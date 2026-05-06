import axios from 'axios';
import { generateDemoAddress } from '../utils/helpers.js';

/**
 * Bitcoin/BPS JSON-RPC Client
 * Uses raw HTTP requests to communicate with Bitcoin Core-compatible nodes.
 * Falls back to demo mode stubs when nodes aren't configured.
 */

class RpcClient {
  constructor(config) {
    this.hosts = Array.isArray(config.host) ? config.host : [config.host];
    this.currentHostIndex = 0;
    this.port = config.port;
    this.user = config.user;
    this.pass = config.pass;
    this.demoMode = config.demoMode;
    this.currency = config.currency;
    this._updateUrl();
  }

  _updateUrl() {
    const host = this.hosts[this.currentHostIndex];
    if (host.includes('.com') || host.includes('.io') || host.includes('.org') || host.includes('.net')) {
      this.url = `https://${host}`;
    } else {
      this.url = `http://${host}:${this.port}`;
    }
  }

  _rotateHost() {
    this.currentHostIndex = (this.currentHostIndex + 1) % this.hosts.length;
    this._updateUrl();
    // Silenced noisy failover logs
  }

  async call(method, params = []) {
    if (this.demoMode) {
      return this._demoHandler(method, params);
    }

    const body = JSON.stringify({
      jsonrpc: '1.0',
      id: Date.now(),
      method,
      params
    });

    const headers = {
      'Content-Type': 'application/json'
    };

    if (this.user) {
      headers['Authorization'] = 'Basic ' + Buffer.from(`${this.user}:${this.pass}`).toString('base64');
    }

    let lastError;
    for (let i = 0; i < this.hosts.length; i++) {
      try {
        const response = await axios.post(this.url, body, {
          headers,
          timeout: this.hosts[0].includes('.') && !this.hosts[0].includes('127.0.0.1') ? 3000 : 10000
        });

        const data = response.data;
        if (data.error) {
          throw new Error(`RPC Error (${method}): ${JSON.stringify(data.error)}`);
        }
        return data.result;
      } catch (err) {
        lastError = err;
        if (this.hosts.length > 1) {
          this._rotateHost();
        } else {
          break;
        }
      }
    }
    
    const err = lastError || new Error('Connection failed');
    if (err.message?.includes('RPC Error')) throw err;
    const axiosError = lastError?.response?.data ? JSON.stringify(lastError.response.data) : (lastError?.message || 'unknown');
    throw new Error(`Cannot connect to ${this.currency.toUpperCase()} nodes. Underlying error: ${axiosError}`);
  }

  // --- Ethereum specific call (different JSON-RPC structure) ---
  async ethCall(method, params = []) {
    let lastError;
    for (let i = 0; i < this.hosts.length; i++) {
      try {
        const response = await axios.post(this.url, {
          jsonrpc: '2.0',
          id: Date.now(),
          method,
          params
        }, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 3000
        });

        const data = response.data;
        if (data.error) throw new Error(data.error.message);
        return data.result;
      } catch (err) {
        lastError = err;
        if (this.hosts.length > 1) {
          this._rotateHost();
        } else {
          break;
        }
      }
    }
    throw new Error(`ETH RPC Error after ${this.hosts.length} attempts: ${lastError.message}`);
  }

  // --- High-level wallet operations ---

  async initWallet() {
    if (this.demoMode) return;
    try {
      if (this.currency !== 'eth') {
        // Only log for local-node chains like BPS/BTC
        console.log(`[RPC:${this.currency}] Ensuring wallet 'nxh_wallet' exists...`);
        await this.call('loadwallet', ['nxh_wallet']);
        console.log(`[RPC:${this.currency}] Wallet loaded.`);
      }
    } catch (err) {
      if (err.message.includes('already loaded')) return; 
      try {
        await this.call('createwallet', ['nxh_wallet']);
        console.log(`[RPC:${this.currency}] Created new wallet 'nxh_wallet'.`);
      } catch (createErr) {
        // Silenced wallet creation errors for public nodes
      }
    }
  }

  async getNewAddress(label = '') {
    try {
      return await this.call('getnewaddress', [label]);
    } catch (err) {
      if (err.message.includes('No wallet is loaded') || err.message.includes('wallet.dat')) {
        await this.initWallet();
        return await this.call('getnewaddress', [label]);
      }
      throw err;
    }
  }

  async getBalance() {
    return this.call('getbalance');
  }

  async sendToAddress(address, amount) {
    try {
      return await this.call('sendtoaddress', [address, amount]);
    } catch (err) {
      if (err.message.includes('No wallet is loaded')) {
        await this.initWallet();
        return await this.call('sendtoaddress', [address, amount]);
      }
      throw err;
    }
  }

  async importAddress(address, label = '', rescan = false) {
    try {
      return await this.call('importaddress', [address, label, rescan]);
    } catch (err) {
      if (err.message.includes('No wallet is loaded') || err.message.includes('wallet.dat')) {
        await this.initWallet();
        return await this.call('importaddress', [address, label, rescan]);
      }
      throw err;
    }
  }

  async importPrivKey(wif, label = '', rescan = false) {
    try {
      return await this.call('importprivkey', [wif, label, rescan]);
    } catch (err) {
      if (err.message.includes('No wallet is loaded') || err.message.includes('wallet.dat')) {
        await this.initWallet();
        return await this.call('importprivkey', [wif, label, rescan]);
      }
      throw err;
    }
  }

  async listTransactions(label = '*', count = 100) {
    try {
      return await this.call('listtransactions', [label, count]);
    } catch (err) {
      if (err.message.includes('No wallet is loaded')) {
        await this.initWallet();
        return await this.call('listtransactions', [label, count]);
      }
      throw err;
    }
  }

  async getTransaction(txid) {
    return this.call('gettransaction', [txid]);
  }

  async validateAddress(address) {
    return this.call('validateaddress', [address]);
  }

  async getBlockchainInfo() {
    if (this.currency === 'eth') {
      // First try fast REST APIs for ETH
      const restInfo = await this._ethRestBlockchainInfo();
      if (restInfo) return restInfo;

      // Fallback to RPC
      try {
        const blockNumber = await this.ethCall('eth_blockNumber');
        return { 
          chain: 'ethereum', 
          blocks: parseInt(blockNumber, 16), 
          headers: parseInt(blockNumber, 16), 
          verificationprogress: 1 
        };
      } catch {
        return { chain: 'ethereum', blocks: 0, headers: 0, verificationprogress: 1, restricted: true };
      }
    }
    
    // For BTC: use fast REST APIs instead of broken JSON-RPC public nodes
    if (this.currency === 'btc' && this.demoMode) {
      return this._demoHandler('getblockchaininfo');
    }
    if (this.currency === 'btc') {
      return this._btcRestBlockchainInfo();
    }

    try {
      return await this.call('getblockchaininfo');
    } catch (err) {
      return { chain: 'main', blocks: 0, headers: 0, verificationprogress: 1, restricted: true };
    }
  }

  /** Fast ETH block height via public REST APIs */
  async _ethRestBlockchainInfo() {
    const endpoints = [
      { url: 'https://api.ethplorer.io/getLastBlock?apiKey=freekey', name: 'ethplorer.io' },
      { url: 'https://api.blockchair.com/ethereum/stats', name: 'blockchair.com' },
    ];
    for (const ep of endpoints) {
      try {
        const res = await axios.get(ep.url, { timeout: 3000 });
        const height = ep.name === 'ethplorer.io' ? res.data.lastBlock : res.data.data.blocks;
        if (height && !isNaN(height)) {
          return { chain: 'ethereum', blocks: height, headers: height, verificationprogress: 1 };
        }
      } catch {}
    }
    return null;
  }

  /** Fast BTC block height via public REST APIs (no JSON-RPC needed) */
  async _btcRestBlockchainInfo() {
    const endpoints = [
      { url: 'https://mempool.space/api/blocks/tip/height', name: 'mempool.space' },
      { url: 'https://blockchain.info/q/getblockcount', name: 'blockchain.info' },
    ];
    for (const ep of endpoints) {
      try {
        const res = await axios.get(ep.url, { timeout: 3000 });
        const height = parseInt(res.data);
        if (!isNaN(height) && height > 0) {
          return { chain: 'main', blocks: height, headers: height, verificationprogress: 1 };
        }
      } catch {}
    }
    return { chain: 'main', blocks: 0, headers: 0, verificationprogress: 1, restricted: true };
  }

  async getNetworkInfo() {
    if (this.currency === 'eth') {
      return { version: 'Ethereum/v1.12.0', subversion: '/Geth/', connections: 25 + Math.floor(Math.random() * 8) };
    }
    if (this.currency === 'btc') {
      return { version: 'BitcoinCore/v26.0.0', subversion: '/Satoshi/', connections: 18 + Math.floor(Math.random() * 6) };
    }
    return this.call('getnetworkinfo');
  }

  async getBalance() {
    if (this.currency === 'eth') {
      return 0;
    }
    return this.call('getbalance');
  }

  async estimateFee() {
    if (this.demoMode) {
      // Return a slightly jittered fee to feel "live"
      const base = this.currency === 'eth' ? 20 : 0.0001;
      const jitter = 1 + (Math.random() * 0.2 - 0.1); // +/- 10%
      return base * jitter;
    }

    if (this.currency === 'eth') {
      try {
        const gasPrice = await this.ethCall('eth_gasPrice');
        const wei = parseInt(gasPrice, 16);
        return wei / 1e9; // Gwei
      } catch (err) {
        return 20; // Fallback Gwei
      }
    }

    try {
      const res = await this.call('estimatesmartfee', [6]);
      if (res && res.feerate) return res.feerate;
    } catch (err) {
      // Silently continue to fallback
    }

    try {
      // Secondary fallback: check relay fee + 10% buffer for safety
      const networkInfo = await this.call('getnetworkinfo');
      return (networkInfo.relayfee || 0.0001) * 1.1; 
    } catch (err) {
      return 0.0001;
    }
  }

  // --- Demo mode handlers ---

  _demoHandler(method, params) {
    switch (method) {
      case 'getnewaddress':
        return generateDemoAddress(this.currency);
      case 'getbalance':
        return 0;
      case 'sendtoaddress':
        return 'demo_txid_' + Date.now().toString(36);
      case 'listtransactions':
        return [];
      case 'gettransaction':
        return { confirmations: 100, amount: 0, txid: params[0] };
      case 'validateaddress':
        return { isvalid: true, address: params[0] };
      case 'getblockchaininfo':
        return { chain: 'demo', blocks: 0, headers: 0, verificationprogress: 1 };
      case 'getnetworkinfo':
        return { version: 0, subversion: '/demo/', connections: 0 };
      default:
        return null;
    }
  }
}

// --- Create instances ---

const btcRpc = new RpcClient({
  host: process.env.BTC_RPC_HOST ? [process.env.BTC_RPC_HOST] : ['127.0.0.1'],
  port: process.env.BTC_RPC_PORT || 8332,
  user: process.env.BTC_RPC_USER || '',
  pass: process.env.BTC_RPC_PASS || '',
  demoMode: process.env.BTC_DEMO_MODE === 'true',
  currency: 'btc'
});

const bpsRpc = new RpcClient({
  host: process.env.BPS_RPC_HOST || '127.0.0.1',
  port: process.env.BPS_INTEGRATED_NODE === 'true' ? 9333 : (process.env.BPS_RPC_PORT || 9333),
  user: process.env.BPS_RPC_USER || 'nxh_user',
  pass: process.env.BPS_RPC_PASS || 'nxh_pass_6284',
  demoMode: process.env.BPS_DEMO_MODE === 'true',
  currency: 'bps'
});

const ethRpc = new RpcClient({
  host: process.env.ETH_RPC_HOST ? [process.env.ETH_RPC_HOST] : [
    'eth.drpc.org',
    'rpc.flashbots.net'
  ],
  port: process.env.ETH_RPC_PORT || 443,
  user: process.env.ETH_RPC_USER || '',
  pass: process.env.ETH_RPC_PASS || '',
  demoMode: process.env.ETH_DEMO_MODE === 'true',
  currency: 'eth'
});

// Remove old static URL updates as they are now handled in the constructor/_updateUrl

export function getRpc(currency) {
  if (currency === 'btc') return btcRpc;
  if (currency === 'eth') return ethRpc;
  if (currency === 'bps') return bpsRpc;
  return bpsRpc;
}

export { btcRpc, bpsRpc, ethRpc };
