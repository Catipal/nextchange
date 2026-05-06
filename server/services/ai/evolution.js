import { getDb } from '../../db/init.js';
import { vectorize, indexKnowledge } from './memory.js';

/**
 * Evolution Service
 * Bridges the gap between user training and the AI's deep understanding.
 */

/**
 * Triggered when a training submission is successfully rewarded.
 * Moves the AI's "understanding" closer to the user's input.
 */
export async function evolveSector(userId, sectorId, text) {
  const db = getDb();
  
  // 1. Permanently index the knowledge for RAG retrieval
  await indexKnowledge(userId, sectorId, text);
  
  // 2. Shift the sector's semantic centroid
  const newVector = await vectorize(text);
  const sector = db.prepare(`SELECT centroid FROM brain_sectors WHERE id = ?`).get(sectorId);
  
  let currentCentroid;
  if (sector.centroid) {
    currentCentroid = JSON.parse(sector.centroid);
  } else {
    // Initialize with the first vector if empty
    currentCentroid = new Array(newVector.length).fill(0);
  }
  
  // SEMANTIC LEARNING RATE: How fast the sector "evolves" its meaning
  const ALPHA = 0.3; 
  const updatedCentroid = currentCentroid.map((val, i) => {
    // If it was zeros, just take the new vector
    if (val === 0) return newVector[i];
    return val * (1 - ALPHA) + newVector[i] * ALPHA;
  });
  
  db.prepare(`UPDATE brain_sectors SET centroid = ? WHERE id = ?`)
    .run(JSON.stringify(updatedCentroid), sectorId);
    
  console.log(`[Evolution] Sector ${sectorId} has evolved semantically.`);
}
