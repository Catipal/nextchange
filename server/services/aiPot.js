import { getDb } from '../db/init.js';
import { getRegistryChain } from '../blockchain/chain.js';
import { createBlock } from '../blockchain/block.js';
import { loadConfig } from '../config.js';
import { generateId, satoshiRound } from '../utils/helpers.js';

const VAULT_ID      = 'EXCHANGE_DAO_VAULT';
const DRAWDOWN_RATE = 0.005;   // 0.5% of vault BPS per reward event
const DUST_GUARD    = 0.000001;

// Synaptic Aggregator Split
const SPLIT = {
  router: 0.02,   // 2%
  macro: 0.64,    // 64%
  micro: 0.33,    // 33%
  trainer: 0.01   // 1%
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function getVaultBps(db) {
  const row = db.prepare(
    `SELECT available FROM balances WHERE user_id = ? AND currency = 'bps'`
  ).get(VAULT_ID);
  return row ? row.available : 0;
}

function countActiveSectors(db, layer) {
  const row = db.prepare(
    `SELECT COUNT(*) as count FROM brain_sectors WHERE layer = ? AND status = 'active'`
  ).get(layer);
  return row.count || 1; // never divide by zero
}

function updateBalance(db, userId, currency, delta) {
  db.prepare(
    `INSERT OR IGNORE INTO balances (user_id, currency, available, locked) VALUES (?, ?, 0, 0)`
  ).run(userId, currency);
  db.prepare(
    `UPDATE balances SET available = available + ? WHERE user_id = ? AND currency = ?`
  ).run(delta, userId, currency);
}

function logToRegistryChain(type, payload) {
  try {
    const config = loadConfig();
    if (!config.nodePublicKey || !config.nodePrivateKey) return;
    const chain = getRegistryChain();
    const latest = chain.getLatestBlock();
    const block = createBlock(
      latest.index + 1,
      latest.hash,
      payload,
      config.nodePrivateKey,
      config.nodePublicKey,
      type
    );
    chain.addBlock(block);
  } catch (err) {
    console.error('[AIPot] Registry log error:', err.message);
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Calculate how much BPS a user would receive for a given sector
 * based on the current vault balance. Used for reward preview.
 */
export function previewReward(sectorId, tier = 'micro') {
  const db = getDb();
  const sector = db.prepare(`SELECT * FROM brain_sectors WHERE id = ?`).get(sectorId);
  if (!sector || sector.status !== 'active') return 0;
  const vaultBps = getVaultBps(db);
  const rewardPool = vaultBps * DRAWDOWN_RATE;
  
  // Predict provider reward
  const share = tier === 'macro' ? SPLIT.macro : SPLIT.micro;
  return satoshiRound(rewardPool * share);
}

/**
 * Issue a BPS reward from the DAO Vault to a user wallet.
 * Called after a verified entropy-reducing submission or sector creation.
 *
 * @param {string} userId   - Recipient user ID
 * @param {string} sectorId - The sector that was improved
 * @returns {number} The BPS amount paid out (0 if dust or vault empty)
 */
export function issueEntropyReward(userId, sectorId) {
  const db = getDb();
  const sector = db.prepare(`SELECT * FROM brain_sectors WHERE id = ?`).get(sectorId);
  if (!sector || sector.status !== 'active') return 0;

  const txn = db.transaction(() => {
    const vaultBps = getVaultBps(db);
    if (vaultBps < DUST_GUARD) return 0;

    const share = sector.layer === 'macro' ? SPLIT.macro : (sector.layer === 'router' ? SPLIT.router : SPLIT.micro);
    const layerFund      = vaultBps * DRAWDOWN_RATE * share;
    const activeSectors  = countActiveSectors(db, sector.layer);
    const userPayout     = satoshiRound(layerFund / activeSectors);

    if (userPayout < DUST_GUARD) return 0;

    // Deduct from vault, credit to user
    updateBalance(db, VAULT_ID, 'bps', -userPayout);
    updateBalance(db, userId, 'bps', userPayout);

    console.log(`[AIPot] Reward: ${userPayout} BPS → ${userId} (sector: ${sector.name})`);
    return userPayout;
  });

  const payout = txn();

  if (payout > 0) {
    logToRegistryChain('REWARD_ISSUED', {
      id: generateId(),
      userId,
      sectorId,
      sectorName: sector.name,
      layer: sector.layer,
      amount: payout,
      drawdownRate: DRAWDOWN_RATE
    });
  }

  return payout;
}

/**
 * Issue rewards for a decentralized inference request (legacy single-provider).
 */
export function issueInferenceReward(routerId, providerId, trainerId, providerTier) {
  return issueWeightedInferenceReward(routerId, [
    { providerId, tier: providerTier, weight: 1.0 }
  ], trainerId);
}

/**
 * Issue weighted rewards for a multi-provider hemispheric inference request.
 * 
 * Global drawdown (0.5% of vault) is split into fixed pools:
 *   Router: 2%, Macro: 64%, Micro: 33%, Trainer: 1%
 * 
 * Within each tier pool, rewards are distributed by contribution weight.
 * The portion of a pool that has no contributing provider stays in the pot.
 * 
 * Example: 95% macro / 5% micro contribution
 *   Macro pool (64% of drawdown):
 *     → Provider gets 95% of macro pool
 *     → 5% stays in pot (returned to vault)
 *   Micro pool (33% of drawdown):
 *     → Provider gets 5% of micro pool
 *     → 95% stays in pot (returned to vault)
 *
 * @param {string} routerId - Router node ID
 * @param {Array<{ providerId: string, tier: string, weight: number }>} contributions
 * @param {string} trainerId - Trainer user ID
 */
export function issueWeightedInferenceReward(routerId, contributions, trainerId) {
  const db = getDb();
  
  const txn = db.transaction(() => {
    const vaultBps = getVaultBps(db);
    if (vaultBps < DUST_GUARD) return null;

    const rewardPool = vaultBps * DRAWDOWN_RATE;
    if (rewardPool < DUST_GUARD) return null;

    const macroPool = satoshiRound(rewardPool * SPLIT.macro);
    const microPool = satoshiRound(rewardPool * SPLIT.micro);
    const routerPayout = satoshiRound(rewardPool * SPLIT.router);
    const trainerPayout = satoshiRound(rewardPool * SPLIT.trainer);

    let totalPaidOut = routerPayout + trainerPayout;
    const providerPayouts = [];

    // Separate contributions by tier
    const macroContribs = contributions.filter(c => c.tier === 'macro');
    const microContribs = contributions.filter(c => c.tier === 'micro');

    // Distribute macro pool by weight
    for (const c of macroContribs) {
      const payout = satoshiRound(macroPool * c.weight);
      if (payout > DUST_GUARD && c.providerId) {
        updateBalance(db, c.providerId, 'bps', payout);
        try {
          db.prepare(`UPDATE ai_inference_nodes SET total_earned_bps = total_earned_bps + ? WHERE node_id = ?`).run(payout, c.providerId);
        } catch {}
        totalPaidOut += payout;
        providerPayouts.push({ providerId: c.providerId, tier: 'macro', weight: c.weight, payout });
      }
    }

    // Distribute micro pool by weight
    for (const c of microContribs) {
      const payout = satoshiRound(microPool * c.weight);
      if (payout > DUST_GUARD && c.providerId) {
        updateBalance(db, c.providerId, 'bps', payout);
        try {
          db.prepare(`UPDATE ai_inference_nodes SET total_earned_bps = total_earned_bps + ? WHERE node_id = ?`).run(payout, c.providerId);
        } catch {}
        totalPaidOut += payout;
        providerPayouts.push({ providerId: c.providerId, tier: 'micro', weight: c.weight, payout });
      }
    }

    // Only deduct what was actually paid out (remainder stays in vault = pot)
    updateBalance(db, VAULT_ID, 'bps', -totalPaidOut);

    // Credit router and trainer
    if (routerId) updateBalance(db, routerId, 'bps', routerPayout);
    if (trainerId) updateBalance(db, trainerId, 'bps', trainerPayout);

    console.log(`[AIPot] Weighted Inference Reward: Router: ${routerPayout}, Trainer: ${trainerPayout}, Providers: ${JSON.stringify(providerPayouts.map(p => `${p.tier}@${(p.weight*100).toFixed(0)}%=${p.payout}`))}`);
    
    return { routerPayout, trainerPayout, providerPayouts, totalPaidOut };
  });

  const payouts = txn();

  if (payouts) {
    logToRegistryChain('INFERENCE_REWARD_ISSUED', {
      id: generateId(),
      routerId,
      trainerId,
      contributions,
      payouts
    });
  }

  return payouts;
}

/**
 * Get the current AI Pot breakdown: vault BPS and per-layer allocations.
 */
export function getAiPotStats() {
  const db = getDb();
  const vaultBps = getVaultBps(db);
  const rewardEvent = vaultBps * DRAWDOWN_RATE;

  const breakdown = {
    router: { pool: satoshiRound(vaultBps * SPLIT.router), rewardPerHit: satoshiRound(rewardEvent * SPLIT.router) },
    macro: { pool: satoshiRound(vaultBps * SPLIT.macro), rewardPerHit: satoshiRound(rewardEvent * SPLIT.macro) },
    micro: { pool: satoshiRound(vaultBps * SPLIT.micro), rewardPerHit: satoshiRound(rewardEvent * SPLIT.micro) },
    trainer: { pool: satoshiRound(vaultBps * SPLIT.trainer), rewardPerHit: satoshiRound(rewardEvent * SPLIT.trainer) }
  };

  return { totalBps: vaultBps, nextRewardEvent: satoshiRound(rewardEvent), breakdown };
}
