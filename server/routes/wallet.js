import { Router } from 'express';
import { ethers } from 'ethers';
import { getDb } from '../db/init.js';
import { getRpc } from '../services/rpc.js';
import { authenticateToken } from '../middleware/auth.js';
import { generateId } from '../utils/helpers.js';
import { fromHubAddress, deriveBtcAddress, deriveBpsAddress } from '../crypto/identity.js';
import { generateDaoAddress, initiateWithdrawal, importKeyToVault } from '../services/vault.js';

const router = Router();

// All wallet routes require authentication
router.use(authenticateToken);

// GET /api/wallet/balances
router.get('/balances', (req, res) => {
  try {
    const db = getDb();
    const balances = db.prepare('SELECT currency, available, locked FROM balances WHERE user_id = ?')
      .all(req.user.id);

    const result = { btc: { available: 0, locked: 0 }, bps: { available: 0, locked: 0 }, eth: { available: 0, locked: 0 } };
    for (const b of balances) {
      result[b.currency] = { available: b.available, locked: b.locked };
    }

    res.json(result);
  } catch (err) {
    console.error('[Wallet] Balances error:', err);
    res.status(500).json({ error: 'Failed to fetch balances' });
  }
});

// GET /api/wallet/fees
router.get('/fees', async (req, res) => {
  try {
    const currencies = ['btc', 'bps', 'eth'];
    const fees = {};
    
    await Promise.all(currencies.map(async (currency) => {
      try {
        const rpc = getRpc(currency);
        if (!rpc) throw new Error(`No RPC for ${currency}`);
        fees[currency] = await rpc.estimateFee();
      } catch (err) {
        console.warn(`[Wallet Route] Fee estimation failed for ${currency}:`, err.message);
        fees[currency] = currency === 'eth' ? 20 : 0.0001;
      }
    }));
    
    // Log the successful fees for debug
    console.log('[Wallet Route] Fetched fees:', JSON.stringify(fees));
    
    res.json({
      ...fees,
      _timestamp: Date.now()
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch fees' });
  }
});

// GET /api/wallet/deposit-address/:currency
router.get('/deposit-address/:currency', async (req, res) => {
  try {
    const { currency } = req.params;
    if (!['btc', 'bps', 'eth'].includes(currency)) {
      return res.status(400).json({ error: 'Invalid currency' });
    }

    const db = getDb();

    const forceNew = req.query.new === 'true';

    if (!forceNew) {
      // Check for existing address
      let addr = db.prepare(
        'SELECT address FROM deposit_addresses WHERE user_id = ? AND currency = ? ORDER BY created_at DESC LIMIT 1'
      ).get(req.user.id, currency);

      if (addr) {
        return res.json({ address: addr.address, currency });
      }
    }

    let newAddress;
    if (currency === 'bps' || currency === 'btc' || currency === 'eth') {
      try {
        // Use the DAO Vault to generate a threshold-controlled address
        // The vault natively utilizes the local daemon for BTC/BPS
        const result = await generateDaoAddress(req.user.id, currency);
        newAddress = result.address;
      } catch (err) {
        console.warn(`[Wallet] Vault generation failed for ${currency}, falling back to local derivation:`, err.message);
        if (currency === 'bps') newAddress = deriveBpsAddress(req.user.publicKey);
        else if (currency === 'btc') newAddress = deriveBtcAddress(req.user.publicKey);
        else if (currency === 'eth') {
          const pk = req.user.publicKey.startsWith('0x') ? req.user.publicKey : '0x' + req.user.publicKey;
          newAddress = ethers.computeAddress(pk);
        }
        
      }
    } else {
      // Fallback for unknown currencies using standard RPC
      const rpc = getRpc(currency);
      const label = `user_${req.user.id}`;
      newAddress = await rpc.getNewAddress(label);

      const addrId = generateId();
      db.prepare(
        'INSERT INTO deposit_addresses (id, user_id, currency, address) VALUES (?, ?, ?, ?)'
      ).run(addrId, req.user.id, currency, newAddress);
    }

    res.json({ address: newAddress, currency });
  } catch (err) {
    console.error('[Wallet] Deposit address error:', err.message, err.stack);
    res.status(500).json({ error: err.message || 'Failed to generate deposit address' });
  }
});

// GET /api/wallet/deposits
router.get('/deposits', (req, res) => {
  try {
    const db = getDb();
    const deposits = db.prepare(
      'SELECT * FROM deposits WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
    ).all(req.user.id);

    res.json(deposits);
  } catch (err) {
    console.error('[Wallet] Deposits error:', err);
    res.status(500).json({ error: 'Failed to fetch deposits' });
  }
});

// POST /api/wallet/withdraw
router.post('/withdraw', async (req, res) => {
  try {
    const { currency, amount, address } = req.body;

    if (!['btc', 'bps', 'eth'].includes(currency)) {
      return res.status(400).json({ error: 'Invalid currency' });
    }

    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    if (!address || address.length < 10) {
      return res.status(400).json({ error: 'Invalid address' });
    }

    // Withdrawal fee
    const fee = currency === 'btc' ? 0.0001 : (currency === 'eth' ? 0.005 : 0.01);
    const totalDeduction = numAmount + fee;

    const db = getDb();

    // Check balance
    const bal = db.prepare('SELECT available FROM balances WHERE user_id = ? AND currency = ?')
      .get(req.user.id, currency);

    if (!bal || bal.available < totalDeduction) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    const withdrawalId = generateId();

    const txn = db.transaction(() => {
      // Deduct balance
      db.prepare(
        'UPDATE balances SET available = available - ? WHERE user_id = ? AND currency = ?'
      ).run(totalDeduction, req.user.id, currency);

      // Create withdrawal record
      db.prepare(
        'INSERT INTO withdrawals (id, user_id, currency, amount, fee, address, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(withdrawalId, req.user.id, currency, numAmount, fee, address, 'pending');

      // Record pending transaction
      db.prepare(`INSERT INTO pending_transactions (id, type, user_id, data) VALUES (?, ?, ?, ?)`).run(
        generateId(), 'withdraw', req.user.id, JSON.stringify({ withdrawalId, currency, amount: numAmount, address })
      );
    });

    txn();

    // Process withdrawal via DAO Vault threshold settlement
    const settlement = await initiateWithdrawal(withdrawalId, req.user.id, currency, numAmount, address);

    if (!settlement) {
      // Fallback: legacy withdrawal via RPC if no DAO address was found
      const { processWithdrawal } = await import('../services/walletSync.js').catch(() => ({})); 
      if (processWithdrawal) {
        processWithdrawal(withdrawalId, currency, numAmount, address);
      } else {
        // Simple mock for prototype if legacy sync not available
        setTimeout(() => {
          const rpc = getRpc(currency);
          rpc.sendToAddress(address, numAmount).then(txid => {
            db.prepare('UPDATE withdrawals SET status = ?, txid = ? WHERE id = ?').run('completed', txid, withdrawalId);
          });
        }, 1000);
      }
    }

    res.json({
      id: withdrawalId,
      currency,
      amount: numAmount,
      fee,
      address,
      status: 'pending'
    });
  } catch (err) {
    console.error('[Wallet] Withdrawal error:', err);
    res.status(500).json({ error: 'Withdrawal failed' });
  }
});

// GET /api/wallet/withdrawals
router.get('/withdrawals', (req, res) => {
  try {
    const db = getDb();
    const withdrawals = db.prepare(
      'SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
    ).all(req.user.id);

    res.json(withdrawals);
  } catch (err) {
    console.error('[Wallet] Withdrawals error:', err);
    res.status(500).json({ error: 'Failed to fetch withdrawals' });
  }
});

// POST /api/wallet/transfer (Internal P2P transfer)
router.post('/transfer', async (req, res) => {
  try {
    const { currency, amount, recipientAddress } = req.body;

    if (!['btc', 'bps', 'eth'].includes(currency)) {
      return res.status(400).json({ error: 'Invalid currency' });
    }

    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    if (!recipientAddress) {
      return res.status(400).json({ error: 'Recipient address required' });
    }

    const db = getDb();

    // Find recipient by public key, user ID, hub ID (first 16 chars), or Hub Address
    console.log(`[Transfer] Attempting to resolve recipient: ${recipientAddress.slice(0, 20)}...`);
    let recipient = db.prepare(
      'SELECT id FROM users WHERE public_key = ? OR id = ?'
    ).get(recipientAddress, recipientAddress);

    if (!recipient && recipientAddress.length === 16) {
      // Direct short user-id lookup
      recipient = db.prepare('SELECT id FROM users WHERE id = ?').get(recipientAddress);
    }

    if (!recipient) {
      // Check if it's a Hub Address (7...)
      const hubAddr = fromHubAddress(recipientAddress);
      if (hubAddr) {
        console.log(`[Transfer] Decoded Hub Address: version=${hubAddr.version}, hash=${hubAddr.hash}`);
        if (hubAddr.version === 0x0F) {
          const potentialId = hubAddr.hash.slice(0, 16);
          recipient = db.prepare('SELECT id FROM users WHERE id = ?').get(potentialId);
          if (recipient) console.log(`[Transfer] Found recipient by Hub Address ID: ${recipient.id}`);
        }
      }
    }

    if (!recipient) {
      // Also check if it's a known deposit address
      const addr = db.prepare('SELECT user_id FROM deposit_addresses WHERE address = ?').get(recipientAddress);
      if (addr) {
        recipient = { id: addr.user_id };
        console.log(`[Transfer] Found recipient by deposit address: ${recipient.id}`);
      }
    }

    if (!recipient) {
      return res.status(404).json({ error: 'Recipient not found on the network' });
    }

    if (recipient.id === req.user.id) {
      return res.status(400).json({ error: 'Cannot transfer to yourself' });
    }

    // Check sender balance
    const senderBal = db.prepare('SELECT available FROM balances WHERE user_id = ? AND currency = ?')
      .get(req.user.id, currency);

    if (!senderBal || senderBal.available < numAmount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    const transferId = generateId();

    const txn = db.transaction(() => {
      // Deduct from sender
      db.prepare(
        'UPDATE balances SET available = available - ? WHERE user_id = ? AND currency = ?'
      ).run(numAmount, req.user.id, currency);

      // Ensure recipient balance row exists
      db.prepare(
        'INSERT OR IGNORE INTO balances (user_id, currency, available, locked) VALUES (?, ?, 0, 0)'
      ).run(recipient.id, currency);

      // Credit to recipient
      db.prepare(
        'UPDATE balances SET available = available + ? WHERE user_id = ? AND currency = ?'
      ).run(numAmount, recipient.id, currency);

      // Record as a 'transfer' type transaction for BOTH sides
      // We'll use the 'deposits' and 'withdrawals' tables for now to keep history simple,
      // but mark them as 'transfer' status.
      db.prepare(
        `INSERT INTO withdrawals (id, user_id, currency, amount, fee, address, status, txid)
         VALUES (?, ?, ?, ?, 0, ?, 'completed', ?)`
      ).run(transferId + '_s', req.user.id, currency, numAmount, recipientAddress, 'internal_transfer');

      db.prepare(
        `INSERT INTO deposits (id, user_id, currency, amount, txid, confirmations, required_confirmations, status, address)
         VALUES (?, ?, ?, ?, ?, 0, 0, 'credited', ?)`
      ).run(transferId + '_r', recipient.id, currency, numAmount, 'internal_transfer', req.user.id);

      // Record pending transaction
      db.prepare(`INSERT INTO pending_transactions (id, type, user_id, data) VALUES (?, ?, ?, ?)`).run(
        generateId(), 'transfer', req.user.id, JSON.stringify({ transferId, currency, amount: numAmount, to: recipient.id })
      );
    });

    txn();

    res.json({
      id: transferId,
      currency,
      amount: numAmount,
      status: 'completed',
      message: 'Transfer completed successfully (Zero Fees)'
    });
  } catch (err) {
    console.error('[Wallet] Transfer error:', err);
    res.status(500).json({ error: 'Transfer failed' });
  }
});

// GET /api/wallet/transactions
router.get('/transactions', (req, res) => {
  try {
    const db = getDb();

    const deposits = db.prepare(
      "SELECT id, currency, amount, status, created_at, 'deposit' as type FROM deposits WHERE user_id = ? ORDER BY created_at DESC LIMIT 25"
    ).all(req.user.id);

    const withdrawals = db.prepare(
      "SELECT id, currency, amount, status, created_at, 'withdrawal' as type FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT 25"
    ).all(req.user.id);

    const all = [...deposits, ...withdrawals].sort((a, b) =>
      new Date(b.created_at) - new Date(a.created_at)
    ).slice(0, 50);

    res.json(all);
  } catch (err) {
    console.error('[Wallet] Transactions error:', err);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// POST /api/wallet/demo-deposit (demo mode only — for testing)
router.post('/demo-deposit', (req, res) => {
  try {
    const { currency, amount } = req.body;

    if (!['btc', 'bps', 'eth'].includes(currency)) {
      return res.status(400).json({ error: 'Invalid currency' });
    }

    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0 || numAmount > 1000) {
      return res.status(400).json({ error: 'Invalid amount (max 1000)' });
    }

    const db = getDb();
    const depositId = generateId();

    const txn = db.transaction(() => {
      // Ensure balance row exists
      db.prepare(
        'INSERT OR IGNORE INTO balances (user_id, currency, available, locked) VALUES (?, ?, 0, 0)'
      ).run(req.user.id, currency);

      // Credit balance
      db.prepare(
        'UPDATE balances SET available = available + ? WHERE user_id = ? AND currency = ?'
      ).run(numAmount, req.user.id, currency);

      // Record deposit
      db.prepare(
        `INSERT INTO deposits (id, user_id, currency, amount, txid, confirmations, required_confirmations, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'credited')`
      ).run(depositId, req.user.id, currency, numAmount, 'demo_' + Date.now().toString(36), 999, 0);

      // Record pending transaction
      db.prepare(`INSERT INTO pending_transactions (id, type, user_id, data) VALUES (?, ?, ?, ?)`).run(
        generateId(), 'deposit', req.user.id, JSON.stringify({ depositId, currency, amount: numAmount })
      );
    });

    txn();

    res.json({
      id: depositId,
      currency,
      amount: numAmount,
      status: 'credited',
      message: 'Demo deposit credited instantly'
    });
  } catch (err) {
    console.error('[Wallet] Demo deposit error:', err);
    res.status(500).json({ error: 'Demo deposit failed' });
  }
});

// Process withdrawal via RPC
async function processWithdrawal(withdrawalId, currency, amount, address) {
  const db = getDb();
  const rpc = getRpc(currency);

  try {
    db.prepare('UPDATE withdrawals SET status = ? WHERE id = ?').run('processing', withdrawalId);

    const txid = await rpc.sendToAddress(address, amount);

    db.prepare('UPDATE withdrawals SET status = ?, txid = ? WHERE id = ?')
      .run('completed', txid, withdrawalId);

    console.log(`[Wallet] Withdrawal ${withdrawalId} completed: ${txid}`);
  } catch (err) {
    console.error(`[Wallet] Withdrawal ${withdrawalId} failed:`, err.message);
    db.prepare('UPDATE withdrawals SET status = ? WHERE id = ?').run('failed', withdrawalId);

    // Refund the user
    db.prepare(
      'UPDATE balances SET available = available + ? WHERE user_id = (SELECT user_id FROM withdrawals WHERE id = ?) AND currency = ?'
    ).run(amount, withdrawalId, currency);
  }
}

export default router;
