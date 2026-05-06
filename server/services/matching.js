import { getDb } from '../db/init.js';
import { generateId, satoshiRound } from '../utils/helpers.js';
import { createBlock, calculateTxHash } from '../blockchain/block.js';
import { getTradeChain } from '../blockchain/chain.js';
import { getP2PNode } from '../p2p/node.js';
import { MSG } from '../p2p/protocol.js';
import { loadConfig } from '../config.js';

// ─── Trade Block Creation ───
// After each trade match, create a signed block and broadcast it to peers.
function createTradeBlock(tradeData) {
  try {
    const config = loadConfig();
    if (!config.nodePublicKey || !config.nodePrivateKey) return null;
    const chain = getTradeChain();
    const latest = chain.getLatestBlock();
    const nextIndex = latest.index + 1;
    const db = getDb();
    
    // 1. Fetch pending transactions
    const pendingTxs = db.prepare('SELECT * FROM pending_transactions ORDER BY created_at ASC').all();
    
    // 2. Fetch and process matured rewards (>= 100 blocks old)
    const maturedRewards = db.prepare('SELECT * FROM locked_rewards WHERE status = "locked" AND mature_at_block <= ?').all(nextIndex);
    const processedRewards = [];
    
    for (const reward of maturedRewards) {
      db.prepare('UPDATE locked_rewards SET status = "matured" WHERE id = ?').run(reward.id);
      
      try {
        // Credit the base to the user
        updateBalance(db, reward.user_id, reward.currency, reward.amount, 0);

        // Consolidate or create order
        const existingReward = db.prepare(
          `SELECT id, size FROM orders 
           WHERE user_id = ? AND pair = ? AND side = 'sell' 
             AND ROUND(price, 8) = ROUND(?, 8)
             AND is_reward = 1 AND status IN ('open', 'partial')
           LIMIT 1`
        ).get(reward.user_id, reward.pair, reward.price);

        if (existingReward) {
          const newSize = existingReward.size + reward.amount;
          db.prepare('UPDATE orders SET size = ? WHERE id = ?').run(newSize, existingReward.id);
          updateBalance(db, reward.user_id, reward.currency, -reward.amount, reward.amount);
        } else {
          const rewardOrderId = generateId();
          db.prepare(
            `INSERT INTO orders (id, user_id, pair, side, type, price, size, filled, status, is_reward) VALUES (?, ?, ?, 'sell', 'limit', ?, ?, 0, 'open', 1)`
          ).run(rewardOrderId, reward.user_id, reward.pair, reward.price, reward.amount);
          updateBalance(db, reward.user_id, reward.currency, -reward.amount, reward.amount);
        }
        
        processedRewards.push(reward);
      } catch (err) {
        console.error('[Matching] Failed to process matured reward:', err.message);
      }
    }
    
    // 3. Attach to payload
    tradeData.transactions = pendingTxs;
    tradeData.maturedRewards = processedRewards;

    const block = createBlock(
      nextIndex, latest.hash, tradeData,
      config.nodePrivateKey, config.nodePublicKey
    );
    const result = chain.addBlock(block);
    if (result.success) {
      // Clear pending transactions
      db.prepare('DELETE FROM pending_transactions').run();
      
      // Link the block hash back to the local trade record
      if (tradeData && tradeData.id) {
        try {
          const db = getDb();
          db.prepare('UPDATE trades SET block_hash = ? WHERE id = ?').run(block.hash, tradeData.id);
        } catch (e) {
          console.error('[Matching] Failed to link block hash:', e.message);
        }
      }

      // Broadcast to P2P network
      try {
        const p2p = getP2PNode();
        p2p.broadcast(MSG.TRADE_BLOCK, { block });
      } catch { }
      return block;
    }
  } catch (err) {
    console.error('[Matching] Block creation error:', err.message);
  }
  return null;
}

/**
 * Price-Time Priority Matching Engine
 * 
 * For market pairs (e.g., BTC/BPS or ETH/BPS):
 * - BUY orders: buying base (BTC/ETH), paying quote (BPS). Bids sorted by price DESC.
 * - SELL orders: selling base, receiving quote. Asks sorted by price ASC.
 * - Price is always in quote per base.
 * 
 * Dynamic impact fee:
 *   impactRatio = orderSize / availableDepth
 *   totalFee = impactRatio (capped at 100%)
 *   Split 50/50: taker pays half, maker pays half
 *   Both halves go to the exchange vault
 */

export function placeOrder(userId, pair, { side, type, price, size }) {
  const db = getDb();
  const [baseCurrency, quoteCurrency] = pair.toLowerCase().split('/');

  // Validate balances
  const balances = db.prepare('SELECT * FROM balances WHERE user_id = ? AND currency = ?');

  if (side === 'buy') {
    // Buying base with quote — need quote balance
    if (type === 'limit') {
      const quoteBalance = balances.get(userId, quoteCurrency);
      const cost = price * size;
      if (!quoteBalance || quoteBalance.available < cost) {
        throw new Error(`Insufficient ${quoteCurrency.toUpperCase()} balance`);
      }
    }
  } else {
    // Selling base for quote — need base balance
    const baseBalance = balances.get(userId, baseCurrency);
    if (!baseBalance || baseBalance.available < size) {
      throw new Error(`Insufficient ${baseCurrency.toUpperCase()} balance`);
    }
  }

  const orderId = generateId();

  // For market orders, we match immediately
  let result;
  if (type === 'market') {
    result = executeMarketOrder(db, orderId, userId, pair, side, size, true); // skipBlock = true
  } else {
    // For limit orders, lock funds and check for crosses
    result = executeLimitOrder(db, orderId, userId, pair, side, price, size, true); // skipBlock = true
  }

  // Record pending transaction with cryptographic hash
  const createdAt = new Date().toISOString();
  const txData = {
    type: 'place_order',
    user_id: userId,
    data: JSON.stringify({ orderId, pair, side, type, price, size }),
    created_at: createdAt
  };
  const txHash = calculateTxHash(txData);
  
  db.prepare(`INSERT INTO pending_transactions (id, type, user_id, data, created_at, hash) VALUES (?, ?, ?, ?, ?, ?)`).run(
    generateId(), txData.type, txData.user_id, txData.data, txData.created_at, txHash
  );

  // Broadcast the pending transaction to the network (Mempool Sync)
  try {
    const p2p = getP2PNode();
    p2p.broadcast(MSG.ORDER_BROADCAST, { 
      id: orderId, hash: txHash, pair, side, type, price, size, userId, publicKey: userId, timestamp: createdAt 
    });
  } catch (err) {
    console.warn('[Matching] Failed to broadcast pending transaction:', err.message);
  }

  // --- Process DAO Vault fees: dynamic buyback/reward split + 50% strategic bids ---
  let vaultResult = { buybackTrades: [], strategicTrades: [], rewards: [] };
  if (userId !== 'EXCHANGE_DAO_VAULT') {
    try {
      // Pass the same fee % used for this trade so buyback scales with market impact
      const feePct = result.totalFeePct || 0.0002;
      vaultResult = processVaultFees(db, pair, feePct);
    } catch (err) {
      // Ignore if vault processing fails (e.g. no liquidity)
    }
  }

  // Bundle all trades and rewards into a single block
  const allTrades = [...result.trades, ...(vaultResult.buybackTrades || []), ...(vaultResult.strategicTrades || [])];
  
  if (allTrades.length > 0 || (vaultResult.rewards && vaultResult.rewards.length > 0)) {
    const primaryTrade = allTrades.length > 0 ? allTrades[0] : null;
    createTradeBlock({
      id: primaryTrade ? primaryTrade.id : generateId(),
      pair,
      buyerPubKey: primaryTrade ? (primaryTrade.side === 'buy' ? userId : 'resting') : 'vault',
      sellerPubKey: primaryTrade ? (primaryTrade.side === 'sell' ? userId : 'resting') : 'vault',
      price: primaryTrade ? primaryTrade.price : 0,
      size: primaryTrade ? primaryTrade.size : 0,
      buyerFee: primaryTrade ? primaryTrade.fee : 0,
      sellerFee: 0,
      additionalTrades: allTrades.slice(1).map(t => ({
        id: t.id, price: t.price, size: t.size, fee: t.fee, side: t.side
      })),
      rewards: vaultResult.rewards || []
    });
  }

  return result;
}

function executeMarketOrder(db, orderId, userId, pair, side, size, skipBlock = false) {
  const [baseCurrency, quoteCurrency] = pair.toLowerCase().split('/');
  const trades = [];

  const txn = db.transaction(() => {
    // Get opposing side of orderbook
    let opposingOrders;
    if (side === 'buy') {
      // Buy: match against asks (lowest price first)
      opposingOrders = db.prepare(
        `SELECT * FROM orders WHERE pair = ? AND side = 'sell' AND status IN ('open', 'partial') ORDER BY price ASC, created_at ASC`
      ).all(pair);
    } else {
      // Sell: match against bids (highest price first)
      opposingOrders = db.prepare(
        `SELECT * FROM orders WHERE pair = ? AND side = 'buy' AND status IN ('open', 'partial') ORDER BY price DESC, created_at ASC`
      ).all(pair);
    }

    if (opposingOrders.length === 0) {
      throw new Error('No liquidity available');
    }

    // Calculate available depth
    const totalDepth = opposingOrders.reduce((sum, o) => sum + (o.size - o.filled), 0);

    // Calculate impact fee
    const impactRatio = Math.min(size / totalDepth, 1.0);
    // Add a DAO fee of 0.02% if the dynamic fee is otherwise 0.00%
    const totalFeePct = Math.max(impactRatio, 0.0002);
    const halfFeePct = totalFeePct / 2;

    // Insert the market order
    db.prepare(
      `INSERT INTO orders (id, user_id, pair, side, type, price, size, filled, status) VALUES (?, ?, ?, ?, 'market', NULL, ?, 0, 'open')`
    ).run(orderId, userId, pair, side, size);

    let remaining = Math.min(size, totalDepth);
    let totalFilled = 0;

    for (const opposing of opposingOrders) {
      if (remaining <= 0) break;

      const availableSize = opposing.size - opposing.filled;
      const fillSize = Math.min(remaining, availableSize);
      const fillPrice = opposing.price;

      // Calculate fees for this fill
      const baseCost = fillSize * fillPrice;
      const buyerFeeBTC = satoshiRound(fillSize * halfFeePct);
      const sellerFeeBPS = satoshiRound(baseCost * halfFeePct);

      // Create trade record
      const tradeId = generateId();
      const buyOrderId = side === 'buy' ? orderId : opposing.id;
      const sellOrderId = side === 'sell' ? orderId : opposing.id;
      const buyerId = side === 'buy' ? userId : opposing.user_id;
      const sellerId = side === 'sell' ? userId : opposing.user_id;

      db.prepare(
        `INSERT INTO trades (id, buy_order_id, sell_order_id, buyer_id, seller_id, price, size, buyer_fee, seller_fee, pair)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(tradeId, buyOrderId, sellOrderId, buyerId, sellerId, fillPrice, fillSize, buyerFeeBTC, sellerFeeBPS, pair);

      // Update opposing order fill
      const newFilled = opposing.filled + fillSize;
      const newStatus = newFilled >= opposing.size ? 'filled' : 'partial';
      db.prepare('UPDATE orders SET filled = ?, status = ? WHERE id = ?')
        .run(newFilled, newStatus, opposing.id);

      // Update balances
      // Buyer pays quote, receives base (minus fee)
      updateBalance(db, buyerId, quoteCurrency, side === 'buy' ? -baseCost : 0, side === 'buy' ? 0 : -baseCost);
      updateBalance(db, buyerId, baseCurrency, fillSize - buyerFeeBTC, 0);

      // Seller provides base, receives quote (minus fee)
      updateBalance(db, sellerId, baseCurrency, side === 'sell' ? -fillSize : 0, side === 'sell' ? 0 : -fillSize);
      updateBalance(db, sellerId, quoteCurrency, baseCost - sellerFeeBPS, 0);

      // Deposit fees to Vault
      if (buyerFeeBTC > 0) updateBalance(db, 'EXCHANGE_DAO_VAULT', baseCurrency, buyerFeeBTC, 0);
      if (sellerFeeBPS > 0) {
        // Dynamic Separation: Game Fund gets a portion of the incoming fee based on the impact percentage.
        // Higher impact trades = larger Game Fund allocation. Normal trades = primarily AI Pot.
        const gameFundSplit = satoshiRound(sellerFeeBPS * Math.min(totalFeePct, 1.0));
        const aiPotSplit = satoshiRound(sellerFeeBPS - gameFundSplit);
        if (gameFundSplit > 0) {
          db.prepare(`INSERT OR IGNORE INTO balances (user_id, currency, available, locked) VALUES (?, 'bps', 0, 0)`).run('GAME_FUND_VAULT');
          db.prepare(`UPDATE balances SET available = available + ? WHERE user_id = ? AND currency = 'bps'`).run(gameFundSplit, 'GAME_FUND_VAULT');
        }
        if (aiPotSplit > 0) updateBalance(db, 'EXCHANGE_DAO_VAULT', quoteCurrency, aiPotSplit, 0);
      }

      trades.push({
        id: tradeId,
        price: fillPrice,
        size: fillSize,
        fee: side === 'buy' ? buyerFeeBTC : sellerFeeBPS,
        baseFee: buyerFeeBTC, // always the base-currency fee, used for dynamic buyback
        side
      });

      remaining -= fillSize;
      totalFilled += fillSize;
    }

    // Update market order status
    const orderStatus = totalFilled >= size ? 'filled' : 'partial';
    db.prepare('UPDATE orders SET filled = ?, status = ? WHERE id = ?')
      .run(totalFilled, orderStatus, orderId);

    return { orderId, filled: totalFilled, trades, impactRatio, totalFeePct };
  });

  const result = txn();

  // Create trade blocks (outside transaction)
  if (!skipBlock) {
    for (const trade of result.trades) {
      createTradeBlock({
        id: trade.id, pair,
        buyerPubKey: side === 'buy' ? userId : 'resting',
        sellerPubKey: side === 'sell' ? userId : 'resting',
        price: trade.price, size: trade.size,
        buyerFee: trade.fee, sellerFee: 0
      });
    }
  }

  return result;
}

function executeLimitOrder(db, orderId, userId, pair, side, price, size, skipBlock = false) {
  const [baseCurrency, quoteCurrency] = pair.toLowerCase().split('/');
  const trades = [];

  const txn = db.transaction(() => {
    // Check for crossing orders first
    let crossingOrders;
    if (side === 'buy') {
      // A buy limit at price X crosses against asks at price <= X
      crossingOrders = db.prepare(
        `SELECT * FROM orders WHERE pair = ? AND side = 'sell' AND status IN ('open', 'partial') AND price <= ? ORDER BY price ASC, created_at ASC`
      ).all(pair, price);
    } else {
      // A sell limit at price X crosses against bids at price >= X
      crossingOrders = db.prepare(
        `SELECT * FROM orders WHERE pair = ? AND side = 'buy' AND status IN ('open', 'partial') AND price >= ? ORDER BY price DESC, created_at ASC`
      ).all(pair, price);
    }

    // Lock funds
    if (side === 'buy') {
      // Lock quote for the bid
      const cost = price * size;
      updateBalance(db, userId, quoteCurrency, -cost, cost);
    } else {
      // Lock base for the ask
      updateBalance(db, userId, baseCurrency, -size, size);
    }

    // Insert the order
    db.prepare(
      `INSERT INTO orders (id, user_id, pair, side, type, price, size, filled, status) VALUES (?, ?, ?, ?, 'limit', ?, ?, 0, 'open')`
    ).run(orderId, userId, pair, side, price, size);

    let remaining = size;
    let totalFilled = 0;

    // Calculate full opposing depth for dynamic impact fee
    let completeOpposingOrders;
    if (side === 'buy') {
      completeOpposingOrders = db.prepare(
        `SELECT * FROM orders WHERE pair = ? AND side = 'sell' AND status IN ('open', 'partial')`
      ).all(pair);
    } else {
      completeOpposingOrders = db.prepare(
        `SELECT * FROM orders WHERE pair = ? AND side = 'buy' AND status IN ('open', 'partial')`
      ).all(pair);
    }
    const fullDepth = completeOpposingOrders.reduce((sum, o) => sum + (o.size - o.filled), 0);

    // Calculate impact fee based on full depth, not just crossing depth
    const impactRatio = fullDepth > 0 ? Math.min(size / fullDepth, 1.0) : 1.0;
    const totalFeePct = Math.max(impactRatio, 0.0002);
    const halfFeePct = totalFeePct / 2;

    // Match against crossing orders
    for (const opposing of crossingOrders) {
      if (remaining <= 0) break;

      const availableSize = opposing.size - opposing.filled;
      const fillSize = Math.min(remaining, availableSize);
      const fillPrice = opposing.price; // Execute at the resting order's price

      const baseCost = fillSize * fillPrice;
      const buyerFeeBTC = satoshiRound(fillSize * halfFeePct);
      const sellerFeeBPS = satoshiRound(baseCost * halfFeePct);

      const tradeId = generateId();
      const buyOrderId = side === 'buy' ? orderId : opposing.id;
      const sellOrderId = side === 'sell' ? orderId : opposing.id;
      const buyerId = side === 'buy' ? userId : opposing.user_id;
      const sellerId = side === 'sell' ? userId : opposing.user_id;

      db.prepare(
        `INSERT INTO trades (id, buy_order_id, sell_order_id, buyer_id, seller_id, price, size, buyer_fee, seller_fee, pair)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(tradeId, buyOrderId, sellOrderId, buyerId, sellerId, fillPrice, fillSize, buyerFeeBTC, sellerFeeBPS, pair);

      // Update opposing order
      const newFilled = opposing.filled + fillSize;
      const newStatus = newFilled >= opposing.size ? 'filled' : 'partial';
      db.prepare('UPDATE orders SET filled = ?, status = ? WHERE id = ?')
        .run(newFilled, newStatus, opposing.id);

      // Update balances
      // Buyer pays quote, receives base (minus fee)
      updateBalance(db, buyerId, quoteCurrency, side === 'buy' ? 0 : -baseCost, side === 'buy' ? -baseCost : 0);
      updateBalance(db, buyerId, baseCurrency, fillSize - buyerFeeBTC, 0);

      // Seller provides base, receives quote (minus fee)
      updateBalance(db, sellerId, baseCurrency, side === 'sell' ? 0 : -fillSize, side === 'sell' ? -fillSize : 0);
      updateBalance(db, sellerId, quoteCurrency, baseCost - sellerFeeBPS, 0);

      // Deposit fees to Vault
      if (buyerFeeBTC > 0) updateBalance(db, 'EXCHANGE_DAO_VAULT', baseCurrency, buyerFeeBTC, 0);
      if (sellerFeeBPS > 0) {
        const gameFundSplit = satoshiRound(sellerFeeBPS * Math.min(totalFeePct, 1.0));
        const aiPotSplit = satoshiRound(sellerFeeBPS - gameFundSplit);
        if (gameFundSplit > 0) {
          db.prepare(`INSERT OR IGNORE INTO balances (user_id, currency, available, locked) VALUES (?, 'bps', 0, 0)`).run('GAME_FUND_VAULT');
          db.prepare(`UPDATE balances SET available = available + ? WHERE user_id = ? AND currency = 'bps'`).run(gameFundSplit, 'GAME_FUND_VAULT');
        }
        if (aiPotSplit > 0) updateBalance(db, 'EXCHANGE_DAO_VAULT', quoteCurrency, aiPotSplit, 0);
      }

      trades.push({
        id: tradeId,
        price: fillPrice,
        size: fillSize,
        fee: side === 'buy' ? buyerFeeBTC : sellerFeeBPS,
        baseFee: buyerFeeBTC, // always the base-currency fee, used for dynamic buyback
        side
      });

      remaining -= fillSize;
      totalFilled += fillSize;
    }

    // Update our order status
    if (totalFilled >= size) {
      db.prepare('UPDATE orders SET filled = ?, status = ? WHERE id = ?')
        .run(totalFilled, 'filled', orderId);
      // Unlock any remaining locked funds
      if (side === 'buy') {
        const unlockedQuote = (size - totalFilled) * price;
        if (unlockedQuote > 0) updateBalance(db, userId, quoteCurrency, unlockedQuote, -unlockedQuote);
      } else {
        const unlockedBase = size - totalFilled;
        if (unlockedBase > 0) updateBalance(db, userId, baseCurrency, unlockedBase, -unlockedBase);
      }
    } else if (totalFilled > 0) {
      db.prepare('UPDATE orders SET filled = ?, status = ? WHERE id = ?')
        .run(totalFilled, 'partial', orderId);
    }

    return { orderId, filled: totalFilled, remaining: size - totalFilled, trades, totalFeePct, resting: size - totalFilled > 0 };
  });

  const result = txn();

  // Create trade blocks (outside transaction)
  if (!skipBlock) {
    for (const trade of result.trades) {
      createTradeBlock({
        id: trade.id, pair,
        buyerPubKey: side === 'buy' ? userId : 'resting',
        sellerPubKey: side === 'sell' ? userId : 'resting',
        price: trade.price, size: trade.size,
        buyerFee: trade.fee, sellerFee: 0
      });
    }
  }

  return result;
}

export function modifyOrder(userId, orderId, { price, size }) {
  const db = getDb();

  const txn = db.transaction(() => {
    // 1. Get old order
    const oldOrder = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(orderId, userId);
    if (!oldOrder) throw new Error('Order not found');
    if (oldOrder.status === 'filled' || oldOrder.status === 'cancelled') {
      throw new Error('Order cannot be modified');
    }

    // 2. Cancel it first (frees up funds)
    cancelOrder(userId, orderId);

    // 3. Place new limit order with same side and pair
    const newOrderId = generateId();
    const result = executeLimitOrder(db, newOrderId, userId, oldOrder.pair, oldOrder.side, price, size);

    // Record pending transaction
    db.prepare(`INSERT INTO pending_transactions (id, type, user_id, data) VALUES (?, ?, ?, ?)`).run(
      generateId(), 'modify_order', userId, JSON.stringify({ oldOrderId: orderId, newOrderId, pair: oldOrder.pair, price, size })
    );

    return result;
  });

  return txn();
}

export function cancelOrder(userId, orderId) {
  const db = getDb();

  const txn = db.transaction(() => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(orderId, userId);
    if (!order) throw new Error('Order not found');
    if (order.status === 'filled' || order.status === 'cancelled') {
      throw new Error('Order cannot be cancelled');
    }

    const unfilled = order.size - order.filled;
    const [baseCurrency, quoteCurrency] = order.pair.toLowerCase().split('/');

    // Unlock funds
    if (order.side === 'buy') {
      const unlockQuote = unfilled * order.price;
      updateBalance(db, userId, quoteCurrency, unlockQuote, -unlockQuote);
    } else {
      updateBalance(db, userId, baseCurrency, unfilled, -unfilled);
    }

    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('cancelled', orderId);

    // Record pending transaction
    const txId = generateId();
    db.prepare(`INSERT INTO pending_transactions (id, type, user_id, data) VALUES (?, ?, ?, ?)`).run(
      txId, 'cancel_order', userId, JSON.stringify({ orderId })
    );

    return { orderId, unlockedSize: unfilled };
  });

  return txn();
}

export function getOrderbook(pair) {
  const db = getDb();

  const bids = db.prepare(
    `SELECT price, SUM(size - filled) as size 
     FROM orders WHERE pair = ? AND side = 'buy' AND status IN ('open', 'partial') 
     GROUP BY price ORDER BY price DESC`
  ).all(pair);

  const asks = db.prepare(
    `SELECT price, SUM(size - filled) as size 
     FROM orders WHERE pair = ? AND side = 'sell' AND status IN ('open', 'partial') 
     GROUP BY price ORDER BY price ASC`
  ).all(pair);

  return { bids, asks };
}

export function getRecentTrades(pair, limit = 50) {
  const db = getDb();
  return db.prepare(
    `SELECT t.*, 
       CASE WHEN t.buyer_id = (SELECT user_id FROM orders WHERE id = t.buy_order_id) THEN 'buy' ELSE 'sell' END as taker_side
     FROM trades t WHERE t.pair = ? ORDER BY t.created_at DESC LIMIT ?`
  ).all(pair, limit);
}

export function getChartData(pair, interval = '5m', limit = 200) {
  const db = getDb();

  // Build OHLCV candles from trades
  // For simplicity, group by minute intervals
  let groupExpr;
  switch (interval) {
    case '1m':
      groupExpr = `strftime('%Y-%m-%d %H:%M', t.created_at)`;
      break;
    case '5m':
      groupExpr = `strftime('%Y-%m-%d %H:', t.created_at) || printf('%02d', (CAST(strftime('%M', t.created_at) AS INTEGER) / 5) * 5)`;
      break;
    case '15m':
      groupExpr = `strftime('%Y-%m-%d %H:', t.created_at) || printf('%02d', (CAST(strftime('%M', t.created_at) AS INTEGER) / 15) * 15)`;
      break;
    case '1h':
      groupExpr = `strftime('%Y-%m-%d %H', t.created_at)`;
      break;
    case '4h':
      groupExpr = `strftime('%Y-%m-%d ', t.created_at) || printf('%02d', (CAST(strftime('%H', t.created_at) AS INTEGER) / 4) * 4)`;
      break;
    case '6h':
      groupExpr = `strftime('%Y-%m-%d ', t.created_at) || printf('%02d', (CAST(strftime('%H', t.created_at) AS INTEGER) / 6) * 6)`;
      break;
    case '8h':
      groupExpr = `strftime('%Y-%m-%d ', t.created_at) || printf('%02d', (CAST(strftime('%H', t.created_at) AS INTEGER) / 8) * 8)`;
      break;
    case '12h':
      groupExpr = `strftime('%Y-%m-%d ', t.created_at) || printf('%02d', (CAST(strftime('%H', t.created_at) AS INTEGER) / 12) * 12)`;
      break;
    case '1d':
      groupExpr = `strftime('%Y-%m-%d', t.created_at)`;
      break;
    case '3d':
      // SQLite doesn't have a simple 3d group, we can use JulianDay / 3
      groupExpr = `CAST(julianday(t.created_at) / 3 AS INTEGER)`;
      break;
    case '1m':
      groupExpr = `strftime('%Y-%m-%d %H:%M', t.created_at)`;
      break;
    case '1w':
      groupExpr = `strftime('%Y-%W', t.created_at)`;
      break;
    case '1M':
      groupExpr = `strftime('%Y-%m', t.created_at)`;
      break;
    case '3M':
      groupExpr = `strftime('%Y-', t.created_at) || printf('%02d', (CAST(strftime('%m', t.created_at) AS INTEGER) / 3) * 3)`;
      break;
    case '12M':
      groupExpr = `strftime('%Y', t.created_at)`;
      break;
    default:
      groupExpr = `strftime('%Y-%m-%d %H:%M', t.created_at)`;
  }

  const candles = db.prepare(`
    SELECT 
      ${groupExpr} as time_bucket,
      MIN(t.created_at) as time,
      (SELECT t2.price FROM trades t2 WHERE t2.pair = ? AND ${groupExpr} = ${groupExpr.replace(/t\./g, 't2.')} ORDER BY t2.created_at ASC LIMIT 1) as open,
      MAX(t.price) as high,
      MIN(t.price) as low,
      (SELECT t2.price FROM trades t2 WHERE t2.pair = ? AND ${groupExpr} = ${groupExpr.replace(/t\./g, 't2.')} ORDER BY t2.created_at DESC LIMIT 1) as close,
      SUM(t.size) as volume
    FROM trades t
    WHERE t.pair = ?
    GROUP BY ${groupExpr}
    ORDER BY time ASC
    LIMIT ?
  `).all(pair, pair, pair, limit);

  return candles;
}

// Helper: update balance atomically
function updateBalance(db, userId, currency, availableDelta, lockedDelta = 0) {
  // Ensure balance row exists
  db.prepare(
    `INSERT OR IGNORE INTO balances (user_id, currency, available, locked) VALUES (?, ?, 0, 0)`
  ).run(userId, currency);

  db.prepare(
    `UPDATE balances SET available = available + ?, locked = locked + ? WHERE user_id = ? AND currency = ?`
  ).run(availableDelta, lockedDelta, userId, currency);

  // Validate no negative balances
  const bal = db.prepare('SELECT * FROM balances WHERE user_id = ? AND currency = ?').get(userId, currency);
  if (bal.available < -0.00000001 || bal.locked < -0.00000001) {
    throw new Error(`Insufficient ${currency.toUpperCase()} balance`);
  }
}

// ============================================================================
// DAO VAULT FEE REDISTRIBUTION ENGINE
//
// Called after every non-vault trade, with the base-currency fee from that trade.
//
//  DYNAMIC BUYBACK  → 10% of THIS trade's base fee (scales with impact fee)
//  DYNAMIC REWARD   → 40% of vault balance remaining after buyback
//                     Redistributed proportionally to ask-side LP providers
//  STRATEGIC BIDS   → 50% of vault balance remaining after buyback
//                     Converted to BPS and placed as ladder limit buys
//
// Because the fee itself is impact-based, buyback & rewards are naturally
// larger when whale trades hit thin books, and smaller during normal flow.
// ============================================================================

const VAULT_ID = 'EXCHANGE_DAO_VAULT';
const DUST_THRESHOLD = 0.00000100;

/**
 * Gets all pairs currently having active orders in the book.
 */
function getActivePairs(db) {
  const rows = db.prepare(
    "SELECT DISTINCT pair FROM orders WHERE status IN ('open', 'partial')"
  ).all();
  return rows.map(r => r.pair);
}

/**
 * Main orchestrator — processes vault fees after every non-vault trade.
 *
 * The vault collects fees in both Base currency (e.g., BTC) and Quote currency (BPS).
 *
 *  BASE CURRENCY → Split dynamically using the triggering trade's feePct:
 *    [feePct] portion → BUYBACK   (market sell base → BPS treasury)
 *    [rest]   portion → LP REWARD (distributed proportionally to ask providers)
 *
 *  QUOTE CURRENCY (BPS) → STRATEGIC BIDS
 *    Placed natively as ladder limit buy orders across all pairs.
 *
 * @param {object} db          - SQLite database instance
 * @param {string} triggerPair - The pair that generated the fees (e.g. 'BTC/BPS')
 * @param {number} feePct      - The fee % of the triggering trade (already impact-dynamic)
 */
function processVaultFees(db, triggerPair, feePct = 0.0002) {
  const [baseCurrency] = triggerPair.toLowerCase().split('/');

  const daoBaseBal = db.prepare(
    'SELECT available FROM balances WHERE user_id = ? AND currency = ?'
  ).get(VAULT_ID, baseCurrency);

  // --- QUOTE CURRENCY (BPS): Game Fund & AI Pot ---
  // The incoming BPS fees are now split at the time of trade execution (see executeMarketOrder/executeLimitOrder).
  // The vault simply holds the AI Pot portion. No further action is needed here.


  let strategicTrades = []; // No longer placing active bids

  let buybackTrades = [];
  let rewards = [];

  if (!daoBaseBal || daoBaseBal.available < DUST_THRESHOLD) return { strategicTrades, buybackTrades, rewards };

  const totalBase = daoBaseBal.available;

  // --- BASE CURRENCY: Dynamic Buyback ---
  // Calculated as [fee%] of the total Base balance
  const buybackAmount = satoshiRound(totalBase * Math.min(feePct, 1.0));
  if (buybackAmount > DUST_THRESHOLD) {
    try {
      const res = executeMarketOrder(db, generateId(), VAULT_ID, triggerPair, 'sell', buybackAmount, true); // skipBlock=true
      buybackTrades = res.trades;
    } catch (e) {
      // No liquidity to absorb buyback — skip
    }
  }

  // --- BASE CURRENCY: Dynamic LP Reward ---
  // The remaining Base balance after Buyback
  const redistAmount = satoshiRound(totalBase - buybackAmount);
  if (redistAmount > DUST_THRESHOLD) {
    rewards = redistributeToAskProviders(db, baseCurrency, redistAmount);
  }

  return { strategicTrades, buybackTrades, rewards };
}

/**
 * Distributes base currency to all ask-side liquidity providers across ALL pairs
 * that use this currency as base, proportionally to their share of the total global depth.
 */
function redistributeToAskProviders(db, baseCurrency, amount) {
  const activePairs = getActivePairs(db);
  const relevantPairs = activePairs.filter(p => p.toLowerCase().startsWith(baseCurrency.toLowerCase() + '/'));

  if (relevantPairs.length === 0) return [];

  // Aggregate ask depth across all relevant pairs
  const allAskGroups = [];
  let globalTotalAskDepth = 0;

  for (const pair of relevantPairs) {
    const groups = db.prepare(
      `SELECT ?, user_id, ROUND(price, 8) as price, SUM(size - filled) as total_remaining
       FROM orders
       WHERE pair = ? AND side = 'sell' AND status IN ('open', 'partial')
         AND user_id != ?
       GROUP BY user_id, ROUND(price, 8)`
    ).all(pair, pair, VAULT_ID);
    
    for (const g of groups) {
      allAskGroups.push({
        pair: pair,
        userId: g.user_id,
        price: g.price,
        total_remaining: g.total_remaining
      });
      globalTotalAskDepth += g.total_remaining;
    }
  }

  if (allAskGroups.length === 0 || globalTotalAskDepth <= 0) return [];

  // Deduct from vault
  updateBalance(db, VAULT_ID, baseCurrency, -amount, 0);

  let distributed = 0;
  const rewardsArray = [];

  for (let i = 0; i < allAskGroups.length; i++) {
    const group = allAskGroups[i];
    const share = group.total_remaining / globalTotalAskDepth;
    const reward = (i === allAskGroups.length - 1)
      ? satoshiRound(amount - distributed)
      : satoshiRound(amount * share);

    if (reward > 0 && reward >= DUST_THRESHOLD) {
      const matureAt = getTradeChain().getHeight() + 100;
      
      db.prepare(`
        INSERT INTO locked_rewards (id, user_id, pair, currency, amount, price, mature_at_block)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(generateId(), group.userId, group.pair, baseCurrency, reward, group.price, matureAt);

      distributed += reward;
      rewardsArray.push({ userId: group.userId, pair: group.pair, amount: reward, price: group.price, matureAt });
    }
  }

  // Log distribution summary
  if (distributed > 0) {
    db.prepare(
      `INSERT INTO vault_rewards (id, pair, currency, total_amount, recipient_count) VALUES (?, ?, ?, ?, ?)`
    ).run(generateId(), baseCurrency.toUpperCase() + '/*', baseCurrency, distributed, allAskGroups.length);
  }

  return rewardsArray;
}

/**
 * DEPRECATED: Strategic Bids are now rebranded to Game Fund and are not placed as active orders.
 * Kept as a no-op for backward compatibility in the orchestrator if needed.
 */
function placeVaultBids(db, feePct) {
  return [];
}
