import fs from 'fs';
import path from 'path';
import https from 'https';

const MODEL = 'Xenova/SmolLM2-1.7B-Instruct';
const FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/model_quantized.onnx'
];

const CACHE_DIR = path.join(process.cwd(), '..', 'hub_ai_cache', MODEL.replace('/', '--'));

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

async function download(file) {
  const url = `https://huggingface.co/${MODEL}/resolve/main/${file}`;
  const dest = path.join(CACHE_DIR, file.replace(/\//g, path.sep));
  
  const dir = path.dirname(dest);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  console.log(`Downloading ${file}...`);
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (response.statusCode === 302) {
        // Handle redirect
        https.get(response.headers.location, (res) => {
          const fileStream = fs.createWriteStream(dest);
          res.pipe(fileStream);
          fileStream.on('finish', () => { fileStream.close(); resolve(); });
        });
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download ${file}: ${response.statusCode}`));
        return;
      }
      const fileStream = fs.createWriteStream(dest);
      response.pipe(fileStream);
      fileStream.on('finish', () => { fileStream.close(); resolve(); });
    });
    request.on('error', (err) => reject(err));
  });
}

async function main() {
  for (const file of FILES) {
    try {
      await download(file);
      console.log(`✓ ${file} downloaded.`);
    } catch (e) {
      console.error(`✗ ${file} failed: ${e.message}`);
    }
  }
}

main();
