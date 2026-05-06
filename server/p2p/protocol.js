import { verifySignature } from '../crypto/identity.js';

/**
 * P2P Message Protocol
 * All messages are JSON with a type field and unique msgId for deduplication.
 */

export const MSG = {
  PEER_HELLO:      'PEER_HELLO',
  PEER_LIST:       'PEER_LIST',
  ORDER_BROADCAST: 'ORDER_BROADCAST',
  ORDER_CANCEL:    'ORDER_CANCEL',
  TRADE_BLOCK:     'TRADE_BLOCK',
  REGISTRY_BLOCK:  'REGISTRY_BLOCK',
  BLOCK_REQUEST:   'BLOCK_REQUEST',
  BLOCK_RESPONSE:  'BLOCK_RESPONSE',
  REGISTRY_REQUEST:  'REGISTRY_REQUEST',
  REGISTRY_RESPONSE: 'REGISTRY_RESPONSE',
  ORDERBOOK_SYNC:  'ORDERBOOK_SYNC',
  PING:            'PING',
  PONG:            'PONG',
  PEER_ANNOUNCE:   'PEER_ANNOUNCE',
  // DAO Vault — Distributed Key Generation
  DKG_INITIATE:    'DKG_INITIATE',
  DKG_COMMITMENT:  'DKG_COMMITMENT',
  // DAO Vault — Threshold Withdrawal Settlement
  WITHDRAWAL_REQUEST: 'WITHDRAWAL_REQUEST',
  SIG_FRAGMENT:    'SIG_FRAGMENT',
  SETTLEMENT_COMPLETE: 'SETTLEMENT_COMPLETE',
  // Synaptic Aggregator - AI P2P Inference
  AI_ROUTING_REQ:  'AI_ROUTING_REQ',
  AI_RFI:          'AI_RFI',
  AI_OFFER:        'AI_OFFER',
  AI_EXEC:         'AI_EXEC',
  AI_RESULT:       'AI_RESULT',
  AI_RESULT_FINAL: 'AI_RESULT_FINAL'
};

let _msgCounter = 0;

/**
 * Create a new protocol message.
 */
export function createMessage(type, payload) {
  return JSON.stringify({
    type,
    msgId: `${Date.now()}-${++_msgCounter}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    payload
  });
}

/**
 * Parse a raw message string.
 */
export function parseMessage(raw) {
  try {
    const msg = JSON.parse(raw);
    if (!msg.type || !msg.msgId) return null;
    return msg;
  } catch { return null; }
}

/**
 * Validate message structure based on type.
 */
export function validateMessage(msg) {
  if (!msg || !msg.type || !msg.msgId) return false;
  switch (msg.type) {
    case MSG.PEER_HELLO:
      return !!msg.payload?.publicKey;
    case MSG.PEER_LIST:
      return Array.isArray(msg.payload?.peers);
    case MSG.ORDER_BROADCAST:
      return !!msg.payload?.order;
    case MSG.ORDER_CANCEL:
      return !!msg.payload?.orderId;
    case MSG.TRADE_BLOCK:
    case MSG.REGISTRY_BLOCK:
      return !!msg.payload?.block;
    case MSG.BLOCK_REQUEST:
    case MSG.REGISTRY_REQUEST:
      return typeof msg.payload?.fromIndex === 'number';
    case MSG.BLOCK_RESPONSE:
    case MSG.REGISTRY_RESPONSE:
      return Array.isArray(msg.payload?.blocks);
    case MSG.ORDERBOOK_SYNC:
      return !!msg.payload?.orderbook;
    case MSG.PING:
    case MSG.PONG:
      return true;
    case MSG.PEER_ANNOUNCE:
      return !!msg.payload?.address;
    // DAO Vault messages
    case MSG.DKG_INITIATE:
      return !!msg.payload?.requestId && !!msg.payload?.currency;
    case MSG.DKG_COMMITMENT:
      return !!msg.payload?.requestId && !!msg.payload?.commitment;
    case MSG.WITHDRAWAL_REQUEST:
      return !!msg.payload?.settlementId && !!msg.payload?.destination;
    case MSG.SIG_FRAGMENT:
      return !!msg.payload?.settlementId && !!msg.payload?.fragment;
    case MSG.SETTLEMENT_COMPLETE:
      return !!msg.payload?.settlementId;
    // Synaptic Aggregator messages
    case MSG.AI_ROUTING_REQ:
      return !!msg.payload?.reqId && !!msg.payload?.query;
    case MSG.AI_RFI:
      return !!msg.payload?.reqId && !!msg.payload?.routerId;
    case MSG.AI_OFFER:
      return !!msg.payload?.reqId && !!msg.payload?.providerId;
    case MSG.AI_EXEC:
      return !!msg.payload?.reqId && !!msg.payload?.providerId && !!msg.payload?.query;
    case MSG.AI_RESULT:
      return !!msg.payload?.reqId && !!msg.payload?.providerId && !!msg.payload?.result;
    case MSG.AI_RESULT_FINAL:
      return !!msg.payload?.reqId && !!msg.payload?.result;
    default:
      return false;
  }
}

/**
 * Rate limiter per peer.
 */
export class RateLimiter {
  constructor(maxPerMinute = 120) {
    this._maxPerMinute = maxPerMinute;
    this._counts = new Map();
  }

  check(peerId) {
    const now = Date.now();
    const record = this._counts.get(peerId) || { count: 0, windowStart: now };
    if (now - record.windowStart > 60000) {
      record.count = 0;
      record.windowStart = now;
    }
    record.count++;
    this._counts.set(peerId, record);
    return record.count <= this._maxPerMinute;
  }

  clear() { this._counts.clear(); }
}
