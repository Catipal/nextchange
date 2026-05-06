import { getDb } from '../db/init.js';
import { getRegistryChain } from '../blockchain/chain.js';
import { createBlock } from '../blockchain/block.js';
import { loadConfig } from '../config.js';
import { generateId } from '../utils/helpers.js';
import { issueEntropyReward } from './aiPot.js';
import { performWebSearch, getGlobalNewsContext } from './exocortex.js';
import { evolveSector } from './ai/evolution.js';
import { generateSmartResponse, getModelStatus } from './ai/model.js';
import { orchestrate, buildNoProviderMessage } from './ai/hemisphere.js';
import { issueWeightedInferenceReward } from './aiPot.js';

const DOMAIN_KEYWORDS = {
  routing:         ['help', 'what can', 'how do', 'commands', 'features'],
  market_analysis: ['market', 'overview', 'price', 'volume', 'ticker', 'summary', 'trend', 'news'],
  ai_theory:       ['ai', 'brain', 'model', 'entropy', 'training', 'intelligence', 'neural', 'learning', 'sector'],
  btc_bps:         ['btc', 'bitcoin', 'orderbook', 'spread', 'depth', 'bids', 'asks'],
  eth_bps:         ['eth', 'ethereum'],
  strategy:        ['strategy', 'trade', 'position', 'risk', 'momentum', 'scalp', 'portfolio', 'balance'],
};

const SECTOR_CREATION_THRESHOLD = 3;
const EXOCORTEX_ENTROPY_THRESHOLD = 0.6; // trigger web search if sector entropy > this
const unknownDomainHits = new Map();

const STOP_WORDS = new Set(['what','is','the','how','do','i','can','you','tell','me','about','a','an','to','for','of','in','on','with','are','this','that','it','and']);

// In-memory session store: sessionId -> { state, sectorId, query, webSnippets, source }
// state: 'answering' | 'awaiting_teaching'
const sessionMemory = new Map();

function tokenize(text) {
  // Preserve apostrophes inside words (e.g. it's) but strip other punctuation
  return text.toLowerCase()
      .replace(/[^a-z0-9\s']/g, '')
      .split(/\s+/).filter(Boolean);
}

function getUnknownDomainKey(tokens) {
  const meaningful = tokens.filter(t => !STOP_WORDS.has(t) && t.length > 2);
  return meaningful.slice(0, 2).join('_') || 'unknown';
}

function logToRegistryChain(type, payload) {
  try {
    const config = loadConfig();
    if (!config.nodePublicKey || !config.nodePrivateKey) return;
    const chain = getRegistryChain();
    const latest = chain.getLatestBlock();
    const block = createBlock(latest.index + 1, latest.hash, payload, config.nodePrivateKey, config.nodePublicKey, type);
    chain.addBlock(block);
  } catch (err) {
    console.error('[BrainState] Registry log error:', err.message);
  }
}

// ── Router ────────────────────────────────────────────────────────────────────

export function routeQuery(query, userId) {
  const db = getDb();
  const tokens = tokenize(query);
  const sectors = db.prepare(`SELECT * FROM brain_sectors WHERE status = 'active' ORDER BY layer ASC`).all();

  let bestSector = null;
  let bestScore = -1;

  for (const sector of sectors) {
    const keywords = DOMAIN_KEYWORDS[sector.domain] || [];
    const score = tokens.filter(t => keywords.includes(t)).length;
    if (score > bestScore) { bestScore = score; bestSector = sector; }
  }

  if (bestScore === 0 && userId) {
    const domainKey = getUnknownDomainKey(tokens);
    if (domainKey !== 'unknown') {
      const newSector = autoCreateSector(db, domainKey, userId);
      if (newSector) return newSector;
    }
  }

  return bestSector || sectors[0];
}

function autoCreateSector(db, domainKey, userId) {
  const exists = db.prepare(`SELECT id FROM brain_sectors WHERE domain = ?`).get(domainKey);
  if (exists) return null;
  const name = domainKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const id = generateId();
  db.prepare(
    `INSERT INTO brain_sectors (id, layer, name, domain, entropy, status, created_by) VALUES (?, 'micro', ?, ?, 1.0, 'active', ?)`
  ).run(id, name, domainKey, userId);
  console.log(`[BrainState] Auto-created sector: ${name}`);
  logToRegistryChain('SECTOR_CREATED', { id, name, domain: domainKey, layer: 'micro', createdBy: userId, auto: true });
  issueEntropyReward(userId, id);
  return db.prepare(`SELECT * FROM brain_sectors WHERE id = ?`).get(id);
}

// ── Entropy Scoring ───────────────────────────────────────────────────────────

function scoreNovelty(correction, recentSubmissions) {
  if (recentSubmissions.length === 0) return 1.0;
  const newTokens = new Set(tokenize(correction));
  const existingTokens = new Set(recentSubmissions.flatMap(s => tokenize(s.correction)));
  let novel = 0;
  for (const t of newTokens) { if (!existingTokens.has(t)) novel++; }
  return newTokens.size > 0 ? novel / newTokens.size : 0;
}

export function processSubmission(userId, sectorId, prompt, correction) {
  const db = getDb();
  const sector = db.prepare(`SELECT * FROM brain_sectors WHERE id = ? AND status = 'active'`).get(sectorId);
  if (!sector) throw new Error('Sector not found or inactive');

  const recent = db.prepare(
    `SELECT correction FROM training_submissions WHERE sector_id = ? ORDER BY created_at DESC LIMIT 50`
  ).all(sectorId);

  const noveltyScore  = scoreNovelty(correction, recent);
  const entropyBefore = sector.entropy;
  
  // LEARNING RATE: A completely novel submission reduces entropy by 15% of its current value
  // This prevents sectors from being instantly pruned after 1 submission.
  const LEARNING_RATE = 0.15; 
  const entropyDelta  = parseFloat((entropyBefore * noveltyScore * LEARNING_RATE).toFixed(6));
  const entropyAfter  = parseFloat(Math.max(0, entropyBefore - entropyDelta).toFixed(6));

  if (entropyDelta < 0.001) {
    return { entropyDelta: 0, entropyAfter: entropyBefore, reward: 0, submissionId: null, rejected: true };
  }

  const submissionId = generateId();

  const txn = db.transaction(() => {
    db.prepare(`UPDATE brain_sectors SET entropy = ? WHERE id = ?`).run(entropyAfter, sectorId);
    db.prepare(
      `INSERT INTO training_submissions (id, user_id, sector_id, prompt, correction, entropy_before, entropy_after, entropy_delta, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
    ).run(submissionId, userId, sectorId, prompt, correction, entropyBefore, entropyAfter, entropyDelta);
  });
  txn();

  const reward = issueEntropyReward(userId, sectorId);
  db.prepare(`UPDATE training_submissions SET reward_bps = ?, status = 'rewarded' WHERE id = ?`).run(reward, submissionId);

  logToRegistryChain('ENTROPY_REDUCED', {
    id: generateId(), submissionId, userId, sectorId,
    sectorName: sector.name, entropyBefore, entropyAfter, entropyDelta, reward
  });

  // Evolve the AI's semantic understanding
  evolveSector(userId, sectorId, correction).catch(err => {
    console.error('[BrainState] Evolution error:', err.message);
  });

  // If entropy is mastered, prune and promote
  if (entropyAfter <= 0) {
    db.prepare(`UPDATE brain_sectors SET status = 'pruned' WHERE id = ?`).run(sectorId);
    
    if (sector.layer === 'micro') {
      const macroSector = promoteToMacro(db, sector, userId);
      logToRegistryChain('SECTOR_PROMOTED', {
        id: generateId(),
        fromId: sectorId,
        toId: macroSector?.id,
        domain: sector.domain,
        layer: 'macro'
      });
    }
  }

  return { entropyDelta, entropyAfter, reward, submissionId };
}

function promoteToMacro(db, microSector, userId) {
  // Logic: In our architecture, many micro domains might roll up into one macro domain.
  // For now, we'll look for an existing macro sector with a similar domain or create a dedicated macro evolution.
  let macro = db.prepare(`SELECT * FROM brain_sectors WHERE domain = ? AND layer = 'macro'`).get(microSector.domain);
  
  if (!macro) {
    const id = generateId();
    const name = `Macro: ${microSector.name}`;
    db.prepare(
      `INSERT INTO brain_sectors (id, layer, name, domain, entropy, status, created_by) 
       VALUES (?, 'macro', ?, ?, 0.5, 'active', ?)`
    ).run(id, name, microSector.domain, userId);
    macro = db.prepare(`SELECT * FROM brain_sectors WHERE id = ?`).get(id);
    console.log(`[BrainState] Promoted Micro to Macro: ${name}`);
  } else {
    // If it already exists, we "refresh" its entropy by adding the mastery delta (e.g., reducing macro entropy)
    const newEntropy = Math.max(0, macro.entropy - 0.1);
    db.prepare(`UPDATE brain_sectors SET entropy = ?, status = 'active' WHERE id = ?`).run(newEntropy, macro.id);
  }
  return macro;
}

// ── Pruning ───────────────────────────────────────────────────────────────────

function pruneSector(db, sectorId, reason) {
  const sector = db.prepare(`SELECT * FROM brain_sectors WHERE id = ?`).get(sectorId);
  if (!sector || sector.status === 'pruned') return;
  db.prepare(`UPDATE brain_sectors SET status = 'pruned', pruned_at = datetime('now') WHERE id = ?`).run(sectorId);
  console.log(`[BrainState] Pruned sector: ${sector.name} (${reason})`);
  logToRegistryChain('SECTOR_PRUNED', {
    id: generateId(), sectorId, sectorName: sector.name,
    layer: sector.layer, finalEntropy: sector.entropy, reason
  });
}

// ── Response Generation ───────────────────────────────────────────────────────

/**
 * Main entry point. Handles both conversation states:
 * - State 1 (answering): Generates a domain response, optionally firing Exocortex.
 * - State 2 (teaching): User is expanding on an Exocortex prompt — synthesize + reward.
 */
export async function generateBrainResponse(query, sector, market, balances, userId, sessionId) {
  const db = getDb();
  const session = sessionMemory.get(sessionId);

  // ── STATE 2: User is teaching ─────────────────────────────────────────────
  if (session?.state === 'awaiting_teaching') {
    sessionMemory.delete(sessionId);

    const { sectorId, originalQuery, webSnippets, source } = session;
    const teachingSector = db.prepare(`SELECT * FROM brain_sectors WHERE id = ?`).get(sectorId);
    if (!teachingSector) return fallbackResponse(query, userId, db);

    // Synthesize the report from web data + user's teaching
    const report = synthesizeReport(webSnippets, query, originalQuery, teachingSector.name);

    // Trigger entropy reduction and BPS reward
    let result = { entropyDelta: 0, reward: 0, submissionId: null, rejected: false };
    try {
      result = processSubmission(userId, sectorId, originalQuery, query + ' ' + webSnippets.join(' '));
    } catch (e) { console.error('[BrainState] Teaching submission error:', e.message); }

    // Log the interaction
    const interactionId = generateId();
    let responseText;
    if (result.rejected || result.entropyDelta === 0) {
      responseText = `${report}\n\n> ℹ️ **This sector already knew most of this.** No entropy was reduced this time.`;
    } else {
      responseText = `${report}\n\n---\n\n## 🎉 You Taught Me Something New!\n**Sector:** \`${teachingSector.name}\` | **Entropy reduced:** \`${result.entropyDelta.toFixed(4)}\` | **Reward: +${result.reward.toFixed(4)} BPS**`;
    }

    db.prepare(`INSERT INTO ai_interactions (id, user_id, sector_id, query, response, triggered_update) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(interactionId, userId, sectorId, query, responseText, result.entropyDelta > 0 ? 1 : 0);

    return { response: responseText, sector: teachingSector, interactionId, reward: result.reward, entropyDelta: result.entropyDelta };
  }

  // ── STATE 1: Normal query — Hemispheric Pipeline ──────────────────────────

  let responseText;
  let setAwaitingTeaching = false;
  let hemisphereResult = null;

  // Route through the Hemispheric Brain Engine
  console.log(`[BrainState] Routing query through Hemispheric Brain: "${query.substring(0, 50)}..."`);
  try {
    hemisphereResult = await orchestrate(query, sector.name, sector.id);
  } catch (orchErr) {
    console.error('[BrainState] Orchestration fatal error:', orchErr);
    return fallbackResponse(query, userId, db);
  }

  if (hemisphereResult.hemisphere === 'offline') {
    // No providers available — check if Exocortex can fill the gap
    const isNewsQuery = /news|latest|recent|today|happening|event/i.test(query);
    const needsExocortex = sector.entropy > EXOCORTEX_ENTROPY_THRESHOLD || isNewsQuery;

    if (needsExocortex) {
      const searchQuery = isNewsQuery ? `crypto ${query}` : query;
      const webResult = await performWebSearch(searchQuery);

      if (webResult && webResult.snippets.length > 0) {
        responseText = buildExocortexPrompt(query, webResult.snippets, webResult.source);
        responseText = responseText.replace('`\u200b`', `\`${sector.name}\``);
        setAwaitingTeaching = true;

        if (isNewsQuery) {
          const news = await getGlobalNewsContext(query);
          if (news.length > 0) {
            responseText += '\n\n## 📰 Latest Headlines\n';
            for (const item of news) {
              responseText += `- **${item.title}**${item.snippet ? ': ' + item.snippet : ''}\n`;
            }
          }
        }

        sessionMemory.set(sessionId, {
          state: 'awaiting_teaching',
          sectorId: sector.id,
          originalQuery: query,
          webSnippets: webResult.snippets,
          source: webResult.source,
        });
      } else {
        // Exocortex empty AND no providers — brain is offline
        responseText = hemisphereResult.response;
      }
    } else {
      // No Exocortex needed, but no providers — brain is offline
      responseText = hemisphereResult.response;
    }
  } else {
    // Providers responded — use the hemispheric result
    responseText = hemisphereResult.response;

    // If the brain detected a knowledge gap, supplement with Exocortex
    if (sector.entropy > EXOCORTEX_ENTROPY_THRESHOLD) {
      try {
        const webResult = await performWebSearch(query);
        if (webResult && webResult.snippets.length > 0) {
          responseText += `\n\n---\n\n### 🌐 Exocortex Supplement\n`;
          for (const snippet of webResult.snippets.slice(0, 2)) {
            responseText += `> ${snippet}\n\n`;
          }
          responseText += `\n> 🧠 **Can you verify this?** Teach me in this chat to earn BPS.`;
          setAwaitingTeaching = true;

          sessionMemory.set(sessionId, {
            state: 'awaiting_teaching',
            sectorId: sector.id,
            originalQuery: query,
            webSnippets: webResult.snippets,
            source: webResult.source,
          });
        }
      } catch (err) {
        console.warn('[BrainState] Exocortex supplement failed:', err.message);
      }
    }

    // Issue weighted rewards for inference providers (Skip reward if it's local use)
    try {
      const providers = hemisphereResult?.providers || [];
      const rewardableProviders = providers.filter(p => p && p.providerId && typeof p.providerId === 'string' && !p.providerId.includes('(local)'));
      
      if (rewardableProviders.length > 0) {
        const routerId = 'local-hub-router'; // Self-identity as router
        const trainerId = userId; // User who asked is credited as the 'trainer' for this session context
        issueWeightedInferenceReward(routerId, rewardableProviders, trainerId);
      }
    } catch (rewardErr) {
      console.error('[BrainState] Reward issuance failed:', rewardErr.message);
    }
  }

  // Append hemisphere routing metadata
  if (hemisphereResult && hemisphereResult.hemisphere !== 'offline' && hemisphereResult.providers?.length > 0) {
    const providerSummary = hemisphereResult.providers
      .map(p => `${p.hemisphere === 'left' ? '🔵' : p.hemisphere === 'right' ? '🔴' : '🟣'} ${p.tier}@${(p.weight * 100).toFixed(0)}%`)
      .join(' | ');
    responseText += `\n\n---\n> ⚡ **Hemispheric Routing:** ${providerSummary}`;
  }

  const interactionId = generateId();
  db.prepare(`INSERT INTO ai_interactions (id, user_id, sector_id, query, response) VALUES (?, ?, ?, ?, ?)`)
    .run(interactionId, userId, sector.id, query, responseText);

  return {
    response: responseText,
    sector,
    interactionId,
    awaiting: setAwaitingTeaching,
    hemisphere: hemisphereResult?.hemisphere,
    providers: hemisphereResult?.providers
  };
}

function fallbackResponse(query, userId, db) {
  const id = generateId();
  const msg = 'Something went wrong with the session context. Please try asking again.';
  db.prepare(`INSERT INTO ai_interactions (id, user_id, sector_id, query, response) VALUES (?, ?, NULL, ?, ?)`).run(id, userId, query, msg);
  return { response: msg, sector: null, interactionId: id };
}


// ── Init & Public API ─────────────────────────────────────────────────────────

export function initBrainState() {
  const db = getDb();
  const count = db.prepare(`SELECT COUNT(*) as count FROM brain_sectors WHERE status = 'active'`).get();
  console.log(`[BrainState] ✓ Active sectors: ${count.count}`);
}

export function getAllSectors() {
  return getDb().prepare(`SELECT * FROM brain_sectors ORDER BY layer ASC, entropy DESC`).all();
}

export function getSector(sectorId) {
  return getDb().prepare(`SELECT * FROM brain_sectors WHERE id = ?`).get(sectorId);
}

export function recordFeedback(interactionId, feedback) {
  getDb().prepare(`UPDATE ai_interactions SET feedback = ? WHERE id = ?`).run(feedback, interactionId);
}

export function getLeaderboard(limit = 10) {
  return getDb().prepare(
    `SELECT model_repo_id as id, SUM(total_earned_bps) as total_bps, COUNT(node_id) as active_nodes
     FROM ai_inference_nodes
     GROUP BY model_repo_id ORDER BY total_bps DESC LIMIT ?`
  ).all(limit);
}

export function getUserSubmissions(userId, limit = 50) {
  return getDb().prepare(
    `SELECT ts.*, bs.name as sector_name, bs.layer
     FROM training_submissions ts LEFT JOIN brain_sectors bs ON bs.id = ts.sector_id
     WHERE ts.user_id = ? ORDER BY ts.created_at DESC LIMIT ?`
  ).all(userId, limit);
}

export function getRecentRegistryEvents(limit = 20) {
  const rows = getDb().prepare(
    `SELECT * FROM registry_blocks
     WHERE registry_data LIKE '%SECTOR_CREATED%' OR registry_data LIKE '%ENTROPY_REDUCED%'
        OR registry_data LIKE '%SECTOR_PRUNED%'  OR registry_data LIKE '%REWARD_ISSUED%'
        OR registry_data LIKE '%INFERENCE_REWARD_ISSUED%'
     ORDER BY block_index DESC LIMIT ?`
  ).all(limit);
  return rows.map(r => {
    const data = JSON.parse(r.registry_data);
    return { blockIndex: r.block_index, timestamp: r.timestamp, type: data.type, payload: data.payload };
  });
}
