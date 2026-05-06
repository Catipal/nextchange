import React, { useState, useEffect } from 'react';
import { Wallet, ArrowDownToLine, ArrowUpFromLine, Copy, Check, Clock, RefreshCw } from 'lucide-react';
import { useExchange } from '../context/ExchangeContext';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import ethWallet from '../utils/eth-wallet';
import { deriveSecondaryKey, toHubAddress } from '../crypto/wallet';

export default function WalletPage() {
  const { balances, fetchBalances, allTickers } = useExchange();
  const { isAuthenticated, user, privateKeyHex, formatPublicKey } = useAuth();

  const getPrice = (pair) => {
    const ticker = allTickers?.find(t => t.pair === pair);
    if (!ticker) return 0;
    
    // 1. Try last trade price
    if (ticker.lastPrice) return parseFloat(ticker.lastPrice);
    
    // 2. If no trades, try mid-price from orderbook
    if (ticker.bestBid && ticker.bestAsk) {
      return (parseFloat(ticker.bestBid) + parseFloat(ticker.bestAsk)) / 2;
    }
    
    // 3. Fallback to whichever side of the book exists
    return parseFloat(ticker.bestBid || ticker.bestAsk || 0);
  };

  const btcPrice = getPrice('BTC/BPS');
  const ethPrice = getPrice('ETH/BPS');

  const totalValueBps = (
    (balances.bps?.available || 0) + (balances.bps?.locked || 0)) +
    ((balances.btc?.available || 0) + (balances.btc?.locked || 0)) * btcPrice +
    ((balances.eth?.available || 0) + (balances.eth?.locked || 0)) * ethPrice;

  const [activeTab, setActiveTab] = useState('deposit');
  const [activeCurrency, setActiveCurrency] = useState('bps');

  // Deposit state
  const [depositAddress, setDepositAddress] = useState('');
  const [loadingAddress, setLoadingAddress] = useState(false);
  const [copied, setCopied] = useState(false);

  // Demo deposit state
  const [demoAmount, setDemoAmount] = useState('');
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoMessage, setDemoMessage] = useState(null);

  // Withdraw state
  const [withdrawAddress, setWithdrawAddress] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [withdrawMessage, setWithdrawMessage] = useState(null);

  // History
  const [transactions, setTransactions] = useState([]);

  // Sync state
  const [bpsSync, setBpsSync] = useState({ status: 'offline' });
  const [btcSync, setBtcSync] = useState({ status: 'offline' });
  const [ethSync, setEthSync] = useState({ status: 'offline' });

  // Ethereum Wallet State
  const [ethConnection, setEthConnection] = useState({
    address: null,
    balance: '0',
    type: null,
    loading: false,
    error: null
  });

  const [transferAmount, setTransferAmount] = useState('');
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferMessage, setTransferMessage] = useState(null);

  // P2P Send state
  const [p2pRecipient, setP2pRecipient] = useState('');
  const [p2pAmount, setP2pAmount] = useState('');
  const [p2pCurrency, setP2pCurrency] = useState('bps');
  const [p2pLoading, setP2pLoading] = useState(false);
  const [p2pMessage, setP2pMessage] = useState(null);

  // Secondary Identity Address
  const [secondaryAddress, setSecondaryAddress] = useState(() => localStorage.getItem('nxh_secondary_address') || '');
  const [generatingSecondary, setGeneratingSecondary] = useState(false);

  // Vault settlements state
  const [userSettlements, setUserSettlements] = useState([]);

  // Real-time network fees (initial 0 to detect first fetch)
  const [networkFees, setNetworkFees] = useState({ btc: 0, bps: 0, eth: 0 });
  const [lastFeeUpdate, setLastFeeUpdate] = useState(null);
  const [fetchingFees, setFetchingFees] = useState(false);

  const fetchFees = async () => {
    setFetchingFees(true);
    try {
      const res = await api.get('/wallet/fees');
      if (res.data && (res.data.btc || res.data.bps)) {
        setNetworkFees(res.data);
        setLastFeeUpdate(res.data._timestamp);
      }
    } catch (err) {
      console.error('[Wallet] Fee fetch failed:', err.message);
    }
    setFetchingFees(false);
  };

  useEffect(() => {
    fetchDepositAddress();
    fetchTransactions();

    // Initial fetch for sync and fees
    fetchSyncStatus();
    fetchFees();

    // If we have an active ETH connection, refresh balance
    if (ethConnection.address) {
      refreshEthBalance();
    }

    const interval = setInterval(() => {
      fetchSyncStatus();
      fetchVaultSettlements();
      fetchFees();
      if (ethConnection.address) refreshEthBalance();
    }, 15000); // Poll every 15s
    return () => clearInterval(interval);
  }, [activeCurrency, ethConnection.address]);

  const fetchVaultSettlements = async () => {
    try {
      const res = await api.get('/network/vault');
      if (res.data.settlements) {
        // Filter settlements for this user (in a real app, the server would filter)
        // Here we just show active ones
        setUserSettlements(res.data.settlements);
      }
    } catch (err) { /* silent */ }
  };

  // Handle native wallet auto-connection
  useEffect(() => {
    if (isAuthenticated && privateKeyHex && !ethConnection.address) {
      handleConnectEth('native');
    }
  }, [isAuthenticated, privateKeyHex]);

  const refreshEthBalance = async () => {
    try {
      const balance = await ethWallet.getBalance();
      setEthConnection(prev => ({ ...prev, balance }));
    } catch (err) { /* silent */ }
  };

  const handleConnectEth = async () => {
    setEthConnection(prev => ({ ...prev, loading: true, error: null }));
    try {
      if (!privateKeyHex) throw new Error('Native wallet not unlocked.');
      // Use the Hub's private key as an Ethereum key
      const res = await ethWallet.connectLocal(privateKeyHex, false);
      const balance = await ethWallet.getBalance(res.address);
      setEthConnection({
        address: res.address,
        type: 'Native',
        balance,
        loading: false,
        error: null
      });
    } catch (err) {
      setEthConnection(prev => ({ ...prev, loading: false, error: err.message }));
    }
  };


  const handleTransferToHub = async () => {
    if (!transferAmount || !depositAddress) return;
    setTransferLoading(true);
    setTransferMessage(null);
    try {
      const tx = await ethWallet.sendEth(depositAddress, transferAmount);
      setTransferMessage({
        type: 'success',
        text: `Transfer submitted! Hash: ${tx.hash.slice(0, 10)}...`
      });
      setTransferAmount('');
    } catch (err) {
      setTransferMessage({ type: 'error', text: err.message || 'Transfer failed' });
    }
    setTransferLoading(false);
  };

  const handleP2pSend = async () => {
    if (!p2pRecipient || !p2pAmount) return;
    setP2pLoading(true);
    setP2pMessage(null);
    try {
      await api.post('/wallet/transfer', {
        currency: p2pCurrency,
        amount: parseFloat(p2pAmount),
        recipientAddress: p2pRecipient
      });
      setP2pMessage({ type: 'success', text: `Sent ${p2pAmount} ${p2pCurrency.toUpperCase()} to ${p2pRecipient.slice(0, 8)}... (Fee: 0.00)` });
      setP2pAmount('');
      setP2pRecipient('');
      fetchBalances();
      fetchTransactions();
    } catch (err) {
      setP2pMessage({ type: 'error', text: err.response?.data?.error || 'Transfer failed' });
    }
    setP2pLoading(false);
  };

  const handleGenerateSecondary = async () => {
    if (!privateKeyHex) {
      console.warn('[Wallet] Cannot generate secondary identity: Wallet is locked.');
      return;
    }
    setGeneratingSecondary(true);
    try {
      // Increment index or start at 1
      const currentIndex = parseInt(localStorage.getItem('nxh_secondary_index') || '0') + 1;
      console.log(`[Wallet] Deriving secondary identity at index ${currentIndex}...`);

      const { publicKeyHex } = await deriveSecondaryKey(privateKeyHex, currentIndex);
      console.log(`[Wallet] Derived: ${publicKeyHex.slice(0, 12)}...`);

      setSecondaryAddress(publicKeyHex);
      localStorage.setItem('nxh_secondary_address', publicKeyHex);
      localStorage.setItem('nxh_secondary_index', currentIndex.toString());

      // Also register this address with the server
      console.log(`[Wallet] Registering secondary identity on network...`);
      await api.post('/auth/register', { publicKey: publicKeyHex, isSecondary: true });

      console.log(`[Wallet] Secondary identity active.`);
    } catch (err) {
      console.error('[Wallet] Failed to generate secondary identity:', err);
      // Fallback: show error in p2pMessage or similar if needed
    } finally {
      setGeneratingSecondary(false);
    }
  };

  const fetchSyncStatus = async () => {
    try {
      const res = await api.get('/network/status');
      if (res.data.bpsNode) setBpsSync(res.data.bpsNode);
      if (res.data.btcNode) setBtcSync(res.data.btcNode);
      if (res.data.ethNode) {
        // console.log('[Wallet] ETH Sync Data:', res.data.ethNode);
        setEthSync(res.data.ethNode);
      }
    } catch (err) { /* silent */ }
  };

  const fetchDepositAddress = async (forceNew = false) => {
    setLoadingAddress(true);
    setCopied(false);
    try {
      const url = forceNew ? `/wallet/deposit-address/${activeCurrency}?new=true` : `/wallet/deposit-address/${activeCurrency}`;
      const res = await api.get(url);
      setDepositAddress(res.data.address);
    } catch (err) {
      setDepositAddress('Error loading address');
    }
    setLoadingAddress(false);
  };

  const fetchTransactions = async () => {
    try {
      const res = await api.get('/wallet/transactions');
      setTransactions(res.data);
    } catch (err) { /* silent */ }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(depositAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDemoDeposit = async () => {
    const num = parseFloat(demoAmount);
    if (!num || num <= 0) return;
    setDemoLoading(true);
    setDemoMessage(null);
    try {
      await api.post('/wallet/demo-deposit', { currency: activeCurrency, amount: num });
      setDemoMessage({ type: 'success', text: `Deposited ${num} ${activeCurrency.toUpperCase()} (demo)` });
      setDemoAmount('');
      fetchBalances();
      fetchTransactions();
    } catch (err) {
      setDemoMessage({ type: 'error', text: err.response?.data?.error || 'Failed' });
    }
    setDemoLoading(false);
  };

  const handleWithdraw = async () => {
    const num = parseFloat(withdrawAmount);
    if (!num || num <= 0 || !withdrawAddress) return;
    setWithdrawLoading(true);
    setWithdrawMessage(null);
    try {
      await api.post('/wallet/withdraw', { currency: activeCurrency, amount: num, address: withdrawAddress });
      setWithdrawMessage({ type: 'success', text: `Withdrawal of ${num} ${activeCurrency.toUpperCase()} submitted` });
      setWithdrawAmount('');
      setWithdrawAddress('');
      fetchBalances();
      fetchTransactions();
    } catch (err) {
      setWithdrawMessage({ type: 'error', text: err.response?.data?.error || 'Withdrawal failed' });
    }
    setWithdrawLoading(false);
  };

  const withdrawFee = activeCurrency === 'eth' 
    ? (networkFees.eth * 21000 / 1e9) // Convert Gwei to ETH for a basic transfer
    : (networkFees[activeCurrency] * 0.25 || 0.0001); // Standard tx is ~250 bytes (0.25 KB)

  return (
    <div className="flex-1 h-full overflow-y-auto scrollbar-hide">
      <div className="max-w-6xl mx-auto p-6 w-full space-y-8">
        {/* Hub Identity Card */}
        <div className="relative overflow-hidden bg-gradient-to-br from-[var(--bg-secondary)] to-[var(--bg-primary)] rounded-3xl border border-[var(--border-color)] p-8 shadow-2xl group">
          {/* Animated Background Glow */}
          <div className="absolute -top-24 -right-24 w-64 h-64 bg-[var(--accent-color)]/5 blur-[80px] rounded-full group-hover:bg-[var(--accent-color)]/10 transition-all duration-1000" />
          <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-[#627EEA]/5 blur-[80px] rounded-full group-hover:bg-[#627EEA]/10 transition-all duration-1000" />

          <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
            <div className="flex items-center gap-6">
              <div className="w-20 h-20 bg-gradient-to-tr from-[var(--accent-color)] to-[#0ECB81] rounded-2xl flex items-center justify-center shadow-lg shadow-[var(--accent-color)]/10">
                <Wallet className="w-10 h-10 text-black" />
              </div>
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <h2 className="text-2xl font-black tracking-tight text-[var(--text-primary)]">Hub Identity</h2>
                  <div className="px-3 py-1 bg-[var(--accent-color)]/20 border border-[var(--accent-color)]/30 rounded-full">
                    <span className="text-[10px] font-black text-[var(--accent-color)] uppercase tracking-widest">ID: {user?.id}</span>
                  </div>
                </div>
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-[var(--text-secondary)] uppercase font-bold opacity-50 mb-1">Hub Network Address (Raw)</span>
                    <div className="flex items-center gap-3">
                      <code className="text-xl font-mono text-[var(--text-primary)] font-black bg-[var(--bg-primary)]/50 px-4 py-2 rounded-lg border border-[var(--border-color)]/50 break-all max-w-[400px]">
                        {user?.publicKey}
                      </code>
                      <button
                        onClick={() => { navigator.clipboard.writeText(user?.publicKey); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                        className="p-2 hover:bg-[var(--bg-tertiary)] rounded-md transition-colors text-[var(--text-secondary)]"
                      >
                        {copied ? <Check className="w-5 h-5 text-[#0ECB81]" /> : <Copy className="w-5 h-5" />}
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col pt-2 border-t border-[var(--border-color)]/30">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-[var(--text-secondary)] uppercase font-bold opacity-50">Secondary Address (Privacy)</span>
                      {!privateKeyHex ? (
                        <span className="text-[9px] text-[#F6465D] font-bold uppercase tracking-tighter">Wallet Locked</span>
                      ) : (
                        <button
                          onClick={handleGenerateSecondary}
                          disabled={generatingSecondary}
                          className="text-[10px] font-bold text-[var(--accent-color)] hover:underline flex items-center gap-1 disabled:opacity-50"
                        >
                          <RefreshCw className={`w-3 h-3 ${generatingSecondary ? 'animate-spin' : ''}`} />
                          {secondaryAddress ? 'Rotate Identity' : 'Generate Identity'}
                        </button>
                      )}
                    </div>
                    {secondaryAddress ? (
                      <div className="flex items-center gap-3">
                        <code className="text-sm font-mono text-[var(--accent-color)] bg-[var(--bg-primary)]/30 px-3 py-1.5 rounded-lg border border-[var(--accent-color)]/20 break-all max-w-[400px]">
                          {toHubAddress(secondaryAddress)}
                        </code>
                        <button
                          onClick={() => { navigator.clipboard.writeText(toHubAddress(secondaryAddress)); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                          className="p-1.5 hover:bg-[var(--bg-tertiary)] rounded-md transition-colors text-[var(--text-secondary)]"
                        >
                          {copied ? <Check className="w-4 h-4 text-[#0ECB81]" /> : <Copy className="w-4 h-4" />}
                        </button>
                      </div>
                    ) : (
                      <div className="text-[10px] text-[var(--text-secondary)] italic opacity-40">No secondary address generated yet</div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col items-end">
              <p className="text-xs uppercase tracking-[0.2em] font-bold text-[var(--text-secondary)] mb-1 opacity-60">Network Value</p>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-black text-[var(--text-primary)] tabular-nums">
                  {totalValueBps.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </span>
                <span className="text-lg font-bold text-[var(--accent-color)]">BPS</span>
              </div>
            </div>
          </div>

          <div className="mt-8 flex gap-4">
            <button
              onClick={() => setActiveTab('send')}
              className="px-6 py-2.5 bg-[var(--text-primary)] text-[var(--bg-primary)] font-black rounded-xl text-sm hover:scale-[1.02] active:scale-95 transition-all shadow-xl shadow-black/20"
            >
              Send on Network
            </button>
            <button
              onClick={() => setActiveTab('deposit')}
              className="px-6 py-2.5 bg-[var(--bg-tertiary)] text-[var(--text-primary)] font-black rounded-xl border border-[var(--border-color)] text-sm hover:bg-[var(--border-color)] transition-all"
            >
              Receive Assets
            </button>
          </div>
        </div>

        {/* Balance Cards */}
        <div className="grid grid-cols-3 gap-6">
          {/* BTC Card */}
          <div
            className={`relative overflow-hidden rounded-2xl border cursor-pointer transition-all duration-300 ${activeCurrency === 'btc' ? 'border-[#F7931A]/50 shadow-[0_0_30px_rgba(247,147,26,0.12)]' : 'border-[var(--border-color)] hover:border-[#F7931A]/30'}`}
            onClick={() => setActiveCurrency('btc')}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-[#F7931A]/8 via-[var(--bg-secondary)] to-[var(--bg-secondary)]" />
            <div className="absolute top-0 right-0 w-32 h-32 bg-[#F7931A]/5 blur-3xl rounded-full pointer-events-none" />
            {activeCurrency === 'btc' && <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#F7931A] to-transparent" />}
            <div className="relative p-5">
              <div className="flex items-start justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#F7931A]/20 to-[#F7931A]/5 border border-[#F7931A]/20 flex items-center justify-center">
                    <span className="text-[#F7931A] font-black text-xl">₿</span>
                  </div>
                  <div>
                    <h3 className="font-black text-[var(--text-primary)] text-sm">Bitcoin</h3>
                    <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest opacity-60">BTC Network</p>
                  </div>
                </div>
                {btcSync && (
                  <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-black uppercase ${btcSync.status === 'running' ? 'bg-[#0ECB81]/10 border-[#0ECB81]/30 text-[#0ECB81]' : 'bg-[#F6465D]/10 border-[#F6465D]/30 text-[#F6465D]'}`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${btcSync.status === 'running' ? 'bg-[#0ECB81]' : 'bg-[#F6465D]'}`} />
                    {btcSync.status === 'running' ? (btcSync.blockchain?.verificationprogress > 0.999 ? 'Live' : `${((btcSync.blockchain?.verificationprogress || 0) * 100).toFixed(0)}%`) : 'Offline'}
                  </div>
                )}
              </div>
              <div className="mb-4">
                <p className="text-[10px] text-[var(--text-secondary)] uppercase font-bold tracking-widest opacity-50 mb-1">Total Balance</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-black text-[var(--text-primary)] tabular-nums leading-none">
                    {((balances.btc?.available || 0) + (balances.btc?.locked || 0)).toFixed(6)}
                  </span>
                  <span className="text-sm font-bold text-[#F7931A]">BTC</span>
                </div>
              </div>
              {(() => {
                const total = (balances.btc?.available || 0) + (balances.btc?.locked || 0);
                const pct = total > 0 ? ((balances.btc?.available || 0) / total) * 100 : 100;
                return (
                  <div className="mb-4 h-1 w-full bg-[var(--bg-primary)] rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-[#F7931A] to-[#F7931A]/50 rounded-full transition-all duration-700" style={{ width: `${pct}%` }} />
                  </div>
                );
              })()}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-[var(--text-secondary)] opacity-70">Available</span>
                  <span className="font-mono text-xs font-bold text-[var(--text-primary)]">{(balances.btc?.available || 0).toFixed(8)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-[var(--text-secondary)] opacity-70">In Orders</span>
                  <span className="font-mono text-xs text-[var(--text-secondary)]/60">{(balances.btc?.locked || 0).toFixed(8)}</span>
                </div>
                {btcSync?.status === 'running' && btcSync.network && (
                  <div className="flex justify-between items-center pt-1.5 border-t border-[var(--border-color)]/40">
                    <span className="text-[10px] text-[var(--text-secondary)] opacity-50 uppercase font-bold tracking-wide">Nodes</span>
                    <span className="text-[10px] font-black text-[#F7931A]">{btcSync.network.connections || 0} Active</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ETH Card */}
          <div
            className={`relative overflow-hidden rounded-2xl border cursor-pointer transition-all duration-300 ${activeCurrency === 'eth' ? 'border-[#627EEA]/50 shadow-[0_0_30px_rgba(98,126,234,0.12)]' : 'border-[var(--border-color)] hover:border-[#627EEA]/30'}`}
            onClick={() => setActiveCurrency('eth')}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-[#627EEA]/8 via-[var(--bg-secondary)] to-[var(--bg-secondary)]" />
            <div className="absolute top-0 right-0 w-32 h-32 bg-[#627EEA]/5 blur-3xl rounded-full pointer-events-none" />
            {activeCurrency === 'eth' && <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#627EEA] to-transparent" />}
            <div className="relative p-5">
              <div className="flex items-start justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#627EEA]/20 to-[#627EEA]/5 border border-[#627EEA]/20 flex items-center justify-center">
                    <span className="text-[#627EEA] font-black text-xl">Ξ</span>
                  </div>
                  <div>
                    <h3 className="font-black text-[var(--text-primary)] text-sm">Ethereum</h3>
                    <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest opacity-60">ETH Network</p>
                  </div>
                </div>
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-black uppercase ${(ethSync?.status || 'offline') === 'running' ? 'bg-[#0ECB81]/10 border-[#0ECB81]/30 text-[#0ECB81]' : 'bg-[#F6465D]/10 border-[#F6465D]/30 text-[#F6465D]'}`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${(ethSync?.status || 'offline') === 'running' ? 'bg-[#0ECB81]' : 'bg-[#F6465D]'}`} />
                  {(ethSync?.status || 'offline') === 'running' ? 'Live' : 'Offline'}
                </div>
              </div>
              <div className="mb-4">
                <p className="text-[10px] text-[var(--text-secondary)] uppercase font-bold tracking-widest opacity-50 mb-1">Total Balance</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-black text-[var(--text-primary)] tabular-nums leading-none">
                    {((balances.eth?.available || 0) + (balances.eth?.locked || 0)).toFixed(6)}
                  </span>
                  <span className="text-sm font-bold text-[#627EEA]">ETH</span>
                </div>
              </div>
              {(() => {
                const total = (balances.eth?.available || 0) + (balances.eth?.locked || 0);
                const pct = total > 0 ? ((balances.eth?.available || 0) / total) * 100 : 100;
                return (
                  <div className="mb-4 h-1 w-full bg-[var(--bg-primary)] rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-[#627EEA] to-[#627EEA]/50 rounded-full transition-all duration-700" style={{ width: `${pct}%` }} />
                  </div>
                );
              })()}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-[var(--text-secondary)] opacity-70">Available</span>
                  <span className="font-mono text-xs font-bold text-[var(--text-primary)]">{(balances.eth?.available || 0).toFixed(8)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-[var(--text-secondary)] opacity-70">In Orders</span>
                  <span className="font-mono text-xs text-[var(--text-secondary)]/60">{(balances.eth?.locked || 0).toFixed(8)}</span>
                </div>
                <div className="flex justify-between items-center pt-1.5 border-t border-[var(--border-color)]/40">
                  <span className="text-[10px] text-[var(--text-secondary)] opacity-50 uppercase font-bold tracking-wide">Nodes</span>
                  <span className="font-mono text-[10px] font-black text-[#627EEA]">
                    {(ethSync?.status || 'offline') === 'running' ? `${ethSync.network?.connections || 0} Active` : 'Offline'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* BPS Card */}
          <div
            className={`relative overflow-hidden rounded-2xl border cursor-pointer transition-all duration-300 ${activeCurrency === 'bps' ? 'border-[#0ECB81]/50 shadow-[0_0_30px_rgba(14,203,129,0.12)]' : 'border-[var(--border-color)] hover:border-[#0ECB81]/30'}`}
            onClick={() => setActiveCurrency('bps')}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-[#0ECB81]/8 via-[var(--bg-secondary)] to-[var(--bg-secondary)]" />
            <div className="absolute top-0 right-0 w-32 h-32 bg-[#0ECB81]/5 blur-3xl rounded-full pointer-events-none" />
            {activeCurrency === 'bps' && <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[#0ECB81] to-transparent" />}
            <div className="relative p-5">
              <div className="flex items-start justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#0ECB81]/20 to-[#0ECB81]/5 border border-[#0ECB81]/20 flex items-center justify-center">
                    <span className="text-[#0ECB81] font-black text-xl">Ƀ</span>
                  </div>
                  <div>
                    <h3 className="font-black text-[var(--text-primary)] text-sm">BitcoinPoS</h3>
                    <p className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest opacity-60">BPS Network</p>
                  </div>
                </div>
                {bpsSync && bpsSync.status === 'running' && (
                  <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-black uppercase ${bpsSync.blockchain?.verificationprogress > 0.999 ? 'bg-[#0ECB81]/10 border-[#0ECB81]/30 text-[#0ECB81]' : 'bg-[var(--accent-color)]/10 border-[var(--accent-color)]/30 text-[var(--accent-color)]'}`}>
                    <div className={`w-1.5 h-1.5 rounded-full ${bpsSync.blockchain?.verificationprogress > 0.999 ? 'bg-[#0ECB81]' : 'bg-[var(--accent-color)] animate-pulse'}`} />
                    {bpsSync.blockchain?.verificationprogress > 0.999 ? 'Live' : `${((bpsSync.blockchain?.verificationprogress || 0) * 100).toFixed(0)}%`}
                  </div>
                )}
              </div>
              <div className="mb-4">
                <p className="text-[10px] text-[var(--text-secondary)] uppercase font-bold tracking-widest opacity-50 mb-1">Total Balance</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-black text-[var(--text-primary)] tabular-nums leading-none">
                    {((balances.bps?.available || 0) + (balances.bps?.locked || 0)).toFixed(4)}
                  </span>
                  <span className="text-sm font-bold text-[#0ECB81]">BPS</span>
                </div>
              </div>
              {(() => {
                const total = (balances.bps?.available || 0) + (balances.bps?.locked || 0);
                const pct = total > 0 ? ((balances.bps?.available || 0) / total) * 100 : 100;
                return (
                  <div className="mb-4 h-1 w-full bg-[var(--bg-primary)] rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-[#0ECB81] to-[#0ECB81]/50 rounded-full transition-all duration-700" style={{ width: `${pct}%` }} />
                  </div>
                );
              })()}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-[var(--text-secondary)] opacity-70">Available</span>
                  <span className="font-mono text-xs font-bold text-[var(--text-primary)]">{(balances.bps?.available || 0).toFixed(8)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-[var(--text-secondary)] opacity-70">In Orders</span>
                  <span className="font-mono text-xs text-[var(--text-secondary)]/60">{(balances.bps?.locked || 0).toFixed(8)}</span>
                </div>
                {bpsSync?.network && (
                  <div className="flex justify-between items-center pt-1.5 border-t border-[var(--border-color)]/40">
                    <span className="text-[10px] text-[var(--text-secondary)] opacity-50 uppercase font-bold tracking-wide">Peers</span>
                    <span className="text-[10px] font-black text-[#0ECB81]">{bpsSync.network.connections} Active</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Action Tabs */}
        <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-color)] overflow-hidden transition-colors">
          <div className="flex border-b border-[var(--border-color)]">
            <button
              onClick={() => setActiveTab('deposit')}
              className={`flex-1 py-3 text-sm font-bold flex items-center justify-center gap-2 transition-colors ${activeTab === 'deposit' ? 'bg-[var(--bg-tertiary)] text-[var(--accent-color)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
            >
              <ArrowDownToLine className="w-4 h-4" /> Deposit
            </button>
            <button
              onClick={() => setActiveTab('withdraw')}
              className={`flex-1 py-3 text-sm font-bold flex items-center justify-center gap-2 transition-colors ${activeTab === 'withdraw' ? 'bg-[var(--bg-tertiary)] text-[var(--accent-color)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
            >
              <ArrowUpFromLine className="w-4 h-4" /> Withdraw
            </button>
            <button
              onClick={() => setActiveTab('send')}
              className={`flex-1 py-3 text-sm font-bold flex items-center justify-center gap-2 transition-colors ${activeTab === 'send' ? 'bg-[var(--bg-tertiary)] text-[var(--accent-color)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
            >
              <ArrowUpFromLine className="w-4 h-4 text-[var(--accent-color)]" /> Network Send
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`flex-1 py-3 text-sm font-bold flex items-center justify-center gap-2 transition-colors ${activeTab === 'history' ? 'bg-[var(--bg-tertiary)] text-[var(--accent-color)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
            >
              <Clock className="w-4 h-4" /> History
            </button>
          </div>

          <div className="p-6">
            {/* Network Send Tab */}
            {activeTab === 'send' && (
              <div className="space-y-6">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-lg font-bold text-[var(--text-primary)]">
                      Send on Hub Network
                    </h3>
                    <span className="px-1.5 py-0.5 rounded bg-[#0ECB81]/10 text-[#0ECB81] text-[10px] font-black uppercase tracking-tighter">
                      Free Transfer
                    </span>
                  </div>
                  <p className="text-sm text-[var(--text-secondary)]">
                    Instantly transfer assets to another Hub Identity. Fees are covered by network liquidity providers.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-[var(--text-secondary)] mb-1.5 block">Asset</label>
                    <select
                      value={p2pCurrency}
                      onChange={(e) => setP2pCurrency(e.target.value)}
                      className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-4 py-3 text-[var(--text-primary)] font-bold text-sm focus:outline-none focus:border-[var(--accent-color)] transition-colors"
                    >
                      <option value="bps">BitcoinPoS (BPS)</option>
                      <option value="btc">Bitcoin (BTC)</option>
                      <option value="eth">Ethereum (ETH)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-[var(--text-secondary)] mb-1.5 block">Amount</label>
                    <input
                      type="number"
                      value={p2pAmount}
                      onChange={(e) => setP2pAmount(e.target.value)}
                      className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-4 py-3 text-[var(--text-primary)] font-mono text-sm focus:outline-none focus:border-[var(--accent-color)] transition-colors"
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs text-[var(--text-secondary)] mb-1.5 block">Recipient Hub ID or Public Key</label>
                  <input
                    type="text"
                    value={p2pRecipient}
                    onChange={(e) => setP2pRecipient(e.target.value)}
                    className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-4 py-3 text-[var(--text-primary)] font-mono text-sm focus:outline-none focus:border-[var(--accent-color)] transition-colors"
                    placeholder="Paste Hub ID or PubKey"
                  />
                </div>

                <div className="bg-[var(--accent-color)]/5 rounded-lg p-4 border border-[var(--accent-color)]/20 flex justify-between items-center">
                  <span className="text-sm text-[var(--text-secondary)]">Network Fee (Subsidized)</span>
                  <span className="font-mono text-[#0ECB81] font-black">0.00 {p2pCurrency.toUpperCase()}</span>
                </div>

                {p2pMessage && (
                  <div className={`text-sm p-3 rounded ${p2pMessage.type === 'success' ? 'bg-[#0ECB81]/10 text-[#0ECB81] border border-[#0ECB81]/30' : 'bg-[#F6465D]/10 text-[#F6465D] border border-[#F6465D]/30'}`}>
                    {p2pMessage.text}
                  </div>
                )}

                <button
                  onClick={handleP2pSend}
                  disabled={p2pLoading || !p2pAmount || !p2pRecipient}
                  className="w-full py-4 bg-[var(--accent-color)] text-black font-black rounded-xl hover:scale-[1.01] active:scale-95 transition-all disabled:opacity-50 text-sm uppercase tracking-widest shadow-xl shadow-[var(--accent-color)]/10"
                >
                  {p2pLoading ? 'Broadcasting...' : 'Confirm Network Send'}
                </button>
              </div>
            )}

            {/* Deposit Tab */}
            {activeTab === 'deposit' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-bold text-[var(--text-primary)] mb-1">
                    Deposit {activeCurrency.toUpperCase()}
                  </h3>
                  <p className="text-sm text-[var(--text-secondary)]">
                    Send {activeCurrency.toUpperCase()} to the address below. {activeCurrency === 'btc' ? '3 confirmations' : '1 confirmation'} required.
                  </p>
                </div>

                {/* Deposit Address */}
                <div className="bg-[var(--bg-primary)] rounded-lg p-4 border border-[var(--border-color)] transition-colors">
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-xs text-[var(--text-secondary)]">Your {activeCurrency.toUpperCase()} Deposit Address</label>
                    <button
                      onClick={() => fetchDepositAddress(true)}
                      disabled={loadingAddress}
                      className="text-xs flex items-center gap-1 text-[var(--accent-color)] hover:text-[var(--accent-color)]/80 transition-colors disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3 h-3 ${loadingAddress ? 'animate-spin' : ''}`} /> Generate New
                    </button>
                  </div>
                  {loadingAddress ? (
                    <div className="flex items-center gap-2 text-[var(--text-secondary)]">
                      <RefreshCw className="w-4 h-4 animate-spin" /> Generating...
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <code className="flex-1 font-mono text-sm text-[var(--accent-color)] break-all select-all bg-[var(--bg-secondary)] px-3 py-2 rounded">
                        {depositAddress}
                      </code>
                      <button
                        onClick={handleCopy}
                        className="px-3 py-2 bg-[var(--bg-tertiary)] rounded hover:bg-[var(--border-color)]/50 transition-colors"
                      >
                        {copied ? <Check className="w-4 h-4 text-[#0ECB81]" /> : <Copy className="w-4 h-4 text-[var(--text-secondary)]" />}
                      </button>
                    </div>
                  )}
                </div>

                {/* Demo Deposit */}
                {activeCurrency === 'eth' && ethConnection.address && (
                  <div className="bg-[#627EEA]/5 rounded-lg p-4 border border-[#627EEA]/20">
                    <h4 className="text-sm font-bold text-[#627EEA] mb-2">📥 Direct Transfer to Hub</h4>
                    <p className="text-xs text-[var(--text-secondary)] mb-3">
                      Transfer ETH from your **Native Wallet** (<b>{ethConnection.address.slice(0, 6)}...{ethConnection.address.slice(-4)}</b>) to your Hub account.
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={transferAmount}
                        onChange={(e) => setTransferAmount(e.target.value)}
                        placeholder={`Amount in ETH (Max: ${(parseFloat(ethConnection.balance) || 0).toFixed(4)})`}
                        className="flex-1 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-3 py-2 text-[var(--text-primary)] font-mono text-sm focus:outline-none focus:border-[#627EEA] transition-colors"
                      />
                      <button
                        onClick={handleTransferToHub}
                        disabled={transferLoading || !parseFloat(transferAmount) || parseFloat(transferAmount) > parseFloat(ethConnection.balance)}
                        className="px-4 py-2 bg-[#627EEA] text-white font-bold rounded text-sm hover:bg-[#627EEA]/90 transition-colors disabled:opacity-50 shadow-[0_0_15px_rgba(98,126,234,0.2)]"
                      >
                        {transferLoading ? '...' : 'Transfer'}
                      </button>
                    </div>
                    {transferMessage && (
                      <p className={`text-xs mt-2 ${transferMessage.type === 'success' ? 'text-[#0ECB81]' : 'text-[#F6465D]'}`}>
                        {transferMessage.text}
                      </p>
                    )}
                  </div>
                )}

                {/* Demo Deposit */}
                <div className="bg-[var(--accent-color)]/5 rounded-lg p-4 border border-[var(--accent-color)]/20">
                  <h4 className="text-sm font-bold text-[var(--accent-color)] mb-2">⚡ Quick Demo Deposit</h4>
                  <p className="text-xs text-[var(--text-secondary)] mb-3">Instantly credit test funds to your account for development.</p>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={demoAmount}
                      onChange={(e) => setDemoAmount(e.target.value)}
                      placeholder={`Amount in ${activeCurrency.toUpperCase()}`}
                      className="flex-1 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-3 py-2 text-[var(--text-primary)] font-mono text-sm focus:outline-none focus:border-[var(--accent-color)] transition-colors"
                    />
                    <button
                      onClick={handleDemoDeposit}
                      disabled={demoLoading || !parseFloat(demoAmount)}
                      className="px-4 py-2 bg-[var(--accent-color)] text-black font-bold rounded text-sm hover:bg-[var(--accent-color)]/90 transition-colors disabled:opacity-50 shadow-[0_0_15px_rgba(223,255,0,0.2)]"
                    >
                      {demoLoading ? '...' : 'Credit'}
                    </button>
                  </div>
                  {demoMessage && (
                    <p className={`text-xs mt-2 ${demoMessage.type === 'success' ? 'text-[#0ECB81]' : 'text-[#F6465D]'}`}>
                      {demoMessage.text}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Withdraw Tab */}
            {activeTab === 'withdraw' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-bold text-[var(--text-primary)] mb-1">
                    Withdraw {activeCurrency.toUpperCase()}
                  </h3>
                  <p className="text-sm text-[var(--text-secondary)]">
                    Available: <span className="font-mono text-[var(--text-primary)]">{(balances[activeCurrency]?.available || 0).toFixed(8)} {activeCurrency.toUpperCase()}</span>
                  </p>
                </div>

                <div>
                  <label className="text-xs text-[var(--text-secondary)] mb-1.5 block">Destination Address</label>
                  <input
                    type="text"
                    value={withdrawAddress}
                    onChange={(e) => setWithdrawAddress(e.target.value)}
                    className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-4 py-3 text-[var(--text-primary)] font-mono text-sm focus:outline-none focus:border-[var(--accent-color)] transition-colors"
                    placeholder={`${activeCurrency.toUpperCase()} address`}
                  />
                </div>

                <div>
                  <label className="text-xs text-[var(--text-secondary)] mb-1.5 block">Amount</label>
                  <div className="relative">
                    <input
                      type="number"
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(e.target.value)}
                      className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-4 py-3 text-[var(--text-primary)] font-mono text-sm focus:outline-none focus:border-[var(--accent-color)] transition-colors pr-20"
                      placeholder="0.00000000"
                      step="0.00000001"
                    />
                    <button
                      onClick={() => setWithdrawAmount(Math.max(0, (balances[activeCurrency]?.available || 0) - withdrawFee).toFixed(8))}
                      className="absolute right-3 top-2.5 text-xs text-[var(--accent-color)] font-bold hover:underline"
                    >
                      MAX
                    </button>
                  </div>
                </div>

                {/* Fee Summary */}
                <div className="bg-[var(--bg-primary)] rounded-lg p-4 border border-[var(--border-color)] space-y-2 transition-colors">
                  <div className="flex justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-[var(--text-secondary)]">Network Fee</span>
                      <button 
                        onClick={fetchFees} 
                        disabled={fetchingFees}
                        className="p-1 hover:bg-[var(--bg-tertiary)] rounded-md transition-colors text-[var(--text-secondary)]"
                      >
                        <RefreshCw className={`w-3 h-3 ${fetchingFees ? 'animate-spin' : ''}`} />
                      </button>
                      <button 
                        onClick={() => alert(JSON.stringify(networkFees, null, 2))}
                        className="p-1 hover:bg-[var(--bg-tertiary)] rounded-md transition-colors text-[var(--text-secondary)] opacity-30 hover:opacity-100"
                        title="Debug raw fee data"
                      >
                        <Clock className="w-3 h-3" />
                      </button>
                      {lastFeeUpdate && (
                        <div className="flex items-center gap-1.5 px-1.5 py-0.5 bg-[#0ECB81]/10 rounded-full border border-[#0ECB81]/20">
                          <div className={`w-1.5 h-1.5 ${fetchingFees ? 'bg-orange-400' : 'bg-[#0ECB81]'} rounded-full animate-pulse`} />
                          <span className="text-[8px] font-black text-[#0ECB81] uppercase tracking-tighter">
                            {fetchingFees ? 'Syncing' : 'Live'}
                          </span>
                        </div>
                      )}
                    </div>
                    <span className="font-mono text-[var(--text-primary)]">
                      {withdrawFee.toFixed(activeCurrency === 'eth' ? 6 : 8)} {activeCurrency.toUpperCase()}
                      {activeCurrency === 'eth' && (
                        <span className="text-[10px] text-[var(--text-secondary)] ml-1 opacity-60">({networkFees.eth} Gwei)</span>
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--text-secondary)]">You Receive</span>
                    <span className="font-mono text-[#0ECB81]">
                      {parseFloat(withdrawAmount) > 0 ? parseFloat(withdrawAmount).toFixed(8) : '0.00000000'} {activeCurrency.toUpperCase()}
                    </span>
                  </div>
                  <div className="border-t border-[var(--border-color)] pt-2 flex justify-between text-sm">
                    <span className="text-[var(--text-primary)]/80">Total Deducted</span>
                    <span className="font-mono font-bold text-[var(--text-primary)]">
                      {parseFloat(withdrawAmount) > 0 ? (parseFloat(withdrawAmount) + withdrawFee).toFixed(8) : '0.00000000'} {activeCurrency.toUpperCase()}
                    </span>
                  </div>
                </div>

                {withdrawMessage && (
                  <div className={`text-sm p-3 rounded ${withdrawMessage.type === 'success' ? 'bg-[#0ECB81]/10 text-[#0ECB81] border border-[#0ECB81]/30' : 'bg-[#F6465D]/10 text-[#F6465D] border border-[#F6465D]/30'}`}>
                    {withdrawMessage.text}
                  </div>
                )}

                <button
                  onClick={handleWithdraw}
                  disabled={withdrawLoading || !parseFloat(withdrawAmount) || !withdrawAddress}
                  className="w-full py-4 bg-[var(--text-primary)] text-[var(--bg-primary)] font-black rounded-xl hover:scale-[1.01] active:scale-95 transition-all disabled:opacity-50 text-sm uppercase tracking-widest shadow-xl shadow-black/20"
                >
                  {withdrawLoading ? 'Authorizing...' : 'Request DAO Withdrawal'}
                </button>

                {/* Active Settlements Tracking */}
                {userSettlements.filter(s => s.currency === activeCurrency).length > 0 && (
                  <div className="mt-8 space-y-4">
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)]">Active DAO Settlements</h4>
                    {userSettlements.filter(s => s.currency === activeCurrency).map(s => (
                      <div key={s.id} className="p-4 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl space-y-3 group hover:border-blue-500/30 transition-all">
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            <Clock className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
                            <span className="text-[10px] font-black uppercase">Consensus Processing</span>
                          </div>
                          <span className="text-[10px] font-mono text-[var(--text-secondary)]">{s.fragments_collected} / {s.fragments_required} Sigs</span>
                        </div>
                        <div className="h-1.5 w-full bg-[var(--bg-secondary)] rounded-full overflow-hidden border border-[var(--border-color)]/50">
                          <div 
                            className="h-full bg-gradient-to-r from-blue-500 to-[#0ECB81] transition-all duration-500 shadow-[0_0_8px_rgba(59,130,246,0.2)]" 
                            style={{ width: `${(s.fragments_collected / s.fragments_required) * 100}%` }}
                          />
                        </div>
                        <p className="text-[9px] text-[var(--text-secondary)] italic leading-tight">
                          The DAO network is currently verifying this L2 trade state and producing threshold signature fragments.
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* History Tab */}
            {activeTab === 'history' && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-[var(--text-primary)]">Transaction History</h3>
                  <button onClick={fetchTransactions} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>

                {transactions.length === 0 ? (
                  <p className="text-gray-500 text-sm text-center py-8">No transactions yet</p>
                ) : (
                  <div className="space-y-2">
                    {transactions.map(tx => (
                      <div key={tx.id} className="flex items-center justify-between bg-[var(--bg-primary)] rounded-lg p-3 border border-[var(--border-color)] transition-colors">
                        <div className="flex items-center gap-3">
                          {tx.type === 'deposit' ? (
                            <ArrowDownToLine className="w-4 h-4 text-[#0ECB81]" />
                          ) : (
                            <ArrowUpFromLine className="w-4 h-4 text-[#F6465D]" />
                          )}
                          <div>
                            <span className="text-sm font-medium text-[var(--text-primary)] capitalize">{tx.type}</span>
                            <span className="text-xs text-[var(--text-secondary)] ml-2">{tx.currency.toUpperCase()}</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className={`font-mono text-sm ${tx.type === 'deposit' ? 'text-[#0ECB81]' : 'text-[#F6465D]'}`}>
                            {tx.type === 'deposit' ? '+' : '-'}{Number(tx.amount).toFixed(8)}
                          </span>
                          <span className={`block text-xs px-2 py-0.5 rounded mt-1 inline-block ${tx.status === 'credited' || tx.status === 'completed' ? 'bg-[#0ECB81]/10 text-[#0ECB81]' :
                            tx.status === 'pending' || tx.status === 'processing' ? 'bg-[var(--accent-color)]/10 text-[var(--accent-color)]' :
                              'bg-[#F6465D]/10 text-[#F6465D]'
                            }`}>
                            {tx.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
