import { initDb } from './server/db/init.js';

async function fixDb() {
  const db = await initDb();
  console.log('Connected to DB');
  
  // Delete all BPS deposit addresses to force re-derivation
  const result = db.prepare('DELETE FROM deposit_addresses WHERE currency = ?').run('bps');
  console.log(`Deleted ${result.changes} BPS deposit addresses.`);
  
  // Optionally reset balances if they were demo balances
  // const result2 = db.prepare('UPDATE balances SET available = 0, locked = 0 WHERE currency = ?').run('bps');
  // console.log(`Reset BPS balances.`);
  
  db.saveNow();
  console.log('Database saved.');
}

fixDb().catch(console.error);
