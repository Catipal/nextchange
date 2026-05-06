import { ethers } from 'ethers';

/**
 * Ethereum Wallet Utility
 * Handles connection to browser wallets (MetaMask) and local HD wallets.
 */

// Default public RPC for Ethereum Mainnet (can be changed to Sepolia for testing)
const DEFAULT_RPC = 'https://cloudflare-eth.com';

class EthWalletService {
  constructor() {
    this.provider = null;
    this.signer = null;
    this.address = null;
    this.type = null; // 'browser' or 'local'
  }

  /**
   * Get an RPC provider (non-signer)
   */
  getRpcProvider() {
    return new ethers.JsonRpcProvider(DEFAULT_RPC);
  }

  /**
   * Connect to a browser wallet (MetaMask)
   */
  async connectBrowser() {
    if (typeof window === 'undefined' || !window.ethereum) {
      throw new Error('MetaMask or a Web3 browser wallet was not detected.');
    }

    try {
      this.provider = new ethers.BrowserProvider(window.ethereum);
      this.signer = await this.provider.getSigner();
      this.address = await this.signer.getAddress();
      this.type = 'browser';
      
      return {
        address: this.address,
        type: this.type
      };
    } catch (err) {
      console.error('[EthWallet] Browser connection failed:', err);
      throw new Error('Failed to connect to browser wallet.');
    }
  }

  /**
   * Initialize a local wallet from a mnemonic or private key
   */
  async connectLocal(secret, isMnemonic = true) {
    try {
      this.provider = this.getRpcProvider();
      let wallet;
      if (isMnemonic) {
        wallet = ethers.Wallet.fromPhrase(secret, this.provider);
      } else {
        wallet = new ethers.Wallet(secret, this.provider);
      }
      this.signer = wallet;
      this.address = wallet.address;
      this.type = 'local';

      return {
        address: this.address,
        type: this.type
      };
    } catch (err) {
      console.error('[EthWallet] Local initialization failed:', err);
      throw new Error(isMnemonic ? 'Invalid mnemonic phrase.' : 'Invalid private key.');
    }
  }

  /**
   * Fetch ETH balance for an address
   */
  async getBalance(address = this.address) {
    if (!address) return '0';
    try {
      const provider = this.provider || this.getRpcProvider();
      const balance = await provider.getBalance(address);
      return ethers.formatEther(balance);
    } catch (err) {
      console.error('[EthWallet] Failed to fetch balance:', err);
      return '0';
    }
  }

  /**
   * Send ETH to an address
   */
  async sendEth(to, amount) {
    if (!this.signer) throw new Error('Wallet not connected.');
    
    try {
      const tx = await this.signer.sendTransaction({
        to,
        value: ethers.parseEther(amount.toString())
      });
      return tx;
    } catch (err) {
      console.error('[EthWallet] Transaction failed:', err);
      throw err;
    }
  }

  /**
   * Disconnect/Reset
   */
  disconnect() {
    this.provider = null;
    this.signer = null;
    this.address = null;
    this.type = null;
  }
}

export const ethWallet = new EthWalletService();
export default ethWallet;
