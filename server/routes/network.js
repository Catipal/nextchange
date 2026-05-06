import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { getP2PNode } from '../p2p/node.js';
import { getTradeChain, getRegistryChain } from '../blockchain/chain.js';
import { loadConfig, addCustomPeer, removeCustomPeer, getAllPeers, updateConfig } from '../config.js';
import { getNodeManager } from '../services/nodeManager.js';
import { getRpc } from '../services/rpc.js';
import { getDb } from '../db/init.js';
import { getVaultStatus } from '../services/vault.js';

const router = Router();

// GET /api/network/status — public network status
router.get('/status', async (req, res) => {
  const p2p = getP2PNode();
  const tradeChain = getTradeChain();
  const registryChain = getRegistryChain();
  const stats = p2p.getStats();
const initialBpsNode = getNodeManager().getStatus();

  // Simple cache for external node info to avoid sequential lag
  if (!global.nodeInfoCache) {
    global.nodeInfoCache = {
      btc: { data: null, lastFetch: 0 },
      eth: { data: null, lastFetch: 0 }
    };
  }
  const CACHE_TTL = 30000; // 30 seconds

  const fetchNodeInfo = async (type) => {
    // Return cached data for external nodes if fresh
    if (type !== 'bps' && global.nodeInfoCache[type].data && (Date.now() - global.nodeInfoCache[type].lastFetch < CACHE_TTL)) {
      return global.nodeInfoCache[type].data;
    }

    const info = { status: 'running', currency: type };
    if (type === 'bps' && initialBpsNode.status !== 'running' && initialBpsNode.status !== 'starting') {
      return initialBpsNode;
    }
    
    try {
      const rpc = getRpc(type);
      const [blockchain, network] = await Promise.all([
        rpc.getBlockchainInfo(),
        rpc.getNetworkInfo()
      ]);
      info.blockchain = blockchain;
      info.network = network;
      if (type === 'bps' && initialBpsNode.status === 'starting') info.status = 'running';
      
      // Update cache for external nodes
      if (type !== 'bps') {
        global.nodeInfoCache[type] = { data: info, lastFetch: Date.now() };
      }
      return info;
    } catch (err) {
      if (type === 'bps' && (initialBpsNode.status === 'starting' || initialBpsNode.status === 'running')) {
        return { ...initialBpsNode, currency: 'bps' };
      }
      info.status = 'offline';
      return info;
    }
  };

  const [bpsNode, btcNode, ethNode] = await Promise.all([
    fetchNodeInfo('bps'),
    fetchNodeInfo('btc'),
    fetchNodeInfo('eth')
  ]);

  const maxPeerTradeHeight = stats.connected.reduce((max, p) => Math.max(max, p.tradeHeight || 0), 0);
  const maxPeerRegistryHeight = stats.connected.reduce((max, p) => Math.max(max, p.registryHeight || 0), 0);

  res.json({
    peerCount: stats.peerCount,
    listening: stats.listening,
    chainHeight: tradeChain.getHeight(),
    registryHeight: registryChain.getHeight(),
    maxPeerTradeHeight,
    maxPeerRegistryHeight,
    bpsNode: bpsNode,
    btcNode: btcNode,
    ethNode: ethNode,
    peers: stats.connected.map(p => ({
      address: p.address,
      publicKey: p.publicKey ? `${p.publicKey.slice(0, 8)}...` : null,
      direction: p.direction,
      connectedSince: p.connectedAt
    })),
    vault: getVaultStatus()
  });
});

// GET /api/network/vault — detailed DAO vault status
router.get('/vault', (req, res) => {
  try {
    const db = getDb();
    const vault = getVaultStatus();
    
    // Get active settlements
    const settlements = db.prepare(`
      SELECT * FROM withdrawal_settlements 
      WHERE status IN ('collecting', 'broadcasting') 
      ORDER BY created_at DESC
    `).all();
    
    res.json({
      ...vault,
      settlements: settlements.map(s => ({
        ...s,
        progress: s.fragments_required > 0 ? (s.fragments_collected / s.fragments_required) * 100 : 0
      }))
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch vault status' });
  }
});

// GET /api/network/blocks — recent blocks (Trade Chain only)
router.get('/blocks', (req, res) => {
  const chain = getTradeChain();
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  // No filtering needed anymore since this chain is trade-only
  const blocks = chain.getRecentBlocks(limit);
  res.json(blocks);
});

// GET /api/network/block/:index
router.get('/block/:index', (req, res) => {
  const chain = getTradeChain();
  const block = chain.getBlockByIndex(parseInt(req.params.index));
  if (!block) return res.status(404).json({ error: 'Block not found' });
  res.json(block);
});

// GET /api/network/block-by-hash/:hash
router.get('/block-by-hash/:hash', (req, res) => {
  const chain = getTradeChain();
  const block = chain.getBlockByHash(req.params.hash);
  if (!block) return res.status(404).json({ error: 'Block not found' });
  res.json(block);
});

// GET /api/network/config
router.get('/config', (req, res) => {
  const config = loadConfig();
  res.json({
    tradePruneEnabled: config.tradePruneEnabled || false,
    tradePruneMaxMB: config.tradePruneMaxMB || 1000,
    registryPruneEnabled: config.registryPruneEnabled || false,
    registryPruneMaxMB: config.registryPruneMaxMB || 500,
    bpsPruneEnabled: config.bpsPruneEnabled !== false, // default true
    bpsPruneMaxMB: config.bpsPruneMaxMB || 2000
  });
});

// POST /api/network/config
router.post('/config', authenticateToken, (req, res) => {
  try {
    const { tradePruneEnabled, tradePruneMaxMB, registryPruneEnabled, registryPruneMaxMB, bpsPruneEnabled, bpsPruneMaxMB } = req.body;
    const updates = {};
    if (typeof tradePruneEnabled === 'boolean') updates.tradePruneEnabled = tradePruneEnabled;
    if (typeof tradePruneMaxMB === 'number') updates.tradePruneMaxMB = tradePruneMaxMB;
    if (typeof registryPruneEnabled === 'boolean') updates.registryPruneEnabled = registryPruneEnabled;
    if (typeof registryPruneMaxMB === 'number') updates.registryPruneMaxMB = registryPruneMaxMB;
    if (typeof bpsPruneEnabled === 'boolean') updates.bpsPruneEnabled = bpsPruneEnabled;
    if (typeof bpsPruneMaxMB === 'number') updates.bpsPruneMaxMB = bpsPruneMaxMB;
    
    updateConfig(updates);

    // If BPS pruning settings changed, restart the node to apply them
    if (typeof bpsPruneEnabled !== 'undefined' || typeof bpsPruneMaxMB !== 'undefined') {
      if (process.env.BPS_INTEGRATED_NODE === 'true') {
        getNodeManager().restart().catch(err => {
          console.error('[Network Route] BPS Restart Error:', err.message);
        });
      }
    }

    res.json({ success: true, ...updates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/network/mempool — pending txns and locked rewards
router.get('/mempool', (req, res) => {
  try {
    const db = getDb();
    const pending = db.prepare(
      'SELECT id, type, user_id, data, created_at FROM pending_transactions ORDER BY created_at ASC'
    ).all();
    const locked = db.prepare(
      "SELECT id, user_id, amount, currency, mature_at_block, created_at FROM locked_rewards WHERE status = 'locked' ORDER BY mature_at_block ASC"
    ).all();
    res.json({
      pendingCount: pending.length,
      lockedRewardsCount: locked.length,
      pending: pending.map(tx => {
        let data = {};
        try { data = JSON.parse(tx.data); } catch { }
        return { ...tx, data };
      }),
      lockedRewards: locked
    });
  } catch (err) {
    res.json({ pendingCount: 0, lockedRewardsCount: 0, pending: [], lockedRewards: [] });
  }
});

// GET /api/network/chain-validity
router.get('/chain-validity', (req, res) => {
  const tradeChain = getTradeChain();
  const registryChain = getRegistryChain();
  res.json({
    trade: tradeChain.validateChain(),
    registry: registryChain.validateChain()
  });
});

// POST /api/network/peers — add a custom peer (requires auth)
router.post('/peers', authenticateToken, (req, res) => {
  const { address } = req.body;
  if (!address || (!address.startsWith('ws://') && !address.startsWith('wss://'))) {
    return res.status(400).json({ error: 'Valid WebSocket address required (ws:// or wss://)' });
  }
  addCustomPeer(address);
  const p2p = getP2PNode();
  p2p.addPeer(address);
  res.json({ peers: getAllPeers() });
});

// DELETE /api/network/peers — remove a custom peer (requires auth)
router.delete('/peers', authenticateToken, (req, res) => {
  const { address } = req.body;
  if (!address) return res.status(400).json({ error: 'Address required' });
  removeCustomPeer(address);
  res.json({ peers: getAllPeers() });
});

// GET /api/network/peers — list all configured peers
router.get('/peers', (req, res) => {
  const config = loadConfig();
  res.json({
    bootstrap: config.bootstrapPeers,
    custom: config.customPeers,
    all: getAllPeers()
  });
});

export default router;
