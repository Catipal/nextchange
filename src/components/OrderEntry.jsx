import React, { useState, useMemo, useEffect, useRef } from 'react';
import { ShieldAlert, ArrowLeftRight, Zap, ArrowDownUp } from 'lucide-react';
import { useExchange } from '../context/ExchangeContext';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';

const COINS = [
  { id: 'btc', name: 'Bitcoin',    symbol: 'BTC', color: '#F7931A' },
  { id: 'eth', name: 'Ethereum',   symbol: 'ETH', color: '#627EEA' },
  { id: 'bps', name: 'BitcoinPoS', symbol: 'BPS', color: '#0ECB81' }
];

/* ─── Root ─────────────────────────────────────────────────────────────────── */
export default function OrderEntry() {
  const [mode, setMode] = useState('trade');
  const containerRef = useRef(null);

  return (
    <div ref={containerRef} className="flex flex-col h-full overflow-hidden bg-[var(--bg-secondary)]">
      {/* Mode tabs */}
      <div className="flex items-center gap-1 p-1.5 border-b border-[var(--border-color)] shrink-0">
        {[
          { key: 'trade', label: 'Trade',        icon: Zap },
          { key: 'swap',  label: 'Instant Swap', icon: ArrowLeftRight },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setMode(key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-[10px] font-bold uppercase tracking-widest rounded-md transition-all duration-200 ${
              mode === key
                ? 'bg-[var(--bg-primary)] text-[#dfff00] shadow-[0_0_12px_rgba(223,255,0,0.12)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)]/40'
            }`}
          >
            <Icon className="w-3 h-3" />
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {mode === 'trade' ? <OrderEntryForm /> : <SwapForm />}
      </div>
    </div>
  );
}

/* ─── Trade Form ───────────────────────────────────────────────────────────── */
function OrderEntryForm() {
  const { orderbook, balances, placeOrder, selectedPair, pendingPrice } = useExchange();
  const [baseCurrency, quoteCurrency] = selectedPair.toLowerCase().split('/');

  const [side,      setSide]      = useState('sell');
  const [orderType, setOrderType] = useState('market');
  const [tradeAmount, setTradeAmount] = useState('');
  const [limitPrice,  setLimitPrice]  = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    if (pendingPrice) { setLimitPrice(pendingPrice); setOrderType('limit'); }
  }, [pendingPrice]);

  const baseAvailable  = balances[baseCurrency]?.available  ?? 0;
  const quoteAvailable = balances[quoteCurrency]?.available ?? 0;
  const numAmount      = parseFloat(tradeAmount) || 0;

  // Quick-fill percentages
  const pctFill = (pct) => {
    const max = side === 'sell' ? baseAvailable : (quoteAvailable / (orderbook.asks[0]?.price || 1));
    setTradeAmount(((max * pct) / 100).toFixed(8));
  };

  const totalBidDepth = orderbook.bids.reduce((a, b) => a + b.size, 0);
  const totalAskDepth = orderbook.asks.reduce((a, b) => a + b.size, 0);

  const preview = useMemo(() => {
    if (numAmount <= 0) return null;
    const numLimitPrice = parseFloat(limitPrice) || 0;
    if (orderType === 'limit' && !numLimitPrice) return null;

    const book = side === 'sell' ? [...orderbook.bids] : [...orderbook.asks];
    const crossingOrders = orderType === 'market'
      ? book
      : book.filter(o => side === 'sell' ? o.price >= numLimitPrice : o.price <= numLimitPrice);
    const totalOpposingDepth = side === 'sell' ? totalBidDepth : totalAskDepth;
    const impactRatio = (crossingOrders.length > 0 && totalOpposingDepth > 0) ? Math.min(numAmount / totalOpposingDepth, 1.0) : 0;
    const totalFeePct = Math.max(impactRatio, 0.0002);
    const halfFeePct  = totalFeePct / 2;

    let expectedGross  = 0;
    let executedBase   = 0;
    
    if (crossingOrders.length > 0) {
      let availableDepth = crossingOrders.reduce((s, o) => s + o.size, 0);
      let remaining = Math.min(numAmount, availableDepth);
      for (const o of crossingOrders) {
        if (remaining <= 0) break;
        const fill = Math.min(remaining, o.size);
        expectedGross += fill * o.price;
        remaining -= fill;
      }
      executedBase = Math.min(numAmount, availableDepth);
    } else if (orderType === 'limit' && numLimitPrice > 0) {
      // Resting order (Maker)
      executedBase = 0;
      expectedGross = numAmount * numLimitPrice;
    } else {
      return null;
    }

    const bestPrice    = crossingOrders[0]?.price || 0;
    const averagePrice = executedBase > 0 ? expectedGross / executedBase : (numLimitPrice || bestPrice);
    const slippage     = executedBase > 0 && bestPrice > 0
      ? Math.abs(((averagePrice - bestPrice) / bestPrice) * 100) : 0;

    const takerProceeds = side === 'sell'
      ? expectedGross * (1 - halfFeePct)
      : (executedBase > 0 ? executedBase * (1 - halfFeePct) : numAmount * (1 - halfFeePct));
    
    const userPays = side === 'sell' ? numAmount : expectedGross;

    return {
      impactRatio, totalFeePct, expectedGross, executedBase,
      takerProceeds, userPays, availableDepth: crossingOrders.reduce((s, o) => s + o.size, 0), slippage
    };
  }, [numAmount, side, orderbook, orderType, limitPrice, totalBidDepth, totalAskDepth]);

  const handleExecute = async () => {
    setLoading(true); setMessage(null);
    try {
      const result = await placeOrder({
        side, type: orderType, size: numAmount,
        price: orderType === 'limit' ? parseFloat(limitPrice) : undefined
      });
      setMessage({ type: 'success', text: `${orderType === 'market' ? 'Market' : 'Limit'} ${side} filled: ${result.filled} ${baseCurrency.toUpperCase()} across ${result.trades?.length ?? 1} trade${result.trades?.length !== 1 ? 's' : ''}` });
      setTradeAmount('');
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.error || err.message });
    }
    setLoading(false);
  };

  const isBuy     = side === 'buy';
  const isLimit   = orderType === 'limit';
  const sideColor = isBuy ? '#0ECB81' : '#F6465D';
  const btnLabel  = `${isLimit ? 'Place' : 'Market'} ${isLimit ? (isBuy ? 'Bid' : 'Ask') : (isBuy ? 'Buy' : 'Sell')}`;

  const numLimitPrice = parseFloat(limitPrice) || 0;
  const isValid = numAmount > 0 && (!isLimit || numLimitPrice > 0);

  return (
    <div className="flex flex-col gap-0 h-full">
      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3">

        {/* ── Order Type Tabs ── */}
        <div className="flex rounded-lg overflow-hidden border border-[var(--border-color)] bg-[var(--bg-primary)] p-0.5 gap-0.5">
          {[['market', 'Market (Sweep)'], ['limit', 'Limit (Maker)']].map(([t, label]) => (
            <button
              key={t}
              onClick={() => setOrderType(t)}
              className={`flex-1 py-2 text-[10px] font-bold rounded-md uppercase tracking-wider transition-all duration-150 ${
                orderType === t
                  ? 'bg-[var(--bg-tertiary)] text-white'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Side Tabs ── */}
        <div className="flex rounded-lg overflow-hidden border border-[var(--border-color)] bg-[var(--bg-primary)] p-0.5 gap-0.5">
          <button
            onClick={() => setSide('buy')}
            className={`flex-1 py-2.5 text-[11px] font-bold rounded-md uppercase tracking-widest transition-all duration-150 ${
              isBuy
                ? 'bg-[#0ECB81] text-black shadow-[0_0_14px_rgba(14,203,129,0.4)]'
                : 'text-[var(--text-secondary)] hover:text-[#0ECB81]'
            }`}
          >
            {isLimit ? 'Bid' : 'Buy'}
          </button>
          <button
            onClick={() => setSide('sell')}
            className={`flex-1 py-2.5 text-[11px] font-bold rounded-md uppercase tracking-widest transition-all duration-150 ${
              !isBuy
                ? 'bg-[#F6465D] text-white shadow-[0_0_14px_rgba(246,70,93,0.4)]'
                : 'text-[var(--text-secondary)] hover:text-[#F6465D]'
            }`}
          >
            {isLimit ? 'Ask' : 'Sell'}
          </button>
        </div>

        {/* ── Limit Price (only in limit mode) ── */}
        {isLimit && (
          <div className="relative flex items-center bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg focus-within:border-[#dfff00]/50 transition-colors">
            <label className="absolute left-3 top-1.5 text-[8px] font-bold uppercase tracking-[0.15em] text-[var(--text-secondary)]">
              Price
            </label>
            <input
              type="number"
              value={limitPrice}
              onChange={e => setLimitPrice(e.target.value)}
              className="w-full pt-5 pb-2 pl-3 pr-16 bg-transparent text-sm font-mono font-bold text-white outline-none placeholder:text-[var(--text-secondary)]/30"
              placeholder="0.00"
            />
            <span className="absolute right-3 text-[10px] font-bold text-[var(--text-secondary)] pointer-events-none">
              {quoteCurrency.toUpperCase()}
            </span>
          </div>
        )}

        {/* ── Amount Input ── */}
        <div className="relative flex items-center bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg focus-within:border-[#dfff00]/50 transition-colors">
          <label className="absolute left-3 top-1.5 text-[8px] font-bold uppercase tracking-[0.15em] text-[var(--text-secondary)]">
            Amount ({baseCurrency.toUpperCase()})
          </label>
          <input
            type="number"
            value={tradeAmount}
            onChange={e => setTradeAmount(e.target.value)}
            className="w-full pt-5 pb-2 pl-3 pr-14 bg-transparent text-sm font-mono font-bold text-white outline-none placeholder:text-[var(--text-secondary)]/30"
            placeholder="0.00"
          />
          <span className="absolute right-3 text-[10px] font-bold text-[var(--text-secondary)] pointer-events-none">
            {baseCurrency.toUpperCase()}
          </span>
        </div>

        {/* ── Quick % Buttons ── */}
        <div className="grid grid-cols-4 gap-1.5">
          {[25, 50, 75, 100].map(pct => (
            <button
              key={pct}
              onClick={() => pctFill(pct)}
              className="py-1.5 text-[9px] font-bold text-[var(--text-secondary)] bg-[var(--bg-primary)] border border-[var(--border-color)] rounded hover:border-[var(--accent-color)]/50 hover:text-[var(--text-primary)] transition-all"
            >
              {pct}%
            </button>
          ))}
        </div>

        {/* ── Preview Panel ── */}
        {preview && (
          <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] overflow-hidden font-sans mt-2">
            {/* Depth */}
            <div className="flex justify-between items-center px-3 py-1.5">
              <span className="text-[9px] text-[var(--text-secondary)] uppercase tracking-[0.1em] font-medium">Available Matching Depth</span>
              <span className="text-[9px] font-mono text-[var(--text-primary)] font-bold">
                {preview.availableDepth.toFixed(2)} {baseCurrency.toUpperCase()}
              </span>
            </div>
            {/* Dynamic Fee */}
            <div className="flex justify-between items-center px-3 py-1.5">
              <span className="text-[9px] text-[var(--text-secondary)] uppercase tracking-[0.1em] font-medium">Dynamic Fee</span>
              <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded border transition-colors ${
                preview.totalFeePct > 0.02 
                  ? 'bg-red-500/20 border-red-500/40 text-red-400' 
                  : preview.totalFeePct > 0.005 
                    ? 'bg-orange-500/20 border-orange-500/40 text-orange-400' 
                    : 'bg-[var(--bg-tertiary)] border-[var(--border-color)] text-[var(--text-primary)]'
              }`}>
                {(preview.totalFeePct * 100).toFixed(2)}%
              </span>
            </div>
            {/* Slippage */}
            <div className="flex justify-between items-center px-3 py-1.5">
              <span className="text-[9px] text-[var(--text-secondary)] uppercase tracking-[0.1em] font-medium">Est. Slippage</span>
              <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded border transition-colors ${
                preview.slippage > 2
                  ? 'bg-orange-500/20 border-orange-500/40 text-orange-400'
                  : 'bg-[var(--bg-tertiary)] border-[var(--border-color)] text-[var(--text-primary)]'
              }`}>
                {preview.slippage.toFixed(2)}%
              </span>
            </div>
            {/* You Pay */}
            <div className="flex justify-between items-center px-3 py-2 mt-1 bg-[var(--bg-secondary)]/30">
              <span className="text-[9px] text-[var(--text-secondary)] uppercase tracking-[0.15em] font-bold">You Pay</span>
              <span className="text-[10px] font-mono font-bold text-[var(--text-primary)]">
                {preview.userPays.toFixed(4)} {side === 'sell' ? baseCurrency.toUpperCase() : quoteCurrency.toUpperCase()}
              </span>
            </div>
            {/* You Receive */}
            <div className="flex justify-between items-center px-3 py-2 bg-[var(--bg-secondary)]/30">
              <span className="text-[9px] text-[var(--text-secondary)] uppercase tracking-[0.15em] font-bold">You Receive (Net)</span>
              <span className="text-[10px] font-mono font-bold text-[#0ECB81]">
                +{preview.takerProceeds.toFixed(4)} {side === 'sell' ? quoteCurrency.toUpperCase() : baseCurrency.toUpperCase()}
              </span>
            </div>
            {/* High-impact warning */}
            {preview.impactRatio > 0.1 && (
              <div className="px-3 py-3 border-t border-red-500/20 bg-red-500/8 flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-3.5 h-3.5 text-red-500 shrink-0" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-red-400">High Impact Warning</span>
                </div>
                <p className="text-[10px] text-red-400 font-medium leading-relaxed pl-5">
                  Sweeping <span className="text-red-400 font-bold font-mono">{(preview.impactRatio * 100).toFixed(1)}%</span> of opposing depth — executing <span className="text-red-400 font-bold font-mono">{preview.executedBase.toFixed(4)} {baseCurrency.toUpperCase()}</span> across the orderbook.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Status message ── */}
        {message && (
          <div className={`px-3 py-2.5 rounded-lg text-[9px] font-medium border ${
            message.type === 'success'
              ? 'bg-[#0ECB81]/10 text-[#0ECB81] border-[#0ECB81]/25'
              : 'bg-[#F6465D]/10 text-[#F6465D] border-[#F6465D]/25'
          }`}>
            {message.text}
          </div>
        )}
      </div>

      {/* ── Execute Button — pinned to bottom ── */}
      <div className="p-3 pt-0 shrink-0">
        <button
          onClick={handleExecute}
          disabled={!isValid || loading}
          className="w-full py-4 rounded-lg font-bold text-[11px] uppercase tracking-widest transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            backgroundColor: isValid && !loading ? sideColor : 'var(--bg-tertiary)',
            color: isValid && !loading ? (isBuy ? '#000' : '#fff') : 'var(--text-secondary)',
            boxShadow: isValid && !loading ? `0 4px 20px ${sideColor}33` : 'none',
          }}
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              Processing…
            </span>
          ) : btnLabel}
        </button>
      </div>
    </div>
  );
}

/* ─── Swap Form ────────────────────────────────────────────────────────────── */
function SwapForm() {
  const { balances, fetchBalances } = useExchange();
  const { signOrder } = useAuth();

  const [fromCoin,  setFromCoin]  = useState(COINS[0]);
  const [toCoin,    setToCoin]    = useState(COINS[2]);
  const [fromAmount, setFromAmount] = useState('');
  const [toAmount,   setToAmount]   = useState('0');
  const [loading,    setLoading]    = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [error,      setError]      = useState(null);
  const [success,    setSuccess]    = useState(null);
  const [exchangeRate, setExchangeRate] = useState(null);
  const [estimatedFee, setEstimatedFee] = useState(0);

  const getRoute = (from, to) => {
    if (from.id === to.id) return [];
    // Direct hops
    if (from.id === 'btc' && to.id === 'bps') return [{ pair: 'BTC/BPS', side: 'sell' }];
    if (from.id === 'bps' && to.id === 'btc') return [{ pair: 'BTC/BPS', side: 'buy'  }];
    if (from.id === 'eth' && to.id === 'bps') return [{ pair: 'ETH/BPS', side: 'sell' }];
    if (from.id === 'bps' && to.id === 'eth') return [{ pair: 'ETH/BPS', side: 'buy'  }];
    // Multi-hop (via BPS)
    if (from.id === 'btc' && to.id === 'eth') return [
      { pair: 'BTC/BPS', side: 'sell' },
      { pair: 'ETH/BPS', side: 'buy' }
    ];
    if (from.id === 'eth' && to.id === 'btc') return [
      { pair: 'ETH/BPS', side: 'sell' },
      { pair: 'BTC/BPS', side: 'buy' }
    ];
    return [];
  };

  const routeHops = getRoute(fromCoin, toCoin);

  useEffect(() => {
    const deb = setTimeout(async () => {
      if (!fromAmount || parseFloat(fromAmount) <= 0 || routeHops.length === 0) return;
      setEstimating(true);
      try {
        let currentInput = parseFloat(fromAmount);
        let finalGained = 0;
        
        let totalFeeMultiplier = 1;
        
        for (const hop of routeHops) {
          const res = await api.get(`/market/orderbook?pair=${hop.pair}`);
          const orders = hop.side === 'buy' ? res.data.asks : res.data.bids;
          const totalDepth = orders.reduce((acc, o) => acc + o.size, 0);
          
          let hopGained = 0;
          let rem = currentInput;
          
          for (const o of orders) {
            if (rem <= 0) break;
            if (hop.side === 'buy') {
              const fillQuote = Math.min(rem, o.size * o.price);
              hopGained += fillQuote / o.price;
              rem -= fillQuote;
            } else {
              const fillBase = Math.min(rem, o.size);
              hopGained += fillBase * o.price;
              rem -= fillBase;
            }
          }
          
          const impactRatio = totalDepth > 0 ? Math.min(hopGained / totalDepth, 1.0) : 0;
          const feePct = Math.max(impactRatio, 0.0002);
          totalFeeMultiplier *= (1 - feePct);
          currentInput = hopGained * (1 - feePct);
          finalGained = currentInput;
        }
        
        setToAmount(finalGained.toFixed(8));
        setExchangeRate(finalGained / parseFloat(fromAmount));
        setEstimatedFee(1 - totalFeeMultiplier);
      } catch (e) { 
        setError(e.message); 
      } finally { 
        setEstimating(false); 
      }
    }, 500);
    return () => clearTimeout(deb);
  }, [fromCoin, toCoin, fromAmount]);

  const executeSwap = async () => {
    if (routeHops.length === 0 || !fromAmount) return;
    setLoading(true); setError(null); setSuccess(null);
    try {
      let currentInput = parseFloat(fromAmount);
      
      for (const hop of routeHops) {
        const signed = await signOrder({ 
          pair: hop.pair, 
          side: hop.side, 
          type: 'market', 
          size: currentInput 
        });
        const res = await api.post('/orders', signed);
        // Next hop input is the filled amount (net of fees)
        // Note: In a real system we'd check the exact fills from 'res.data'
        currentInput = res.data.filled * (1 - (res.data.feePct || 0.001)); 
      }
      
      setSuccess('Multi-hop swap executed successfully');
      setFromAmount('');
      fetchBalances();
    } catch (err) { 
      setError(err.message); 
    } finally { 
      setLoading(false); 
    }
  };

  const CoinSelect = ({ value, onChange }) => (
    <select
      value={value}
      onChange={e => onChange(COINS.find(c => c.id === e.target.value))}
      className="bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-[10px] font-bold text-[var(--text-primary)] rounded-md px-2 py-1 outline-none cursor-pointer hover:border-[var(--accent-color)]/40 transition-colors"
    >
      {COINS.map(c => <option key={c.id} value={c.id}>{c.symbol}</option>)}
    </select>
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">

        {/* Pay panel */}
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
          <div className="flex justify-between items-center mb-2">
            <span className="text-[8px] font-bold uppercase tracking-[0.15em] text-[var(--text-secondary)]">Pay</span>
            <span className="text-[8px] text-[var(--text-secondary)] font-mono">
              Bal: <span className="text-[var(--text-primary)]">{balances[fromCoin.id]?.available?.toFixed(4) ?? '—'}</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={fromAmount}
              onChange={e => setFromAmount(e.target.value)}
              className="flex-1 bg-transparent text-base font-mono font-bold text-white outline-none placeholder:text-[var(--text-secondary)]/30"
              placeholder="0.00"
            />
            <CoinSelect value={fromCoin.id} onChange={setFromCoin} />
          </div>
        </div>

        {/* Swap arrow */}
        <div className="flex justify-center">
          <div className="w-8 h-8 rounded-full bg-[var(--bg-tertiary)] border-2 border-[var(--bg-secondary)] flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--accent-color)] hover:border-[var(--accent-color)]/40 transition-colors">
            <ArrowDownUp className="w-3.5 h-3.5" />
          </div>
        </div>

        {/* Receive panel */}
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3">
          <div className="flex justify-between items-center mb-2">
            <span className="text-[8px] font-bold uppercase tracking-[0.15em] text-[var(--text-secondary)]">Receive</span>
            {exchangeRate && (
              <span className="text-[8px] text-[var(--text-secondary)] font-mono">
                1 {fromCoin.symbol} ≈ <span className="text-[var(--text-primary)]">{exchangeRate.toFixed(4)}</span> {toCoin.symbol}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className={`flex-1 text-base font-mono font-bold transition-colors ${estimating ? 'text-[var(--text-secondary)] animate-pulse' : 'text-[#0ECB81]'}`}>
              {estimating ? '…' : toAmount}
            </div>
            <CoinSelect value={toCoin.id} onChange={setToCoin} />
          </div>
        </div>

        {/* Routing & Fees */}
        <div className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-[8px] uppercase tracking-widest text-[var(--text-secondary)]">Routing Path</span>
            <span className="text-[9px] font-mono font-bold text-[var(--accent-color)]">
              {routeHops.length > 0 
                ? [fromCoin.symbol, ...routeHops.map(h => h.pair.split('/')[h.side === 'sell' ? 1 : 0])].join(' → ')
                : '—'
              }
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-[8px] uppercase tracking-widest text-[var(--text-secondary)]">Est. Dynamic Fee</span>
            <span className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded border ${
              estimatedFee > 0.01 ? 'bg-orange-500/20 border-orange-500/40 text-orange-400' : 'bg-[var(--bg-tertiary)] border-[var(--border-color)] text-[var(--text-primary)]'
            }`}>
              {(estimatedFee * 100).toFixed(3)}%
            </span>
          </div>
        </div>

        {error   && <div className="text-[9px] px-3 py-2 rounded-lg bg-[#F6465D]/10 text-[#F6465D] border border-[#F6465D]/20 font-medium">{error}</div>}
        {success && <div className="text-[9px] px-3 py-2 rounded-lg bg-[#0ECB81]/10 text-[#0ECB81] border border-[#0ECB81]/20 font-medium">{success}</div>}
      </div>

      {/* Swap button — pinned bottom */}
      <div className="p-3 pt-0 shrink-0">
        <button
          onClick={executeSwap}
          disabled={loading || !fromAmount}
          className="w-full py-4 rounded-lg font-bold text-[11px] uppercase tracking-widest bg-[#dfff00] text-black hover:brightness-105 shadow-[0_4px_20px_rgba(223,255,0,0.2)] transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin" />
              Swapping…
            </span>
          ) : 'Confirm Swap'}
        </button>
      </div>
    </div>
  );
}
