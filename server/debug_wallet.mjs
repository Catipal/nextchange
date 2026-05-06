import 'dotenv/config';
import { initDb } from './db/init.js';
import { loadConfig } from './config.js';
import jwt from 'jsonwebtoken';

const db = await initDb(false);
const config = loadConfig();

const users = db.prepare('SELECT id, public_key FROM users LIMIT 5').all();
console.log('Users:', JSON.stringify(users, null, 2));

const addrs = db.prepare("SELECT * FROM deposit_addresses WHERE currency = 'bps' LIMIT 5").all();
console.log('BPS deposit addresses:', JSON.stringify(addrs, null, 2));

// Simulate what happens when getRpc is called for BPS
import { getRpc } from './services/rpc.js';
const rpc = getRpc('bps');
console.log('\nRPC type for BPS:', rpc.constructor.name);
console.log('BPS_INTEGRATED_NODE env:', process.env.BPS_INTEGRATED_NODE);

// If there's a user, simulate their JWT
if (users.length > 0) {
  const u = users[0];
  const token = jwt.sign(
    { id: u.id, publicKey: u.public_key },
    config.jwtSecret,
    { expiresIn: '7d' }
  );
  const decoded = jwt.verify(token, config.jwtSecret);
  console.log('\nJWT payload:', decoded);
  console.log('decoded.publicKey:', decoded.publicKey);
  
  // Test the BPS address derivation
  try {
    const addr = await rpc.getNewAddress(decoded.publicKey);
    console.log('BPS address derived:', addr);
  } catch(e) {
    console.log('Error deriving BPS address:', e.message);
  }
}

process.exit(0);
