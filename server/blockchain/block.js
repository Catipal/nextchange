import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { signMessage, verifySignature } from '../crypto/identity.js';

/**
 * Trade Block Structure
 * 
 * packaged into a signed block:
 * {
 *   index: number,
 *   previousHash: string (SHA-256),
 *   timestamp: ISO string,
 *   type: 'trade' | 'announcement',
 *   payload: object,
 *   matcherPubKey: string,
 *   signature: string,
 *   hash: string
 * }
 */

// Trade Chain Genesis
export const GENESIS_BLOCK_TRADE = {
  index: 0,
  previousHash: '0'.repeat(64),
  timestamp: '2026-01-01T00:00:00.000Z',
  type: 'trade',
  payload: { id: 'genesis-trade', pair: 'GENESIS', price: 0, size: 0 },
  matcherPubKey: '0'.repeat(66),
  signature: '0'.repeat(128),
  hash: '' // calculated below
};

// Registry Chain Genesis
export const GENESIS_BLOCK_REGISTRY = {
  index: 0,
  previousHash: '0'.repeat(64),
  timestamp: '2026-01-01T00:00:00.000Z',
  type: 'announcement',
  payload: { id: 'genesis-registry', message: 'Registry Chain Started' },
  matcherPubKey: '0'.repeat(66),
  signature: '0'.repeat(128),
  hash: '' // calculated below
};

GENESIS_BLOCK_TRADE.hash = calculateHash(GENESIS_BLOCK_TRADE);
GENESIS_BLOCK_REGISTRY.hash = calculateHash(GENESIS_BLOCK_REGISTRY);

// Backward compat
export const GENESIS_BLOCK = GENESIS_BLOCK_TRADE;

/**
 * Calculate the SHA-256 hash of a block's data.
 */
export function calculateHash(blockData) {
  const content = JSON.stringify({
    index: blockData.index,
    previousHash: blockData.previousHash,
    timestamp: blockData.timestamp,
    type: blockData.type || 'trade',
    payload: blockData.payload || blockData.trade,
    matcherPubKey: blockData.matcherPubKey,
    signature: blockData.signature
  });
  const hash = sha256(new TextEncoder().encode(content));
  return bytesToHex(hash);
}

/**
 * Calculate the SHA-256 hash of a transaction.
 */
export function calculateTxHash(txData) {
  const content = JSON.stringify({
    type: txData.type,
    user_id: txData.user_id,
    data: txData.data,
    created_at: txData.created_at
  });
  const hash = sha256(new TextEncoder().encode(content));
  return bytesToHex(hash);
}

/**
 * Create and sign a new block.
 */
export function createBlock(index, previousHash, payload, matcherPrivateKeyHex, matcherPublicKeyHex, type = 'trade') {
  const timestamp = new Date().toISOString();

  const preSignData = JSON.stringify({
    index,
    previousHash,
    timestamp,
    type,
    payload,
    matcherPubKey: matcherPublicKeyHex
  });

  const signature = signMessage(matcherPrivateKeyHex, preSignData);

  const block = {
    index,
    previousHash,
    timestamp,
    type,
    payload,
    matcherPubKey: matcherPublicKeyHex,
    signature
  };

  block.hash = calculateHash(block);
  return block;
}

/**
 * Validate a block against its predecessor.
 * Checks: hash integrity, chain link, signature, and index sequence.
 * 
 * @param {object} block - The block to validate
 * @param {object} previousBlock - The previous block in the chain
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateBlock(block, previousBlock) {
  // Check index sequence
  if (block.index !== previousBlock.index + 1) {
    return { valid: false, error: `Index mismatch: expected ${previousBlock.index + 1}, got ${block.index}` };
  }

  // Check chain link
  if (block.previousHash !== previousBlock.hash) {
    return { valid: false, error: 'Previous hash does not match' };
  }

  // Check hash integrity (Skip if pruned, payload is missing)
  if (!block.pruned) {
    const recalculatedHash = calculateHash(block);
    if (block.hash !== recalculatedHash) {
      return { valid: false, error: 'Block hash is invalid' };
    }

    // Verify signature
    const preSignData = JSON.stringify({
      index: block.index,
      previousHash: block.previousHash,
      timestamp: block.timestamp,
      type: block.type || 'trade',
      payload: block.payload || block.trade,
      matcherPubKey: block.matcherPubKey
    });

    if (!verifySignature(block.matcherPubKey, preSignData, block.signature)) {
      return { valid: false, error: 'Block signature is invalid' };
    }
  }

  return { valid: true };
}
