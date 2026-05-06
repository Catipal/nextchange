/**
 * Synthesis Engine — Pure JavaScript NLP.
 * Takes raw web snippets + user teaching text and generates
 * a cohesive "Learned Report" without requiring an external LLM.
 */

// ── Sentence splitter ─────────────────────────────────────────────────────────

function splitSentences(text) {
  return text
    .replace(/([.!?])\s+/g, '$1\n')
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 20);
}

function tokenize(text) {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s']/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3 && !STOP_WORDS.has(w))
  );
}

// Common English stop words to ignore when scoring relevance
const STOP_WORDS = new Set([
  'this', 'that', 'with', 'from', 'have', 'will', 'they', 'their',
  'what', 'which', 'when', 'where', 'also', 'more', 'some', 'such',
  'been', 'into', 'than', 'then', 'most', 'over', 'about', 'these',
  'those', 'after', 'other', 'were', 'just', 'like', 'used', 'using',
]);

// ── TF-IDF-style relevance scorer ─────────────────────────────────────────────

/**
 * Score how relevant a sentence is to the query keywords.
 * Higher = more relevant.
 */
function scoreSentence(sentence, queryTokens) {
  const sentenceTokens = tokenize(sentence);
  let score = 0;
  for (const token of queryTokens) {
    if (sentenceTokens.has(token)) score += 2;
    // Partial match bonus
    for (const st of sentenceTokens) {
      if (st.includes(token) || token.includes(st)) score += 0.5;
    }
  }
  return score;
}

// ── Key phrase extractor ──────────────────────────────────────────────────────

function extractKeyPhrases(text, maxPhrases = 5) {
  const tokens = text.toLowerCase().replace(/[^a-z0-9\s']/g, '').split(/\s+/);
  const freq = {};
  for (const token of tokens) {
    if (token.length > 4 && !STOP_WORDS.has(token)) {
      freq[token] = (freq[token] || 0) + 1;
    }
  }
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxPhrases)
    .map(([word]) => word);
}

// ── Report builder ────────────────────────────────────────────────────────────

/**
 * Synthesize a learned report from:
 * - webSnippets: string[] — raw text from Exocortex search
 * - userInput:   string  — what the user said in the chat
 * - query:       string  — the original question asked
 * - sectorName:  string  — which brain sector this belongs to
 *
 * Returns a markdown-formatted report string.
 */
export function synthesizeReport(webSnippets, userInput, query, sectorName) {
  const allWebText = webSnippets.join(' ');
  const queryTokens = tokenize(query);

  // 1. Extract the most relevant sentences from web snippets
  const webSentences = splitSentences(allWebText);
  const scoredWeb = webSentences
    .map(s => ({ sentence: s, score: scoreSentence(s, queryTokens) }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(s => s.sentence);

  // 2. Extract the most relevant sentences from user input
  const userSentences = splitSentences(userInput);
  const scoredUser = userSentences
    .map(s => ({ sentence: s, score: scoreSentence(s, queryTokens) + 3 })) // user input gets priority boost
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(s => s.sentence);

  // 3. Merge and de-duplicate
  const allSentences = [...scoredUser, ...scoredWeb];
  const seen = new Set();
  const merged = allSentences.filter(s => {
    const key = s.toLowerCase().slice(0, 40);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // 4. Extract key concepts for the summary header
  const keyPhrases = extractKeyPhrases(userInput + ' ' + allWebText);

  // 5. Assemble the report
  const lines = [];
  lines.push(`## 🧠 ${sectorName} — Learned Report`);
  lines.push('');

  if (keyPhrases.length > 0) {
    lines.push(`**Key concepts:** ${keyPhrases.join(', ')}`);
    lines.push('');
  }

  if (merged.length > 0) {
    lines.push('**Synthesized understanding:**');
    for (const sentence of merged) {
      lines.push(`- ${sentence.endsWith('.') ? sentence : sentence + '.'}`);
    }
  } else {
    // Fallback: just use user input directly
    lines.push(userInput);
  }

  return lines.join('\n');
}

/**
 * Generate the AI's initial response when it encounters high entropy
 * and has fetched Exocortex results but hasn't synthesized yet.
 * This is State 1: presenting raw findings and asking for verification.
 */
export function buildExocortexPrompt(query, webSnippets, source) {
  const allText = webSnippets.join(' ');
  const sentences = splitSentences(allText);
  const queryTokens = tokenize(query);

  // Pick the single most relevant sentence as the "lead finding"
  const scored = sentences
    .map(s => ({ s, score: scoreSentence(s, queryTokens) }))
    .sort((a, b) => b.score - a.score);

  const lead = scored[0]?.s || sentences[0] || allText.slice(0, 200);
  const supporting = scored.slice(1, 3).map(s => s.s).filter(Boolean);

  const lines = [];
  lines.push(`## 🌍 Exocortex Search (via ${source})`);
  lines.push('');
  lines.push(`My local weights had no strong knowledge here. Here is what I found:`);
  lines.push('');
  lines.push(`> ${lead}`);
  if (supporting.length > 0) {
    for (const s of supporting) lines.push(`> ${s}`);
  }
  lines.push('');
  lines.push(`**Can you verify or expand on this?** Your input will be permanently stored in my \`${'\u200b'}\` sector and you will earn BPS for reducing my entropy.`);

  return lines.join('\n');
}
