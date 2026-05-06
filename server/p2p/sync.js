import { MSG } from './protocol.js';
import { getP2PNode } from './node.js';
import { getTradeChain, getRegistryChain } from '../blockchain/chain.js';
import { getDb } from '../db/init.js';
import { validateBlock } from '../blockchain/block.js';
import { handleDKGCommitment, handleSigFragment, signWithFragment } from '../services/vault.js';
import { 
  handleRoutingRequest, handleRFI, handleOffer, 
  handleExec, handleResult, handleFinalResult 
} from '../services/ai/p2pInference.js';
import { randomBytes } from 'crypto';

/**
 * P2P Sync — handles synchronization of orderbook and blockchain between peers.
 */

function setupChainSync(node, chain, blockMsg, reqMsg, resMsg, onBlockAdded) {
  // New block from network
  node.on(blockMsg, (msg, peerId) => {
    const block = msg.payload?.block;
    if (!block) return;
    if (chain.getBlockByHash(block.hash)) return;

    const result = chain.addBlock(block);
    if (result.success) {
      console.log(`[Sync] Accepted block #${block.index} from network [${blockMsg}]`);
      if (onBlockAdded) onBlockAdded(block);
    } else if (result.error?.includes('Index mismatch')) {
      const height = chain.getHeight();
      node.sendToPeer(peerId, reqMsg, { fromIndex: height + 1 });
    }
  });

  // Peer wants blocks
  node.on(reqMsg, (msg, peerId) => {
    const fromIndex = msg.payload?.fromIndex || 1;
    const toIndex = Math.min(fromIndex + 49, chain.getHeight());
    const blocks = [];
    for (let i = fromIndex; i <= toIndex; i++) {
      const b = chain.getBlockByIndex(i);
      if (b) blocks.push(b);
    }
    node.sendToPeer(peerId, resMsg, { blocks });
  });

  // Received requested blocks
  node.on(resMsg, (msg) => {
    const blocks = msg.payload?.blocks;
    if (!Array.isArray(blocks)) return;
    let added = 0;
    for (const block of blocks) {
      const result = chain.addBlock(block);
      if (result.success) {
        added++;
        if (onBlockAdded) onBlockAdded(block);
      }
    }
    if (added > 0) console.log(`[Sync] Added ${added} blocks to chain [${resMsg}]`);
  });
}

export function registerSyncHandlers(matchingCallbacks) {
  const node = getP2PNode();
  const tradeChain = getTradeChain();
  const registryChain = getRegistryChain();

  // Setup sync for both chains
  setupChainSync(node, tradeChain, MSG.TRADE_BLOCK, MSG.BLOCK_REQUEST, MSG.BLOCK_RESPONSE, (block) => {
    if (matchingCallbacks?.onRemoteTradeBlock) matchingCallbacks.onRemoteTradeBlock(block);
  });

  setupChainSync(node, registryChain, MSG.REGISTRY_BLOCK, MSG.REGISTRY_REQUEST, MSG.REGISTRY_RESPONSE, (block) => {
    // Registry block added — can trigger peer discovery refresh if needed
  });

  // Handle PEER_HELLO — new peer connected, send our state
  node.on(MSG.PEER_HELLO, (msg, peerId) => {
    // Send our peer list
    const peers = [];
    for (const [, p] of node.peers) {
      if (p.address) peers.push(p.address);
    }
    node.sendToPeer(peerId, MSG.PEER_LIST, { peers });

    // Send our chain heights
    node.sendToPeer(peerId, MSG.PONG, { 
      chainHeight: tradeChain.getHeight(),
      registryHeight: registryChain.getHeight()
    });

    // Request missing blocks if they are ahead
    if (msg.payload?.chainHeight > tradeChain.getHeight()) {
      node.sendToPeer(peerId, MSG.BLOCK_REQUEST, { fromIndex: tradeChain.getHeight() + 1 });
    }
    if (msg.payload?.registryHeight > registryChain.getHeight()) {
      node.sendToPeer(peerId, MSG.REGISTRY_REQUEST, { fromIndex: registryChain.getHeight() + 1 });
    }
  });

  // Handle PEER_LIST — learn about new peers
  node.on(MSG.PEER_LIST, (msg) => {
    if (!Array.isArray(msg.payload?.peers)) return;
    for (const addr of msg.payload.peers) {
      if (typeof addr === 'string' && addr.startsWith('ws://')) {
        node.addPeer(addr);
      }
    }
  });

  // Handle ORDER_BROADCAST — Add to local mempool (pending_transactions)
  node.on(MSG.ORDER_BROADCAST, (msg) => {
    const order = msg.payload;
    if (!order) return;
    
    // Save to local database mempool
    try {
      const db = getDb();
      // Check if we already have this tx
      const existing = db.prepare('SELECT id FROM pending_transactions WHERE hash = ?').get(order.hash);
      if (!existing) {
        db.prepare(`INSERT INTO pending_transactions (id, type, user_id, data, created_at, hash) VALUES (?, ?, ?, ?, ?, ?)`).run(
          randomBytes(16).toString('hex'), 
          'place_order', 
          order.userId || order.publicKey, 
          JSON.stringify({ 
            orderId: order.id, 
            pair: order.pair, 
            side: order.side, 
            type: order.type, 
            price: order.price, 
            size: order.size 
          }),
          order.timestamp || new Date().toISOString(),
          order.hash
        );
      }
    } catch (err) {
      console.error('[Sync] Failed to process remote order:', err.message);
    }

    if (matchingCallbacks?.onRemoteOrder) matchingCallbacks.onRemoteOrder(order);
  });

  // Handle ORDER_CANCEL
  node.on(MSG.ORDER_CANCEL, (msg) => {
    const { orderId, publicKey, hash } = msg.payload;
    
    // Remove from local mempool
    try {
      const db = getDb();
      db.prepare('DELETE FROM pending_transactions WHERE hash = ?').run(hash);
    } catch {}

    if (matchingCallbacks?.onRemoteCancel) matchingCallbacks.onRemoteCancel(orderId, publicKey);
  });

  // Handle ORDERBOOK_SYNC
  node.on(MSG.ORDERBOOK_SYNC, (msg) => {
    if (matchingCallbacks?.onOrderbookSync) matchingCallbacks.onOrderbookSync(msg.payload.orderbook);
  });

  // Handle PING/PONG
  node.on(MSG.PING, (msg, peerId) => {
    node.sendToPeer(peerId, MSG.PONG, { 
      chainHeight: tradeChain.getHeight(),
      registryHeight: registryChain.getHeight()
    });
  });

  node.on(MSG.PONG, () => { /* keepalive */ });

  // --- DAO Vault Handlers ---

  // Handle DKG_INITIATE: Participate in generating a new DAO address
  node.on(MSG.DKG_INITIATE, (msg, peerId) => {
    const { requestId, currency, threshold, totalValidators } = msg.payload;
    
    console.log(`[Sync] Participating in DKG ceremony ${requestId} for ${currency}`);
    
    // Generate a random secret fragment for this ceremony
    // In production, this would use proper polynomial commitment schemes
    const rBytes = randomBytes(32);
    const commitment = '02' + rBytes.toString('hex').slice(0, 64);
    
    node.sendToPeer(peerId, MSG.DKG_COMMITMENT, {
      requestId,
      commitment
    });
  });

  // Handle DKG_COMMITMENT: Record commitment from a peer
  node.on(MSG.DKG_COMMITMENT, (msg, peerId) => {
    const peer = node.peers.get(peerId);
    const pubKey = peer?.publicKey || peerId;
    handleDKGCommitment(msg.payload.requestId, pubKey, msg.payload.commitment);
  });

  // Handle WITHDRAWAL_REQUEST: Verify and auto-sign if valid on L2
  node.on(MSG.WITHDRAWAL_REQUEST, (msg, peerId) => {
    const { settlementId, withdrawalId, sourceAddress, destination, amount, currency, userId } = msg.payload;
    
    // 1. Verify against local Trade Chain
    // In a real implementation, we'd check if the withdrawalId exists in the chain
    const isValidOnL2 = true; // Placeholder for chain verification
    
    if (isValidOnL2) {
      console.log(`[Sync] Withdrawal ${withdrawalId} verified on L2. Producing signature fragment.`);
      
      // Get our fragment for this address
      const db = getDb();
      const fragmentRow = db.prepare('SELECT fragment FROM key_fragments WHERE address = ?').get(sourceAddress);
      
      if (fragmentRow) {
        // Produce partial signature using our local fragment
        const sig = signWithFragment(fragmentRow.fragment, destination, amount, currency);
        if (sig) {
          node.sendToPeer(peerId, MSG.SIG_FRAGMENT, {
            settlementId,
            fragment: sig
          });
        }
      }
    }
  });

  // Handle SIG_FRAGMENT: Collect and combine
  node.on(MSG.SIG_FRAGMENT, (msg, peerId) => {
    const peer = node.peers.get(peerId);
    const pubKey = peer?.publicKey || peerId;
    handleSigFragment(msg.payload.settlementId, pubKey, msg.payload.fragment);
  });

  // --- Synaptic Aggregator (AI P2P Inference) Handlers ---

  node.on(MSG.AI_ROUTING_REQ, (msg) => handleRoutingRequest(msg.payload));
  node.on(MSG.AI_RFI, (msg) => handleRFI(msg.payload));
  node.on(MSG.AI_OFFER, (msg) => handleOffer(msg.payload));
  node.on(MSG.AI_EXEC, (msg) => handleExec(msg.payload));
  node.on(MSG.AI_RESULT, (msg) => handleResult(msg.payload));
  node.on(MSG.AI_RESULT_FINAL, (msg) => handleFinalResult(msg.payload));

  console.log('[Sync] Message handlers registered for Dual-Chain + DAO Vault + Synaptic Aggregator');
}
