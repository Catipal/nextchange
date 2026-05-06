import { getP2PNode } from '../../p2p/node.js';
import { generateSmartResponse, getModelStatus } from './model.js';
import crypto from 'crypto';

// ── In-memory state ──────────────────────────────────────────────────────────

const pendingRequests = new Map();     // Client waiting for aggregated results
const pendingRFIs = new Map();         // Router waiting for Offers
const activeExecutions = new Map();    // Router waiting for Provider Results
const multiResultBuffers = new Map();  // Buffers for multi-provider results

// Node identity
const NODE_ID = crypto.randomBytes(8).toString('hex');
let providerModeEnabled = false;
let nodeProviderConfig = {
  tier: 'micro',
  repoId: 'unknown',
  benchmark: 0.50,
  capabilities: ['general']  // detected at load time by Oracle
};

// ── Provider Config ──────────────────────────────────────────────────────────

export function setProviderMode(enabled, config) {
  providerModeEnabled = enabled;
  if (config) nodeProviderConfig = { ...nodeProviderConfig, ...config };
  console.log(`[P2P Inference] Provider Mode: ${enabled ? 'ON' : 'OFF'} | Tier: ${nodeProviderConfig.tier} | Caps: [${nodeProviderConfig.capabilities?.join(', ')}]`);
}

export function getProviderState() {
  return { enabled: providerModeEnabled, ...nodeProviderConfig };
}

export function getNodeId() { return NODE_ID; }

// ── 1. Client initiates request ──────────────────────────────────────────────

export async function requestInference(query, sectorId, requiredCapability = null) {
  return new Promise((resolve, reject) => {
    const reqId = crypto.randomUUID();
    
    // 1. Set a hard timeout to fail if no one responds (5s for an offer)
    const timeout = setTimeout(() => {
      const req = pendingRequests.get(reqId);
      if (req) {
        pendingRequests.delete(reqId);
        req.reject(new Error('NO_PROVIDERS'));
      }
    }, 5000);

    pendingRequests.set(reqId, { 
      resolve, reject, 
      timeout,
      startTime: Date.now(),
      query, sectorId, requiredCapability
    });

    console.log(`[P2P Inference] Broadcasting RFI: ${reqId} (cap: ${requiredCapability || 'any'})`);
    const node = getP2PNode();
    if (node) {
      node.broadcast('AI_RFI', {
        type: 'AI_RFI',
        reqId,
        clientId: NODE_ID,
        query,
        sectorId,
        requiredCapability
      });
    }
  });
}

/**
 * Request inference from multiple providers in parallel.
 * Each plan specifies { query, sectorId, requiredCapability, weight }.
 * Returns an array of results with their weights.
 */
export async function requestMultiInference(plans) {
  const results = await Promise.allSettled(
    plans.map(plan => 
      requestInference(plan.query, plan.sectorId, plan.requiredCapability)
        .then(result => ({ ...result, weight: plan.weight, capability: plan.requiredCapability }))
    )
  );

  return results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);
}

// ── 2. Provider receives RFI and sends Offer ─────────────────────────────────

export function handleRFI(msg) {
  if (!providerModeEnabled) return;
  if (msg.clientId === NODE_ID) return; // Don't double-offer if we already self-served
  
  const { status } = getModelStatus();
  if (status !== 'ready') return;

  const caps = nodeProviderConfig.capabilities || ['general'];
  
  // Honor capability restrictions:
  if (msg.requiredCapability && msg.requiredCapability !== 'general') {
    if (!caps.includes('general') && !caps.includes(msg.requiredCapability)) {
      return; // Capability mismatch, don't offer
    }
  }

  console.log(`[P2P Inference] Offering for req: ${msg.reqId}`);
  const node = getP2PNode();
  if (node) {
    node.broadcast('AI_OFFER', {
      type: 'AI_OFFER',
      reqId: msg.reqId,
      clientId: msg.clientId,
      providerId: NODE_ID,
      tier: nodeProviderConfig.tier,
      benchmark: nodeProviderConfig.benchmark,
      capabilities: caps
    });
  }
}

// ── 3. Client collects offers and selects best ───────────────────────────────

export function handleOffer(msg) {
  if (msg.clientId !== NODE_ID) return;
  const req = pendingRequests.get(msg.reqId);
  if (!req) return;

  // First valid offer wins
  clearTimeout(req.timeout);
  pendingRequests.delete(msg.reqId);

  // Send EXEC to the provider
  console.log(`[P2P Inference] Selected Provider ${msg.providerId} (${msg.tier}, benchmark: ${msg.benchmark})`);
  
  const execTimeout = setTimeout(() => {
    const exec = activeExecutions.get(msg.reqId);
    if (exec) {
      activeExecutions.delete(msg.reqId);
      exec.resolve({
        text: `### ⚠️ Provider Timeout\nThe remote AI provider (${msg.providerId.slice(0, 6)}) failed to generate a response in time.`,
        providerId: msg.providerId + ' (timeout)',
        tier: msg.tier,
        capabilities: msg.capabilities
      });
    }
  }, 60000); // 60s for inference generation

  activeExecutions.set(msg.reqId, { resolve: req.resolve, providerId: msg.providerId, execTimeout });

  const node = getP2PNode();
  if (node) {
    node.broadcast('AI_EXEC', {
      type: 'AI_EXEC',
      reqId: msg.reqId,
      clientId: NODE_ID,
      providerId: msg.providerId,
      query: req.query || '',
      sectorId: req.sectorId || '',
      hemisphere: req.requiredCapability || 'general'
    });
  }
}

// ── 4. Provider executes inference ───────────────────────────────────────────

export async function handleExec(msg) {
  if (msg.providerId !== NODE_ID) return;
  
  console.log(`[P2P Inference] Executing inference for req: ${msg.reqId} (hemisphere: ${msg.hemisphere})`);
  try {
    const result = await generateSmartResponse(msg.query, msg.sectorId || 'General', msg.hemisphere);
    
    const node = getP2PNode();
    if (node) {
      node.broadcast('AI_RESULT', {
        type: 'AI_RESULT',
        reqId: msg.reqId,
        clientId: msg.clientId,
        providerId: NODE_ID,
        tier: nodeProviderConfig.tier,
        capabilities: nodeProviderConfig.capabilities,
        result
      });
    }
  } catch (err) {
    console.error(`[P2P Inference] Execution failed:`, err.message);
  }
}

// ── 5. Client receives result ────────────────────────────────────────────────

export function handleResult(msg) {
  if (msg.clientId !== NODE_ID) return;
  
  const exec = activeExecutions.get(msg.reqId);
  if (exec) {
    if (exec.execTimeout) clearTimeout(exec.execTimeout);
    activeExecutions.delete(msg.reqId);
    console.log(`[P2P Inference] Received result from ${msg.providerId}`);
    exec.resolve({
      text: msg.result || '',
      providerId: msg.providerId,
      tier: msg.tier,
      capabilities: msg.capabilities
    });
    return;
  }

  // Check pending requests (for direct offers)
  const req = pendingRequests.get(msg.reqId);
  if (req) {
    clearTimeout(req.timeout);
    pendingRequests.delete(msg.reqId);
    req.resolve({
      text: msg.result || '',
      providerId: msg.providerId,
      tier: msg.tier,
      capabilities: msg.capabilities
    });
  }
}

// ── Local execution (self-serve) ─────────────────────────────────────────────

async function handleLocalExec(reqId, query, sectorId, hemisphere) {
  try {
    const result = await generateSmartResponse(query, sectorId || 'General', hemisphere);
    
    const req = pendingRequests.get(reqId);
    if (req) {
      clearTimeout(req.timeout);
      if (req.fallbackTimeout) clearTimeout(req.fallbackTimeout);
      pendingRequests.delete(reqId);
      console.log(`[P2P Inference] Local self-serve complete for ${reqId}`);
      req.resolve({
        text: result,
        providerId: NODE_ID + ' (local)',
        tier: nodeProviderConfig.tier,
        capabilities: nodeProviderConfig.capabilities
      });
    }
  } catch (err) {
    console.error(`[P2P Inference] Local execution failed:`, err.message);
    const req = pendingRequests.get(reqId);
    if (req) {
      clearTimeout(req.timeout);
      pendingRequests.delete(reqId);
      req.resolve({
        text: `### ⚠️ Local Brain Error\nThe local AI model failed to generate a response: ${err.message}`,
        providerId: NODE_ID + ' (local-error)',
        tier: nodeProviderConfig.tier,
        capabilities: nodeProviderConfig.capabilities
      });
    }
  }
}

// ── Legacy compatibility ─────────────────────────────────────────────────────

export async function requestRemoteInference(query, sectorId) {
  return requestInference(query, sectorId, null);
}

export function handleRoutingRequest(msg) {} // Deprecated — kept for P2P compat
export function handleFinalResult(msg) {}    // Deprecated — kept for P2P compat
