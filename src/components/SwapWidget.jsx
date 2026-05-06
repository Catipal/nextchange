import React, { useState, useEffect, useCallback } from 'react';
import { ArrowDown, RefreshCw, AlertCircle, CheckCircle2, Wallet, ArrowLeftRight } from 'lucide-react';
import { useExchange } from '../context/ExchangeContext';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';

const COINS = [
  { id: 'btc', name: 'Bitcoin', symbol: 'BTC', color: '#F7931A' },
  { id: 'eth', name: 'Ethereum', symbol: 'ETH', color: '#627EEA' },
  { id: 'bps', name: 'BitcoinPoS', symbol: 'BPS', color: '#0ECB81' }
];

export default function SwapWidget() {
  const { balances, fetchBalances } = useExchange();
  const { signOrder } = useAuth();
  
  const [fromCoin, setFromCoin] = useState(COINS[0]);
  const [toCoin, setToCoin] = useState(COINS[2]);
  const [fromAmount, setFromAmount] = useState('');
  const [toAmount, setToAmount] = useState('0');
  
  const [loading, setLoading] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  
  const [route, setRoute] = useState([]);
  const [exchangeRate, setExchangeRate] = useState(null);
  const [totalFee, setTotalFee] = useState('0.10');

  // Determine the trade route
  const getRoute = useCallback((from, to) => {
    if (from.id === to.id) return [];
    if (from.id === 'btc' && to.id === 'bps') return [{ pair: 'BTC/BPS', side: 'sell' }];
    if (from.id === 'bps' && to.id === 'btc') return [{ pair: 'BTC/BPS', side: 'buy' }];
    if (from.id === 'eth' && to.id === 'bps') return [{ pair: 'ETH/BPS', side: 'sell' }];
    if (from.id === 'bps' && to.id === 'eth') return [{ pair: 'ETH/BPS', side: 'buy' }];
    if (from.id === 'btc' && to.id === 'eth') return [
      { pair: 'BTC/BPS', side: 'sell' },
      { pair: 'ETH/BPS', side: 'buy' }
    ];
    if (from.id === 'eth' && to.id === 'btc') return [
      { pair: 'ETH/BPS', side: 'sell' },
      { pair: 'BTC/BPS', side: 'buy' }
    ];
    return [];
  }, []);

  const estimateOutput = useCallback(async (amount, currentRoute) => {
    if (!amount || isNaN(amount) || amount <= 0 || currentRoute.length === 0) {
      setToAmount('0');
      setExchangeRate(null);
      return;
    }

    setEstimating(true);
    try {
      let currentAmount = parseFloat(amount);
      if (isNaN(currentAmount)) throw new Error('Invalid input amount');
      
      for (const step of currentRoute) {
        const res = await api.get(`/market/orderbook?pair=${step.pair}`);
        const book = res.data;
        const orders = step.side === 'buy' ? (book.asks || []) : (book.bids || []);
        
        let gainedAmount = 0;
        let remainingToFill = currentAmount;

        if (step.side === 'buy') {
          for (const order of orders) {
            const p = Number(order.price);
            const s = Number(order.size);
            const orderCost = p * s;
            if (remainingToFill <= orderCost) {
              gainedAmount += remainingToFill / p;
              remainingToFill = 0;
              break;
            } else {
              gainedAmount += s;
              remainingToFill -= orderCost;
            }
          }
        } else {
          for (const order of orders) {
            const p = Number(order.price);
            const s = Number(order.size);
            if (remainingToFill <= s) {
              gainedAmount += remainingToFill * p;
              remainingToFill = 0;
              break;
            } else {
              gainedAmount += s * p;
              remainingToFill -= s;
            }
          }
        }
        
        if (remainingToFill > 0) throw new Error(`Insufficient liquidity on ${step.pair}`);
        
        const totalDepth = orders.reduce((sum, o) => sum + (Number(o.size) - Number(o.filled || 0)), 0);
        const impactRatio = totalDepth > 0 ? Math.min(currentAmount / totalDepth, 1.0) : 1.0;
        const stepFeePct = Math.max(impactRatio, 0.0001) / 2;
        
        currentAmount = gainedAmount * (1 - stepFeePct);
      }
      
      const baseRate = await (async () => {
        try {
          if (currentRoute.length === 0) return 1;
          let rate = 1;
          for (const step of currentRoute) {
            const res = await api.get(`/market/ticker?pair=${step.pair}`);
            const price = Number(res.data.lastPrice) || 1;
            rate = step.side === 'buy' ? rate / price : rate * price;
          }
          return rate;
        } catch { return 1; }
      })();

      if (isNaN(currentAmount) || !isFinite(currentAmount)) throw new Error('Calculation error');

      setToAmount(currentAmount.toFixed(8));
      setExchangeRate(currentAmount / amount);
      const totalCostRaw = amount * baseRate;
      setTotalFee(totalCostRaw > 0 ? ((1 - (currentAmount / totalCostRaw)) * 100).toFixed(2) : '0.10');
    } catch (err) {
      console.error('[Swap] Estimate error:', err);
      setToAmount('0');
      setError(err.message || 'Error estimating swap');
    } finally {
      setEstimating(false);
    }
  }, []);

  useEffect(() => {
    const newRoute = getRoute(fromCoin, toCoin);
    setRoute(newRoute);
    
    const debounce = setTimeout(() => {
      estimateOutput(fromAmount, newRoute);
    }, 500);
    
    return () => clearTimeout(debounce);
  }, [fromCoin, toCoin, fromAmount, getRoute, estimateOutput]);

  const handleSwapCoins = () => {
    const temp = fromCoin;
    setFromCoin(toCoin);
    setToCoin(temp);
    setFromAmount(toAmount === '0' ? '' : toAmount);
  };

  const handleMax = () => {
    const bal = balances[fromCoin.id]?.available || 0;
    setFromAmount(bal.toString());
  };

  const executeSwap = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    
    try {
      let currentInAmount = parseFloat(fromAmount);
      
      for (let i = 0; i < route.length; i++) {
        const step = route[i];
        
        let orderSize;
        if (step.side === 'sell') {
          orderSize = currentInAmount;
        } else {
          const tickerRes = await api.get(`/market/ticker?pair=${step.pair}`);
          const price = tickerRes.data.bestAsk || tickerRes.data.lastPrice;
          orderSize = (currentInAmount / price) * 0.99; 
        }

        const rawOrder = {
          pair: step.pair,
          side: step.side,
          type: 'market',
          size: orderSize
        };
        
        const signedOrder = await signOrder(rawOrder);
        const res = await api.post('/orders', signedOrder);
        
        const gained = res.data.trades.reduce((acc, t) => acc + (step.side === 'buy' ? t.size : t.size * t.price), 0);
        currentInAmount = gained;
      }
      
      setSuccess('Swap completed successfully!');
      setFromAmount('');
      fetchBalances();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Swap failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full p-4 overflow-y-auto">
      <div className="space-y-4">
        {/* From Section */}
        <div className="bg-[var(--bg-primary)] rounded-xl p-3 border border-[var(--border-color)] focus-within:border-[var(--accent-color)]/50 transition-colors">
           <div className="flex justify-between items-center mb-1.5">
             <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest">You Pay</label>
             <div className="flex items-center gap-1 text-[10px] text-[var(--text-secondary)]">
                <Wallet className="w-2.5 h-2.5" />
                <span>{(balances[fromCoin.id]?.available || 0).toFixed(fromCoin.id === 'bps' ? 2 : 6)} {fromCoin.symbol}</span>
                <button onClick={handleMax} className="text-[var(--accent-color)] font-bold hover:underline ml-0.5">MAX</button>
             </div>
           </div>
           <div className="flex items-center gap-2">
             <input
               type="number"
               value={fromAmount}
               onChange={(e) => setFromAmount(e.target.value)}
               className="flex-1 bg-transparent border-none text-xl font-mono text-[var(--text-primary)] focus:outline-none placeholder-[var(--text-secondary)]/30"
               placeholder="0.00"
             />
             <select
               value={fromCoin.id}
               onChange={(e) => setFromCoin(COINS.find(c => c.id === e.target.value))}
               className="bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-color)] rounded-lg px-2 py-1 text-xs font-bold outline-none cursor-pointer transition-colors"
             >
               {COINS.map(c => (
                 <option key={c.id} value={c.id} className="bg-[var(--bg-secondary)]">{c.symbol}</option>
               ))}
             </select>
           </div>
        </div>

        {/* Swap Button */}
        <div className="flex justify-center -my-6 relative z-10">
           <button 
             onClick={handleSwapCoins}
             className="bg-[var(--bg-tertiary)] border-4 border-[var(--bg-secondary)] rounded-xl p-1.5 hover:bg-[var(--accent-color)] hover:text-black transition-all group shadow-lg text-[var(--text-primary)]"
           >
             <ArrowDown className="w-4 h-4 group-hover:rotate-180 transition-transform duration-300" />
           </button>
        </div>

        {/* To Section */}
        <div className="bg-[var(--bg-primary)] rounded-xl p-3 border border-[var(--border-color)] transition-colors">
           <div className="flex justify-between items-center mb-1.5">
             <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest">You Receive</label>
           </div>
           <div className="flex items-center gap-2">
             <div className="flex-1 text-xl font-mono text-[var(--text-primary)] overflow-hidden text-ellipsis whitespace-nowrap">
                {estimating ? '...' : toAmount}
             </div>
             <select
               value={toCoin.id}
               onChange={(e) => setToCoin(COINS.find(c => c.id === e.target.value))}
               className="bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-color)] rounded-lg px-2 py-1 text-xs font-bold outline-none cursor-pointer transition-colors"
             >
               {COINS.map(c => (
                 <option key={c.id} value={c.id} className="bg-[var(--bg-secondary)]">{c.symbol}</option>
               ))}
             </select>
           </div>
        </div>

        {/* Stats & Route */}
        <div className="px-0.5 text-[10px] text-[var(--text-secondary)] flex flex-col gap-1">
          {route.length > 1 && (
            <div className="flex justify-between items-center bg-[var(--bg-primary)] rounded-lg px-2 py-1.5 mb-1 border border-[var(--border-color)]/50 transition-colors">
              <span className="font-bold uppercase tracking-tighter text-[9px]">Route</span>
              <div className="flex items-center gap-1.5">
                <span className="text-[var(--text-primary)] font-medium">{fromCoin.symbol}</span>
                <ArrowDown className="w-2.5 h-2.5 rotate-270 text-[var(--accent-color)]/50" />
                <span className="text-[var(--accent-color)]">.hub</span>
                <ArrowDown className="w-2.5 h-2.5 rotate-270 text-[var(--accent-color)]/50" />
                <span className="text-[var(--text-primary)] font-medium">{toCoin.symbol}</span>
              </div>
            </div>
          )}
          
          {exchangeRate && (
            <>
              <div className="flex justify-between">
                 <span>Exchange Rate</span>
                 <span className="font-mono">1 {fromCoin.symbol} ≈ {exchangeRate.toFixed(6)} {toCoin.symbol}</span>
              </div>
              <div className="flex justify-between">
               <span>Estimated Total Fee</span>
               <span className="text-[#0ECB81] font-mono">~ {totalFee} %</span>
            </div>
            </>
          )}
        </div>

        {/* Messages */}
        {error && (
          <div className="bg-[#F6465D]/10 border border-[#F6465D]/30 rounded-lg p-3 flex items-start gap-3">
            <AlertCircle className="w-4 h-4 text-[#F6465D] shrink-0 mt-0.5" />
            <p className="text-[10px] text-[var(--text-primary)] font-medium leading-tight">{error}</p>
          </div>
        )}

        {success && (
          <div className="bg-[#0ECB81]/10 border border-[#0ECB81]/30 rounded-lg p-3 flex items-start gap-3">
            <CheckCircle2 className="w-4 h-4 text-[#0ECB81] shrink-0 mt-0.5" />
            <p className="text-[10px] text-[#0ECB81] font-medium leading-tight">{success}</p>
          </div>
        )}

        {/* Submit Button */}
        <button
          onClick={executeSwap}
          disabled={loading || !fromAmount || parseFloat(fromAmount) <= 0 || fromCoin.id === toCoin.id || (balances[fromCoin.id]?.available || 0) < parseFloat(fromAmount)}
          className="w-full py-3 bg-[var(--accent-color)] text-black font-bold rounded-lg hover:bg-[var(--accent-color)]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-[11px] uppercase tracking-wide shadow-[0_0_15px_rgba(223,255,0,0.2)] flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              Processing...
            </>
          ) : (
            'Confirm Swap'
          )}
        </button>
      </div>
    </div>
  );
}
