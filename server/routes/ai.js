import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { getAiPotStats, previewReward } from '../services/aiPot.js';
import {
  routeQuery, processSubmission, generateBrainResponse,
  getAllSectors, getSector, recordFeedback,
  getLeaderboard, getUserSubmissions, getRecentRegistryEvents
} from '../services/brainState.js';
import api from 'axios';
import { getDb } from '../db/init.js';
import { getModelStatus } from '../services/ai/model.js';
import * as modelLoader from '../services/ai/modelLoader.js';
import * as p2pInference from '../services/ai/p2pInference.js';
import { verifyModelBenchmark } from '../services/ai/oracle.js';

const router = Router();
router.use(authenticateToken);

// ── Market context fetcher (mirrors AiPage client logic) ──────────────────────
async function fetchMarketContext(baseUrl) {
  try {
    const [tickers, btcBook, ethBook] = await Promise.all([
      api.get(`${baseUrl}/api/market/all-tickers`).catch(() => ({ data: [] })),
      api.get(`${baseUrl}/api/market/orderbook?pair=BTC/BPS`).catch(() => ({ data: { bids: [], asks: [] } })),
      api.get(`${baseUrl}/api/market/orderbook?pair=ETH/BPS`).catch(() => ({ data: { bids: [], asks: [] } })),
    ]);
    return { tickers: tickers.data, btcBook: btcBook.data, ethBook: ethBook.data };
  } catch { return { tickers: [], btcBook: { bids: [], asks: [] }, ethBook: { bids: [], asks: [] } }; }
}

function getBaseUrl(req) {
  return `http://localhost:${req.socket.localPort || 3001}`;
}

// ── GET /api/ai/brain-state ───────────────────────────────────────────────────
router.get('/brain-state', (req, res) => {
  try {
    const db = getDb();
    const sectors = getAllSectors();
    const pot = getAiPotStats();
    const events = getRecentRegistryEvents(10);

    // Fetch active inference nodes for the heatmap
    let inferenceNodes = [];
    try {
      inferenceNodes = db.prepare(`SELECT * FROM ai_inference_nodes WHERE status = 'active' ORDER BY benchmark_score DESC`).all();
    } catch { /* table may not exist yet */ }

    // New Hemispheric Logic for Readiness & Nodes
    const activeNodes = inferenceNodes.length;
    
    // Check hemispheric coverage
    let hasLogic = false;
    let hasCreative = false;
    
    for (const node of inferenceNodes) {
      const caps = node.capabilities ? node.capabilities.split(',') : [];
      if (caps.includes('logic') || caps.includes('general')) hasLogic = true;
      if (caps.includes('creative') || caps.includes('general')) hasCreative = true;
    }

    // Readiness: 0% = offline, 50% = 1 hemisphere, 100% = both active
    let readinessPct = 0;
    if (hasLogic && hasCreative) readinessPct = 100;
    else if (hasLogic || hasCreative) readinessPct = 50;

    // Map sectors to layers for the UI visualization (keeping the map, but it's secondary now)
    const layers = { router: [], macro: [], micro: [] };
    for (const s of sectors) { if (layers[s.layer]) layers[s.layer].push(s); }

    res.json({ 
      sectors, 
      layers, 
      pot, 
      events, 
      readinessPct, 
      activeNodes,
      hemispheres: { logic: hasLogic, creative: hasCreative },
      inferenceNodes 
    });
  } catch (err) {
    console.error('[AI] brain-state error:', err);
    res.status(500).json({ error: 'Failed to fetch brain state' });
  }
});

// ── GET /api/ai/pot ───────────────────────────────────────────────────────────
router.get('/pot', (req, res) => {
  try { res.json(getAiPotStats()); }
  catch (err) { res.status(500).json({ error: 'Failed to fetch AI pot stats' }); }
});

// ── POST /api/ai/query ────────────────────────────────────────────────────────
router.post('/query', async (req, res) => {
  try {
    const { query, balances, sessionId } = req.body;
    if (!query || !query.trim()) return res.status(400).json({ error: 'Query required' });
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

    const sector  = routeQuery(query, req.user.id);
    const market  = await fetchMarketContext(getBaseUrl(req));
    const result  = await generateBrainResponse(query, sector, market, balances, req.user.id, sessionId);

    res.json({
      response: result.response,
      sector: result.sector ? { id: result.sector.id, name: result.sector.name, layer: result.sector.layer } : null,
      interactionId: result.interactionId,
      awaiting: result.awaiting || false,
      reward: result.reward || 0,
      entropyDelta: result.entropyDelta || 0,
    });
  } catch (err) {
    console.error('[AI] query error details:', {
      message: err.message,
      stack: err.stack,
      name: err.name
    });
    res.status(500).json({ error: 'Query failed', details: err.message });
  }
});

// ── POST /api/ai/feedback ─────────────────────────────────────────────────────
router.post('/feedback', (req, res) => {
  try {
    const { interactionId, feedback } = req.body;
    if (!interactionId || ![-1, 1].includes(Number(feedback))) return res.status(400).json({ error: 'Invalid feedback' });
    recordFeedback(interactionId, Number(feedback));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Feedback failed' }); }
});

// ── GET /api/ai/preview-reward ────────────────────────────────────────────────
router.get('/preview-reward', (req, res) => {
  try {
    const { sectorId } = req.query;
    if (!sectorId) return res.status(400).json({ error: 'sectorId required' });
    res.json({ estimatedBps: previewReward(sectorId) });
  } catch (err) { res.status(500).json({ error: 'Preview failed' }); }
});

// ── POST /api/ai/submit ───────────────────────────────────────────────────────
router.post('/submit', (req, res) => {
  try {
    const { sectorId, prompt, correction } = req.body;
    if (!sectorId || !prompt?.trim() || !correction?.trim()) {
      return res.status(400).json({ error: 'sectorId, prompt, and correction are required' });
    }
    const result = processSubmission(req.user.id, sectorId, prompt, correction);
    if (result.rejected) return res.status(422).json({ error: 'Submission rejected — knowledge already known', entropyDelta: 0 });
    res.json(result);
  } catch (err) {
    console.error('[AI] submit error:', err);
    res.status(500).json({ error: err.message || 'Submission failed' });
  }
});

// ── GET /api/ai/submissions ───────────────────────────────────────────────────
router.get('/submissions', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    res.json(getUserSubmissions(req.user.id, limit));
  } catch (err) { res.status(500).json({ error: 'Failed to fetch submissions' }); }
});

// ── GET /api/ai/synaptic-chain ────────────────────────────────────────────────
router.get('/synaptic-chain', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    res.json(getRecentRegistryEvents(limit));
  } catch (err) { res.status(500).json({ error: 'Failed to fetch synaptic chain' }); }
});

// ── GET /api/ai/leaderboard ───────────────────────────────────────────────────
router.get('/leaderboard', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    res.json(getLeaderboard(limit));
  } catch (err) { res.status(500).json({ error: 'Failed to fetch leaderboard' }); }
});

// ── GET /api/ai/model-status ──────────────────────────────────────────────────
router.get('/model-status', (req, res) => {
  try {
    res.json(getModelStatus());
  } catch (err) { res.status(500).json({ error: 'Failed to fetch model status' }); }
});

// ── GET /api/ai/sectors ───────────────────────────────────────────────────────
router.get('/sectors', (req, res) => {
  try { res.json(getAllSectors()); }
  catch (err) { res.status(500).json({ error: 'Failed to fetch sectors' }); }
});

// ── GET /api/ai/provider ──────────────────────────────────────────────────────
router.get('/provider', (req, res) => {
  try {
    const p2pState = p2pInference.getProviderState();
    const loaderStatus = modelLoader.getLoaderStatus();
    res.json({ ...p2pState, loader: loaderStatus });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch provider status' }); }
});

// ── POST /api/ai/provider ─────────────────────────────────────────────────────
router.post('/provider', async (req, res) => {
  try {
    const { enabled, ggufPath, contextSize } = req.body;
    const db = getDb();
    const address = req.user.id; // Using user ID as node/wallet address for now
    const nodeId = req.user.id + '-node';

    if (enabled) {
      // 1. Get Benchmark Score, Tier & Capabilities from Oracle
      const modelIdentifier = ggufPath ? ggufPath.split(/[/\\]/).pop() : 'unknown';
      const { score, tier, capabilities } = await verifyModelBenchmark(modelIdentifier, 'mock-hash');

      // 2. Start loading model in background
      const mode = 'gguf';
      const ctxSize = contextSize ? parseInt(contextSize) : 2048;
      modelLoader.loadModel({ mode, ggufPath, contextSize: ctxSize }).catch(err => console.error('[AI] Background load failed:', err));

      // 3. Update P2P state with capabilities
      p2pInference.setProviderMode(true, { tier, repoId: modelIdentifier, benchmark: score, capabilities });

      // 4. Register in DB
      try {
        db.prepare(`
          INSERT INTO ai_inference_nodes (node_id, address, model_tier, model_repo_id, benchmark_score, status, context_size)
          VALUES (?, ?, ?, ?, ?, 'active', ?)
          ON CONFLICT(node_id) DO UPDATE SET 
            model_tier=excluded.model_tier,
            model_repo_id=excluded.model_repo_id,
            benchmark_score=excluded.benchmark_score,
            status='active',
            context_size=excluded.context_size,
            last_seen=datetime('now')
        `).run(nodeId, address, tier, modelIdentifier, score, ctxSize);
      } catch (dbErr) { console.warn('[AI] DB insert failed:', dbErr.message); }

      res.json({ success: true, message: 'Provider enabled, model loading initiated', capabilities });
    } else {
      // Disable
      p2pInference.setProviderMode(false);
      await modelLoader.unloadModel();
      try {
        db.prepare(`UPDATE ai_inference_nodes SET status='inactive' WHERE node_id=?`).run(nodeId);
      } catch (dbErr) {}

      res.json({ success: true, message: 'Provider disabled' });
    }
  } catch (err) {
    console.error('[AI] Provider toggle error:', err);
    res.status(500).json({ error: err.message || 'Failed to toggle provider mode' });
  }
});

export default router;
