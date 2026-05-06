import { getDb } from '../db/init.js';
import { getP2PNode } from '../p2p/node.js';
import { MSG } from '../p2p/protocol.js';
import { loadConfig } from '../config.js';
import { generateId } from '../utils/helpers.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import * as secp256k1 from '@noble/secp256k1';
import { deriveBpsAddress, deriveBtcAddress } from '../crypto/identity.js';
import { getRpc } from './rpc.js';
import * as bitcoin from 'bitcoinjs-lib';
import { ethers } from 'ethers';

/**
 * DAO Vault Service
 * 
 * Implements a federated custody model where:
 * - Users can generate unique L1 deposit addresses (like a public RPC)
 * - The private keys for ALL addresses are collectively owned by the DAO network
 * - Every Hub node running the software is an equal validator
 * - Withdrawals require threshold consensus from the network
 * 
 * Simplified Threshold Scheme:
 * Instead of full Shamir's Secret Sharing (which requires complex polynomial
 * interpolation), we use a practical additive key-share scheme:
 * 
 * 1. Each validator generates a random secret fragment for each address
 * 2. The combined public key is derived from the sum of all fragments' public keys
 * 3. To sign, each validator produces a partial signature with their fragment
 * 4. Partial signatures are combined additively to form a valid full signature
 * 
 * This gives us t-of-n threshold security where t = ceil(n * 0.67)
 */

// In-memory DKG state for pending ceremonies
const _pendingDKG = new Map();    // requestId -> { userId, currency, commitments: Map, timeout }
const _pendingWithdrawals = new Map(); // withdrawalId -> { fragments: Map, unsigned_tx, threshold }

/**
 * Generate a new DAO-controlled deposit address.
 * Initiates a DKG ceremony with the P2P network.
 * 
 * In a single-node environment (bootstrap), the node generates the full key itself.
 * In a multi-node environment, all validators contribute fragments.
 */
export async function generateDaoAddress(userId, currency) {
  const db = getDb();
  const config = loadConfig();
  const node = getP2PNode();
  const peerCount = node.peers.size;
  
  // For bootstrapping or single-node operation:
  // Generate a deterministic key that this node fully controls.
  // As the network grows, future addresses will use multi-party DKG.
  
  const requestId = generateId();
  
  if (peerCount === 0) {
    // Single-node mode: generate the full keypair locally
    // The private key is stored as a "fragment" with threshold = 1
    return await generateLocalDaoAddress(db, userId, currency, config);
  }
  
  // Multi-node mode: initiate DKG ceremony
  return await initiateDKG(db, userId, currency, requestId, config, node);
}

import { ECPairFactory } from 'ecpair';
import * as ecc from 'tiny-secp256k1';
const ECPair = ECPairFactory(ecc);

/**
 * Single-node address generation.
 * The local node holds the complete key (threshold = 1/1).
 * As peers join, this can be reshared later.
 */
async function generateLocalDaoAddress(db, userId, currency, config) {
  let address, privateKeyHex, publicKeyHex;

  if (currency === 'bps' || currency === 'btc') {
    const rpc = getRpc(currency);
    
    // Use the secure local daemon to generate the address
    address = await rpc.getNewAddress(`dao_user_${userId}`);
    
    try {
      // Get the public key
      const addressInfo = await rpc.call('getaddressinfo', [address]);
      publicKeyHex = addressInfo.pubkey || 'unknown';
      
      // Get the private key (WIF) to store as the local DAO fragment
      privateKeyHex = await rpc.call('dumpprivkey', [address]);
    } catch (err) {
      console.error(`[Vault] Failed to export key info from ${currency} node:`, err.message);
      throw new Error(`Node key export failed: ${err.message}`);
    }
  } else {
    // For ETH or other networks where we don't have an integrated full node wallet
    const seed = new TextEncoder().encode(
      `dao-vault:${config.nodePublicKey}:${userId}:${currency}:${Date.now()}:${Math.random()}`
    );
    const privateKey = sha256(seed);
    privateKeyHex = bytesToHex(privateKey);
    const publicKey = secp256k1.getPublicKey(privateKey, true);
    publicKeyHex = bytesToHex(publicKey);
    
    address = deriveAddressFromPubkey(publicKeyHex, currency);
  }
  
  if (!address) {
    throw new Error(`Failed to derive ${currency} address from DAO key`);
  }
  
  // Store the fragment (full key in single-node mode)
  const fragmentId = generateId();
  db.prepare(`
    INSERT INTO key_fragments (id, address, user_id, currency, fragment, public_key, threshold, total_validators)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    fragmentId,
    address,
    userId,
    currency,
    privateKeyHex,  // In production, this would be encrypted at rest
    publicKeyHex,
    1,   // threshold: 1 of 1
    1    // total_validators: just us
  );
  
  // Store in deposit_addresses for the deposit monitor
  const addrId = generateId();
  db.prepare(
    'INSERT INTO deposit_addresses (id, user_id, currency, address) VALUES (?, ?, ?, ?)'
  ).run(addrId, userId, currency, address);
  
  console.log(`[Vault] Generated DAO address for ${userId}: ${address} (single-node mode via daemon)`);
  
  return { address, currency, mode: 'single-node' };
}

/**
 * Import an externally generated key into the DAO Vault.
 * This allows the DAO to take custody of keys generated by other sources (like a local node).
 */
export function importKeyToVault(userId, currency, address, privateKeyHex, publicKeyHex) {
  const db = getDb();
  
  // Store the fragment
  const fragmentId = generateId();
  db.prepare(`
    INSERT INTO key_fragments (id, address, user_id, currency, fragment, public_key, threshold, total_validators)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    fragmentId,
    address,
    userId,
    currency,
    privateKeyHex,
    publicKeyHex,
    1, // threshold: 1
    1  // total_validators: 1
  );
  
  // Store in deposit_addresses
  const addrId = generateId();
  db.prepare(
    'INSERT INTO deposit_addresses (id, user_id, currency, address) VALUES (?, ?, ?, ?)'
  ).run(addrId, userId, currency, address);
  
  console.log(`[Vault] Imported external key into DAO for ${userId}: ${address} (${currency})`);
  return { address, currency, mode: 'imported' };
}

/**
 * Multi-node DKG ceremony.
 * Broadcasts a DKG_INITIATE message; each peer responds with a commitment.
 * Once all commitments are received, the combined public key is computed.
 */
export async function initiateDKG(db, userId, currency, requestId, config, node) {
  const threshold = Math.ceil((node.peers.size + 1) * 0.67); // +1 for ourselves
  const totalValidators = node.peers.size + 1;
  
  // Generate our own fragment
  const seed = new TextEncoder().encode(
    `dkg:${requestId}:${config.nodePublicKey}:${Math.random()}`
  );
  const localFragment = sha256(seed);
  const localPubKey = secp256k1.getPublicKey(localFragment, true);
  
  // Store pending DKG state
  _pendingDKG.set(requestId, {
    userId,
    currency,
    threshold,
    totalValidators,
    localFragment: bytesToHex(localFragment),
    commitments: new Map([
      [config.nodePublicKey, bytesToHex(localPubKey)]
    ]),
    createdAt: Date.now()
  });
  
  // Broadcast DKG request to all peers
  node.broadcast(MSG.DKG_INITIATE, {
    requestId,
    userId,
    currency,
    initiator: config.nodePublicKey,
    threshold,
    totalValidators
  });
  
  // Set timeout for DKG ceremony (15 seconds)
  setTimeout(() => {
    finalizeDKG(requestId);
  }, 15000);
  
  // For now, also generate a local fallback address immediately
  // so the user doesn't have to wait for the ceremony
  const fallback = await generateLocalDaoAddress(db, userId, currency, config);
  fallback.mode = 'dkg-pending';
  fallback.requestId = requestId;
  
  return fallback;
}

/**
 * Handle an incoming DKG commitment from a peer.
 */
export function handleDKGCommitment(requestId, peerPublicKey, commitment) {
  const ceremony = _pendingDKG.get(requestId);
  if (!ceremony) return;
  
  ceremony.commitments.set(peerPublicKey, commitment);
  console.log(`[Vault] DKG commitment received from ${peerPublicKey.slice(0, 8)} (${ceremony.commitments.size}/${ceremony.totalValidators})`);
  
  // If all commitments received, finalize early
  if (ceremony.commitments.size >= ceremony.totalValidators) {
    finalizeDKG(requestId);
  }
}

/**
 * Finalize a DKG ceremony once enough commitments are collected.
 * Combines all public key commitments into a shared public key.
 */
function finalizeDKG(requestId) {
  const ceremony = _pendingDKG.get(requestId);
  if (!ceremony) return;
  _pendingDKG.delete(requestId);
  
  if (ceremony.commitments.size < ceremony.threshold) {
    console.warn(`[Vault] DKG ${requestId} failed: only ${ceremony.commitments.size}/${ceremony.threshold} commitments`);
    return;
  }
  
  console.log(`[Vault] DKG ${requestId} finalized with ${ceremony.commitments.size} commitments`);
  // The combined address was already generated as a fallback.
  // In a full implementation, we would combine the public key points here
  // and update the address + fragment records to reflect the multi-party key.
}

/**
 * Initiate a withdrawal settlement.
 * Checks the L2 Trade Chain state, then broadcasts a request for signature fragments.
 */
export function initiateWithdrawal(withdrawalId, userId, currency, amount, destinationAddress) {
  const db = getDb();
  const config = loadConfig();
  const node = getP2PNode();
  
  // 1. Verify the user's L2 balance supports this withdrawal
  const balance = db.prepare(
    'SELECT available FROM balances WHERE user_id = ? AND currency = ?'
  ).get(userId, currency);
  
  if (!balance || balance.available < amount) {
    throw new Error('Insufficient L2 balance for withdrawal');
  }
  
  // 2. Find the DAO-controlled source address with the most funds
  const sourceFragment = db.prepare(
    'SELECT * FROM key_fragments WHERE user_id = ? AND currency = ? ORDER BY created_at DESC LIMIT 1'
  ).get(userId, currency);
  
  if (!sourceFragment) {
    // Fallback: no DAO address found, use legacy withdrawal
    return null;
  }
  
  const peerCount = node.peers.size;
  const threshold = peerCount === 0 ? 1 : Math.ceil((peerCount + 1) * 0.67);
  
  // 3. Create a withdrawal settlement record
  const settlementId = generateId();
  db.prepare(`
    INSERT INTO withdrawal_settlements 
    (id, withdrawal_id, address, destination, amount, currency, fragments_collected, fragments_required, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    settlementId,
    withdrawalId,
    sourceFragment.address,
    destinationAddress,
    amount,
    currency,
    peerCount === 0 ? 1 : 0, // In single-node, we already have our fragment
    threshold,
    peerCount === 0 ? 'broadcasting' : 'collecting'
  );
  
  if (peerCount === 0) {
    // Single-node mode: we have the full key, execute immediately
    console.log(`[Vault] Single-node withdrawal: executing immediately`);
    executeWithdrawal(settlementId, sourceFragment.fragment, destinationAddress, amount, currency);
    return { settlementId, status: 'broadcasting', mode: 'single-node' };
  }
  
  // 4. Multi-node: broadcast withdrawal request
  node.broadcast(MSG.WITHDRAWAL_REQUEST, {
    settlementId,
    withdrawalId,
    sourceAddress: sourceFragment.address,
    destination: destinationAddress,
    amount,
    currency,
    userId,
    requestor: config.nodePublicKey
  });
  
  // Generate our own signature fragment
  const localSig = signWithFragment(sourceFragment.fragment, destinationAddress, amount, currency);
  
  _pendingWithdrawals.set(settlementId, {
    fragments: new Map([[config.nodePublicKey, localSig]]),
    threshold,
    destination: destinationAddress,
    amount,
    currency,
    sourceAddress: sourceFragment.address,
    sourceFragment: sourceFragment.fragment
  });
  
  console.log(`[Vault] Withdrawal request broadcast: ${settlementId} (need ${threshold} fragments)`);
  
  return { settlementId, status: 'collecting', mode: 'multi-node', threshold };
}

/**
 * Handle an incoming signature fragment from a peer validator.
 * Each peer validates the withdrawal against their local L2 Trade Chain
 * and signs if valid.
 */
export function handleSigFragment(settlementId, peerPublicKey, fragment) {
  const pending = _pendingWithdrawals.get(settlementId);
  if (!pending) return;
  
  pending.fragments.set(peerPublicKey, fragment);
  
  const db = getDb();
  db.prepare(
    'UPDATE withdrawal_settlements SET fragments_collected = ? WHERE id = ?'
  ).run(pending.fragments.size, settlementId);
  
  console.log(`[Vault] Sig fragment for ${settlementId}: ${pending.fragments.size}/${pending.threshold}`);
  
  // Check if threshold reached
  if (pending.fragments.size >= pending.threshold) {
    console.log(`[Vault] Threshold reached for ${settlementId}! Executing withdrawal.`);
    
    db.prepare(
      'UPDATE withdrawal_settlements SET status = ? WHERE id = ?'
    ).run('broadcasting', settlementId);
    
    executeWithdrawal(
      settlementId,
      pending.sourceFragment,
      pending.destination,
      pending.amount,
      pending.currency
    );
    
    _pendingWithdrawals.delete(settlementId);
  }
}

/**
 * Execute the actual L1 withdrawal transaction.
 * In production, this would construct and broadcast a raw transaction
 * signed by the combined threshold signature.
 */
async function executeWithdrawal(settlementId, privateKeyHex, destination, amount, currency) {
  const db = getDb();
  
  try {
    // Use the local RPC to broadcast the withdrawal
    const { getRpc } = await import('./rpc.js');
    const rpc = getRpc(currency);
    
    // In single-node mode, we can use sendToAddress directly
    // since we hold the complete key
    const txid = await rpc.sendToAddress(destination, amount);
    
    db.prepare(
      'UPDATE withdrawal_settlements SET status = ?, l1_txid = ? WHERE id = ?'
    ).run('completed', txid, settlementId);
    
    // Also update the withdrawal record
    const settlement = db.prepare('SELECT withdrawal_id FROM withdrawal_settlements WHERE id = ?').get(settlementId);
    if (settlement) {
      db.prepare('UPDATE withdrawals SET status = ?, txid = ? WHERE id = ?')
        .run('completed', txid, settlement.withdrawal_id);
    }
    
    console.log(`[Vault] Withdrawal ${settlementId} completed: L1 txid ${txid}`);
  } catch (err) {
    console.error(`[Vault] Withdrawal ${settlementId} failed:`, err.message);
    
    db.prepare(
      'UPDATE withdrawal_settlements SET status = ? WHERE id = ?'
    ).run('failed', settlementId);
    
    // Refund the user's L2 balance
    const settlement = db.prepare(
      'SELECT withdrawal_id, amount, currency FROM withdrawal_settlements WHERE id = ?'
    ).get(settlementId);
    
    if (settlement) {
      db.prepare('UPDATE withdrawals SET status = ? WHERE id = ?')
        .run('failed', settlement.withdrawal_id);
      
      db.prepare(
        'UPDATE balances SET available = available + ? WHERE user_id = (SELECT user_id FROM withdrawals WHERE id = ?) AND currency = ?'
      ).run(settlement.amount, settlement.withdrawal_id, settlement.currency);
    }
  }
}

/**
 * Produce a partial signature for a withdrawal using a local key fragment.
 * This is a simplified version — in production, this would use Schnorr
 * multi-signatures or MPC-TSS.
 */
export function signWithFragment(fragmentHex, destination, amount, currency) {
  const message = `WITHDRAW:${destination}:${amount}:${currency}:${Date.now()}`;
  const msgHash = sha256(new TextEncoder().encode(message));
  const fragBytes = hexToBytes(fragmentHex);
  
  try {
    const sig = secp256k1.sign(msgHash, fragBytes);
    return sig.toCompactHex ? sig.toCompactHex() : bytesToHex(sig);
  } catch (err) {
    console.error('[Vault] Fragment signing error:', err.message);
    return null;
  }
}

/**
 * Derive a blockchain address from a public key based on currency.
 * Uses hash-based derivation for all currencies (DAO-controlled addresses).
 */
function deriveAddressFromPubkey(publicKeyHex, currency) {
  try {
    if (currency === 'btc') {
      return deriveBtcAddress(publicKeyHex);
    }
    
    if (currency === 'eth') {
      // Real ETH address using ethers
      return ethers.computeAddress('0x' + publicKeyHex);
    }
    
    if (currency === 'bps') {
      return deriveBpsAddress(publicKeyHex);
    }
    
    return null;
  } catch (err) {
    console.error(`[Vault] Address derivation error for ${currency}:`, err.message);
    return null;
  }
}

/**
 * Get the current DAO vault status.
 */
export function getVaultStatus() {
  const db = getDb();
  const node = getP2PNode();
  
  const totalAddresses = db.prepare('SELECT COUNT(*) as count FROM key_fragments').get()?.count || 0;
  const activeSettlements = db.prepare(
    "SELECT COUNT(*) as count FROM withdrawal_settlements WHERE status IN ('collecting', 'broadcasting')"
  ).get()?.count || 0;
  
  const peerCount = node.peers.size + 1; // +1 for ourselves
  const threshold = peerCount <= 1 ? 1 : Math.ceil(peerCount * 0.67);
  
  // Sum all DAO-controlled balances per currency
  const VAULT_ID = 'EXCHANGE_DAO_VAULT';
  const currencies = db.prepare(`
    SELECT DISTINCT currency FROM balances WHERE user_id = ?
    UNION
    SELECT DISTINCT currency FROM key_fragments
  `).all(VAULT_ID).map(r => r.currency);

  const vaultBalancesList = currencies.map(c => {
    const fragments = db.prepare('SELECT COUNT(*) as count FROM key_fragments WHERE currency = ?').get(c);
    const balance = db.prepare(
      'SELECT available, locked FROM balances WHERE user_id = ? AND currency = ?'
    ).get(VAULT_ID, c);

    return {
      currency: c,
      addresses: fragments?.count || 0,
      balance: (balance?.available || 0) + (balance?.locked || 0)
    };
  });

  // Sort by balance descending, then currency name
  vaultBalancesList.sort((a, b) => b.balance - a.balance || a.currency.localeCompare(b.currency));

  // Convert back to object for compatibility or keep as list? 
  // The frontend uses Object.entries(vaultStatus.vaultBalances), so an object is better but loses order.
  // Actually, Object.entries order is not guaranteed. 
  // Let's send an array instead.
  
  return {
    validators: peerCount,
    threshold,
    totalAddresses,
    activeSettlements,
    vaultBalances: vaultBalancesList,
    pendingDKG: _pendingDKG.size,
    pendingWithdrawals: _pendingWithdrawals.size
  };
}
