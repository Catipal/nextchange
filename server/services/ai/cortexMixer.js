/**
 * Cortex Mixer
 * 
 * Blends outputs from multiple AI provider models that ran in parallel.
 * Uses contribution weights to select the best parts from each response
 * and assembles them into a single coherent answer.
 */

/**
 * Mix results from multiple parallel inference providers.
 * 
 * @param {Array<{ text: string, providerId: string, tier: string, weight: number, capability: string }>} results
 * @param {{ hemisphere: string, leftScore: number, rightScore: number }} intent
 * @returns {{ text: string, providers: object[], tierWeights: object }}
 */
export function mixResults(results, intent) {
  if (results.length === 0) {
    return { text: '', providers: [], tierWeights: {} };
  }

  // Single result — passthrough
  if (results.length === 1) {
    const r = results[0];
    return {
      text: r.text,
      providers: [{
        providerId: r.providerId,
        tier: r.tier,
        weight: 1.0,
        hemisphere: r.capability === 'logic' ? 'left' : r.capability === 'creative' ? 'right' : 'general'
      }],
      tierWeights: { [r.tier]: 1.0 }
    };
  }

  // ── Multi-result mixing ────────────────────────────────────────────────────

  // Sort by weight descending — highest-weighted response is the primary
  const sorted = [...results].sort((a, b) => (b.weight || 0.5) - (a.weight || 0.5));
  const primary = sorted[0];
  const secondary = sorted.slice(1);

  // Calculate tier weights for reward distribution
  const tierWeights = {};
  for (const r of results) {
    const tier = r.tier || 'micro';
    tierWeights[tier] = (tierWeights[tier] || 0) + (r.weight || 0.5);
  }
  // Normalize so each tier's total sums correctly
  const totalWeight = Object.values(tierWeights).reduce((a, b) => a + b, 0);
  for (const tier in tierWeights) {
    tierWeights[tier] = tierWeights[tier] / totalWeight;
  }

  // Build providers metadata
  const providers = results.map(r => ({
    providerId: r.providerId,
    tier: r.tier,
    weight: r.weight || 0.5,
    hemisphere: r.capability === 'logic' ? 'left' : r.capability === 'creative' ? 'right' : 'general'
  }));

  // ── Blending Strategy ──────────────────────────────────────────────────────
  // Primary response is the base. Extract unique insights from secondary
  // responses and append them as supplementary sections.

  let mixedText = primary.text;

  for (const sec of secondary) {
    if (!sec.text || sec.text.trim().length === 0) continue;

    // Extract paragraphs from the secondary that don't overlap with primary
    const uniqueInsights = extractUniqueInsights(primary.text, sec.text);
    
    if (uniqueInsights.length > 0) {
      const hemisphereLabel = sec.capability === 'logic' 
        ? '🔵 Analytical Perspective' 
        : sec.capability === 'creative' 
          ? '🔴 Creative Perspective' 
          : '🟣 Additional Perspective';

      mixedText += `\n\n---\n\n### ${hemisphereLabel}\n\n${uniqueInsights.join('\n\n')}`;
    }
  }

  console.log(`[CortexMixer] Blended ${results.length} outputs. Tiers: ${JSON.stringify(tierWeights)}`);

  return { text: mixedText, providers, tierWeights };
}

/**
 * Extract paragraphs from secondary text that contain novel content
 * not present in the primary text.
 */
function extractUniqueInsights(primaryText, secondaryText) {
  const primaryTokens = new Set(
    primaryText.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(t => t.length > 3)
  );

  const paragraphs = secondaryText
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 20);

  const unique = [];

  for (const para of paragraphs) {
    const paraTokens = para.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(t => t.length > 3);

    // Calculate overlap ratio — how many tokens in this paragraph are new
    const newTokens = paraTokens.filter(t => !primaryTokens.has(t));
    const noveltyRatio = paraTokens.length > 0 ? newTokens.length / paraTokens.length : 0;

    // Only include paragraphs that are at least 30% novel
    if (noveltyRatio >= 0.3) {
      unique.push(para);
    }
  }

  // Limit to 2 supplementary insights to keep the response concise
  return unique.slice(0, 2);
}
