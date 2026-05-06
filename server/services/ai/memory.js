import { getDb } from '../../db/init.js';
import { generateId } from '../../utils/helpers.js';

/**
 * Semantic Memory Service
 * Handles indexing and retrieval of "Learned Knowledge" using vector embeddings.
 */

let vectorizer = null;

async function getVectorizer() {
  if (vectorizer) return vectorizer;
  const { pipeline } = await import('@xenova/transformers');
  vectorizer = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  return vectorizer;
}

/**
 * Convert text into a 384-dimensional vector.
 */
export async function vectorize(text) {
  const extractor = await getVectorizer();
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

/**
 * Store a piece of knowledge in the Evolutive Layer.
 */
export async function indexKnowledge(userId, sectorId, text) {
  const db = getDb();
  const vector = await vectorize(text);
  const id = generateId();
  
  db.prepare(`
    INSERT INTO evolutive_memory (id, user_id, sector_id, content, vector)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, userId, sectorId, text, JSON.stringify(vector));
  
  return id;
}

/**
 * Retrieve the most relevant pieces of knowledge for a query.
 */
export async function queryMemory(queryText, limit = 3) {
  const db = getDb();
  const queryVector = await vectorize(queryText);
  
  // Fetch all memory blocks (for small scale, we do exhaustive search)
  // At 2GB scale, we'll want to optimize this later with a HNSW index
  const memories = db.prepare(`SELECT content, vector FROM evolutive_memory`).all();
  
  const scored = memories.map(m => {
    const mVector = JSON.parse(m.vector);
    const score = cosineSimilarity(queryVector, mVector);
    return { content: m.content, score };
  });
  
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .filter(m => m.score > 0.5); // only return reasonably relevant matches
}

function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let mA = 0;
  let mB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    mA += vecA[i] * vecA[i];
    mB += vecB[i] * vecB[i];
  }
  return dotProduct / (Math.sqrt(mA) * Math.sqrt(mB));
}
