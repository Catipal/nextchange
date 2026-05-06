import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import * as secp256k1 from '@noble/secp256k1';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONFIG_PATH = join(__dirname, 'config.json');

const DEFAULT_BOOTSTRAP_PEERS = [
  'ws://bootstrap1.nextchange.hub:9735',
  'ws://bootstrap2.nextchange.hub:9735'
];

const DEFAULT_CONFIG = {
  port: 3001,
  p2pPort: 9735,
  p2pHost: '0.0.0.0',
  bootstrapPeers: DEFAULT_BOOTSTRAP_PEERS,
  customPeers: [],
  maxPeers: 50,
  peerTimeout: 30000,
  jwtSecret: null,
  nodePublicKey: null,
  nodePrivateKey: null,
  btcDemoMode: true,
  bpsDemoMode: true,
  ethDemoMode: true,
  tradePruneEnabled: false,
  tradePruneMaxMB: 1000,
  registryPruneEnabled: false,
  registryPruneMaxMB: 500,
  bpsPruneEnabled: true,
  bpsPruneMaxMB: 2000
};

let _config = null;

export function loadConfig() {
  if (_config) return _config;
  if (existsSync(CONFIG_PATH)) {
    try {
      _config = { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) };
    } catch { _config = { ...DEFAULT_CONFIG }; }
  } else {
    _config = { ...DEFAULT_CONFIG };
  }

  // Generate P2P node identity if missing
  if (!_config.nodePrivateKey || !_config.nodePublicKey || _config.nodePublicKey === 'GENERATE_ON_START') {
    const privBytes = randomBytes(32);
    const privHex = privBytes.toString('hex');
    _config.nodePrivateKey = privHex;
    const pubBytes = secp256k1.getPublicKey(new Uint8Array(privBytes), true);
    _config.nodePublicKey = Buffer.from(pubBytes).toString('hex');
    saveConfig();
  }

  if (!_config.jwtSecret) {
    _config.jwtSecret = randomBytes(32).toString('hex');
    saveConfig();
  }
  return _config;
}

export function saveConfig() {
  if (!_config) return;
  try { writeFileSync(CONFIG_PATH, JSON.stringify(_config, null, 2), 'utf8'); } catch {}
}

export function updateConfig(updates) {
  _config = { ...loadConfig(), ...updates };
  saveConfig();
  return _config;
}

export function getAllPeers() {
  const c = loadConfig();
  return [...new Set([...c.bootstrapPeers, ...c.customPeers])];
}

export function addCustomPeer(addr) {
  const c = loadConfig();
  if (!c.customPeers.includes(addr)) { c.customPeers.push(addr); saveConfig(); }
  return c.customPeers;
}

export function removeCustomPeer(addr) {
  const c = loadConfig();
  c.customPeers = c.customPeers.filter(p => p !== addr);
  saveConfig();
  return c.customPeers;
}

export { DEFAULT_BOOTSTRAP_PEERS };
