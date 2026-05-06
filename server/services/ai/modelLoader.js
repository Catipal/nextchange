/**
 * Unified Model Loader
 * Supports two backends:
 *   - ONNX mode (Micro tier): Uses @xenova/transformers for HuggingFace ONNX repos
 *   - GGUF mode (Macro tier): Uses node-llama-cpp for local .gguf model files
 *
 * This abstraction lets the Provider tab hot-swap models at runtime.
 */

import { env, pipeline } from '@xenova/transformers';
import path from 'path';
import fs from 'fs';

// Cache ONNX models outside server folder to prevent restart loops
env.cacheDir = path.join(process.cwd(), '..', 'hub_ai_cache');

// ── State ─────────────────────────────────────────────────────────────────────

let currentBackend = null;   // 'onnx' | 'gguf' | null
let currentModelName = null; // repo ID or filename
let currentModelPath = null; // full path for GGUF
let loaderStatus = 'idle';   // idle | loading | ready | error
let loadProgress = 0;
let lastError = null;

// ONNX state
let onnxGenerator = null;

// GGUF state
let llamaModel = null;
let llamaContext = null;
let llamaSession = null;

// ── ONNX Backend (@xenova/transformers) ───────────────────────────────────────

async function loadOnnxModel(repoId) {
  loaderStatus = 'loading';
  loadProgress = 0;
  currentModelName = repoId;
  currentBackend = 'onnx';

  console.log(`[ModelLoader] Loading ONNX model: ${repoId}...`);

  onnxGenerator = await pipeline('text-generation', repoId, {
    progress_callback: (p) => {
      if (p.status === 'progress') {
        loadProgress = Math.round(p.progress);
      }
    }
  });

  loaderStatus = 'ready';
  loadProgress = 100;
  console.log(`[ModelLoader] ONNX model ready: ${repoId}`);
}

async function runOnnxInference(prompt, systemPrompt) {
  if (!onnxGenerator) throw new Error('ONNX model not loaded');

  const messages = [
    { role: 'system', content: systemPrompt || 'You are a helpful AI assistant.' },
    { role: 'user', content: prompt }
  ];

  const output = await onnxGenerator(messages, {
    max_new_tokens: 256,
    temperature: 0.7,
    do_sample: true,
    top_k: 50
  });

  return output[0].generated_text[output[0].generated_text.length - 1].content;
}

// ── GGUF Backend (node-llama-cpp) ─────────────────────────────────────────────

let llamaCppModule = null;

async function getLlamaCpp() {
  if (llamaCppModule) return llamaCppModule;
  try {
    llamaCppModule = await import('node-llama-cpp');
    return llamaCppModule;
  } catch (err) {
    throw new Error(`node-llama-cpp not available: ${err.message}. Install with: npm install node-llama-cpp`);
  }
}

async function loadGgufModel(ggufPath, customContextSize) {
  loaderStatus = 'loading';
  loadProgress = 0;
  currentBackend = 'gguf';

  // Resolve and validate path
  if (!ggufPath || ggufPath.trim() === '') {
    loaderStatus = 'error';
    lastError = 'Please enter a valid GGUF file path.';
    throw new Error(lastError);
  }

  const resolvedPath = path.resolve(ggufPath);
  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
    loaderStatus = 'error';
    lastError = `GGUF file not found or invalid: ${resolvedPath}`;
    throw new Error(lastError);
  }

  currentModelPath = resolvedPath;
  currentModelName = path.basename(resolvedPath);
  console.log(`[ModelLoader] Loading GGUF model: ${currentModelName}...`);

  const { getLlama } = await getLlamaCpp();
  const llama = await getLlama();

  loadProgress = 30;

  try {
    llamaModel = await llama.loadModel({ modelPath: resolvedPath });
  } catch (err) {
    console.warn(`[ModelLoader] GPU load failed (${err.message}). Retrying with CPU only...`);
    llamaModel = await llama.loadModel({ modelPath: resolvedPath, gpuLayers: 0 });
  }
  
  loadProgress = 70;
  
  const ctxSize = customContextSize || 2048;
  console.log(`[ModelLoader] Creating context with size: ${ctxSize}`);
  llamaContext = await llamaModel.createContext({ 
    sequences: 2,
    contextSize: ctxSize 
  });
  loadProgress = 100;

  loaderStatus = 'ready';
  console.log(`[ModelLoader] GGUF model ready: ${currentModelName}`);
}

async function runGgufInference(prompt, systemPrompt) {
  if (!llamaModel || !llamaContext) throw new Error('GGUF model not loaded');
  const { LlamaChatSession } = await getLlamaCpp();

  // Reuse session to prevent "No sequences left" leak
  if (!llamaSession) {
    llamaSession = new LlamaChatSession({
      contextSequence: llamaContext.getSequence(),
      systemPrompt: systemPrompt || 'You are a helpful AI assistant.'
    });
  }

  return await llamaSession.prompt(prompt, {
    maxTokens: 512,
    temperature: 0.7
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Load a model. Unloads any previously loaded model first.
 * @param {object} config - { mode: 'onnx'|'gguf', repoId?: string, ggufPath?: string }
 */
export async function loadModel(config) {
  console.log('[ModelLoader] Request to load model:', config);
  
  // Prevent redundant loads if already ready
  const isSameModel = (currentBackend === config.mode && 
                       (currentModelPath === config.ggufPath || currentModelName === config.repoId));
                       
  if (isSameModel && loaderStatus === 'ready') {
    console.log('[ModelLoader] Model already loaded and ready. Skipping.');
    return;
  }

  console.log(`[ModelLoader] Initializing load sequence (current status: ${loaderStatus})...`);
  // Unload current model first
  await unloadModel();
  if (global.gc) global.gc(); // Force GC if exposed

  lastError = null;

  try {
    if (config.mode === 'onnx') {
      if (!config.repoId) throw new Error('repoId required for ONNX mode');
      await loadOnnxModel(config.repoId);
    } else if (config.mode === 'gguf') {
      if (!config.ggufPath) throw new Error('ggufPath required for GGUF mode');
      await loadGgufModel(config.ggufPath, config.contextSize);
    } else {
      throw new Error(`Unknown mode: ${config.mode}`);
    }
  } catch (err) {
    loaderStatus = 'error';
    lastError = err.message;
    console.error(`[ModelLoader] Load failed:`, err.message);
    throw err;
  }
}

/**
 * Unload the current model and free memory.
 */
export async function unloadModel() {
  if (llamaContext) {
    try { llamaContext.dispose?.(); } catch {}
    llamaContext = null;
  }
  if (llamaSession) {
    llamaSession = null;
  }
  if (llamaModel) {
    try { llamaModel.dispose?.(); } catch {}
    llamaModel = null;
  }
  onnxGenerator = null;
  currentBackend = null;
  currentModelName = null;
  currentModelPath = null;
  loaderStatus = 'idle';
  loadProgress = 0;
  lastError = null;
}

/**
 * Run inference on the currently loaded model.
 * @param {string} prompt - User prompt
 * @param {string} systemPrompt - System prompt
 * @returns {Promise<string>} Generated text
 */
export async function runInference(prompt, systemPrompt) {
  if (loaderStatus !== 'ready') throw new Error(`Model not ready (status: ${loaderStatus})`);

  if (currentBackend === 'onnx') {
    return runOnnxInference(prompt, systemPrompt);
  } else if (currentBackend === 'gguf') {
    return runGgufInference(prompt, systemPrompt);
  }

  throw new Error('No model backend active');
}

/**
 * Get current loader status.
 */
export function getLoaderStatus() {
  return {
    status: loaderStatus,
    backend: currentBackend,
    modelName: currentModelName,
    modelPath: currentModelPath,
    progress: loadProgress,
    error: lastError
  };
}

/**
 * Check if a model is loaded and ready for inference.
 */
export function isReady() {
  return loaderStatus === 'ready';
}
