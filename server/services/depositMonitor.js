import { getDb } from '../db/init.js';
import { getRpc } from './rpc.js';
import { generateId } from '../utils/helpers.js';

const REQUIRED_CONFIRMATIONS = {
  btc: 3,
  bps: 1,
  eth: 1
};

/**
 * Deposit Monitor
 * Polls both blockchain nodes for incoming transactions,
 * matches them to user deposit addresses, and credits balances.
 */
export function startDepositMonitor(intervalMs = 30000) {
  console.log(`[DepositMonitor] Starting (interval: ${intervalMs / 1000}s)`);

  // Run immediately, then on interval
  checkDeposits().catch(err => console.error('[DepositMonitor] Initial check failed:', err.message));
  const timer = setInterval(checkDeposits, intervalMs);
  return timer;
}

async function checkDeposits() {
  for (const currency of ['btc', 'bps', 'eth']) {
    try {
      if (currency === 'eth') {
        await checkEthDeposits();
      } else {
        await checkCurrencyDeposits(currency);
      }
    } catch (err) {
      // Don't crash the monitor on errors
      if (!err.message.includes('demo') && !err.message.includes('Cannot connect')) {
        console.error(`[DepositMonitor:${currency}] Error:`, err.message);
      }
    }
  }
}

async function checkEthDeposits() {
  const rpc = getRpc('eth');
  const db = getDb();

  // Get all active ETH deposit addresses
  const addresses = db.prepare(
    'SELECT address, user_id FROM deposit_addresses WHERE currency = ?'
  ).all('eth');

  for (const item of addresses) {
    try {
      // Use eth_getBalance
      const balanceHex = await rpc.ethCall('eth_getBalance', [item.address, 'latest']);
      const balanceEth = parseFloat(parseInt(balanceHex, 16) / 1e18);

      if (balanceEth > 0) {
        // Check if we've already credited this (simple check: current available balance vs this)
        // In a real app, you'd use a 'last_processed_balance' or individual tx IDs.
        // For this Hub, we'll check if a deposit with this amount/address exists.
        const existing = db.prepare(
          'SELECT id FROM deposits WHERE user_id = ? AND currency = ? AND address = ? AND amount = ?'
        ).get(item.user_id, 'eth', item.address, balanceEth);

        if (!existing) {
          const depositId = generateId();
          db.prepare(
            `INSERT INTO deposits (id, user_id, currency, amount, txid, confirmations, required_confirmations, status, address)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(depositId, item.user_id, 'eth', balanceEth, 'eth_' + Date.now().toString(36), 1, 1, 'credited', item.address);

          creditDeposit(db, depositId, item.user_id, 'eth', balanceEth);
          console.log(`[DepositMonitor:eth] Credited ${balanceEth} ETH to user ${item.user_id} at ${item.address}`);
        }
      }
    } catch (err) {
      // Ignore errors for individual addresses
    }
  }
}

async function checkCurrencyDeposits(currency) {
  const rpc = getRpc(currency);
  const db = getDb();

  // Get recent transactions from the node
  const transactions = await rpc.listTransactions('*', 100);

  if (!transactions || transactions.length === 0) return;

  // Filter for receives only
  const receives = transactions.filter(tx => tx.category === 'receive' && tx.amount > 0);

  for (const tx of receives) {
    // Check if this address belongs to a user
    const depositAddr = db.prepare(
      'SELECT * FROM deposit_addresses WHERE address = ? AND currency = ?'
    ).get(tx.address, currency);

    if (!depositAddr) continue; // Not our address

    // Check if we've already processed this txid
    const existingDeposit = db.prepare(
      'SELECT * FROM deposits WHERE txid = ? AND currency = ?'
    ).get(tx.txid, currency);

    if (existingDeposit) {
      // Update confirmations if not yet credited
      if (existingDeposit.status !== 'credited') {
        const confirmations = tx.confirmations || 0;
        db.prepare('UPDATE deposits SET confirmations = ? WHERE id = ?')
          .run(confirmations, existingDeposit.id);

        if (confirmations >= REQUIRED_CONFIRMATIONS[currency]) {
          // Credit the user's balance
          creditDeposit(db, existingDeposit.id, depositAddr.user_id, currency, existingDeposit.amount);
        }
      }
      continue;
    }

    // New deposit found
    const depositId = generateId();
    const confirmations = tx.confirmations || 0;
    const status = confirmations >= REQUIRED_CONFIRMATIONS[currency] ? 'credited' : 'confirming';

    db.prepare(
      `INSERT INTO deposits (id, user_id, currency, amount, txid, confirmations, required_confirmations, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(depositId, depositAddr.user_id, currency, tx.amount, tx.txid, confirmations, REQUIRED_CONFIRMATIONS[currency], status);

    if (status === 'credited') {
      creditDeposit(db, depositId, depositAddr.user_id, currency, tx.amount);
    }

    console.log(`[DepositMonitor:${currency}] New deposit: ${tx.amount} ${currency.toUpperCase()} for user ${depositAddr.user_id} (${confirmations} confs)`);
  }
}

function creditDeposit(db, depositId, userId, currency, amount) {
  const txn = db.transaction(() => {
    // Ensure balance row exists
    db.prepare(
      'INSERT OR IGNORE INTO balances (user_id, currency, available, locked) VALUES (?, ?, 0, 0)'
    ).run(userId, currency);

    // Credit balance
    db.prepare(
      'UPDATE balances SET available = available + ? WHERE user_id = ? AND currency = ?'
    ).run(amount, userId, currency);

    // Mark deposit as credited
    db.prepare('UPDATE deposits SET status = ? WHERE id = ?').run('credited', depositId);
  });

  txn();
  console.log(`[DepositMonitor] Credited ${amount} ${currency.toUpperCase()} to user ${userId}`);
}
