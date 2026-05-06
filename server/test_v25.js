import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function encodeBase58(buffer) {
  let x = BigInt('0x' + bytesToHex(buffer));
  let output = '';
  while (x > 0n) {
    output = ALPHABET[Number(x % 58n)] + output;
    x /= 58n;
  }
  for (let i = 0; i < buffer.length && buffer[i] === 0; i++) {
    output = ALPHABET[0] + output;
  }
  return output;
}

function base58Check(version, hash) {
  const payload = new Uint8Array(1 + hash.length);
  payload[0] = version;
  payload.set(hash, 1);
  const hash1 = nobleSha256(payload);
  const hash2 = nobleSha256(hash1);
  const checksum = hash2.slice(0, 4);
  const final = new Uint8Array(payload.length + 4);
  final.set(payload);
  final.set(checksum, payload.length);
  return encodeBase58(final);
}

const dummyHash = new Uint8Array(20).fill(1);
const v = 25; // Try 25
const addr = base58Check(v, dummyHash);
console.log(`Version ${v} starts with ${addr[0]}: ${addr}`);
