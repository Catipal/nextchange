import * as bitcoin from 'bitcoinjs-lib';

const pubkeyHex = '0279BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798';
const pubBytes = Buffer.from(pubkeyHex, 'hex');

for (let i = 0; i < 256; i++) {
  try {
    const { address } = bitcoin.payments.p2pkh({ 
        pubkey: pubBytes,
        network: {
            messagePrefix: '\x18BitcoinPoS Signed Message:\n',
            bech32: 'bps',
            bip32: { public: 0x0488b21e, private: 0x0488ade4 },
            pubKeyHash: i,
            scriptHash: 0x05, 
            wif: 0x83
        }
    });
    if (address.startsWith('4')) {
      console.log(`pubKeyHash: ${i} (0x${i.toString(16)}) -> ${address}`);
    }
  } catch (e) {}
}
