import { queryMemory } from './memory.js';
import * as modelLoader from './modelLoader.js';

/**
 * AI Model Service
 * Delegates to the unified model loader for inference.
 */

/**
 * Generate a smart response using the active model and Evolutive Memory (RAG).
 */
export async function generateSmartResponse(query, sectorName, hemisphere = 'general') {
  if (!modelLoader.isReady()) {
    throw new Error('AI Model is not loaded or not ready. Please enable Provider mode and load a model.');
  }
  
  // 1. Retrieve evolutive context (what the AI learned from the user)
  const memories = await queryMemory(query);
  const context = memories.map(m => m.content).join('\n');
  
  // 2. Build the instruction prompt based on hemisphere
  let hemisphereInstruction = "";
  if (hemisphere === 'logic') {
    hemisphereInstruction = "Your primary focus is LOGIC and ANALYSIS. Be precise, data-driven, and objective. Use tables or lists where appropriate to break down complex information.";
  } else if (hemisphere === 'creative') {
    hemisphereInstruction = "Your primary focus is CREATIVITY and INNOVATION. Be imaginative, strategic, and forward-thinking. Provide novel insights and explore hypothetical scenarios.";
  } else {
    hemisphereInstruction = "Provide a balanced response incorporating both analytical precision and creative strategic insight.";
  }

  const systemPrompt = `
    You are the Global Brain of NextChange Hub, a decentralized trading and AI ecosystem.
    You are currently operating in the "${sectorName}" sector.
    
    ${hemisphereInstruction}
    
    Use the following learned knowledge to refine your answer. 
    If the knowledge is technical, prioritize it over general knowledge.
    Learned Knowledge:
    ${context || 'No specific expert knowledge learned yet for this query.'}
    
    Keep your response professional, bold, and concise. Use markdown for structure.
  `.trim();

  // 3. Generate
  const output = await modelLoader.runInference(query, systemPrompt);
  return output;
}

export function getModelStatus() {
  return modelLoader.getLoaderStatus();
}
