import { loadConfig } from '../config.js';
import { getRegistryChain } from '../blockchain/chain.js';
import { MSG } from './protocol.js';
import os from 'os';

export class DiscoveryService {
  constructor(p2pNode) {
    this.p2pNode = p2pNode;
    this.announceTimer = null;
  }

  start() {
    // 1. Scan registry chain for recent announcements on startup
    this._scanChainForPeers();

    // 2. Listen for new registry blocks in real-time
    this.p2pNode.on(MSG.REGISTRY_BLOCK, (msg) => {
      const { block } = msg.payload;
      if (block.payload?.address) {
        if (!this._isSelf(block.payload.address)) {
          console.log('[Discovery] Found peer on-chain:', block.payload.address);
          this.p2pNode.addPeer(block.payload.address);
        }
      }
    });

    // 3. Periodically announce ourselves on-chain (every 15 minutes)
    this.announceTimer = setInterval(() => this.p2pNode.announceOnChain(), 900000);
    
    // Initial announcement
    setTimeout(() => this.p2pNode.announceOnChain(), 5000);
  }

  stop() {
    if (this.announceTimer) clearInterval(this.announceTimer);
  }

  _scanChainForPeers() {
    try {
      const chain = getRegistryChain();
      const recentBlocks = chain.getRecentBlocks(100);
      for (const block of recentBlocks) {
        if (block.payload?.address) {
          if (!this._isSelf(block.payload.address)) {
            console.log('[Discovery] Recovered peer from registry history:', block.payload.address);
            this.p2pNode.addPeer(block.payload.address);
          }
        }
      }
    } catch (err) {
      console.error('[Discovery] Registry scan failed:', err.message);
    }
  }

  _isSelf(address) {
    const config = loadConfig();
    const interfaces = os.networkInterfaces();
    const localIPs = [];
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          localIPs.push(iface.address);
        }
      }
    }
    if (address.includes('AUTO')) return true; // Treat AUTO as self to avoid failed connections
    return localIPs.some(ip => address.includes(ip) && address.includes(config.p2pPort.toString()));
  }
}

