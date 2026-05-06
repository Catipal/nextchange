import Database from 'better-sqlite3';
const db = new Database('./server/db/hub.db');

try {
    const trades = db.prepare('SELECT pair, price FROM trades ORDER BY created_at DESC LIMIT 5').all();
    console.log('Trades:', trades);
    const tickers = db.prepare('SELECT * FROM trades WHERE (pair, created_at) IN (SELECT pair, MAX(created_at) FROM trades GROUP BY pair)').all();
    console.log('Last Prices:', tickers);
} catch (e) {
    console.error(e);
}
