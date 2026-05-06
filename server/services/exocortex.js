/**
 * Exocortex — External knowledge retrieval layer.
 * Scrapes DuckDuckGo Lite + Wikipedia for real-time context.
 * All results are cached for 5 minutes to avoid hammering sources.
 */

import https from 'https';
import http from 'http';

// ── Cache ─────────────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const searchCache = new Map();

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NextChangeAI/1.0)' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&#x27;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ── DuckDuckGo Lite Scraper ───────────────────────────────────────────────────

async function scrapeDuckDuckGo(query) {
  const encoded = encodeURIComponent(query);
  const html = await httpGet(`https://lite.duckduckgo.com/lite/?q=${encoded}`);

  // Extract result snippets from DDG Lite's <td class="result-snippet">
  const snippets = [];
  const snippetRe = /class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi;
  const titleRe = /class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = snippetRe.exec(html)) !== null && snippets.length < 4) {
    const text = stripHtml(m[1]).trim();
    if (text.length > 30) snippets.push(text);
  }

  // Fallback: grab any <td> text blocks if no snippets found
  if (snippets.length === 0) {
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    while ((m = tdRe.exec(html)) !== null && snippets.length < 4) {
      const text = stripHtml(m[1]).trim();
      if (text.length > 60 && !text.startsWith('http') && !/^\d+$/.test(text)) {
        snippets.push(text);
      }
    }
  }

  return snippets;
}

// ── Wikipedia Summary API ─────────────────────────────────────────────────────

async function fetchWikipediaSummary(query) {
  try {
    const encoded = encodeURIComponent(query.replace(/ /g, '_'));
    const json = await httpGet(`https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`);
    const data = JSON.parse(json);
    if (data.extract && data.extract.length > 40) {
      return data.extract.slice(0, 500);
    }
  } catch { /* silent fail */ }
  return null;
}

// ── Crypto RSS Feed Cache ─────────────────────────────────────────────────────

const RSS_FEEDS = [
  'https://cointelegraph.com/rss',
  'https://www.coindesk.com/arc/outboundfeeds/rss/',
];

let newsCache = { items: [], fetchedAt: 0 };

async function fetchNewsFeeds() {
  if (Date.now() - newsCache.fetchedAt < CACHE_TTL_MS) return newsCache.items;
  const items = [];
  for (const feed of RSS_FEEDS) {
    try {
      const xml = await httpGet(feed);
      const itemRe = /<item[\s\S]*?<\/item>/gi;
      const titleRe = /<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/i;
      const descRe  = /<description><!\[CDATA\[(.*?)\]\]><\/description>|<description>(.*?)<\/description>/i;
      let m;
      while ((m = itemRe.exec(xml)) !== null && items.length < 20) {
        const block = m[0];
        const title = titleRe.exec(block);
        const desc  = descRe.exec(block);
        const titleText = (title?.[1] || title?.[2] || '').trim();
        const descText  = stripHtml(desc?.[1] || desc?.[2] || '').trim().slice(0, 200);
        if (titleText.length > 5) items.push({ title: titleText, snippet: descText });
      }
    } catch { /* silent — don't break if one feed fails */ }
  }
  newsCache = { items, fetchedAt: Date.now() };
  return items;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Perform a live web search for the given query.
 * Returns { snippets: string[], source: string } or null on failure.
 */
export async function performWebSearch(query) {
  const cacheKey = query.toLowerCase().trim();
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.result;

  let snippets = [];
  let source = 'web';

  try {
    // 1. Try Wikipedia first (cleanest data)
    const wiki = await fetchWikipediaSummary(query);
    if (wiki) {
      snippets.push(wiki);
      source = 'Wikipedia';
    }

    // 2. DuckDuckGo Lite for additional snippets
    const ddg = await scrapeDuckDuckGo(query);
    snippets = [...snippets, ...ddg];
  } catch (err) {
    console.error('[Exocortex] Search error:', err.message);
    return null;
  }

  if (snippets.length === 0) return null;

  const result = { snippets: snippets.slice(0, 4), source };
  searchCache.set(cacheKey, { result, fetchedAt: Date.now() });
  return result;
}

/**
 * Get recent crypto news headlines filtered by keywords from the query.
 */
export async function getGlobalNewsContext(query) {
  const items = await fetchNewsFeeds();
  const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const relevant = items.filter(item =>
    keywords.some(k => item.title.toLowerCase().includes(k) || item.snippet.toLowerCase().includes(k))
  );
  return relevant.length > 0 ? relevant.slice(0, 5) : items.slice(0, 3);
}
