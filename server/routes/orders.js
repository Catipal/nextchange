import { Router } from 'express';
import { getDb } from '../db/init.js';
import { authenticateToken } from '../middleware/auth.js';
import { placeOrder, cancelOrder, modifyOrder } from '../services/matching.js';
import { verifyOrderSignature } from '../crypto/identity.js';

const router = Router();

// All order routes require authentication
router.use(authenticateToken);

// POST /api/orders — Place a new order
router.post('/', (req, res) => {
  try {
    const { pair = 'BTC/BPS', side, type, price, size, publicKey, signature, timestamp } = req.body;

    // Verify signature and public key
    if (req.user.publicKey !== publicKey) {
      return res.status(403).json({ error: 'Public key mismatch' });
    }
    
    if (!verifyOrderSignature({ pair, side, type, price, size, publicKey, signature, timestamp })) {
      return res.status(401).json({ error: 'Invalid order signature' });
    }

    // Validate
    if (!['buy', 'sell'].includes(side)) {
      return res.status(400).json({ error: 'Side must be buy or sell' });
    }

    if (!['market', 'limit'].includes(type)) {
      return res.status(400).json({ error: 'Type must be market or limit' });
    }

    const numSize = parseFloat(size);
    if (!numSize || numSize <= 0) {
      return res.status(400).json({ error: 'Invalid size' });
    }

    if (type === 'limit') {
      const numPrice = parseFloat(price);
      if (!numPrice || numPrice <= 0) {
        return res.status(400).json({ error: 'Invalid price for limit order' });
      }

      const result = placeOrder(req.user.id, pair, {
        side,
        type,
        price: numPrice,
        size: numSize
      });

      return res.json(result);
    }

    // Market order
    const result = placeOrder(req.user.id, pair, {
      side,
      type,
      price: null,
      size: numSize
    });

    res.json(result);
  } catch (err) {
    console.error('[Orders] Place error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// GET /api/orders — List user's open orders
router.get('/', (req, res) => {
  try {
    const pair = req.query.pair || 'BTC/BPS';
    const db = getDb();
    const orders = db.prepare(
      `SELECT * FROM orders WHERE user_id = ? AND pair = ? AND status IN ('open', 'partial') ORDER BY created_at DESC`
    ).all(req.user.id, pair);

    res.json(orders);
  } catch (err) {
    console.error('[Orders] List error:', err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// GET /api/orders/history — List user's historical orders
router.get('/history', (req, res) => {
  try {
    const pair = req.query.pair || 'BTC/BPS';
    const db = getDb();
    const orders = db.prepare(`
      SELECT o.*, 
             (SELECT t.block_hash FROM trades t WHERE t.buy_order_id = o.id OR t.sell_order_id = o.id ORDER BY t.created_at DESC LIMIT 1) as block_hash
      FROM orders o 
      WHERE o.user_id = ? AND o.pair = ? 
      ORDER BY o.created_at DESC LIMIT 50
    `).all(req.user.id, pair);

    res.json(orders);
  } catch (err) {
    console.error('[Orders] History error:', err);
    res.status(500).json({ error: 'Failed to fetch order history' });
  }
});

// DELETE /api/orders/:id — Cancel an order
router.delete('/:id', (req, res) => {
  try {
    const result = cancelOrder(req.user.id, req.params.id);
    res.json(result);
  } catch (err) {
    console.error('[Orders] Cancel error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/orders/:id — Modify an order
router.patch('/:id', (req, res) => {
  try {
    const { price, size } = req.body;
    const numPrice = parseFloat(price);
    const numSize = parseFloat(size);

    if (!numPrice || numPrice <= 0) return res.status(400).json({ error: 'Invalid price' });
    if (!numSize || numSize <= 0) return res.status(400).json({ error: 'Invalid size' });

    const result = modifyOrder(req.user.id, req.params.id, { price: numPrice, size: numSize });
    res.json(result);
  } catch (err) {
    console.error('[Orders] Modify error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

export default router;
