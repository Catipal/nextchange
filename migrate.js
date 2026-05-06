import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync } from 'fs';

(async () => {
  const SQL = await initSqlJs();
  const file = readFileSync('server/exchange.db');
  const db = new SQL.Database(file);

  let count = 0;
  const blocks = db.exec('SELECT * FROM trade_blocks');
  
  if (blocks.length > 0) {
    const rows = blocks[0].values;
    for (const r of rows) {
      const data = JSON.parse(r[3]); // trade_data
      if (data.type === 'announcement') {
        const index = r[0];
        // delete from trade
        db.run('DELETE FROM trade_blocks WHERE block_index = ?', [index]);
        // insert into registry
        try {
          db.run(
            'INSERT INTO registry_blocks (block_index, previous_hash, timestamp, registry_data, matcher_pubkey, signature, hash) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [index, r[1], r[2], r[3], r[4], r[5], r[6]]
          );
          count++;
        } catch (e) {
          // might fail if it already exists
        }
      }
    }
  }

  const outData = db.export();
  writeFileSync('server/exchange.db', Buffer.from(outData));
  console.log('Migrated ' + count + ' announcement blocks');
})();
