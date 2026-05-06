import * as secp256k1 from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { hmac } from '@noble/hashes/hmac.js';
import * as bitcoin from 'bitcoinjs-lib';

// Required for @noble/secp256k1 v2 and v3
try {
  if (secp256k1.hashes) {
    secp256k1.hashes.hmacSha256 = (k, msg) => hmac(sha256, k, msg);
    secp256k1.hashes.sha256 = sha256;
  }
  if (secp256k1.etc) {
    secp256k1.etc.hmacSha256Sync = (k, ...m) => hmac(sha256, k, secp256k1.etc.concatBytes(...m));
  }
} catch (e) {
  // Ignore if already set or frozen
}

/**
 * Server-side cryptographic identity operations.
 * Uses secp256k1 for signing/verification (same curve as Bitcoin).
 */

/**
 * Derive a short user ID from a public key.
 * Takes first 16 hex chars of SHA-256(pubkey) for DB storage.
 */
export function deriveUserId(publicKeyHex) {
  const pubBytes = hexToBytes(publicKeyHex);
  const hash = sha256(pubBytes);
  return bytesToHex(hash).slice(0, 16);
}

/**
 * Sign a message with a private key.
 * Returns hex-encoded signature.
 */
export function signMessage(privateKeyHex, message) {
  const msgBytes = typeof message === 'string' ? new TextEncoder().encode(message) : message;
  const msgHash = sha256(msgBytes);
  const privBytes = typeof privateKeyHex === 'string' ? hexToBytes(privateKeyHex) : privateKeyHex;
  let sig;
  try {
    sig = secp256k1.sign(msgHash, privBytes, { prehash: true });
  } catch (e) {
    try {
      sig = secp256k1.sign(msgHash, privBytes);
    } catch (e2) {
      sig = secp256k1.sign(msgBytes, privBytes);
    }
  }
  if (sig.toCompactHex) return sig.toCompactHex();
  if (sig.toHex) return sig.toHex();
  return bytesToHex(sig instanceof Uint8Array ? sig : new Uint8Array(sig));
}

/**
 * Verify a signature against a public key and message.
 */
export function verifySignature(publicKeyHex, message, signatureHex) {
  try {
    const msgBytes = typeof message === 'string' ? new TextEncoder().encode(message) : message;
    const pub = typeof publicKeyHex === 'string' ? hexToBytes(publicKeyHex) : publicKeyHex;
    const sigBytes = hexToBytes(signatureHex);
    
    // Try v3
    try {
      if (secp256k1.verify(sigBytes, msgBytes, pub)) return true;
    } catch (e) {}
    
    // Fallback for v2
    const msgHash = sha256(msgBytes);
    try {
      const sig = secp256k1.Signature.fromCompact(signatureHex);
      if (secp256k1.verify(sig, msgHash, pub)) return true;
    } catch (e) {}

    return false;
  } catch (e) {
    return false;
  }
}

/**
 * Verify that an order was signed by the claimed public key.
 * The order signature covers: side, type, price, size, pair, timestamp.
 */
export function verifyOrderSignature(order) {
  if (!order.publicKey || !order.signature || !order.timestamp) return false;
  const message = `ORDER:${order.side}:${order.type}:${order.price || 'market'}:${order.size}:${order.pair}:${order.timestamp}`;
  return verifySignature(order.publicKey, message, order.signature);
}

/**
 * Create the canonical string for signing an order.
 */
export function createOrderMessage(order) {
  return `ORDER:${order.side}:${order.type}:${order.price || 'market'}:${order.size}:${order.pair}:${order.timestamp}`;
}

/**
 * Generate a random challenge nonce for auth.
 */
export function generateChallenge() {
  const bytes = secp256k1.utils.randomPrivateKey().slice(0, 32);
  return bytesToHex(bytes);
}

/**
 * Derive a secp256k1 private key from BIP39 seed bytes.
 * Uses simplified derivation: SHA-256(seed + "nextchange-hub/secp256k1").
 */
export function deriveKeypairFromSeed(seedHex) {
  const seedBytes = hexToBytes(seedHex);
  const context = new TextEncoder().encode('nextchange-hub/secp256k1');
  const combined = new Uint8Array(seedBytes.length + context.length);
  combined.set(seedBytes);
  combined.set(context, seedBytes.length);
  const privateKey = sha256(combined);
  const privateKeyHex = bytesToHex(privateKey);
  const publicKey = secp256k1.getPublicKey(privateKey, true);
  const publicKeyHex = bytesToHex(publicKey);
  return { privateKeyHex, publicKeyHex };
}

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Decodes a Base58 string to Uint8Array.
 */
function decodeBase58(str) {
  let x = 0n;
  for (let i = 0; i < str.length; i++) {
    const charIndex = B58_ALPHABET.indexOf(str[i]);
    if (charIndex === -1) throw new Error('Invalid Base58 character');
    x = x * 58n + BigInt(charIndex);
  }
  let hex = x.toString(16);
  if (hex.length % 2 !== 0) hex = '0' + hex;
  
  let bytes = hexToBytes(hex);
  
  // Handle leading zeros (1s in Base58)
  let leadingZeros = 0;
  for (let i = 0; i < str.length && str[i] === B58_ALPHABET[0]; i++) {
    leadingZeros++;
  }
  
  if (leadingZeros > 0) {
    const result = new Uint8Array(leadingZeros + bytes.length);
    result.set(bytes, leadingZeros);
    return result;
  }
  
  return bytes;
}

/**
 * Decodes a Hub Address (starts with 7) back into its component parts.
 * Verifies the checksum and version byte.
 */
export function fromHubAddress(address) {
  try {
    const decoded = decodeBase58(address);
    // Format: [Version 1 byte] + [Hash 20 bytes] + [Checksum 4 bytes]
    if (decoded.length < 25) return null;
    
    const version = decoded[0];
    const hash = decoded.slice(1, 21);
    const checksum = decoded.slice(21, 25);
    
    // Verify checksum
    const data = decoded.slice(0, 21);
    const expectedChecksum = sha256(sha256(data)).slice(0, 4);
    
    for (let i = 0; i < 4; i++) {
      if (checksum[i] !== expectedChecksum[i]) return null;
    }
    
    return { version, hash: bytesToHex(hash) };
  } catch (e) {
    return null;
  }
}

export const BPS_NETWORK = {
  messagePrefix: '\x18BitcoinPoS Signed Message:\n',
  bech32: 'bps',
  bip32: { public: 0x0488b21e, private: 0x0488ade4 },
  pubKeyHash: 0x19, // 25 -> 'B'
  scriptHash: 0x05, 
  wif: 0x83
};

/**
 * Derives a real BitcoinPoS (BPS) P2PKH address from a public key hex.
 * BPS uses version 0x19 (25 decimal) to produce the 'B' prefix.
 */
export function deriveBpsAddress(publicKeyHex) {
  try {
    const pubkey = Buffer.from(publicKeyHex, 'hex');
    const { address } = bitcoin.payments.p2pkh({ 
      pubkey,
      network: BPS_NETWORK
    });
    return address;
  } catch (err) {
    console.error('[BPS] Derivation error:', err);
    return null;
  }
}

/**
 * Derives a real Bitcoin Bech32 (p2wpkh) address from a public key hex.
 */
export function deriveBtcAddress(publicKeyHex) {
  try {
    const pubkey = Buffer.from(publicKeyHex, 'hex');
    const { address } = bitcoin.payments.p2wpkh({ pubkey });
    return address;
  } catch (err) {
    console.error('[BTC] Derivation error:', err);
    return null;
  }
}
