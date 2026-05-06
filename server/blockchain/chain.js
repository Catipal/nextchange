import { getDb } from '../db/init.js';
import { GENESIS_BLOCK_TRADE, GENESIS_BLOCK_REGISTRY, validateBlock, calculateHash } from './block.js';

/**
 * TradeChain — manages the local trade blockchain.
 * Stores blocks in SQLite for persistence.
 */
/**
 * Blockchain — generic class to manage a local signed chain.
 */
export class Blockchain {
  constructor(tableName, genesisBlock, dataFieldName = 'trade_data') {
    this.tableName = tableName;
    this.genesisBlock = genesisBlock;
    this.dataFieldName = dataFieldName;
    this._initialized = false;
  }

  initialize() {
    if (this._initialized) return;
    const db = getDb();

    const genesis = db.prepare(`SELECT * FROM ${this.tableName} WHERE block_index = 0`).get();
    if (!genesis) {
      db.prepare(
        `INSERT INTO ${this.tableName} (block_index, previous_hash, timestamp, ${this.dataFieldName}, matcher_pubkey, signature, hash)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        this.genesisBlock.index,
        this.genesisBlock.previousHash,
        this.genesisBlock.timestamp,
        JSON.stringify({ type: this.genesisBlock.type, payload: this.genesisBlock.payload }),
        this.genesisBlock.matcherPubKey,
        this.genesisBlock.signature,
        this.genesisBlock.hash
      );
      console.log(`[Chain] Genesis block created for ${this.tableName}`);
    }

    this._initialized = true;
  }

  getLatestBlock() {
    const db = getDb();
    const row = db.prepare(`SELECT * FROM ${this.tableName} ORDER BY block_index DESC LIMIT 1`).get();
    return row ? this._rowToBlock(row) : this.genesisBlock;
  }

  getHeight() {
    const db = getDb();
    const row = db.prepare(`SELECT MAX(block_index) as height FROM ${this.tableName}`).get();
    return row?.height ?? 0;
  }

  addBlock(block) {
    const db = getDb();
    const latestBlock = this.getLatestBlock();

    const validation = validateBlock(block, latestBlock);
    if (!validation.valid) return { success: false, error: validation.error };

    const existing = db.prepare(`SELECT hash FROM ${this.tableName} WHERE hash = ?`).get(block.hash);
    if (existing) return { success: false, error: 'Block already exists' };

    db.prepare(
      `INSERT INTO ${this.tableName} (block_index, previous_hash, timestamp, ${this.dataFieldName}, matcher_pubkey, signature, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      block.index,
      block.previousHash,
      block.timestamp,
      JSON.stringify({ type: block.type, payload: block.payload }),
      block.matcherPubKey,
      block.signature,
      block.hash
    );

    return { success: true };
  }

  getBlockByHash(hash) {
    const db = getDb();
    const row = db.prepare(`SELECT * FROM ${this.tableName} WHERE hash = ?`).get(hash);
    return row ? this._rowToBlock(row) : null;
  }

  getBlockByIndex(index) {
    const db = getDb();
    const row = db.prepare(`SELECT * FROM ${this.tableName} WHERE block_index = ?`).get(index);
    return row ? this._rowToBlock(row) : null;
  }

  getRecentBlocks(limit = 20) {
    const db = getDb();
    const rows = db.prepare(`SELECT * FROM ${this.tableName} ORDER BY block_index DESC LIMIT ?`).all(limit);
    return rows.map(r => this._rowToBlock(r)).reverse();
  }

  validateChain() {
    const db = getDb();
    const blocks = db.prepare(`SELECT * FROM ${this.tableName} ORDER BY block_index ASC`).all();
    if (blocks.length === 0) return { valid: true };

    const genesis = this._rowToBlock(blocks[0]);
    if (genesis.hash !== this.genesisBlock.hash) return { valid: false, invalidAt: 0, error: 'Genesis hash mismatch' };

    for (let i = 1; i < blocks.length; i++) {
      const current = this._rowToBlock(blocks[i]);
      const previous = this._rowToBlock(blocks[i - 1]);
      const validation = validateBlock(current, previous);
      if (!validation.valid) return { valid: false, invalidAt: current.index, error: validation.error };
    }
    return { valid: true };
  }

  _rowToBlock(row) {
    const dataStr = row[this.dataFieldName];
    const data = JSON.parse(dataStr);
    const isPruned = data.type === 'pruned';
    
    return {
      index: row.block_index,
      previousHash: row.previous_hash,
      timestamp: row.timestamp,
      type: data.type,
      payload: data.payload || data,
      trade: data.payload || data, // compat
      matcherPubKey: row.matcher_pubkey,
      signature: row.signature,
      hash: row.hash,
      pruned: isPruned
    };
  }
}

// Singletons
let tradeChainInstance = null;
let registryChainInstance = null;

export function getTradeChain() {
  if (!tradeChainInstance) {
    tradeChainInstance = new Blockchain('trade_blocks', GENESIS_BLOCK_TRADE, 'trade_data');
    tradeChainInstance.initialize();
  }
  return tradeChainInstance;
}

export function getRegistryChain() {
  if (!registryChainInstance) {
    registryChainInstance = new Blockchain('registry_blocks', GENESIS_BLOCK_REGISTRY, 'registry_data');
    registryChainInstance.initialize();
  }
  return registryChainInstance;
}

// Backward compat
export function getChain() { return getTradeChain(); }
export function resetChain() { tradeChainInstance = null; registryChainInstance = null; }
