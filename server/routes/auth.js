import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { getDb } from '../db/init.js';
import { deriveUserId, verifySignature, generateChallenge } from '../crypto/identity.js';
import { loadConfig } from '../config.js';
import { generateId } from '../utils/helpers.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

/**
 * POST /api/auth/register
 * Register a new user by public key.
 * No password needed — identity IS the keypair.
 */
router.post('/register', (req, res) => {
  try {
    const { publicKey } = req.body;
    if (!publicKey || publicKey.length < 60) {
      return res.status(400).json({ error: 'Valid public key required' });
    }

    const db = getDb();
    const userId = deriveUserId(publicKey);

    // Check if already registered
    const existing = db.prepare('SELECT id FROM users WHERE public_key = ?').get(publicKey);
    if (existing) {
      return res.json({ userId: existing.id, publicKey, alreadyExists: true });
    }

    // Register
    db.prepare('INSERT INTO users (id, public_key) VALUES (?, ?)').run(userId, publicKey);

    // Initialize balances
    for (const currency of ['btc', 'bps', 'eth']) {
      db.prepare('INSERT INTO balances (user_id, currency, available, locked) VALUES (?, ?, 0, 0)')
        .run(userId, currency);
    }

    console.log(`[Auth] Registered user ${userId} (pubkey: ${publicKey.slice(0, 12)}...)`);
    res.status(201).json({ userId, publicKey });
  } catch (err) {
    console.error('[Auth] Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

/**
 * POST /api/auth/challenge
 * Request a random challenge nonce for authentication.
 */
router.post('/challenge', (req, res) => {
  try {
    const { publicKey } = req.body;
    if (!publicKey) return res.status(400).json({ error: 'Public key required' });

    const db = getDb();
    const challenge = generateChallenge();
    const id = generateId();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min

    // Clean up old challenges for this key
    db.prepare('DELETE FROM auth_challenges WHERE public_key = ?').run(publicKey);

    // Store challenge
    db.prepare('INSERT INTO auth_challenges (id, public_key, challenge, expires_at) VALUES (?, ?, ?, ?)')
      .run(id, publicKey, challenge, expiresAt);

    res.json({ challengeId: id, challenge });
  } catch (err) {
    console.error('[Auth] Challenge error:', err);
    res.status(500).json({ error: 'Challenge generation failed' });
  }
});

/**
 * POST /api/auth/verify
 * Verify a signed challenge to authenticate.
 * Returns a JWT session token.
 */
router.post('/verify', (req, res) => {
  try {
    const { publicKey, challengeId, signature } = req.body;
    if (!publicKey || !challengeId || !signature) {
      return res.status(400).json({ error: 'publicKey, challengeId, and signature required' });
    }

    const db = getDb();

    // Fetch challenge
    const record = db.prepare(
      'SELECT * FROM auth_challenges WHERE id = ? AND public_key = ?'
    ).get(challengeId, publicKey);

    if (!record) {
      return res.status(401).json({ error: 'Challenge not found or expired' });
    }

    // Check expiry
    if (new Date(record.expires_at) < new Date()) {
      db.prepare('DELETE FROM auth_challenges WHERE id = ?').run(challengeId);
      return res.status(401).json({ error: 'Challenge expired' });
    }

    // Verify signature
    const valid = verifySignature(publicKey, record.challenge, signature);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Clean up challenge
    db.prepare('DELETE FROM auth_challenges WHERE id = ?').run(challengeId);

    // Ensure user exists
    const userId = deriveUserId(publicKey);
    const user = db.prepare('SELECT id FROM users WHERE public_key = ?').get(publicKey);
    if (!user) {
      // Auto-register
      db.prepare('INSERT INTO users (id, public_key) VALUES (?, ?)').run(userId, publicKey);
      for (const currency of ['btc', 'bps', 'eth']) {
        db.prepare('INSERT OR IGNORE INTO balances (user_id, currency, available, locked) VALUES (?, ?, 0, 0)')
          .run(userId, currency);
      }
    }

    // Issue JWT
    const config = loadConfig();
    const token = jwt.sign(
      { id: userId, publicKey },
      config.jwtSecret,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: { id: userId, publicKey }
    });
  } catch (err) {
    console.error('[Auth] Verify error:', err);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

/**
 * GET /api/auth/me
 * Get current user info from token.
 */
router.get('/me', authenticateToken, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, public_key, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: { id: user.id, publicKey: user.public_key, createdAt: user.created_at } });
});

export default router;
