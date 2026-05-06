import { v4 as uuidv4 } from 'uuid';

// Generates a fake but realistic-looking Bitcoin address for demo mode
export function generateDemoAddress(currency) {
  if (currency === 'eth') return '0x' + Array.from({length: 40}, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
  if (currency === 'btc') return 'bc1q' + Array.from({length: 38}, () => 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'[Math.floor(Math.random() * 32)]).join('');
  if (currency === 'bps') {
    // Valid-looking BPS address (starts with B, correct length)
    // For a demo, a random Base58-like string is usually okay unless they validate checksum.
    // I'll provide a 'stable' demo address.
    return 'B' + Array.from({length: 33}, () => '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'[Math.floor(Math.random() * 58)]).join('');
  }
  return 'demo_address_for_' + currency;
}

export function generateId() {
  return uuidv4();
}

export function satoshiRound(value) {
  return Math.round(value * 1e8) / 1e8;
}
