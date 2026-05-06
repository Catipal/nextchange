import { statSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getDb } from '../db/init.js';
import { loadConfig } from '../config.js';
import { getTradeChain, getRegistryChain } from '../blockchain/chain.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DB_PATH = join(__dirname, '..', '..', 'exchange.db');

let pruneInterval = null;

export function startPruner(intervalMs = 5 * 60 * 1000) {
  if (pruneInterval) clearInterval(pruneInterval);
  
  pruneInterval = setInterval(() => {
    try {
      const config = loadConfig();
      if (!config.tradePruneEnabled && !config.registryPruneEnabled) return;

      if (!existsSync(DB_PATH)) return;

      const stats = statSync(DB_PATH);
      const sizeMB = stats.size / (1024 * 1024);

      if (config.tradePruneEnabled && sizeMB > (config.tradePruneMaxMB || 1000)) {
        console.log(`[Pruner] DB size (${sizeMB.toFixed(2)} MB) exceeds Trade limit (${config.tradePruneMaxMB} MB). Pruning Trade chain...`);
        pruneChain('trade');
      }
      
      if (config.registryPruneEnabled && sizeMB > (config.registryPruneMaxMB || 500)) {
        console.log(`[Pruner] DB size (${sizeMB.toFixed(2)} MB) exceeds Registry limit (${config.registryPruneMaxMB} MB). Pruning Registry chain...`);
        pruneChain('registry');
      }
    } catch (err) {
      console.error('[Pruner] Error during prune check:', err.message);
    }
  }, intervalMs);
  
  console.log('[Pruner] Background L2 pruning service started.');
}

function pruneChain(chainType) {
  const db = getDb();
  const isTrade = chainType === 'trade';
  const chain = isTrade ? getTradeChain() : getRegistryChain();
  const height = chain.getHeight();

  // Keep genesis (0) and the latest 100 blocks
  const maxPruneIndex = Math.max(0, height - 100);
  const prunePayload = JSON.stringify({ type: 'pruned', payload: null });
  const table = isTrade ? 'trade_blocks' : 'registry_blocks';
  const column = isTrade ? 'trade_data' : 'registry_data';

  try {
    const result = db.prepare(
      `UPDATE ${table} 
       SET ${column} = ? 
       WHERE block_index > 0 AND block_index <= ? AND ${column} != ?`
    ).run(prunePayload, maxPruneIndex, prunePayload);
    
    if (result.changes > 0) {
      console.log(`[Pruner] Pruned ${result.changes} ${chainType} blocks. Freed space added to SQLite freelist.`);
    }
  } catch (err) {
    console.error(`[Pruner] Error executing ${chainType} pruning query:`, err.message);
  }
}
