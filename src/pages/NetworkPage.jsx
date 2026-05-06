import React, { useState, useEffect, useMemo } from 'react';
import { Wifi, Box, Plus, Trash2, RefreshCw, CheckCircle, XCircle, Globe, Link, User, Search, Activity, Cpu, Clock, ChevronRight, Hash, ArrowRightLeft, Layers, Zap, Lock, DatabaseZap, ShieldCheck } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function NetworkPage() {
  const { publicKey } = useAuth();
  const [status, setStatus] = useState({ peerCount: 0, peers: [], chainHeight: 0, listening: false });
  const [blocks, setBlocks] = useState([]);
  const [peerConfig, setPeerConfig] = useState({ bootstrap: [], custom: [], all: [] });
  const [chainValid, setChainValid] = useState(null);
  const [newPeer, setNewPeer] = useState('');
  const [addError, setAddError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('explorer'); // 'explorer', 'peers'
  const [mempool, setMempool] = useState({ pendingCount: 0, lockedRewardsCount: 0, pending: [], lockedRewards: [] });
  const [mempoolPulse, setMempoolPulse] = useState(false);
  const [pruneConfig, setPruneConfig] = useState({ 
    tradePruneEnabled: false, tradePruneMaxMB: 1000,
    registryPruneEnabled: false, registryPruneMaxMB: 500,
    bpsPruneEnabled: true, bpsPruneMaxMB: 2000
  });
  const [savingPrune, setSavingPrune] = useState(false);
  const [connecting, setConnecting] = useState(false);

  // Refs to avoid stale closures in setInterval
  const lastStatusRef = React.useRef(status);
  const lastBlocksRef = React.useRef(blocks);

  useEffect(() => { lastStatusRef.current = status; }, [status]);
  useEffect(() => { lastBlocksRef.current = blocks; }, [blocks]);

  const fetchAll = async (force = false) => {
    try {
      const prevStatus = lastStatusRef.current;
      const prevBlocks = lastBlocksRef.current;

      // On first load or force, parallelize everything for speed
      if (prevBlocks.length === 0 || force) {
        const [sRes, b, p, m, c] = await Promise.all([
          api.get('/network/status'),
          api.get('/network/blocks?limit=50'),
          api.get('/network/peers'),
          api.get('/network/mempool'),
          api.get('/network/config')
        ]);
        setStatus(sRes.data);
        setBlocks(b.data);
        setPeerConfig(p.data);
        setPruneConfig(c.data);
        setMempool(m.data);
        return;
      }

      // Subsequent polls: check status first
      const [statusRes, mempoolRes] = await Promise.all([
        api.get('/network/status'),
        api.get('/network/mempool')
      ]);
      
      const s = statusRes.data;
      setStatus(s);
      
      // Always update mempool so pending transactions show up immediately
      setMempool(mempoolRes.data);

      const shouldFetchHeavy = 
        s.chainHeight !== prevStatus.chainHeight || 
        s.registryHeight !== prevStatus.registryHeight ||
        s.peerCount !== prevStatus.peerCount ||
        s.bpsNode?.status !== prevStatus.bpsNode?.status;

      if (shouldFetchHeavy) {
        const [b, p, c] = await Promise.all([
          api.get('/network/blocks?limit=50'),
          api.get('/network/peers'),
          api.get('/network/config')
        ]);
        setBlocks(b.data);
        setPeerConfig(p.data);
        setPruneConfig(c.data);
      }
    } catch (err) {
      console.error('[NetworkPage] Fetch error:', err);
    }
  };

  useEffect(() => { 
    fetchAll(true); 
    const i = setInterval(() => fetchAll(false), 10000); // 10s poll
    return () => clearInterval(i); 
  }, [activeTab]);

  const updatePruneConfig = async (updates) => {
    setSavingPrune(true);
    try {
      await api.post('/network/config', updates);
      setPruneConfig(prev => ({ ...prev, ...updates }));
    } catch (err) {
      console.error(err);
    }
    setSavingPrune(false);
  };

  const validateChain = async () => {
    try { const r = await api.get('/network/chain-validity'); setChainValid(r.data); } catch {}
  };

  const addPeer = async () => {
    const addr = newPeer.trim();
    if (!addr.startsWith('ws://') && !addr.startsWith('wss://')) { 
      setAddError('Must start with ws:// or wss://'); 
      return; 
    }
    setConnecting(true);
    try { 
      await api.post('/network/peers', { address: addr }); 
      setNewPeer(''); 
      setAddError(''); 
      fetchAll(); 
    } catch (e) { 
      setAddError(e.response?.data?.error || 'Failed'); 
    }
    setConnecting(false);
  };

  const removePeer = async (addr) => {
    try { await api.delete('/network/peers', { data: { address: addr } }); fetchAll(); } catch {}
  };

  // Filtered data based on search
  const filteredBlocks = useMemo(() => {
    if (!searchQuery) return blocks;
    const q = searchQuery.toLowerCase();
    return blocks.filter(b => 
      b.hash?.toLowerCase().includes(q) || 
      b.index.toString().includes(q) ||
      b.trade?.id?.toLowerCase().includes(q) ||
      b.trade?.buyerPubKey?.toLowerCase().includes(q) ||
      b.trade?.sellerPubKey?.toLowerCase().includes(q)
    );
  }, [blocks, searchQuery]);

  const walletBlocks = useMemo(() => {
    return filteredBlocks.filter(b => 
      b.index > 0 && 
      (b.trade?.buyerPubKey === publicKey || b.trade?.sellerPubKey === publicKey)
    ).sort((a, b) => b.index - a.index);
  }, [filteredBlocks, publicKey]);

  const allTransactions = useMemo(() => {
    const txs = [];
    filteredBlocks.forEach(block => {
      if (!block.trade) return;
      
      // Add the primary trade as a transaction if it exists
      if (block.trade.id) {
        txs.push({
          id: block.trade.id,
          hash: block.trade.hash || block.trade.id,
          type: 'trade',
          pair: block.trade.pair,
          from: block.trade.sellerPubKey,
          to: block.trade.buyerPubKey,
          amount: block.trade.size,
          price: block.trade.price,
          timestamp: new Date(block.timestamp).getTime(),
          blockIndex: block.index
        });
      }

      // Add all confirmed transactions from the block payload
      if (block.trade.transactions && Array.isArray(block.trade.transactions)) {
        block.trade.transactions.forEach(tx => {
          let data = {};
          try { data = JSON.parse(tx.data); } catch {}
          txs.push({
            id: tx.id,
            hash: tx.hash || tx.id,
            type: tx.type,
            pair: data.pair || block.trade.pair,
            from: tx.user_id,
            to: 'mempool',
            amount: data.size || 0,
            price: data.price || 0,
            timestamp: new Date(tx.created_at || block.timestamp).getTime(),
            blockIndex: block.index
          });
        });
      }
    });
    return txs.sort((a, b) => b.timestamp - a.timestamp).slice(0, 50);
  }, [filteredBlocks]);

  const sortedBlocks = useMemo(() => {
    return filteredBlocks.filter(b => b.index > 0).sort((a, b) => b.index - a.index);
  }, [filteredBlocks]);

  const formatTime = (ts) => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
  };

  const truncate = (str, len = 8) => str ? `${str.slice(0, len)}...` : '';

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden p-6 max-w-7xl mx-auto w-full space-y-6 animate-in fade-in duration-500">
      
      {/* Header Area */}
      <div className="flex-none flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Activity className="w-8 h-8 text-[var(--accent-color)]" />
            Blockchain Explorer
          </h1>
          <p className="text-gray-400 mt-1 text-sm">Real-time network and transaction analysis</p>
        </div>
        
        {/* Global Search */}
        <div className="relative w-full md:w-96 group">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-5 w-5 text-gray-500 group-focus-within:text-[var(--accent-color)] transition-colors" />
          </div>
          <input
            type="text"
            className="block w-full pl-10 pr-10 py-3 border border-[var(--border-color)] rounded-xl leading-5 bg-[var(--bg-secondary)]/50 backdrop-blur-sm text-gray-300 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-[var(--accent-color)] focus:border-[var(--accent-color)] focus:bg-[var(--bg-secondary)] transition-all sm:text-sm shadow-inner"
            placeholder="Search hash, index, txid..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 hover:text-[var(--accent-color)] transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Network Stats Row */}
      <div className="flex-none grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-[var(--bg-secondary)] to-[var(--bg-primary)] rounded-2xl border border-[var(--border-color)] p-5 relative overflow-hidden group hover:border-[var(--accent-color)]/50 transition-colors">
          <div className="absolute top-0 right-0 w-24 h-24 bg-[#0ECB81]/5 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110" />
          <div className="flex justify-between items-start relative z-10">
            <div>
              <p className="text-sm text-gray-400 font-medium">Trade Chain</p>
              <div className="flex items-center gap-2 mt-1">
                <div className={`w-2 h-2 rounded-full ${status.listening ? 'bg-[#0ECB81] animate-pulse' : 'bg-gray-600'}`} />
                <p className="text-3xl font-bold text-white font-mono">
                  {status.chainHeight}
                </p>
              </div>
              {status.maxPeerTradeHeight > status.chainHeight && (
                <p className="text-[10px] text-yellow-500 font-bold mt-1 animate-pulse">Syncing... {(Math.min(100, (status.chainHeight / Math.max(1, status.maxPeerTradeHeight) * 100)) || 0).toFixed(1)}%</p>
              )}
            </div>
            <div className="w-12 h-12 bg-[#0ECB81]/10 rounded-xl flex items-center justify-center">
              <Box className="w-6 h-6 text-[#0ECB81]" />
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-[var(--bg-secondary)] to-[var(--bg-primary)] rounded-2xl border border-[var(--border-color)] p-5 relative overflow-hidden group hover:border-[#627EEA]/50 transition-colors">
          <div className="absolute top-0 right-0 w-24 h-24 bg-[#627EEA]/5 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110" />
          <div className="flex justify-between items-start relative z-10">
            <div>
              <p className="text-sm text-gray-400 font-medium">Registry Chain</p>
              <div className="flex items-center gap-2 mt-1">
                <div className={`w-2 h-2 rounded-full ${status.listening ? 'bg-[#627EEA] animate-pulse' : 'bg-gray-600'}`} />
                <p className="text-3xl font-bold text-white font-mono">
                  {status.registryHeight || 0}
                </p>
              </div>
              {status.maxPeerRegistryHeight > (status.registryHeight || 0) && (
                <p className="text-[10px] text-yellow-500 font-bold mt-1 animate-pulse">Syncing... {(Math.min(100, ((status.registryHeight || 0) / Math.max(1, status.maxPeerRegistryHeight) * 100)) || 0).toFixed(1)}%</p>
              )}
            </div>
            <div className="w-12 h-12 bg-[#627EEA]/10 rounded-xl flex items-center justify-center">
              <Link className="w-6 h-6 text-[#627EEA]" />
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-[var(--bg-secondary)] to-[var(--bg-primary)] rounded-2xl border border-[var(--border-color)] p-5 relative overflow-hidden group hover:border-[var(--accent-color)]/50 transition-colors">
          <div className="absolute top-0 right-0 w-24 h-24 bg-[var(--accent-color)]/5 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110" />
          <div className="flex justify-between items-start relative z-10">
            <div>
              <p className="text-sm text-gray-400 font-medium">Network Status</p>
              <div className="flex items-center gap-2 mt-2">
                <div className={`w-3 h-3 rounded-full ${
                  status.listening ? 'bg-[var(--accent-color)] animate-pulse' : 
                  (status.bpsNode?.status === 'starting' || (status.bpsNode?.status === 'running' && status.bpsNode?.blockchain?.initialblockdownload)) ? 'bg-yellow-500 animate-pulse' : 
                  'bg-[#F6465D]'
                }`} />
                <p className="text-lg font-bold text-white">
                  {status.bpsNode?.status === 'starting' ? 'Starting BPS...' :
                   (status.bpsNode?.status === 'running' && status.bpsNode?.blockchain?.initialblockdownload) ? 
                     `Syncing... ${(Math.min(100, ((status.bpsNode?.blockchain?.blocks || 0) / Math.max(1, status.bpsNode?.blockchain?.headers || 1)) * 100) || 0).toFixed(1)}%` :
                   status.listening ? 'Syncing Live' : 'Offline'}
                </p>
              </div>
            </div>
            <div className="w-12 h-12 bg-[var(--accent-color)]/10 rounded-xl flex items-center justify-center">
              <Globe className="w-6 h-6 text-[var(--accent-color)]" />
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-[var(--bg-secondary)] to-[var(--bg-primary)] rounded-2xl border border-[var(--border-color)] p-5 relative overflow-hidden group hover:border-blue-500/50 transition-colors">
          <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110" />
          <div className="flex justify-between items-start relative z-10">
            <div>
              <p className="text-sm text-gray-400 font-medium">DAO Vault</p>
              <p className="text-3xl font-bold text-white font-mono mt-1">{status.vault?.validators || 1}</p>
            </div>
            <div className="w-12 h-12 bg-blue-500/10 rounded-xl flex items-center justify-center">
              <ShieldCheck className="w-6 h-6 text-blue-400" />
            </div>
          </div>
          <p className="text-[10px] text-blue-400/70 font-bold uppercase tracking-widest mt-2">Threshold: {status.vault?.threshold || 1}/{status.vault?.validators || 1}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex-none flex space-x-1 border-b border-[var(--border-color)] mb-2">
        <button
          onClick={() => setActiveTab('explorer')}
          className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'explorer' ? 'border-[var(--accent-color)] text-[var(--accent-color)]' : 'border-transparent text-gray-400 hover:text-white hover:border-gray-600'}`}
        >
          <div className="flex items-center gap-2"><Activity className="w-4 h-4"/> Block Explorer</div>
        </button>
        <button
          onClick={() => setActiveTab('peers')}
          className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'peers' ? 'border-[var(--accent-color)] text-[var(--accent-color)]' : 'border-transparent text-gray-400 hover:text-white hover:border-gray-600'}`}
        >
          <div className="flex items-center gap-2"><Wifi className="w-4 h-4"/> Peer Management</div>
        </button>
      </div>

      {/* Tab Content - THIS IS THE ADAPTIVE AREA */}
      <div className="flex-1 min-h-0">
        
        {/* EXPLORER TAB */}
        {activeTab === 'explorer' && (
          <div className="flex flex-col gap-4 h-full min-h-0">

            {/* ── MEMPOOL WIDGET ── */}
            <div className={`flex-none rounded-2xl border transition-all duration-700 overflow-hidden shadow-xl ${
              mempoolPulse
                ? 'border-[var(--accent-color)] shadow-[0_0_24px_rgba(14,203,129,0.18)]'
                : 'border-[var(--border-color)]'
            } bg-gradient-to-r from-[var(--bg-primary)] via-[var(--bg-secondary)] to-[var(--bg-primary)]`}>

              {/* Header row */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)]/60">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <Layers className="w-5 h-5 text-[var(--accent-color)]" />
                    {mempool.pendingCount > 0 && (
                      <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[var(--accent-color)] animate-ping" />
                    )}
                  </div>
                  <h3 className="font-bold text-white text-base">Mempool</h3>
                  <span className="text-[10px] uppercase tracking-widest text-gray-500 font-bold">unconfirmed pool</span>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${ mempool.pendingCount > 0 ? 'bg-[var(--accent-color)] animate-pulse' : 'bg-gray-600' }`} />
                    <span className="text-xs text-gray-400"><span className="font-bold text-white">{mempool.pendingCount}</span> pending tx</span>
                  </div>
                  <div className="h-4 w-px bg-[var(--border-color)]" />
                  <div className="flex items-center gap-2">
                    <Lock className="w-3.5 h-3.5 text-[#627EEA]" />
                    <span className="text-xs text-gray-400"><span className="font-bold text-white">{mempool.lockedRewardsCount}</span> locked rewards</span>
                  </div>
                  <div className="h-4 w-px bg-[var(--border-color)]" />
                  <span className="text-[10px] text-gray-600 font-mono">~{mempool.pendingCount} awaiting next trade block</span>
                </div>
              </div>

              {/* Body: scrollable tx list + locked rewards summary side by side */}
              <div className="flex gap-0">

                {/* Pending transactions lane */}
                <div className="flex-1 min-w-0">
                  {mempool.pending.length === 0 ? (
                    <div className="flex items-center justify-center gap-2 py-5 text-gray-600">
                      <DatabaseZap className="w-4 h-4" />
                      <span className="text-sm">Mempool is empty — all transactions confirmed</span>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <div className="flex gap-2 px-4 py-3 min-w-max">
                        {mempool.pending.map((tx, i) => {
                          const typeColors = {
                            place_order: { bg: 'bg-[#0ECB81]/10', border: 'border-[#0ECB81]/30', text: 'text-[#0ECB81]', dot: 'bg-[#0ECB81]' },
                            cancel_order: { bg: 'bg-[#F6465D]/10', border: 'border-[#F6465D]/30', text: 'text-[#F6465D]', dot: 'bg-[#F6465D]' },
                            modify_order: { bg: 'bg-[#F0B90B]/10', border: 'border-[#F0B90B]/30', text: 'text-[#F0B90B]', dot: 'bg-[#F0B90B]' },
                            deposit:  { bg: 'bg-[#627EEA]/10', border: 'border-[#627EEA]/30', text: 'text-[#627EEA]', dot: 'bg-[#627EEA]' },
                            withdraw: { bg: 'bg-[#F6465D]/10', border: 'border-[#F6465D]/30', text: 'text-[#F6465D]', dot: 'bg-[#F6465D]' },
                            transfer: { bg: 'bg-purple-500/10', border: 'border-purple-500/30', text: 'text-purple-400', dot: 'bg-purple-400' },
                          };
                          const c = typeColors[tx.type] || { bg: 'bg-gray-700/30', border: 'border-gray-600/30', text: 'text-gray-400', dot: 'bg-gray-500' };
                          return (
                            <div
                              key={tx.id}
                              className={`flex-none flex flex-col gap-1 px-3 py-2.5 rounded-xl border ${c.bg} ${c.border} min-w-[130px] max-w-[160px]`}
                              style={{ animationDelay: `${i * 40}ms` }}
                            >
                              <div className="flex items-center gap-1.5">
                                <span className={`w-1.5 h-1.5 rounded-full ${c.dot} shrink-0`} />
                                <span className={`text-[10px] font-bold uppercase tracking-wider ${c.text} truncate`}>{tx.type.replace('_', ' ')}</span>
                              </div>
                              {tx.data?.pair && <span className="text-[10px] text-gray-400 font-mono">{tx.data.pair}</span>}
                              {tx.data?.price && <span className="text-[10px] text-white font-mono">{tx.data.size} @ {tx.data.price}</span>}
                              {tx.data?.amount && !tx.data?.price && <span className="text-[10px] text-white font-mono">{tx.data.amount} {tx.data.currency || ''}</span>}
                              <span className="text-[9px] text-gray-600 font-mono mt-0.5 truncate">{tx.id?.slice(0, 10)}…</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Locked rewards summary lane */}
                {mempool.lockedRewardsCount > 0 && (
                  <div className="flex-none border-l border-[var(--border-color)]/50 px-4 py-3 flex flex-col gap-1 justify-center min-w-[180px]">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Lock className="w-3.5 h-3.5 text-[#627EEA]" />
                      <span className="text-[10px] text-[#627EEA] font-bold uppercase tracking-wider">Locked Rewards</span>
                    </div>
                    {mempool.lockedRewards.slice(0, 4).map(r => (
                      <div key={r.id} className="flex justify-between items-center text-[10px]">
                        <span className="text-gray-500 font-mono">→ Block #{r.mature_at_block}</span>
                        <span className="text-[#627EEA] font-bold font-mono">+{r.amount} {r.currency}</span>
                      </div>
                    ))}
                    {mempool.lockedRewards.length > 4 && (
                      <span className="text-[9px] text-gray-600 mt-1">+{mempool.lockedRewards.length - 4} more locked…</span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* ── BLOCKS + TRADES TWO-COLUMN ── */}
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-0">
            
            {/* Latest Blocks Column */}
            <div className="bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-color)] shadow-xl overflow-hidden flex flex-col h-full min-h-0">
              <div className="flex-none p-5 border-b border-[var(--border-color)] flex justify-between items-center bg-[var(--bg-primary)]/50">
                <h3 className="font-bold text-white flex items-center gap-2 text-lg">
                  <Box className="w-5 h-5 text-[#0ECB81]" /> Latest Blocks
                </h3>
              </div>
              <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
                {sortedBlocks.map(block => (
                  <div 
                    key={block.hash} 
                    onClick={() => setSearchQuery(block.hash)}
                    className={`group p-4 border-b border-[var(--border-color)]/50 hover:bg-[var(--bg-primary)]/80 transition-all rounded-xl mb-1 cursor-pointer ${searchQuery === block.hash ? 'bg-[var(--bg-primary)] border-[var(--accent-color)]/30 ring-1 ring-[var(--accent-color)]/20 shadow-inner' : ''}`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-[var(--bg-primary)] flex items-center justify-center border border-[var(--border-color)] group-hover:border-[var(--accent-color)]/30 transition-colors">
                          <Hash className="w-5 h-5 text-gray-400 group-hover:text-[var(--accent-color)]" />
                        </div>
                        <div>
                          <p className="text-[var(--accent-color)] font-mono font-bold text-lg">#{block.index}</p>
                          <p className="text-xs text-gray-500 flex items-center gap-1"><Clock className="w-3 h-3" /> {formatTime(block.timestamp)}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        {block.pruned ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-500/10 text-gray-400 border border-gray-500/20">
                            PRUNED
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#627EEA]/10 text-[#627EEA] border border-[#627EEA]/20">
                            {block.trade ? '1 Tx' : '0 Txs'}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="bg-[var(--bg-primary)] rounded px-3 py-2 mt-3 font-mono text-[10px] text-gray-400 break-all border border-[var(--border-color)]/50 group-hover:border-gray-600 transition-colors">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-gray-500 font-bold uppercase tracking-tighter">Hash</span>
                      </div>
                      <div className="text-gray-300">{block.hash}</div>
                      
                      <div className="mt-2 pt-2 border-t border-[var(--border-color)]/30">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-gray-500 font-bold uppercase tracking-tighter">History Link</span>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setSearchQuery(block.trade?.prevTradeHash || block.previousHash);
                            }}
                            className="text-[var(--accent-color)]/70 hover:text-[var(--accent-color)] flex items-center gap-1 transition-colors"
                          >
                            <Link className="w-3 h-3" /> {block.trade?.prevTradeHash ? 'View Prev Trade' : 'View Parent Block'}
                          </button>
                        </div>
                        <div className="text-gray-500 italic text-[9px] group-hover:text-gray-400 transition-colors">
                          {block.trade?.prevTradeHash ? `Trade Path: ${block.trade.prevTradeHash}` : `Parent: ${block.previousHash}`}
                        </div>
                      </div>
                    </div>

                    {/* Pending Transactions Included in this Block */}
                    {block.trade?.transactions?.length > 0 && (
                      <div className="mt-3 bg-[var(--bg-primary)]/50 rounded-lg p-2 border border-[var(--border-color)]/30">
                        <p className="text-[10px] text-gray-500 uppercase tracking-tighter mb-2 font-bold flex items-center gap-1"><Activity className="w-3 h-3" /> Confirmed Transactions</p>
                        <div className="space-y-1">
                          {block.trade.transactions.map(tx => {
                            let data = {};
                            try { data = JSON.parse(tx.data); } catch {}
                            return (
                              <div key={tx.id} className="text-xs flex justify-between items-center bg-[var(--bg-secondary)] px-2 py-1.5 rounded border border-[var(--border-color)]/50">
                                <span className="text-gray-300 font-mono">{tx.type}</span>
                                {data.pair && <span className="text-gray-400 font-mono text-[10px]">{data.pair}</span>}
                                {data.price && <span className="text-gray-400 font-mono text-[10px]">{data.size} @ {data.price}</span>}
                                {!data.price && data.orderId && <span className="text-gray-400 font-mono text-[10px]">{truncate(data.orderId, 8)}</span>}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Matured Rewards Issued in this Block */}
                    {block.trade?.maturedRewards?.length > 0 && (
                      <div className="mt-2 bg-[#0ECB81]/5 rounded-lg p-2 border border-[#0ECB81]/20">
                        <p className="text-[10px] text-[#0ECB81]/70 uppercase tracking-tighter mb-2 font-bold flex items-center gap-1"><Box className="w-3 h-3" /> Matured Rewards (100 Blocks)</p>
                        <div className="space-y-1">
                          {block.trade.maturedRewards.map(rew => (
                            <div key={rew.id} className="text-xs flex justify-between items-center bg-[var(--bg-primary)] px-2 py-1.5 rounded border border-[#0ECB81]/10">
                              <span className="text-gray-300 font-mono text-[10px]">To: {truncate(rew.user_id, 8)}</span>
                              <span className="text-[#0ECB81] font-mono font-bold">+{rew.amount} {rew.currency}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {sortedBlocks.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-gray-500">
                    <Box className="w-12 h-12 mb-3 text-gray-600" />
                    <p>No blocks found.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Latest Transactions Column */}
            <div className="bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-color)] shadow-xl overflow-hidden flex flex-col h-full min-h-0">
              <div className="flex-none p-5 border-b border-[var(--border-color)] flex justify-between items-center bg-[var(--bg-primary)]/50">
                <h3 className="font-bold text-white flex items-center gap-2 text-lg">
                  <ArrowRightLeft className="w-5 h-5 text-[#627EEA]" /> Latest Transactions
                </h3>
              </div>
              <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
                {allTransactions.map(tx => (
                  <div key={tx.hash} className="group p-4 border-b border-[var(--border-color)]/50 hover:bg-[var(--bg-primary)]/80 transition-all rounded-xl mb-1">
                    <div className="flex justify-between items-center mb-3">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${tx.type === 'trade' ? 'bg-[#0ECB81]/10 text-[#0ECB81] border border-[#0ECB81]/20' : 'bg-[#627EEA]/10 text-[#627EEA] border border-[#627EEA]/20'}`}>
                          {tx.type}
                        </span>
                        <span className="bg-[var(--bg-primary)] border border-[var(--border-color)] px-2 py-1 rounded text-[10px] font-bold text-white">
                          {tx.pair}
                        </span>
                        <span className="text-xs text-gray-500 font-mono">Hash: {truncate(tx.hash, 12)}</span>
                      </div>
                      <span className="text-xs text-gray-500 font-mono">Block #{tx.blockIndex}</span>
                    </div>
                    
                    <div className="grid grid-cols-3 gap-2 items-center text-center">
                      <div className="bg-[var(--bg-primary)] p-2 rounded-lg border border-[var(--border-color)]">
                        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">From</p>
                        <p className="text-xs font-mono text-white truncate">{truncate(tx.from, 12)}</p>
                      </div>
                      <div className="flex justify-center text-gray-600">
                        <ArrowRightLeft className="w-4 h-4" />
                      </div>
                      <div className="bg-[var(--bg-primary)] p-2 rounded-lg border border-[var(--border-color)]">
                        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">To</p>
                        <p className="text-xs font-mono text-white truncate">{truncate(tx.to, 12)}</p>
                      </div>
                    </div>
                    
                    <div className="mt-3 flex justify-between items-center px-2">
                      <div className="text-sm">
                        <span className="text-white font-bold">{tx.amount}</span>
                        <span className="text-gray-500 text-xs ml-1">{tx.pair.split('/')[0]}</span>
                        {tx.price > 0 && (
                          <>
                            <span className="text-gray-600 mx-2">@</span>
                            <span className="text-[var(--accent-color)] font-mono">{tx.price}</span>
                          </>
                        )}
                      </div>
                      <div className="text-xs text-gray-500">
                        {formatTime(tx.timestamp)}
                      </div>
                    </div>
                  </div>
                ))}
                {allTransactions.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-gray-500">
                    <ArrowRightLeft className="w-12 h-12 mb-3 text-gray-600" />
                    <p>No transactions found.</p>
                  </div>
                )}
              </div>
            </div>

            </div>
          </div>
        )}


        {/* PEERS TAB */}
        {activeTab === 'peers' && (
          <div className="bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-color)] overflow-hidden shadow-xl max-w-4xl mx-auto h-full flex flex-col min-h-0">
            <div className="flex-none p-6 border-b border-[var(--border-color)] flex justify-between items-center bg-gradient-to-r from-[var(--bg-primary)] to-[var(--bg-secondary)]">
              <div>
                <h3 className="font-bold text-white text-xl flex items-center gap-2"><Link className="w-5 h-5 text-[#627EEA]" /> Node Connections</h3>
                <p className="text-sm text-gray-400 mt-1">Manage outbound and inbound P2P connections.</p>
              </div>
              <div className="flex items-stretch gap-3">
                <button onClick={fetchAll} className="px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg hover:border-[var(--accent-color)] transition-colors text-gray-400 hover:text-[var(--accent-color)] flex items-center justify-center">
                  <RefreshCw className="w-5 h-5" />
                </button>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar min-h-0">
              <div className="mb-8 grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Add custom peer */}
                <div className="bg-[var(--bg-primary)]/50 p-5 rounded-xl border border-[var(--border-color)]">
                  <h4 className="text-sm text-white mb-3 font-bold flex items-center gap-2"><Plus className="w-4 h-4 text-[var(--accent-color)]"/> Connect to Peer</h4>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <input value={newPeer} onChange={e => setNewPeer(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addPeer()}
                      placeholder="ws://192.168.1.100:9735"
                      className="flex-1 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg px-4 py-3 text-white font-mono text-sm focus:outline-none focus:border-[var(--accent-color)] shadow-inner" />
                    <button 
                      onClick={addPeer} 
                      disabled={connecting || !newPeer.trim()}
                      className={`px-4 py-2 bg-[var(--accent-color)] text-black rounded-lg text-xs font-bold hover:bg-[var(--accent-color)]/90 transition-colors whitespace-nowrap flex items-center justify-center gap-2 ${connecting ? 'opacity-70 cursor-not-allowed' : ''} sm:w-auto w-full`}
                    >
                      {connecting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
                      {connecting ? 'Connecting...' : 'Establish Connection'}
                    </button>
                  </div>
                  {addError && <p className="text-sm text-[#F6465D] mt-2 font-medium">{addError}</p>}
                </div>

                {/* Database Pruning */}
                <div className="bg-[var(--bg-primary)]/50 p-5 rounded-xl border border-[var(--border-color)] relative overflow-hidden flex flex-col justify-between">
                  <div>
                    <h4 className="text-sm text-white mb-3 font-bold flex items-center gap-2">
                      <DatabaseZap className="w-4 h-4 text-[#0ECB81]" /> 
                      Node Database Pruning
                    </h4>
                    <p className="text-xs text-gray-400 mb-4">
                      Configure size limits for local chains to automatically prune old block payloads.
                    </p>
                  </div>
                  
                  <div className="space-y-3">
                    {/* BPS Node */}
                    <div className="flex items-center justify-between gap-4">
                      <div className="text-sm text-gray-300 font-bold w-24">BPS Core</div>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg overflow-hidden">
                          <input type="number" 
                            defaultValue={pruneConfig.bpsPruneMaxMB} 
                            key={`bps-${pruneConfig.bpsPruneMaxMB}`}
                            onBlur={(e) => updatePruneConfig({ bpsPruneMaxMB: parseInt(e.target.value) || 2000 })}
                            onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
                            disabled={savingPrune} className="w-16 bg-transparent text-white font-mono text-sm px-2 py-1.5 text-right focus:outline-none" />
                          <span className="text-gray-500 text-[10px] font-bold pr-2">MB</span>
                        </div>
                        <button onClick={() => updatePruneConfig({ bpsPruneEnabled: !pruneConfig.bpsPruneEnabled })} disabled={savingPrune}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${pruneConfig.bpsPruneEnabled ? 'bg-[#0ECB81]' : 'bg-gray-600'}`}>
                          <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${pruneConfig.bpsPruneEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
                        </button>
                      </div>
                    </div>
                    {/* Trade Chain */}
                    <div className="flex items-center justify-between gap-4">
                      <div className="text-sm text-gray-300 font-bold w-24">Trade L2</div>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg overflow-hidden">
                          <input type="number" 
                            defaultValue={pruneConfig.tradePruneMaxMB} 
                            key={`trade-${pruneConfig.tradePruneMaxMB}`}
                            onBlur={(e) => updatePruneConfig({ tradePruneMaxMB: parseInt(e.target.value) || 1000 })}
                            onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
                            disabled={savingPrune} className="w-16 bg-transparent text-white font-mono text-sm px-2 py-1.5 text-right focus:outline-none" />
                          <span className="text-gray-500 text-[10px] font-bold pr-2">MB</span>
                        </div>
                        <button onClick={() => updatePruneConfig({ tradePruneEnabled: !pruneConfig.tradePruneEnabled })} disabled={savingPrune}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${pruneConfig.tradePruneEnabled ? 'bg-[#0ECB81]' : 'bg-gray-600'}`}>
                          <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${pruneConfig.tradePruneEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
                        </button>
                      </div>
                    </div>
                    {/* Registry Chain */}
                    <div className="flex items-center justify-between gap-4">
                      <div className="text-sm text-gray-300 font-bold w-24">Registry L2</div>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg overflow-hidden">
                          <input type="number" 
                            defaultValue={pruneConfig.registryPruneMaxMB} 
                            key={`registry-${pruneConfig.registryPruneMaxMB}`}
                            onBlur={(e) => updatePruneConfig({ registryPruneMaxMB: parseInt(e.target.value) || 500 })}
                            onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
                            disabled={savingPrune} className="w-16 bg-transparent text-white font-mono text-sm px-2 py-1.5 text-right focus:outline-none" />
                          <span className="text-gray-500 text-[10px] font-bold pr-2">MB</span>
                        </div>
                        <button onClick={() => updatePruneConfig({ registryPruneEnabled: !pruneConfig.registryPruneEnabled })} disabled={savingPrune}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${pruneConfig.registryPruneEnabled ? 'bg-[#0ECB81]' : 'bg-gray-600'}`}>
                          <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${pruneConfig.registryPruneEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Active Peers */}
                <div>
                  <h4 className="text-sm text-gray-400 uppercase tracking-wider font-bold mb-4 flex justify-between">
                    Active Connections <span className="text-white bg-[var(--bg-primary)] px-2 py-0.5 rounded text-xs">{status.peers?.length || 0}</span>
                  </h4>
                  <div className="space-y-3 pr-2">
                    {status.peers?.map((p, i) => (
                      <div key={i} className="bg-[var(--bg-primary)] rounded-xl p-4 border border-[var(--border-color)] relative overflow-hidden group">
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#0ECB81]"></div>
                        <div className="flex justify-between items-start pl-2">
                          <div>
                            <p className="text-sm text-white font-mono font-bold mb-1">{p.address}</p>
                            <div className="flex gap-2">
                              <span className="text-[10px] uppercase bg-[var(--bg-secondary)] px-1.5 py-0.5 rounded text-gray-400 border border-[var(--border-color)]">{p.direction}</span>
                              <span className="text-[10px] text-gray-500 font-mono flex items-center gap-1"><Cpu className="w-3 h-3"/> {p.publicKey ? truncate(p.publicKey, 16) : 'Handshaking...'}</span>
                            </div>
                          </div>
                          <div className="w-2.5 h-2.5 rounded-full bg-[#0ECB81] shadow-[0_0_8px_#0ECB81] animate-pulse" />
                        </div>
                      </div>
                    ))}
                    {(!status.peers || status.peers.length === 0) && (
                      <div className="text-center py-10 bg-[var(--bg-primary)]/30 rounded-xl border border-dashed border-[var(--border-color)]">
                        <Wifi className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                        <p className="text-sm text-gray-500">No active peers connected</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Saved Peers */}
                <div>
                  <h4 className="text-sm text-gray-400 uppercase tracking-wider font-bold mb-4 flex justify-between">
                    Saved Custom Peers <span className="text-white bg-[var(--bg-primary)] px-2 py-0.5 rounded text-xs">{peerConfig.custom?.length || 0}</span>
                  </h4>
                  <div className="space-y-3 pr-2">
                    {peerConfig.custom?.map((addr, i) => (
                      <div key={i} className="flex justify-between items-center bg-[var(--bg-primary)] rounded-xl p-4 border border-[var(--border-color)] hover:border-gray-500 transition-colors">
                        <span className="text-gray-300 font-mono text-sm">{addr}</span>
                        <button onClick={() => removePeer(addr)} className="p-2 text-gray-500 hover:text-[#F6465D] hover:bg-[#F6465D]/10 rounded-lg transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    {(!peerConfig.custom || peerConfig.custom.length === 0) && (
                      <div className="text-center py-10 bg-[var(--bg-primary)]/30 rounded-xl border border-dashed border-[var(--border-color)]">
                        <Box className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                        <p className="text-sm text-gray-500">No saved custom peers</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
