import React, { useEffect, useState } from 'react';
import api from '../api/client';
import { Landmark, TrendingUp, Activity, BarChart3, ChevronDown, Gift, ShieldCheck, Zap, Database, ArrowRight, Brain, Cpu, Waves, Globe } from 'lucide-react';

export default function DaoPage() {
  const [stats, setStats] = useState({
    bpsHoldings: 0,
    gameFundBps: 0,
    bpsInOrders: 0,
    lpYieldPct: 0,
    totalRewards: 0,
    rewardsByPair: [],
    operations: [],
    marketPrices: {},
    vaultBalances: {}
  });
  const [brainStats, setBrainStats] = useState({
    sectors: [],
    avgEntropy: 1.0,
    readinessPct: 0
  });
  const [vaultStatus, setVaultStatus] = useState({
    validators: 1,
    threshold: 1,
    totalAddresses: 0,
    activeSettlements: 0,
    vaultBalances: [],
    settlements: []
  });
  const [loading, setLoading] = useState(true);
  const [rewardPair, setRewardPair] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 12;

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const [daoRes, brainRes, vaultRes] = await Promise.all([
          api.get('/market/dao-stats'),
          api.get('/ai/brain-state').catch(() => ({ data: { sectors: [], avgEntropy: 1.0, readinessPct: 0 } })),
          api.get('/network/vault').catch(() => ({ data: {} }))
        ]);
        setStats(daoRes.data);
        setBrainStats(brainRes.data);
        setVaultStatus(vaultRes.data);
      } catch (err) {
        console.error("Failed to fetch DAO stats", err);
      } finally {
        setLoading(false);
      }
    };
    fetchStats();

    const interval = setInterval(fetchStats, 10000);
    return () => clearInterval(interval);
  }, []);

  // Compute filtered reward amount
  let filteredRewards = 0;
  if (rewardPair === 'ALL') {
    filteredRewards = (stats.rewardsByPair || []).reduce((sum, r) => {
      let price = stats.marketPrices?.[r.pair];
      if (!price && r.pair.includes('/*')) {
        const base = r.pair.split('/')[0];
        const match = Object.keys(stats.marketPrices || {}).find(p => p.startsWith(base + '/'));
        price = match ? stats.marketPrices[match] : 1;
      }
      return sum + (r.total_rewards * (price || 1));
    }, 0);
  } else {
    filteredRewards = (stats.rewardsByPair || [])
      .filter(r => r.pair === rewardPair)
      .reduce((sum, r) => sum + r.total_rewards, 0);
  }

  const rewardPairs = [...new Set((stats.rewardsByPair || []).map(r => r.pair))];
  const rewardCurrency = rewardPair === 'ALL' ? 'BPS (Est)' : (rewardPair.includes('/') ? rewardPair.split('/')[0] : rewardPair);

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--bg-primary)] text-[var(--text-primary)] transition-colors selection:bg-[var(--accent-color)] selection:text-black">
      <div className="p-8 max-w-7xl mx-auto w-full space-y-12 pb-24">

        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-[var(--accent-color)]/10 rounded-lg">
                <Landmark className="w-8 h-8 text-[var(--accent-color)]" />
              </div>
              <h1 className="text-4xl font-black tracking-tighter uppercase italic">DAOshboard</h1>
            </div>
            <p className="text-[var(--text-secondary)] max-w-xl text-sm leading-relaxed">
              The Nextchange Protocol Vault automates market-making and liquidity incentives through an algorithmic distribution loop.
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)]">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#0ECB81] animate-pulse" />
              Live Protocol Stats
            </div>
          </div>
        </div>

        {/* Hero Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* BPS Holdings Card */}
          <div className="relative group overflow-hidden bg-[var(--bg-secondary)] border border-[var(--border-color)] p-8 rounded-2xl transition-all hover:border-[var(--accent-color)]/30">
            <div className="absolute -right-4 -top-4 opacity-5 group-hover:opacity-10 transition-opacity rotate-12">
              <Landmark className="w-40 h-40 text-[var(--accent-color)]" />
            </div>
            <h3 className="text-[var(--text-secondary)] font-bold text-xs uppercase tracking-widest mb-4 flex items-center gap-2">
              <Database className="w-4 h-4" /> BPS Treasury
            </h3>
            <div className="flex items-baseline gap-2 mb-4">
              <span className="text-5xl font-black font-mono tracking-tighter text-[var(--accent-color)]">
                {Number((stats.bpsHoldings || 0) + (stats.gameFundBps || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className="text-lg font-bold text-[var(--text-secondary)] uppercase">BPS</span>
            </div>
            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-[var(--border-color)]/50">
              <div>
                <p className="text-[var(--text-secondary)] text-[10px] uppercase font-bold mb-1">AI Pot</p>
                <p className="font-mono text-sm font-bold text-[#8A2BE2]">
                  {Number(stats.bpsHoldings || 0).toFixed(4)}
                </p>
              </div>
              <div>
                <p className="text-[var(--text-secondary)] text-[10px] uppercase font-bold mb-1">Game Fund</p>
                <p className="font-mono text-sm font-bold text-blue-400">
                  {Number(stats.gameFundBps || 0).toFixed(4)}
                </p>
              </div>
            </div>
          </div>

          {/* LP Yield Card */}
          <div className="relative group overflow-hidden bg-[var(--bg-secondary)] border border-[var(--border-color)] p-8 rounded-2xl transition-all hover:border-[#0ECB81]/30">
            <div className="absolute -right-4 -top-4 opacity-5 group-hover:opacity-10 transition-opacity rotate-12">
              <TrendingUp className="w-40 h-40 text-[#0ECB81]" />
            </div>
            <h3 className="text-[var(--text-secondary)] font-bold text-xs uppercase tracking-widest mb-4 flex items-center gap-2">
              <Zap className="w-4 h-4" /> Protocol APY
            </h3>
            <div className="flex items-baseline gap-2 mb-4">
              <span className="text-5xl font-black font-mono tracking-tighter text-[#0ECB81]">
                {Number(stats.lpYieldPct || 0).toFixed(2)}%
              </span>
              <span className="text-lg font-bold text-[var(--text-secondary)] uppercase italic">AVG</span>
            </div>
            <p className="text-[var(--text-secondary)] text-xs mt-4">
              Real-time yield based on trailing 12-month volume and distributed rewards.
            </p>
          </div>

          {/* Liquidity Rewards Card */}
          <div className="relative group overflow-hidden bg-[var(--bg-secondary)] border border-[var(--border-color)] p-8 rounded-2xl transition-all hover:border-blue-500/30">
            <div className="absolute -right-4 -top-4 opacity-5 group-hover:opacity-10 transition-opacity rotate-12">
              <Gift className="w-40 h-40 text-blue-500" />
            </div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[var(--text-secondary)] font-bold text-xs uppercase tracking-widest flex items-center gap-2">
                <Gift className="w-4 h-4" /> Rewards Paid
              </h3>
              <div className="relative z-10 group">
                <select
                  value={rewardPair}
                  onChange={e => setRewardPair(e.target.value)}
                  className="bg-[var(--bg-primary)] border border-[var(--border-color)] text-[9px] font-black uppercase tracking-widest text-[var(--text-secondary)] rounded px-2 py-1 pr-6 focus:outline-none focus:border-[var(--accent-color)]/50 appearance-none cursor-pointer transition-all hover:text-[var(--text-primary)] hover:border-[var(--border-color)]/80"
                >
                  <option value="ALL">All Pairs (12M)</option>
                  {rewardPairs.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <ChevronDown className="w-3 h-3 text-[var(--text-secondary)] absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none group-hover:text-[var(--text-primary)]" />
              </div>
            </div>
            <div className="flex items-baseline gap-2 mb-6">
              <span className="text-5xl font-black font-mono tracking-tighter text-[var(--text-primary)]">
                {Number(filteredRewards).toFixed(rewardPair === 'ALL' ? 2 : 6)}
              </span>
              <span className="text-sm font-bold text-[var(--text-secondary)] uppercase">{rewardPair === 'ALL' ? 'BPS (Est)' : rewardCurrency}</span>
            </div>


            <p className="text-[var(--text-secondary)] text-xs mt-6 pt-4 border-t border-[var(--border-color)]/30">
              Cumulative distributions to liquidity providers over the last 12 months.
            </p>
          </div>
        </div>

        {/* DAO Vault & Threshold Signing Section */}
        {/* DAO Vault Status & Asset Heatmap */}
        <div className="space-y-6">
          <h2 className="text-lg font-black uppercase tracking-tight flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-[#0ECB81]" />
            DAO Vault Infrastructure
          </h2>
          
          <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl overflow-hidden shadow-2xl transition-all hover:border-[#0ECB81]/20">
            <div className="grid grid-cols-1 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-[var(--border-color)]/30">
              
              {/* Stats Panel (1/4) */}
              <div className="p-8 bg-[var(--bg-primary)]/20 space-y-8">
                <div className="space-y-6">
                  <div className="space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)]">Validators</p>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-[#0ECB81]/10 flex items-center justify-center">
                        <Globe className="w-5 h-5 text-[#0ECB81]" />
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-3xl font-black font-mono leading-none">{vaultStatus.validators}</span>
                        <span className="text-[10px] font-bold text-[var(--text-secondary)] uppercase">Online</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)]">Signing Threshold</p>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-[var(--accent-color)]/10 flex items-center justify-center">
                        <ShieldCheck className="w-5 h-5 text-[var(--accent-color)]" />
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-3xl font-black font-mono leading-none text-[var(--accent-color)]">{vaultStatus.threshold}</span>
                        <span className="text-[10px] font-bold text-[var(--text-secondary)] uppercase italic">M-of-N</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-6 border-t border-[var(--border-color)]/30">
                  <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)] mb-4">Inventory Breakdown</p>
                  <div className="space-y-3">
                    {(vaultStatus.vaultBalances || []).map((data) => (
                      <div key={data.currency} className="flex justify-between items-center text-[11px] font-bold">
                        <span className="uppercase text-[var(--text-secondary)] flex items-center gap-2">
                          <div className={`w-1 h-1 rounded-full ${data.currency === 'bps' ? 'bg-[var(--accent-color)]' : data.currency === 'btc' ? 'bg-[#F7931A]' : 'bg-[#627EEA]'}`} />
                          {data.currency}
                        </span>
                        <span className="font-mono text-[var(--text-primary)]">{Number(data.balance || 0).toFixed(4)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Heatmap Panel (3/4) */}
              <div className="lg:col-span-3 p-8 flex flex-col justify-between">
                <div className="space-y-6">
                  {(() => {
                    const totalValue = (vaultStatus.vaultBalances || []).reduce((sum, b) => {
                      const p = stats.marketPrices?.[`${(b.currency || '').toUpperCase()}/BPS`] || (b.currency === 'bps' ? 1 : 0);
                      return sum + (b.balance * p);
                    }, 0);

                    return (
                      <>
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)]">Asset Allocation Heatmap</p>
                          <div className="text-right">
                            <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase">Estimated Vault Value</p>
                            <p className="text-xl font-black font-mono text-[var(--accent-color)]">
                              {Number(totalValue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              <span className="text-xs ml-1 uppercase opacity-50">BPS</span>
                            </p>
                          </div>
                        </div>

                        <div className="h-32 w-full flex rounded-2xl overflow-hidden border border-[var(--border-color)] p-1 bg-[var(--bg-primary)]/30">
                          {(vaultStatus.vaultBalances || []).map((data) => {
                            const price = stats.marketPrices?.[`${data.currency.toUpperCase()}/BPS`] || (data.currency === 'bps' ? 1 : 0);
                            const value = data.balance * price;
                            const share = totalValue > 0 ? (value / totalValue) * 100 : 0;
                            
                            if (share < 1) return null;

                            const colors = {
                              bps: 'from-[var(--accent-color)] to-[#DFE300]',
                              btc: 'from-[#F7931A] to-[#FFAB4A]',
                              eth: 'from-[#627EEA] to-[#8899FF]'
                            };

                            return (
                              <div 
                                key={data.currency}
                                className={`h-full bg-gradient-to-br ${colors[data.currency] || 'from-gray-500 to-gray-400'} border-r border-[var(--bg-primary)] last:border-0 relative group flex items-center justify-center transition-all hover:brightness-110`}
                                style={{ width: `${share}%` }}
                              >
                                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-white/5 pointer-events-none" />
                                <div className="text-center">
                                  <p className="text-[10px] font-black text-black leading-none uppercase mb-0.5">{data.currency}</p>
                                  <p className="text-[9px] font-bold text-black/60 leading-none">{share.toFixed(1)}%</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    );
                  })()}
                </div>

                <div className="grid grid-cols-3 gap-8 pt-8">
                  <div className="space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)]">Bridge Latency</p>
                    <p className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2 italic">
                      ~15m <span className="text-[10px] opacity-50 uppercase not-italic">L1-Confirm</span>
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)]">Custody Model</p>
                    <p className="text-sm font-bold text-[var(--text-primary)] uppercase flex items-center gap-2 italic">
                      Federated <span className="text-[10px] opacity-50 uppercase not-italic">TSS-DKG</span>
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)]">Current Queue</p>
                    <p className="text-sm font-bold text-blue-400 uppercase flex items-center gap-2 italic">
                      {vaultStatus.settlements?.length || 0} ACTIVE <span className="text-[10px] opacity-50 uppercase not-italic">Pending L1</span>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Vault Inventory & Fee Distribution Flow */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">

          {/* Fee Distribution Flow (3/5 Width) */}
          <div className="lg:col-span-3 flex flex-col space-y-6">
            <h2 className="text-lg font-black uppercase tracking-tight flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-[var(--text-secondary)]" />
              Vault Distribution Logic
            </h2>            <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl p-8 flex-1 flex flex-col justify-between space-y-8">
              {/* Entry Node */}
              <div className="flex flex-col items-center relative">
                <div className="w-12 h-12 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl flex items-center justify-center shadow-sm">
                  <Zap className="w-6 h-6 text-[var(--accent-color)]" />
                </div>
                <div className="text-center mt-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-[var(--accent-color)]">Trade Fee Inflow</p>
                  <p className="text-[9px] font-bold text-[var(--text-secondary)] uppercase">50/50 Multi-Currency Split</p>
                </div>
                {/* Visual connectors */}
                <div className="absolute top-12 left-1/2 -translate-x-1/2 w-px h-8 bg-gradient-to-b from-[var(--border-color)] to-transparent" />
              </div>

              <div className="grid grid-cols-2 gap-6 flex-1">
                {/* Base Sector */}
                <div className="bg-[var(--bg-primary)]/40 border border-[var(--border-color)] rounded-xl p-6 flex flex-col space-y-6">
                  <div className="flex items-center gap-2 pb-4 border-b border-[var(--border-color)]/30">
                    <Waves className="w-4 h-4 text-[var(--text-secondary)]" />
                    <h4 className="text-xs font-black uppercase tracking-widest">Base Currency</h4>
                  </div>
                  
                  <div className="flex-1 flex flex-col justify-around gap-4">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-black text-[var(--accent-color)] uppercase">Dynamic Buyback</span>
                        <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 bg-[var(--accent-color)]/10 rounded">FEE %</span>
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] leading-relaxed italic">
                        Apply trade fee % to collected Base — market sell to replenish BPS
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-black text-[#0ECB81] uppercase">LP Distribution</span>
                        <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 bg-[#0ECB81]/10 rounded">REST</span>
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] leading-relaxed italic">
                        Remainder of Base — distributed to liquidity providers
                      </p>
                    </div>
                  </div>
                </div>

                {/* Quote Sector */}
                <div className="bg-[var(--bg-primary)]/40 border border-[var(--border-color)] rounded-xl p-6 flex flex-col space-y-6">
                  <div className="flex items-center gap-2 pb-4 border-b border-[var(--border-color)]/30">
                    <Landmark className="w-4 h-4 text-[var(--text-secondary)]" />
                    <h4 className="text-xs font-black uppercase tracking-widest">Quote / BPS</h4>
                  </div>

                  <div className="flex-1 flex flex-col justify-around gap-4">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-black text-blue-400 uppercase">Game Fund</span>
                        <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 bg-blue-400/10 rounded">FEE %</span>
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] leading-relaxed italic">
                        {Number(stats.gameFundBps || 0).toFixed(4)} BPS allocated to ecosystem & game growth.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-black text-[#8A2BE2] uppercase">AI Pot</span>
                        <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 bg-[#8A2BE2]/10 rounded">REST</span>
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] leading-relaxed italic">
                        {Number(stats.bpsHoldings || 0).toFixed(4)} BPS backing neural training & agent incentives.
                      </p>
                    </div>
                  </div>
                </div>
              </div>


            </div>
          </div>

          {/* AI Monitoring Widget (2/5 Width) */}
          <div className="lg:col-span-2 flex flex-col space-y-6">
            <h2 className="text-lg font-black uppercase tracking-tight flex items-center gap-2">
              <Brain className="w-5 h-5 text-[#8A2BE2]" />
              AI Pot Monitoring
            </h2>
            
            <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl overflow-hidden flex-1">
              <div className="p-8 space-y-8">
                {/* Balance Display */}
                <div className="space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)]">Current Pot Balance</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-black font-mono text-[var(--text-primary)] tracking-tighter">
                      {Number(brainStats.pot?.totalBps || 0).toFixed(4)}
                    </span>
                    <span className="text-sm font-bold text-[#8A2BE2] uppercase italic">BPS</span>
                  </div>
                </div>

                {/* Sub-stats Grid */}
                <div className="grid grid-cols-2 gap-6 pt-6 border-t border-[var(--border-color)]/50">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)]">
                      <TrendingUp className="w-3 h-3" /> Growth
                    </div>
                    <p className="text-sm font-bold font-mono text-[var(--text-primary)]">+{((brainStats.pot?.totalBps * 0.005) || 0).toFixed(4)} <span className="text-[9px] opacity-50">/24H</span></p>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)]">
                      <Cpu className="w-3 h-3" /> Neural Nodes
                    </div>
                    <p className="text-sm font-bold font-mono text-[var(--text-primary)]">{brainStats.activeNodes || 0} ACTIVE</p>
                  </div>
                </div>

                {/* Training Readiness */}
                <div className="space-y-3 pt-6 border-t border-[var(--border-color)]/50">
                  <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest">
                    <span className="text-[var(--text-secondary)]">Brain Readiness</span>
                    <span className="text-[#8A2BE2]">{brainStats.readinessPct}%</span>
                  </div>
                  <div className="h-2 w-full bg-[var(--bg-primary)] rounded-full overflow-hidden border border-[var(--border-color)]">
                    <div 
                      className="h-full bg-gradient-to-r from-[#8A2BE2] to-[#B266FF] transition-all duration-1000 shadow-[0_0_10px_rgba(138,43,226,0.5)]" 
                      style={{ width: `${brainStats.readinessPct}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-[var(--text-secondary)] italic">
                    Next Reward Event: {Number(brainStats.pot?.nextRewardEvent || 0).toFixed(4)} BPS — Readiness based on {(brainStats.avgEntropy || 0).toFixed(2)} Entropy.
                  </p>
                </div>

                {/* Reward Split Visualization */}
                <div className="space-y-4 pt-6 border-t border-[var(--border-color)]/50">
                  <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)]">Reward Split per Inference</p>
                  <div className="flex rounded-lg overflow-hidden h-6 border border-[var(--border-color)]">
                    <div className="bg-amber-500 flex items-center justify-center text-[8px] font-black text-black" style={{ width: '2%', minWidth: '20px' }}>2%</div>
                    <div className="bg-[#8A2BE2] flex items-center justify-center text-[8px] font-black text-white" style={{ width: '64%' }}>64%</div>
                    <div className="bg-[#0ECB81] flex items-center justify-center text-[8px] font-black text-black" style={{ width: '33%' }}>33%</div>
                    <div className="bg-blue-500 flex items-center justify-center text-[8px] font-black text-white" style={{ width: '1%', minWidth: '16px' }}>1%</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[9px] font-mono">
                    {[
                      { label: 'Router', color: '#F59E0B', value: brainStats.pot?.breakdown?.router?.rewardPerHit },
                      { label: 'Macro', color: '#8A2BE2', value: brainStats.pot?.breakdown?.macro?.rewardPerHit },
                      { label: 'Micro', color: '#0ECB81', value: brainStats.pot?.breakdown?.micro?.rewardPerHit },
                      { label: 'Trainer', color: '#3B82F6', value: brainStats.pot?.breakdown?.trainer?.rewardPerHit },
                    ].map(s => (
                      <div key={s.label} className="flex items-center gap-1.5 p-1.5 bg-[var(--bg-primary)] rounded-md border border-[var(--border-color)]">
                        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: s.color }}></div>
                        <div className="flex justify-between flex-1">
                          <span className="text-[var(--text-secondary)]">{s.label}</span>
                          <span className="font-bold" style={{ color: s.color }}>{(s.value || 0).toFixed(4)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Vault Operations Table */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-black uppercase tracking-tight flex items-center gap-2">
              <Activity className="w-5 h-5 text-[var(--text-secondary)]" />
              Vault Activity Feed
            </h2>
            <div className="flex items-center gap-2">
              <button className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-md hover:bg-[var(--accent-color)] hover:text-black transition-all">Export CSV</button>
            </div>
          </div>

          <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl overflow-hidden transition-colors">
            {stats.operations && stats.operations.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="text-[var(--text-secondary)] border-b border-[var(--border-color)]">
                      <th className="py-4 font-bold px-6 text-[10px] uppercase tracking-widest">Type</th>
                      <th className="py-4 font-bold px-6 text-right text-[10px] uppercase tracking-widest">Asset Amount</th>
                      <th className="py-4 font-bold px-6 text-right text-[10px] uppercase tracking-widest">Execution Price</th>
                      <th className="py-4 font-bold px-6 text-right text-[10px] uppercase tracking-widest">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.operations
                      .slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
                      .map((op) => {
                        let base = '';
                        let quote = '';
                        
                        if ((op.pair || '').includes('/')) {
                          [base, quote] = op.pair.split('/');
                        } else {
                          base = op.pair || '???';
                          quote = 'L1';
                        }

                        let opLabel = '';
                        let badgeClass = '';

                        if (op.type === 'reward') {
                          opLabel = `REWARD DIST (${base})`;
                          badgeClass = 'bg-[#0ECB81]/10 text-[#0ECB81] border-[#0ECB81]/20';
                        } else if (op.type === 'order') {
                          opLabel = `GAME FUND ALLOC (${quote})`;
                          badgeClass = 'bg-blue-500/10 text-blue-400 border-blue-500/20';
                        } else if (op.type === 'settlement') {
                          opLabel = `L1 WITHDRAWAL (${base})`;
                          badgeClass = 'bg-[#F6465D]/10 text-[#F6465D] border-[#F6465D]/20';
                        } else if (op.type === 'deposit') {
                          opLabel = `L1 DEPOSIT (${base})`;
                          badgeClass = 'bg-[#0ECB81]/10 text-[#0ECB81] border-[#0ECB81]/20';
                        } else {
                          if (op.action === 'sell') {
                            opLabel = `SWEEP ${base} → ${quote}`;
                            badgeClass = 'bg-[#F6465D]/10 text-[#F6465D] border-[#F6465D]/20';
                          } else {
                            opLabel = `BID FILLED (${base})`;
                            badgeClass = 'bg-[#0ECB81]/10 text-[#0ECB81] border-[#0ECB81]/20';
                          }
                        }

                        return (
                          <tr key={op.id} className="border-b border-[var(--border-color)]/30 hover:bg-[var(--item-hover)] transition-colors group">
                            <td className="py-4 px-6">
                              <span className={`px-2 py-1 rounded-md text-[9px] font-black tracking-widest border border-transparent uppercase ${badgeClass}`}>
                                {opLabel}
                              </span>
                            </td>
                            <td className="py-4 px-6 text-right font-mono text-sm font-bold text-[var(--text-primary)]">
                              {op.type === 'order' ? (
                                <>
                                  {Number(op.size * (op.price || 1)).toFixed(8)} <span className="text-[var(--text-secondary)] text-[10px] uppercase font-sans italic">{quote}</span>
                                </>
                              ) : (
                                <>
                                  {Number(op.size).toFixed(8)} <span className="text-[var(--text-secondary)] text-[10px] uppercase font-sans italic">{base}</span>
                                </>
                              )}
                            </td>
                            <td className="py-4 px-6 text-right font-mono text-sm font-bold text-[var(--accent-color)]">
                              {op.type === 'trade' ? (
                                <div className="flex items-center justify-end gap-1">
                                  {Number(op.price).toLocaleString()}
                                  <span className="text-[var(--text-secondary)] text-[10px] uppercase font-sans italic">{quote}</span>
                                </div>
                              ) : (
                                <span className="text-[var(--text-secondary)] opacity-30">—</span>
                              )}
                            </td>
                            <td className="py-4 px-6 text-right text-[11px] font-bold text-[var(--text-secondary)] uppercase tabular-nums">
                              {new Date(op.created_at).toLocaleDateString()} {new Date(op.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>

                {/* Pagination */}
                <div className="flex justify-between items-center px-6 py-4 bg-[var(--bg-primary)]/30 border-t border-[var(--border-color)]">
                  <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)] italic">
                    Log Entries {((currentPage - 1) * itemsPerPage) + 1}—{Math.min(currentPage * itemsPerPage, stats.operations.length)}
                  </p>
                  <div className="flex gap-2">
                    <button
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage(p => p - 1)}
                      className="px-4 py-1.5 bg-[var(--bg-tertiary)] hover:bg-[var(--accent-color)] hover:text-black rounded-md transition-all disabled:opacity-30 font-black text-[10px] uppercase tracking-widest"
                    >
                      Prev
                    </button>
                    <button
                      disabled={currentPage * itemsPerPage >= stats.operations.length}
                      onClick={() => setCurrentPage(p => p + 1)}
                      className="px-4 py-1.5 bg-[var(--bg-tertiary)] hover:bg-[var(--accent-color)] hover:text-black rounded-md transition-all disabled:opacity-30 font-black text-[10px] uppercase tracking-widest"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-[var(--text-secondary)] text-sm py-24 text-center border border-dashed border-[var(--border-color)] rounded-2xl m-4">
                <Activity className="w-12 h-12 text-[var(--border-color)] mx-auto mb-4 opacity-50" />
                <p className="font-black uppercase tracking-widest text-xs">No protocol operations detected</p>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

