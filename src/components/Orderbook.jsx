import React from 'react';
import { ArrowRightLeft } from 'lucide-react';
import { useExchange } from '../context/ExchangeContext';

export default function Orderbook() {
  const { orderbook, selectedPair, ticker, setPendingPrice } = useExchange();
  const { bids, asks } = orderbook;
  const [baseCurrency, quoteCurrency] = selectedPair.toUpperCase().split('/');

  const totalBidDepth = bids.reduce((acc, b) => acc + b.size, 0);
  const totalAskDepth = asks.reduce((acc, a) => acc + a.size, 0);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex text-xs font-medium text-[var(--text-secondary)] px-4 py-2 border-b border-[var(--border-color)]">
        <div className="flex-1">Price ({quoteCurrency})</div>
        <div className="flex-1 text-right">Size ({baseCurrency})</div>
        <div className="flex-1 text-right">Total ({baseCurrency})</div>
      </div>

      {/* Asks */}
      <div className="flex-1 overflow-y-auto font-mono text-sm flex flex-col-reverse bg-[var(--bg-primary)] transition-colors">
        {asks.length === 0 && <div className="text-center text-[var(--text-secondary)] text-xs py-2">No asks available</div>}
        {asks.map((ask, i) => {
          const cumulative = asks.slice(0, i + 1).reduce((sum, a) => sum + a.size, 0);
          const depthPct = totalAskDepth > 0 ? (cumulative / totalAskDepth) * 100 : 0;
          return (
            <div 
              key={`ask-${i}`} 
              onClick={() => setPendingPrice(Number(ask.price).toFixed(2))}
              className="relative flex px-4 py-1 hover:bg-[var(--accent-color)]/20 cursor-pointer group flex-shrink-0 transition-colors"
            >
              <div className="absolute right-0 top-0 bottom-0 bg-[#F6465D]/10" style={{ width: `${depthPct}%` }} />
              <div className="flex-1 text-[#F6465D] relative z-10 font-bold">{Number(ask.price).toFixed(2)}</div>
              <div className="flex-1 text-right text-[var(--text-primary)] relative z-10">{Number(ask.size).toFixed(8)}</div>
              <div className="flex-1 text-right text-[var(--text-secondary)] relative z-10">{cumulative.toFixed(8)}</div>
            </div>
          );
        })}
      </div>

      {/* Last Price & Volume (Center) */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 bg-[var(--bg-secondary)] border-y border-[var(--border-color)] transition-colors">
        <div className="flex flex-col">
          <span className={`text-xl font-bold tracking-wider leading-none ${
              ticker?.lastPrice >= (bids[0]?.price || 0) ? 'text-[#0ECB81]' : 'text-[#F6465D]'
            }`}>
            {ticker?.lastPrice ? Number(ticker.lastPrice).toFixed(2) : '---'}
          </span>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-[10px] text-[var(--text-secondary)] uppercase tracking-tight">24h Vol:</span>
            <span className="text-[11px] font-mono text-[var(--text-primary)] font-bold">
              {ticker?.volume24h ? Number(ticker.volume24h).toFixed(2) : '0.00'}
            </span>
          </div>
        </div>
        
        <div className="flex flex-col items-end">
          <span className="text-xs text-gray-400 flex items-center gap-2 mb-0.5">
            <ArrowRightLeft className="w-3 h-3 text-[#DFFF00]" />
            Spread: {asks.length > 0 && bids.length > 0
              ? Math.abs(Number(asks[0].price) - Number(bids[0].price)).toFixed(2)
              : '--'}
          </span>
          {asks.length > 0 && bids.length > 0 && (
            <span className="text-[9px] text-[var(--text-secondary)] font-mono">
              {((Math.abs(Number(asks[0].price) - Number(bids[0].price)) / Number(asks[0].price)) * 100).toFixed(4)}%
            </span>
          )}
        </div>
      </div>

      {/* Bids */}
      <div className="flex-1 overflow-y-auto font-mono text-sm bg-[var(--bg-primary)] transition-colors">
        {bids.length === 0 && <div className="text-center text-[var(--text-secondary)] text-xs py-2">No bids available</div>}
        {bids.map((bid, i) => {
          const cumulative = bids.slice(0, i + 1).reduce((sum, b) => sum + b.size, 0);
          const depthPct = totalBidDepth > 0 ? (cumulative / totalBidDepth) * 100 : 0;
          return (
            <div 
              key={`bid-${i}`} 
              onClick={() => setPendingPrice(Number(bid.price).toFixed(2))}
              className="relative flex px-4 py-1 hover:bg-[var(--accent-color)]/20 cursor-pointer group flex-shrink-0 transition-colors"
            >
              <div className="absolute right-0 top-0 bottom-0 bg-[#0ECB81]/10" style={{ width: `${depthPct}%` }} />
              <div className="flex-1 text-[#0ECB81] relative z-10 font-bold">{Number(bid.price).toFixed(2)}</div>
              <div className="flex-1 text-right text-[var(--text-primary)] relative z-10">{Number(bid.size).toFixed(8)}</div>
              <div className="flex-1 text-right text-[var(--text-secondary)] relative z-10">{cumulative.toFixed(8)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
