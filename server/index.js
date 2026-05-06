import './env.js';
import express from 'express';
import cors from 'cors';
import { initDb } from './db/init.js';
import { loadConfig } from './config.js';
import { getP2PNode } from './p2p/node.js';
import { registerSyncHandlers } from './p2p/sync.js';
import { getChain } from './blockchain/chain.js';
import { startDepositMonitor } from './services/depositMonitor.js';
import { getNodeManager } from './services/nodeManager.js';
import { initBrainState } from './services/brainState.js';
import { startPruner } from './services/pruner.js';

import authRoutes from './routes/auth.js';
import walletRoutes from './routes/wallet.js';
import orderRoutes from './routes/orders.js';
import marketRoutes from './routes/market.js';
import networkRoutes from './routes/network.js';
import aiRoutes from './routes/ai.js';

/**
 * Start the NextChange Hub server.
 * Can be called from Electron main process or standalone.
 */
export async function startServer(options = {}) {
  const config = loadConfig();
  const port = options.port || config.port;

  // Initialize database (fresh start for v2)
  await initDb(options.freshStart || false);

  // Initialize blockchain
  const chain = getChain();
  console.log(`[Chain] Height: ${chain.getHeight()} blocks`);

  // Initialize brain state
  initBrainState();

  // Initialize P2P messaging on startup
  const validation = chain.validateChain();
  if (!validation.valid) {
    console.warn(`[Chain] ⚠ Chain invalid at block ${validation.invalidAt}: ${validation.error}`);
  } else {
    console.log('[Chain] ✓ Chain integrity verified');
  }

  // Express app
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/wallet', walletRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api/market', marketRoutes);
  app.use('/api/network', networkRoutes);
  app.use('/api/ai', aiRoutes);

  // Health check
  app.get('/api/health', (req, res) => {
    const p2p = getP2PNode();
    res.json({
      status: 'ok',
      time: new Date().toISOString(),
      chainHeight: chain.getHeight(),
      peers: p2p.getStats().peerCount,
      version: '2.0.0'
    });
  });

  // Start HTTP server
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(port, () => {
      console.log(`\n  ⚡ nextchange.hub P2P Exchange Node`);
      console.log(`  🌐 http://localhost:${port}`);
      console.log(`  📦 Chain height: ${chain.getHeight()}`);
      console.log('');
      resolve(s);
    });
    s.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is already in use`));
      } else {
        reject(err);
      }
    });
  });

  // Start P2P node (if node identity is configured)
  let p2pNode = null;
  if (config.nodePublicKey) {
    p2pNode = getP2PNode();
    registerSyncHandlers({});
    p2pNode.start(config.nodePublicKey);
    console.log(`  🔗 P2P listening on port ${config.p2pPort}`);
  } else {
    console.log('  ℹ  P2P disabled (no node identity — create a wallet first)');
  }

  // Start integrated BPS node if enabled (non-blocking)
  console.log(`[NodeManager] BPS_INTEGRATED_NODE = ${process.env.BPS_INTEGRATED_NODE}`);
  if (process.env.BPS_INTEGRATED_NODE === 'true') {
    getNodeManager().start().catch(err => {
      console.error('[NodeManager] Startup error:', err.message);
    });
  }

  // Start deposit monitor (after node has been triggered)
  startDepositMonitor(30000);

  // Start L2 Pruner
  startPruner(5 * 60 * 1000); // Check every 5 minutes

  return { app, server, p2pNode, chain };
}

// Standalone mode — run directly with node
const isMainModule = process.argv[1] && (
  process.argv[1].endsWith('index.js') ||
  process.argv[1].endsWith('server/index.js')
);

if (isMainModule) {
  startServer({ freshStart: false }).catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
