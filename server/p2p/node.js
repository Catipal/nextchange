import { WebSocketServer, WebSocket } from 'ws';
import { MSG, createMessage, parseMessage, validateMessage, RateLimiter } from './protocol.js';
import { loadConfig, getAllPeers } from '../config.js';
import { DiscoveryService } from './discovery.js';
import { getRegistryChain, getTradeChain } from '../blockchain/chain.js';
import { createBlock } from '../blockchain/block.js';

/**
 * P2PNode — WebSocket mesh network node.
 * Each running app instance is a peer.
 */
export class P2PNode {
  constructor() {
    this.peers = new Map();         // peerId -> { ws, publicKey, address, connectedAt }
    this.seenMessages = new Set();  // Dedup msgIds (pruned periodically)
    this.wss = null;                // WebSocket server
    this.publicKey = null;
    this.rateLimiter = new RateLimiter(120);
    this._handlers = new Map();     // type -> handler fn
    this._reconnectTimers = new Map();
    this._pruneTimer = null;
    this.discovery = new DiscoveryService(this);
    this._started = false;
  }

  /**
   * Start the P2P node.
   * @param {string} publicKey - This node's public key
   */
  start(publicKey) {
    if (this._started) return;
    this.publicKey = publicKey;
    const config = loadConfig();

    this.discovery.start();

    // Start WebSocket server with port fallback
    const startWss = (port) => {
      return new Promise((resolve, reject) => {
        try {
          const wss = new WebSocketServer({ port, host: config.p2pHost });
          wss.on('listening', () => {
            console.log(`[P2P] Listening on ${config.p2pHost}:${port}`);
            resolve(wss);
          });
          wss.on('error', (err) => {
            reject(err);
          });
        } catch (err) {
          reject(err);
        }
      });
    };

    const tryStart = async () => {
      for (let offset = 0; offset < 5; offset++) {
        const port = config.p2pPort + offset;
        try {
          this.wss = await startWss(port);
          
          this.wss.on('connection', (ws, req) => {
            const addr = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
            console.log(`[P2P] Incoming connection from ${addr}`);
            this._setupPeer(ws, addr, 'inbound');
          });

          this.wss.on('error', (err) => {
            console.error('[P2P] Server error:', err.message);
          });

          return true;
        } catch (err) {
          if (err.code === 'EADDRINUSE') {
            console.log(`[P2P] Port ${port} in use, trying next...`);
            continue;
          }
          console.error(`[P2P] Failed to start on port ${port}:`, err.message);
          return false;
        }
      }
      console.warn('[P2P] Could not find an available port. P2P disabled.');
      return false;
    };

    tryStart().then(success => {
      if (success) {
        // Connect to bootstrap + custom peers
        const peers = getAllPeers();
        for (const addr of peers) {
          this._connectToPeer(addr);
        }
        this._started = true;
      }
    });

    // Prune seen messages every 5 minutes
    this._pruneTimer = setInterval(() => {
      if (this.seenMessages.size > 10000) {
        this.seenMessages.clear();
      }
    }, 300000);

    this._started = true;
  }

  /**
   * Stop the P2P node.
   */
  stop() {
    if (!this._started) return;
    for (const [, timer] of this._reconnectTimers) clearTimeout(timer);
    this._reconnectTimers.clear();
    if (this._pruneTimer) clearInterval(this._pruneTimer);
    for (const [, peer] of this.peers) {
      try { peer.ws.close(); } catch {}
    }
    this.peers.clear();
    if (this.wss) this.wss.close();
    this._started = false;
    console.log('[P2P] Node stopped');
  }

  /**
   * Register a handler for a message type.
   */
  on(messageType, handler) {
    this._handlers.set(messageType, handler);
  }

  /**
   * Broadcast a message to all connected peers.
   */
  broadcast(type, payload, excludePeerId = null) {
    const raw = createMessage(type, payload);
    const msg = JSON.parse(raw);
    this.seenMessages.add(msg.msgId);

    for (const [peerId, peer] of this.peers) {
      if (peerId === excludePeerId) continue;
      if (peer.ws.readyState === WebSocket.OPEN) {
        try { peer.ws.send(raw); } catch {}
      }
    }
  }

  /**
   * Send a message to a specific peer.
   */
  sendToPeer(peerId, type, payload) {
    const peer = this.peers.get(peerId);
    if (!peer || peer.ws.readyState !== WebSocket.OPEN) return false;
    try {
      peer.ws.send(createMessage(type, payload));
      return true;
    } catch { return false; }
  }

  /**
   * Connect to a peer by address.
   */
  _connectToPeer(address) {
    const normalized = address.replace('ws://', '').split(':')[0]; // Get just the IP
    
    // Don't connect to self or existing peers
    for (const [, peer] of this.peers) {
      const peerIp = peer.address.replace('ws://', '').split(':')[0].replace('[::ffff:', '').replace(']', '');
      if (peerIp === normalized) return;
    }

    try {
      const ws = new WebSocket(address);
      ws.on('open', () => {
        console.log(`[P2P] Outbound connection to ${address}`);
        this._setupPeer(ws, address, 'outbound');
      });
      ws.on('error', () => {
        this._scheduleReconnect(address);
      });
    } catch {
      this._scheduleReconnect(address);
    }
  }

  /**
   * Set up event handlers for a peer connection.
   */
  _setupPeer(ws, address, direction) {
    const peerId = `${address}-${Date.now()}`;
    const peerInfo = { ws, publicKey: null, address, connectedAt: Date.now(), direction };
    this.peers.set(peerId, peerInfo);

    // Send hello immediately
    const config = loadConfig();
    try {
      ws.send(createMessage(MSG.PEER_HELLO, {
        publicKey: this.publicKey,
        tradeHeight: getTradeChain().getHeight(),
        registryHeight: getRegistryChain().getHeight(),
        listenPort: config.p2pPort
      }));
    } catch {}

    ws.on('message', (data) => {
      try {
        const raw = data.toString();
        const msg = parseMessage(raw);
        if (!msg || !validateMessage(msg)) return;

        // Dedup global broadcast messages
        if ([MSG.ORDER_BROADCAST, MSG.TRADE_BLOCK].includes(msg.type)) {
          if (this.seenMessages.has(msg.msgId)) return;
          this.seenMessages.add(msg.msgId);
        }

        // Rate limit
        if (!this.rateLimiter.check(peerId)) return;

        // Handle HELLO specially
        if (msg.type === MSG.PEER_HELLO && msg.payload?.publicKey) {
          const peer = this.peers.get(peerId);
          if (peer) {
            peer.publicKey = msg.payload.publicKey;
            peer.tradeHeight = msg.payload.tradeHeight || 0;
            peer.registryHeight = msg.payload.registryHeight || 0;
            console.log(`[P2P] Handshake complete with ${address} (${msg.payload.publicKey.slice(0, 8)})`);
          }
        }

        // Dispatch to registered handler
        const handler = this._handlers.get(msg.type);
        if (handler) handler(msg, peerId);

        // Gossip
        if ([MSG.ORDER_BROADCAST, MSG.ORDER_CANCEL, MSG.TRADE_BLOCK, MSG.REGISTRY_BLOCK].includes(msg.type)) {
          for (const [otherId, otherPeer] of this.peers) {
            if (otherId === peerId) continue;
            if (otherPeer.ws.readyState === WebSocket.OPEN) {
              try { otherPeer.ws.send(raw); } catch {}
            }
          }
        }
      } catch (err) {
        console.error('[P2P] Message error:', err.message);
      }
    });

    ws.on('close', () => {
      this.peers.delete(peerId);
      console.log(`[P2P] Peer disconnected: ${address}`);
      if (direction === 'outbound') this._scheduleReconnect(address);
    });

    ws.on('error', (err) => {
      console.error(`[P2P] Peer ${address} error:`, err.message);
    });

    // Ping/pong keepalive
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(createMessage(MSG.PING, {})); } catch {}
      } else {
        clearInterval(pingInterval);
      }
    }, 25000);
  }

  _scheduleReconnect(address) {
    if (this._reconnectTimers.has(address)) return;
    const timer = setTimeout(() => {
      this._reconnectTimers.delete(address);
      this._connectToPeer(address);
    }, 10000 + Math.random() * 5000);
    this._reconnectTimers.set(address, timer);
  }

  /**
   * Get connection stats.
   */
  getStats() {
    const connected = [];
    for (const [id, peer] of this.peers) {
      connected.push({
        id, address: peer.address,
        publicKey: peer.publicKey,
        direction: peer.direction,
        connectedAt: peer.connectedAt
      });
    }
    return { peerCount: this.peers.size, connected, listening: this._started };
  }

  /**
   * Manually add and connect to a peer.
   */
  addPeer(address) {
    this._connectToPeer(address);
  }

  /**
   * Announce this node on the BPS blockchain.
   * Creates a zero-fee infrastructure block.
   */
  announceOnChain() {
    try {
      const config = loadConfig();
      if (!config.nodePublicKey || !config.nodePrivateKey) return;

      const chain = getRegistryChain();
      const latest = chain.getLatestBlock();
      
      const payload = {
        address: `ws://${config.p2pHost === '0.0.0.0' ? 'AUTO' : config.p2pHost}:${config.p2pPort}`,
        publicKey: this.publicKey,
        timestamp: Date.now()
      };

      const block = createBlock(
        latest.index + 1, 
        latest.hash, 
        payload,
        config.nodePrivateKey, 
        config.nodePublicKey,
        'announcement'
      );

      const result = chain.addBlock(block);
      if (result.success) {
        this.broadcast(MSG.REGISTRY_BLOCK, { block });
        console.log('[P2P] Published on-chain registry announcement');
      }
    } catch (err) {
      console.error('[P2P] Registry announcement failed:', err.message);
    }
  }
}

// Singleton
let _node = null;
export function getP2PNode() {
  if (!_node) _node = new P2PNode();
  return _node;
}
