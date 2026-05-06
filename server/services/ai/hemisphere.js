/**
 * Hemispheric Brain Engine
 * 
 * Layer 2 of the inference pipeline. Classifies user intent into
 * Left (Logic/Analytical) or Right (Creative/Generative) hemisphere,
 * discovers providers with matching capabilities, and orchestrates
 * multi-model inference through the Cortex Mixer.
 */

import { requestInference, requestMultiInference, getProviderState } from './p2pInference.js';
import { mixResults } from './cortexMixer.js';
import { getModelStatus, generateSmartResponse } from './model.js';

// ── Intent Classification ────────────────────────────────────────────────────

const LEFT_KEYWORDS = new Set([
  'analyze', 'calculate', 'compare', 'data', 'orderbook', 'price',
  'volume', 'spread', 'depth', 'statistics', 'math', 'verify',
  'audit', 'debug', 'explain', 'how', 'why', 'what', 'define',
  'measure', 'evaluate', 'assess', 'quantify', 'estimate',
  'breakdown', 'logic', 'proof', 'fact', 'number', 'percentage',
  'rate', 'ratio', 'correlation', 'chart', 'graph', 'metric'
]);

const RIGHT_KEYWORDS = new Set([
  'write', 'create', 'imagine', 'design', 'suggest', 'brainstorm',
  'story', 'strategy', 'predict', 'compose', 'generate', 'innovate',
  'explore', 'invent', 'dream', 'hypothetical', 'scenario', 'idea',
  'inspire', 'creative', 'artistic', 'narrative', 'vision',
  'speculate', 'what if', 'could', 'might', 'possible', 'future'
]);

/**
 * Classify a user query into hemisphere(s).
 * @param {string} query - Raw user query
 * @returns {{ hemisphere: 'left'|'right'|'both', leftScore: number, rightScore: number }}
 */
export function classifyIntent(query) {
  const tokens = query.toLowerCase()
    .replace(/[^a-z0-9\s']/g, '')
    .split(/\s+/)
    .filter(Boolean);

  let leftScore = 0;
  let rightScore = 0;

  for (const token of tokens) {
    if (LEFT_KEYWORDS.has(token)) leftScore++;
    if (RIGHT_KEYWORDS.has(token)) rightScore++;
  }

  // Normalize by query length to avoid bias toward longer queries
  const total = leftScore + rightScore;
  
  let hemisphere;
  if (total === 0) {
    // No strong signal — default to general (treated as both)
    hemisphere = 'both';
  } else if (leftScore > 0 && rightScore > 0) {
    // Mixed signals — use both hemispheres
    hemisphere = 'both';
  } else if (leftScore > rightScore) {
    hemisphere = 'left';
  } else {
    hemisphere = 'right';
  }

  console.log(`[Hemisphere] Intent: "${query.substring(0, 40)}..." → ${hemisphere.toUpperCase()} (L:${leftScore} R:${rightScore})`);

  return { hemisphere, leftScore, rightScore };
}

// ── No-Provider Fallback ─────────────────────────────────────────────────────

const NO_PROVIDER_MESSAGES = [
  '## 🧠 Neural Pathways Dormant\n\nMy inference cortex is currently **offline** — no AI provider nodes are connected to the Synaptic Aggregator.\n\n> 💡 **To activate the Global Brain:** Go to the **Provider** tab and load a GGUF model, or wait for a remote provider to join the network.\n\nOnce a provider connects, both hemispheres will come alive and I can process your query with full neural capacity.',

  '## 🔌 Synaptic Network Disconnected\n\nNo inference providers are currently feeding the Global Brain. My left and right hemispheres are **dormant** without compute power.\n\n> 🧬 **Want to be the first neuron?** Enable Provider Mode in the Provider tab to contribute your GPU and earn BPS rewards.\n\nYour query has been noted — I will process it as soon as a provider connects.',

  '## 💤 Hemispheres Inactive\n\nThe Global Brain requires at least one inference provider to think. Currently, **zero providers** are connected.\n\n> ⚡ Enable **Provider Mode** to load a model and power the brain. You\'ll earn BPS for every query you process.'
];

export function buildNoProviderMessage(query) {
  const idx = Math.floor(Math.random() * NO_PROVIDER_MESSAGES.length);
  return NO_PROVIDER_MESSAGES[idx];
}

export function buildExocortexPrompt(query, snippets, source) {
  return `
### 🌐 Exocortex Analysis
I've supplemented the Global Brain's knowledge with real-time data from the Exocortex.

**Search Query:** "${query}"
**Source:** ${source || 'Global Web Index'}

#### 📝 Supplemented Knowledge:
${snippets.map(s => `> ${s}`).join('\n\n')}

---

🧠 **Can you verify this?** Teach me in this chat to refine my understanding of this topic and earn BPS rewards.
`.trim();
}

// ── Orchestration ────────────────────────────────────────────────────────────

/**
 * Main entry point for the hemispheric brain.
 * Classifies intent → discovers providers → dispatches in parallel → mixes results.
 *
 * @param {string} query - User query
 * @param {string} sectorName - Brain sector name for context
 * @param {string} sectorId - Brain sector ID
 * @returns {Promise<{ response: string, hemisphere: string, providers: object[], weights: object }>}
 */
export async function orchestrate(query, sectorName, sectorId) {
  const intent = classifyIntent(query);

  // Check if any provider is available (local or network)
  const providerState = getProviderState();
  const localStatus = getModelStatus();
  const hasLocalProvider = providerState.enabled && localStatus.status === 'ready';

  // Build inference plans based on hemisphere classification
  const plans = [];
  try {
    const intent = classifyIntent(query);

    // Prepare inference plans based on hemisphere
    const plans = [];
    if (intent.hemisphere === 'left' || intent.hemisphere === 'both') {
      plans.push({ query, sectorId, requiredCapability: 'logic', weight: intent.hemisphere === 'both' ? 0.5 : 1.0 });
    }
    if (intent.hemisphere === 'right' || intent.hemisphere === 'both') {
      plans.push({ query, sectorId, requiredCapability: 'creative', weight: intent.hemisphere === 'both' ? 0.5 : 1.0 });
    }

    let results = [];
    if (plans.length === 1) {
      // Single plan — simple request
      try {
        const result = await requestInference(query, sectorId, plans[0].requiredCapability);
        results = [{ ...result, weight: 1.0, capability: plans[0].requiredCapability }];
      } catch (err) {
        // Fallback to general if capability fails
        try {
          const fallback = await requestInference(query, sectorId, null);
          results = [{ ...fallback, weight: 1.0, capability: 'general' }];
        } catch { /* proceed to offline check */ }
      }
    } else {
      // Multiple plans — parallel execution
      try {
        results = await requestMultiInference(plans);
      } catch { /* proceed to offline check */ }
    }

    // ── Offline / No Provider Fallback ───────────────────────────────────────
    if (results.length === 0) {
      // Check if WE can handle it locally as a single combined request
      const provider = getProviderState();
      const { status } = getModelStatus();
      
      if (provider.enabled && status === 'ready') {
        const caps = provider.capabilities || ['general'];
        let canServe = false;
        if (caps.includes('general')) {
          canServe = true;
        } else if (intent.hemisphere === 'left' && caps.includes('logic')) {
          canServe = true;
        } else if (intent.hemisphere === 'right' && caps.includes('creative')) {
          canServe = true;
        } else if (intent.hemisphere === 'both' && caps.includes('logic') && caps.includes('creative')) {
          canServe = true;
        }
        
        // USER REQUIREMENT: specialized nodes (logic-only or creative-only) 
        // should NOT be used for "both" or for the wrong hemisphere.
        if (canServe) {
          console.log(`[Hemisphere] No network providers. Using local single-instance fallback...`);
          const localResult = await generateSmartResponse(query, sectorName, intent.hemisphere);
          return {
            response: localResult,
            hemisphere: intent.hemisphere,
            providers: [{ providerId: 'local-node', tier: provider.tier, weight: 1.0, hemisphere: 'general' }],
            weights: { [provider.tier]: 1.0 }
          };
        }
      }
      
      // Truly offline
      return { response: buildNoProviderMessage(query), hemisphere: 'offline', providers: [], weights: {} };
    }

    // ── Mixing & Formatting ──────────────────────────────────────────────────
    const mixed = mixResults(results, intent);
    return {
      response: mixed.text,
      hemisphere: intent.hemisphere,
      providers: mixed.providers,
      weights: mixed.tierWeights
    };
  } catch (err) {
    console.error('[Hemisphere] Orchestration error:', err.message);
    return { response: buildNoProviderMessage(query), hemisphere: 'offline', providers: [], weights: {} };
  }
}
