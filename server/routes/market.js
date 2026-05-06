import { Router } from 'express';
import { getOrderbook, getRecentTrades, getChartData } from '../services/matching.js';
import { getDb } from '../db/init.js';

const router = Router();

// GET /api/market/orderbook — Public orderbook
router.get('/orderbook', (req, res) => {
  try {
    const pair = req.query.pair || 'BTC/BPS';
    const orderbook = getOrderbook(pair);
    res.json(orderbook);
  } catch (err) {
    console.error('[Market] Orderbook error:', err);
    res.status(500).json({ error: 'Failed to fetch orderbook' });
  }
});

// GET /api/market/trades — Public recent trades
router.get('/trades', (req, res) => {
  try {
    const pair = req.query.pair || 'BTC/BPS';
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const trades = getRecentTrades(pair, limit);
    res.json(trades);
  } catch (err) {
    console.error('[Market] Trades error:', err);
    res.status(500).json({ error: 'Failed to fetch trades' });
  }
});

// GET /api/market/chart — OHLCV candle data
router.get('/chart', (req, res) => {
  try {
    const pair = req.query.pair || 'BTC/BPS';
    const interval = req.query.interval || '5m';
    const limit = Math.min(parseInt(req.query.limit) || 200, 1000);
    const candles = getChartData(pair, interval, limit);
    res.json(candles);
  } catch (err) {
    console.error('[Market] Chart error:', err);
    res.status(500).json({ error: 'Failed to fetch chart data' });
  }
});

// GET /api/market/ticker — Current market summary
router.get('/ticker', (req, res) => {
  try {
    const pair = req.query.pair || 'BTC/BPS';
    const orderbook = getOrderbook(pair);
    const trades = getRecentTrades(pair, 1);

    const bestBid = orderbook.bids.length > 0 ? orderbook.bids[0].price : null;
    const bestAsk = orderbook.asks.length > 0 ? orderbook.asks[0].price : null;
    const lastPrice = trades.length > 0 ? trades[0].price : null;
    const spread = bestBid && bestAsk ? bestAsk - bestBid : null;

    // 24h Stats
    const db = getDb();
    const statsRow = db.prepare(
      `SELECT 
        COALESCE(SUM(size), 0) as volume, 
        COUNT(*) as count,
        COALESCE(MAX(price), 0) as high,
        COALESCE(MIN(price), 0) as low
       FROM trades WHERE pair = ? AND created_at >= datetime('now', '-24 hours')`
    ).get(pair);

    // Get price 24h ago to calculate change
    const price24hAgoRow = db.prepare(
      `SELECT price FROM trades WHERE pair = ? AND created_at <= datetime('now', '-24 hours') ORDER BY created_at DESC LIMIT 1`
    ).get(pair);
    
    const price24hAgo = price24hAgoRow ? price24hAgoRow.price : lastPrice;
    const priceChange = lastPrice && price24hAgo ? lastPrice - price24hAgo : 0;
    const priceChangePct = price24hAgo ? (priceChange / price24hAgo) * 100 : 0;

    res.json({
      pair,
      lastPrice,
      bestBid,
      bestAsk,
      spread,
      volume24h: statsRow.volume,
      trades24h: statsRow.count,
      high24h: statsRow.high,
      low24h: statsRow.low,
      priceChange24h: priceChange,
      priceChangePct24h: priceChangePct
    });
  } catch (err) {
    console.error('[Market] Ticker error:', err);
    res.status(500).json({ error: 'Failed to fetch ticker' });
  }
});

// GET /api/market/all-tickers — Get status for all pairs
router.get('/all-tickers', (req, res) => {
  try {
    const db = getDb();
    const pairs = ['BTC/BPS', 'ETH/BPS'];
    const results = pairs.map(pair => {
      const orderbook = getOrderbook(pair);
      const trades = getRecentTrades(pair, 1);
      const volumeRow = db.prepare(
        `SELECT COALESCE(SUM(size), 0) as volume
         FROM trades WHERE pair = ? AND created_at >= datetime('now', '-24 hours')`
      ).get(pair);

      // Fetch 24h trend (hourly averages)
      const trendRow = db.prepare(`
        SELECT AVG(price) as price 
        FROM (
          SELECT price, strftime('%Y-%m-%d %H', created_at) as hour 
          FROM trades 
          WHERE pair = ? AND created_at >= datetime('now', '-24 hours')
        ) GROUP BY hour ORDER BY hour ASC
      `).all(pair);

      // Fetch price 24h ago for percentage change
      const price24hAgoRow = db.prepare(
        `SELECT price FROM trades WHERE pair = ? AND created_at <= datetime('now', '-24 hours') ORDER BY created_at DESC LIMIT 1`
      ).get(pair);
      
      const lastPrice = trades.length > 0 ? trades[0].price : null;
      const price24hAgo = price24hAgoRow ? price24hAgoRow.price : lastPrice;
      const priceChangePct = (lastPrice && price24hAgo) ? ((lastPrice - price24hAgo) / price24hAgo) * 100 : 0;

      return {
        pair,
        lastPrice,
        bestBid: orderbook.bids.length > 0 ? orderbook.bids[0].price : null,
        bestAsk: orderbook.asks.length > 0 ? orderbook.asks[0].price : null,
        volume24h: volumeRow.volume,
        priceChangePct24h: priceChangePct,
        trend: trendRow.map(t => t.price)
      };
    });
    res.json(results);
  } catch (err) {
    console.error('[Market] All tickers error:', err);
    res.status(500).json({ error: 'Failed' });
  }
});

// GET /api/market/dao-stats — Return collected fees and return rate
router.get('/dao-stats', (req, res) => {
  try {
    const db = getDb();
    
    // Get all vault balances
    const vaultBalances = db.prepare(
      `SELECT currency, available, locked FROM balances WHERE user_id = 'EXCHANGE_DAO_VAULT'`
    ).all();

    const balanceMap = {};
    let totalBps = 0;
    for (const b of vaultBalances) {
      balanceMap[b.currency] = { available: b.available, locked: b.locked };
      if (b.currency === 'bps') totalBps = b.available + b.locked;
    }

    // BPS locked in vault orders (strategic bids)
    const bpsInOrders = balanceMap['bps'] ? balanceMap['bps'].locked : 0;

    // Count active vault bids
    const activeBids = db.prepare(
      `SELECT COUNT(*) as count FROM orders WHERE user_id = 'EXCHANGE_DAO_VAULT' AND side = 'buy' AND status IN ('open', 'partial')`
    ).get();

    // --- Liquidity rewards data ---
    // Rewards per pair (last year)
    const rewardsByPair = db.prepare(`
      SELECT pair, currency, COALESCE(SUM(total_amount), 0) as total_rewards, COUNT(*) as distribution_count
      FROM vault_rewards
      WHERE created_at >= datetime('now', '-1 year')
      GROUP BY pair, currency
    `).all();

    // --- LP Yield calculation ---
    // 1. Get latest prices for all pairs
    const priceRows = db.prepare(`SELECT pair, price FROM trades WHERE (pair, created_at) IN (SELECT pair, MAX(created_at) FROM trades GROUP BY pair)`).all();
    const marketPrices = {};
    for (const r of priceRows) {
      marketPrices[r.pair] = r.price;
    }

    // 2. Calculate total rewards value in BPS (Estimated)
    let totalRewardsBps = 0;
    for (const r of rewardsByPair) {
      // Find a price for this pair. If it's a cross-pair reward (e.g. BTC/*), find a price for the base currency.
      let price = 1;
      if (r.pair.endsWith('/*')) {
        const base = r.pair.split('/')[0];
        const pairMatch = Object.keys(marketPrices).find(p => p.startsWith(base + '/'));
        price = pairMatch ? marketPrices[pairMatch] : 1;
      } else {
        price = marketPrices[r.pair] || 1;
      }
      totalRewardsBps += r.total_rewards * price;
    }

    // 3. APY Calculation: (collected base currencies - dynamic buyback) / available pairs
    const buybackRow = db.prepare(`
      SELECT COALESCE(SUM(size * price), 0) as total
      FROM trades
      WHERE seller_id = 'EXCHANGE_DAO_VAULT'
        AND created_at >= datetime('now', '-1 year')
    `).get();
    const totalBuyback = buybackRow ? buybackRow.total : 0;

    const availablePairs = db.prepare(`SELECT COUNT(DISTINCT pair) as count FROM trades WHERE pair NOT LIKE '%/*%'`).get().count || 1;
    
    const lpYieldPct = (totalRewardsBps - totalBuyback) / availablePairs;

    // (marketPrices already calculated above)

    // Get Vault's operations (trades, bids placed, rewards)
    const tradesOps = db.prepare(`
      SELECT t.id, t.price, t.size, t.created_at, t.pair,
             CASE WHEN t.seller_id = 'EXCHANGE_DAO_VAULT' THEN 'sell' ELSE 'buy' END as action,
             'trade' as type
      FROM trades t
      WHERE t.buyer_id = 'EXCHANGE_DAO_VAULT' OR t.seller_id = 'EXCHANGE_DAO_VAULT'
      ORDER BY t.created_at DESC LIMIT 150
    `).all();

    const ordersOps = db.prepare(`
      SELECT id, price, size, created_at, pair, side as action, 'order' as type
      FROM orders
      WHERE user_id = 'EXCHANGE_DAO_VAULT' AND is_reward = 0
      ORDER BY created_at DESC LIMIT 150
    `).all();

    const rewardsOps = db.prepare(`
      SELECT id, 0 as price, total_amount as size, created_at, pair, 'reward' as action, 'reward' as type
      FROM vault_rewards
      ORDER BY created_at DESC LIMIT 150
    `).all();

    const settlementsOps = db.prepare(`
      SELECT id, 0 as price, amount as size, created_at, currency as pair, 
             'withdraw' as action, 'settlement' as type
      FROM withdrawal_settlements
      ORDER BY created_at DESC LIMIT 100
    `).all();

    const depositsOps = db.prepare(`
      SELECT id, 0 as price, amount as size, created_at, currency as pair,
             'deposit' as action, 'deposit' as type
      FROM deposits
      ORDER BY created_at DESC LIMIT 100
    `).all();

    const operations = [...tradesOps, ...ordersOps, ...rewardsOps, ...settlementsOps, ...depositsOps]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 150);

    // Game Fund Balance
    const gameFundRow = db.prepare(
      `SELECT available FROM balances WHERE user_id = 'GAME_FUND_VAULT' AND currency = 'bps'`
    ).get();
    const gameFundBps = gameFundRow ? gameFundRow.available : 0;

    res.json({
      bpsHoldings: totalBps,
      gameFundBps,
      bpsInOrders,
      vaultBalances: balanceMap,
      activeBids: activeBids.count,
      rewardsByPair,
      totalRewards: totalRewardsBps,
      totalBuyback,
      availablePairs,
      lpYieldPct,
      operations,
      marketPrices
    });
  } catch (err) {
    console.error('[Market] DAO Stats error:', err);
    res.status(500).json({ error: 'Failed to fetch DAO stats' });
  }
});

export default router;
