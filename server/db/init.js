import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DB_PATH = join(__dirname, '..', '..', 'exchange.db');

let db;
let saveTimer;

class DbWrapper {
  constructor(sqlDb) { this._db = sqlDb; this._dirty = false; }

  exec(sql) { this._db.run(sql); this._markDirty(); }

  prepare(sql) { return new PreparedStatement(this, sql); }

  pragma(p) { try { this._db.run(`PRAGMA ${p}`); } catch {} }

  transaction(fn) {
    return (...args) => {
      this._db.run('BEGIN TRANSACTION');
      try {
        const result = fn(...args);
        this._db.run('COMMIT');
        this._markDirty();
        return result;
      } catch (err) {
        this._db.run('ROLLBACK');
        throw err;
      }
    };
  }

  _markDirty() {
    this._dirty = true;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => this._save(), 1000);
  }

  _save() {
    if (!this._dirty) return;
    try {
      const data = this._db.export();
      writeFileSync(DB_PATH, Buffer.from(data));
      this._dirty = false;
    } catch (err) { console.error('[DB] Save error:', err.message); }
  }

  saveNow() { if (saveTimer) clearTimeout(saveTimer); this._save(); }
}

class PreparedStatement {
  constructor(wrapper, sql) { this._wrapper = wrapper; this._sql = sql; }

  run(...params) {
    const flatParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
    this._wrapper._db.run(this._sql, flatParams);
    this._wrapper._markDirty();
    return { changes: this._wrapper._db.getRowsModified() };
  }

  get(...params) {
    const flatParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
    const stmt = this._wrapper._db.prepare(this._sql);
    stmt.bind(flatParams);
    if (stmt.step()) { const row = stmt.getAsObject(); stmt.free(); return row; }
    stmt.free();
    return undefined;
  }

  all(...params) {
    const flatParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
    const results = [];
    const stmt = this._wrapper._db.prepare(this._sql);
    if (flatParams.length > 0) stmt.bind(flatParams);
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    return results;
  }
}

export async function initDb(freshStart = false) {
  if (db) return db;
  const SQL = await initSqlJs();

  if (freshStart && existsSync(DB_PATH)) {
    const { unlinkSync } = await import('fs');
    try { unlinkSync(DB_PATH); console.log('[DB] Fresh start — deleted old database'); } catch {}
  }

  if (!freshStart && existsSync(DB_PATH)) {
    const fileBuffer = readFileSync(DB_PATH);
    db = new DbWrapper(new SQL.Database(fileBuffer));
    console.log('[DB] Loaded existing database');
  } else {
    db = new DbWrapper(new SQL.Database());
    console.log('[DB] Created new database');
  }

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);

  process.on('exit', () => db.saveNow());
  process.on('SIGINT', () => { db.saveNow(); process.exit(); });

  return db;
}

export function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      public_key TEXT UNIQUE NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS balances (
      user_id TEXT NOT NULL,
      currency TEXT NOT NULL,
      available REAL DEFAULT 0,
      locked REAL DEFAULT 0,
      PRIMARY KEY (user_id, currency)
    );

    CREATE TABLE IF NOT EXISTS deposit_addresses (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      currency TEXT NOT NULL,
      address TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS deposits (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      currency TEXT NOT NULL,
      amount REAL NOT NULL,
      txid TEXT,
      address TEXT,
      confirmations INTEGER DEFAULT 0,
      required_confirmations INTEGER DEFAULT 1,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS withdrawals (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      currency TEXT NOT NULL,
      amount REAL NOT NULL,
      fee REAL DEFAULT 0,
      address TEXT NOT NULL,
      txid TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      public_key TEXT,
      side TEXT NOT NULL,
      type TEXT NOT NULL,
      price REAL,
      size REAL NOT NULL,
      filled REAL DEFAULT 0,
      status TEXT DEFAULT 'open',
      pair TEXT DEFAULT 'BTC/BPS',
      signature TEXT,
      source TEXT DEFAULT 'local',
      is_reward INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      buy_order_id TEXT NOT NULL,
      sell_order_id TEXT NOT NULL,
      buyer_id TEXT NOT NULL,
      seller_id TEXT NOT NULL,
      price REAL NOT NULL,
      size REAL NOT NULL,
      buyer_fee REAL DEFAULT 0,
      seller_fee REAL DEFAULT 0,
      pair TEXT DEFAULT 'BTC/BPS',
      block_hash TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS trade_blocks (
      block_index INTEGER PRIMARY KEY,
      previous_hash TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      trade_data TEXT NOT NULL,
      matcher_pubkey TEXT NOT NULL,
      signature TEXT NOT NULL,
      hash TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS registry_blocks (
      block_index INTEGER PRIMARY KEY,
      previous_hash TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      registry_data TEXT NOT NULL,
      matcher_pubkey TEXT NOT NULL,
      signature TEXT NOT NULL,
      hash TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vault_rewards (
      id TEXT PRIMARY KEY,
      pair TEXT NOT NULL,
      currency TEXT NOT NULL,
      total_amount REAL NOT NULL,
      recipient_count INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS auth_challenges (
      id TEXT PRIMARY KEY,
      public_key TEXT NOT NULL,
      challenge TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS known_peers (
      address TEXT PRIMARY KEY,
      public_key TEXT,
      last_seen TEXT DEFAULT (datetime('now')),
      is_bootstrap INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS pending_transactions (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      user_id TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      hash TEXT UNIQUE
    );

    CREATE TABLE IF NOT EXISTS locked_rewards (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      pair TEXT NOT NULL,
      currency TEXT NOT NULL,
      amount REAL NOT NULL,
      price REAL NOT NULL,
      mature_at_block INTEGER NOT NULL,
      status TEXT DEFAULT 'locked',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS brain_sectors (
      id TEXT PRIMARY KEY,
      layer TEXT NOT NULL,
      name TEXT NOT NULL,
      domain TEXT NOT NULL,
      entropy REAL DEFAULT 1.0,
      status TEXT DEFAULT 'active',
      centroid TEXT, -- JSON array of floats for semantic centering
      model_repo_id TEXT, -- e.g., 'microsoft/phi-2'
      model_hash TEXT,    -- SHA-256 for verification
      benchmark_score REAL DEFAULT 0.0,
      provider_address TEXT, -- Wallet address of the current top provider
      created_by TEXT,
      pruned_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_inference_nodes (
      node_id TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      model_tier TEXT NOT NULL, -- 'macro' or 'micro'
      model_repo_id TEXT NOT NULL,
      capabilities TEXT DEFAULT 'general', -- 'logic', 'creative', 'general'
      benchmark_score REAL DEFAULT 0.0,
      total_earned_bps REAL DEFAULT 0.0,
      status TEXT DEFAULT 'active',
      last_seen TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS training_submissions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      sector_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      correction TEXT NOT NULL,
      entropy_before REAL NOT NULL,
      entropy_after REAL NOT NULL,
      entropy_delta REAL NOT NULL,
      reward_bps REAL DEFAULT 0,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ai_interactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      sector_id TEXT,
      query TEXT NOT NULL,
      response TEXT NOT NULL,
      feedback INTEGER DEFAULT 0,
      triggered_update INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS evolutive_memory (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      sector_id TEXT NOT NULL,
      content TEXT NOT NULL,
      vector TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS linguistic_weights (
      phrase TEXT PRIMARY KEY,
      weight REAL DEFAULT 1.0,
      usage_count INTEGER DEFAULT 0,
      last_used TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS key_fragments (
      id TEXT PRIMARY KEY,
      address TEXT NOT NULL,
      user_id TEXT,
      currency TEXT NOT NULL,
      fragment TEXT NOT NULL,
      public_key TEXT,
      threshold INTEGER NOT NULL,
      total_validators INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS withdrawal_settlements (
      id TEXT PRIMARY KEY,
      withdrawal_id TEXT NOT NULL,
      address TEXT NOT NULL,
      destination TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      unsigned_tx TEXT,
      fragments_collected INTEGER DEFAULT 0,
      fragments_required INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      l1_txid TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  const sectorCount = db.prepare('SELECT COUNT(*) as count FROM brain_sectors').get().count;
  if (sectorCount === 0) {
    seedDefaultSectors(db);
  }

  // Migration: ensure locked_rewards has pair and price columns
  try {
    db.prepare("ALTER TABLE locked_rewards ADD COLUMN pair TEXT").run();
    console.log("[DB] Migration: Added pair to locked_rewards");
  } catch (e) { /* already exists */ }

  try {
    db.prepare("ALTER TABLE locked_rewards ADD COLUMN price REAL").run();
    console.log("[DB] Migration: Added price to locked_rewards");
  } catch (e) { /* already exists */ }

  try {
    db.prepare("ALTER TABLE ai_inference_nodes ADD COLUMN capabilities TEXT DEFAULT 'general'").run();
    console.log("[DB] Migration: Added capabilities to ai_inference_nodes");
  } catch (e) { /* already exists */ }

  try {
    db.prepare("ALTER TABLE ai_inference_nodes ADD COLUMN context_size INTEGER DEFAULT 2048").run();
    console.log("[DB] Migration: Added context_size to ai_inference_nodes");
  } catch (e) { /* already exists */ }

  // Cleanup: Mark all nodes as inactive on startup to clear stale session states
  try {
    db.prepare("UPDATE ai_inference_nodes SET status = 'inactive'").run();
    console.log("[DB] Stale inference nodes marked as inactive");
  } catch (e) { /* table might not exist yet */ }

  console.log('[DB] Schema initialized (v2 — P2P + seed phrase)');
}

const DEFAULT_SECTORS = [
  { layer: 'router', name: 'Global Router',       domain: 'routing' },
  { layer: 'macro',  name: 'Market Intelligence', domain: 'market_analysis' },
  { layer: 'macro',  name: 'AI & Systems Theory', domain: 'ai_theory' },
  { layer: 'micro',  name: 'BTC/BPS Analysis',    domain: 'btc_bps' },
  { layer: 'micro',  name: 'ETH/BPS Analysis',    domain: 'eth_bps' },
  { layer: 'micro',  name: 'Trading Strategies',  domain: 'strategy' },
];

function seedDefaultSectors(db) {
  const { v4: uuidv4 } = { v4: () => Math.random().toString(36).slice(2) + Date.now().toString(36) };
  const existing = db.prepare('SELECT COUNT(*) as count FROM brain_sectors').get();
  if (existing.count > 0) return;
  for (const s of DEFAULT_SECTORS) {
    const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    db.prepare(
      `INSERT INTO brain_sectors (id, layer, name, domain, entropy, status) VALUES (?, ?, ?, ?, 1.0, 'active')`
    ).run(id, s.layer, s.name, s.domain);
  }
  console.log('[DB] Seeded 6 default brain sectors');
}

