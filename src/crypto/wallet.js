/**
 * Client-side wallet operations.
 * BIP39 mnemonic generation + secp256k1 keypair derivation.
 */

import * as bip39 from 'bip39';
import * as secp256k1 from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { hmac } from '@noble/hashes/hmac.js';

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

export async function generateMnemonic() {
  return bip39.generateMnemonic(256);
}

export async function validateMnemonic(mnemonic) {
  return bip39.validateMnemonic(mnemonic);
}

export async function mnemonicToKeypair(mnemonic, index = 0) {
  const seedBuffer = await bip39.mnemonicToSeed(mnemonic);
  const seedHex = bytesToHex(new Uint8Array(seedBuffer));

  const contextStr = index === 0 ? 'nextchange-hub/secp256k1' : `nextchange-hub/secp256k1/${index}`;
  const context = new TextEncoder().encode(contextStr);
  const seedBytes = new Uint8Array(seedBuffer);
  const combined = new Uint8Array(seedBytes.length + context.length);
  combined.set(seedBytes);
  combined.set(context, seedBytes.length);
  const privateKey = sha256(combined);
  const privateKeyHex = bytesToHex(privateKey);

  const publicKey = secp256k1.getPublicKey(privateKey, true);
  const publicKeyHex = bytesToHex(publicKey);

  return { privateKeyHex, publicKeyHex };
}

export async function signMessage(privateKeyHex, message) {
  const msgBytes = typeof message === 'string' ? new TextEncoder().encode(message) : message;
  const privBytes = typeof privateKeyHex === 'string' ? hexToBytes(privateKeyHex) : privateKeyHex;
  
  let sig;
  try {
    // In v3, we pass the unhashed message and let it hash
    sig = secp256k1.sign(msgBytes, privBytes);
  } catch (e) {
    // Fallback for v2 which expects prehashed
    const msgHash = sha256(msgBytes);
    sig = secp256k1.sign(msgHash, privBytes);
  }

  if (sig.toCompactHex) return sig.toCompactHex();
  if (sig.toHex) return sig.toHex();
  return bytesToHex(sig instanceof Uint8Array ? sig : new Uint8Array(sig));
}

export function createOrderMessage(order) {
  return `ORDER:${order.side}:${order.type}:${order.price || 'market'}:${order.size}:${order.pair}:${order.timestamp}`;
}

export async function deriveUserId(publicKeyHex) {
  const pubBytes = hexToBytes(publicKeyHex);
  const hash = sha256(pubBytes);
  return bytesToHex(hash).slice(0, 16);
}

// ─── PIN-based encryption for private key storage ───

async function deriveEncryptionKey(pin, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt the private key with a PIN.
 * Returns a base64 string containing salt + iv + ciphertext.
 */
export async function encryptPrivateKey(privateKeyHex, pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveEncryptionKey(pin, salt);
  const encoded = new TextEncoder().encode(privateKeyHex);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );
  // Concatenate salt(16) + iv(12) + ciphertext
  const result = new Uint8Array(salt.length + iv.length + new Uint8Array(ciphertext).length);
  result.set(salt, 0);
  result.set(iv, salt.length);
  result.set(new Uint8Array(ciphertext), salt.length + iv.length);
  return btoa(String.fromCharCode(...result));
}

/**
 * Decrypt the private key with a PIN.
 * Returns the hex private key or throws on wrong PIN.
 */
export async function decryptPrivateKey(encryptedBase64, pin) {
  const data = new Uint8Array(atob(encryptedBase64).split('').map(c => c.charCodeAt(0)));
  const salt = data.slice(0, 16);
  const iv = data.slice(16, 28);
  const ciphertext = data.slice(28);
  const key = await deriveEncryptionKey(pin, salt);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );
  return new TextDecoder().decode(decrypted);
}

/**
 * Derives a secondary keypair deterministically from the primary private key.
 * Allows multiple network identities without storing the mnemonic.
 */
export async function deriveSecondaryKey(primaryPrivateKeyHex, index) {
  const privBytes = hexToBytes(primaryPrivateKeyHex);
  const indexBytes = new TextEncoder().encode(`secondary/${index}`);
  const combined = new Uint8Array(privBytes.length + indexBytes.length);
  combined.set(privBytes);
  combined.set(indexBytes, privBytes.length);
  
  const secondaryPriv = sha256(combined);
  const secondaryPrivHex = bytesToHex(secondaryPriv);
  const secondaryPub = secp256k1.getPublicKey(secondaryPriv, true);
  const secondaryPubHex = bytesToHex(secondaryPub);
  
  return { privateKeyHex: secondaryPrivHex, publicKeyHex: secondaryPubHex };
}

/**
 * Base58 alphabet
 */
const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Encodes a Uint8Array to Base58.
 */
function encodeBase58(bytes) {
  let x = BigInt('0x' + bytesToHex(bytes));
  let output = '';
  while (x > 0n) {
    output = B58_ALPHABET[Number(x % 58n)] + output;
    x /= 58n;
  }
  // Handle leading zeros
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
    output = B58_ALPHABET[0] + output;
  }
  return output;
}

/**
 * Converts a public key into a human-readable Hub Address starting with '7'.
 * Format: [Version 0x06] + [Pubkey Hash] + [Checksum]
 */
export function toHubAddress(publicKeyHex) {
  const pubBytes = hexToBytes(publicKeyHex);
  const hash = sha256(pubBytes).slice(0, 20); // First 20 bytes of hash
  
  // Version 0x0F (15) produces prefix '7' in Base58 for 25-byte payloads
  const versioned = new Uint8Array(1 + hash.length);
  versioned[0] = 0x0F;
  versioned.set(hash, 1);
  
  // Double SHA256 checksum (first 4 bytes)
  const checksum = sha256(sha256(versioned)).slice(0, 4);
  
  const final = new Uint8Array(versioned.length + checksum.length);
  final.set(versioned);
  final.set(checksum, versioned.length);
  
  return encodeBase58(final);
}

/**
 * Format a public key for display (truncated).
 * e.g., "03ab4f...c21e"
 */
export function formatPublicKey(publicKeyHex) {
  if (!publicKeyHex || publicKeyHex.length < 12) return publicKeyHex || '';
  return `${publicKeyHex.slice(0, 6)}...${publicKeyHex.slice(-4)}`;
}
