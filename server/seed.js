import { initDb, getDb } from './db/init.js';
import { generateId } from './utils/helpers.js';
import bcrypt from 'bcryptjs';

async function seed() {
  await initDb();
  const db = getDb();
  console.log('Seeding liquidity...');
  
  // Create a market maker user
  const mmId = 'MARKET_MAKER_1';
  const passwordHash = await bcrypt.hash('mm_password', 12);
  
  db.prepare('INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)')
    .run(mmId, 'mm@nextchange.hub', passwordHash);
    
  // Give MM some balances
  db.prepare('INSERT OR IGNORE INTO balances (user_id, currency, available, locked) VALUES (?, ?, 10000, 0)')
    .run(mmId, 'btc');
  db.prepare('INSERT OR IGNORE INTO balances (user_id, currency, available, locked) VALUES (?, ?, 10000, 0)')
    .run(mmId, 'eth');
  db.prepare('INSERT OR IGNORE INTO balances (user_id, currency, available, locked) VALUES (?, ?, 1000000, 0)')
    .run(mmId, 'bps');
    
  // ETH/BPS Orders
  // Sell ETH for BPS (Asks)
  for (let i = 0; i < 5; i++) {
    const price = 3.5 + i * 0.1;
    const size = 10 + i * 5;
    db.prepare('INSERT INTO orders (id, user_id, pair, side, type, price, size, filled, status) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)')
      .run(generateId(), mmId, 'ETH/BPS', 'sell', 'limit', price, size, 'open');
  }
  
  // Buy ETH with BPS (Bids)
  for (let i = 0; i < 5; i++) {
    const price = 3.3 - i * 0.1;
    const size = 10 + i * 5;
    db.prepare('INSERT INTO orders (id, user_id, pair, side, type, price, size, filled, status) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)')
      .run(generateId(), mmId, 'ETH/BPS', 'buy', 'limit', price, size, 'open');
  }

  // BTC/BPS Orders
  // Sell BTC for BPS (Asks)
  for (let i = 0; i < 5; i++) {
    const price = 2.5 + i * 0.1;
    const size = 5 + i * 2;
    db.prepare('INSERT INTO orders (id, user_id, pair, side, type, price, size, filled, status) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)')
      .run(generateId(), mmId, 'BTC/BPS', 'sell', 'limit', price, size, 'open');
  }

  // Buy BTC with BPS (Bids)
  for (let i = 0; i < 5; i++) {
    const price = 2.3 - i * 0.1;
    const size = 5 + i * 2;
    db.prepare('INSERT INTO orders (id, user_id, pair, side, type, price, size, filled, status) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)')
      .run(generateId(), mmId, 'BTC/BPS', 'buy', 'limit', price, size, 'open');
  }

  db.saveNow();
  console.log('Seeding complete.');
}

seed().catch(console.error);
