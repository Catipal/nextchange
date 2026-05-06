import React, { useEffect } from 'react';
import { TrendingUp, TrendingDown, Activity, BarChart3, Clock } from 'lucide-react';
import { useExchange } from '../context/ExchangeContext';

export default function MarketStatsBar() {
  const { ticker, selectedPair } = useExchange();
  const lastPriceRef = React.useRef(ticker?.lastPrice);
  const [flash, setFlash] = React.useState(null); // 'up', 'down', or null
  const [currentDate, setCurrentDate] = React.useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentDate(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (ticker?.lastPrice) {
      document.title = `${Number(ticker.lastPrice).toFixed(2)} | ${selectedPair} | NextChange Hub`;
      
      if (lastPriceRef.current && ticker.lastPrice !== lastPriceRef.current) {
        setFlash(ticker.lastPrice > lastPriceRef.current ? 'up' : 'down');
        const timer = setTimeout(() => setFlash(null), 1000);
        lastPriceRef.current = ticker.lastPrice;
        return () => clearTimeout(timer);
      }
      lastPriceRef.current = ticker.lastPrice;
    }
  }, [ticker, selectedPair]);

  if (!ticker) return (
    <div className="h-14 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] flex items-center px-6 gap-8 animate-pulse">
      <div className="w-32 h-6 bg-[var(--bg-tertiary)] rounded" />
      <div className="w-24 h-4 bg-[var(--bg-tertiary)] rounded" />
      <div className="w-24 h-4 bg-[var(--bg-tertiary)] rounded" />
    </div>
  );

  const isPositive = (ticker.priceChange24h || 0) >= 0;

  return (
    <div className={`h-14 border-b border-[var(--border-color)] flex items-center px-6 gap-8 overflow-x-auto no-scrollbar transition-all duration-500 ${
      flash === 'up' ? 'bg-[#0ECB81]/10' : flash === 'down' ? 'bg-[#F6465D]/10' : 'bg-[var(--bg-secondary)]'
    }`}>
      {/* Primary Price */}
      <div className="flex items-center gap-4 flex-shrink-0 border-r border-[var(--border-color)] pr-8">
        <div className="flex flex-col">
          <span className="text-[10px] text-[var(--text-secondary)] uppercase font-bold tracking-tighter mb-0.5">Last Price</span>
          <div className="flex items-center gap-2">
            <span className={`text-xl font-mono font-bold tracking-tight ${isPositive ? 'text-[#0ECB81]' : 'text-[#F6465D]'}`}>
              {Number(ticker.lastPrice || 0).toFixed(2)}
            </span>
            <span className="text-xs text-[var(--text-secondary)] font-medium">{(selectedPair || '').split('/')[1]}</span>
          </div>
        </div>
      </div>

      {/* 24h Change */}
      <div className="flex flex-col flex-shrink-0">
        <span className="text-[10px] text-[var(--text-secondary)] uppercase font-bold tracking-tighter mb-0.5">24h Change</span>
        <div className={`flex items-center gap-1.5 font-mono text-sm font-bold ${isPositive ? 'text-[#0ECB81]' : 'text-[#F6465D]'}`}>
          {isPositive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
          {(ticker.priceChange24h || 0) > 0 && '+'}{Number(ticker.priceChange24h || 0).toFixed(2)} ({(ticker.priceChangePct24h || 0).toFixed(2)}%)
        </div>
      </div>

      {/* 24h High/Low */}
      <div className="flex items-center gap-8 border-l border-[var(--border-color)] pl-8">
        <div className="flex flex-col flex-shrink-0">
          <span className="text-[10px] text-[var(--text-secondary)] uppercase font-bold tracking-tighter mb-0.5">24h High</span>
          <span className="font-mono text-sm text-[var(--text-primary)] font-medium">{Number(ticker.high24h || 0).toFixed(2)}</span>
        </div>
        <div className="flex flex-col flex-shrink-0">
          <span className="text-[10px] text-[var(--text-secondary)] uppercase font-bold tracking-tighter mb-0.5">24h Low</span>
          <span className="font-mono text-sm text-[var(--text-primary)] font-medium">{Number(ticker.low24h || 0).toFixed(2)}</span>
        </div>
      </div>

      {/* 24h Volume */}
      <div className="flex items-center gap-8 border-l border-[var(--border-color)] pl-8">
        <div className="flex flex-col flex-shrink-0">
          <span className="text-[10px] text-[var(--text-secondary)] uppercase font-bold tracking-tighter mb-0.5">24h Volume ({(selectedPair || '').split('/')[0]})</span>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-3 h-3 text-[var(--accent-color)]" />
            <span className="font-mono text-sm text-[var(--text-primary)] font-medium">{Number(ticker.volume24h || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
        </div>
        <div className="flex flex-col flex-shrink-0">
          <span className="text-[10px] text-[var(--text-secondary)] uppercase font-bold tracking-tighter mb-0.5">Trades</span>
          <div className="flex items-center gap-2">
            <Activity className="w-3 h-3 text-[var(--accent-color)]" />
            <span className="font-mono text-sm text-[var(--text-primary)] font-medium">{ticker.trades24h || 0}</span>
          </div>
        </div>
      </div>

      {/* Timezone / Status */}
      <div className="ml-auto flex items-center gap-4 border-l border-[var(--border-color)] pl-8">
        <div className="flex flex-col items-end">
          <span className="text-[10px] text-[var(--text-secondary)] uppercase font-bold tracking-tighter mb-0.5 flex items-center gap-1">
            <Clock className="w-3 h-3" /> Timezone
          </span>
          <span className="text-[10px] text-[var(--text-primary)] font-bold">
            UTC {currentDate.getUTCHours().toString().padStart(2, '0')}:{currentDate.getUTCMinutes().toString().padStart(2, '0')}
          </span>
        </div>
        <div className="px-3 py-1 bg-[var(--bg-tertiary)] rounded border border-[var(--border-color)] flex flex-col items-center">
          <span className="text-[7px] text-[var(--text-secondary)] uppercase font-bold tracking-[0.2em] leading-tight mb-0.5">Local Machine Time</span>
          <span className="text-[9px] text-[var(--text-primary)] font-bold uppercase tracking-widest">
            {currentDate.toLocaleDateString(undefined, {
              weekday: 'short',
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })}
          </span>
        </div>
      </div>
    </div>
  );
}
