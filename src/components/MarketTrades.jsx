import React from 'react';
import { useExchange } from '../context/ExchangeContext';
import { History } from 'lucide-react';

export default function MarketTrades() {
  const { recentTrades } = useExchange();

  return (
    <div className="flex flex-col h-full bg-[var(--bg-secondary)] transition-colors overflow-hidden">
      {/* Table Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-primary)]/30 text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-widest">
        <span className="flex-1">Price</span>
        <span className="flex-1 text-center">Amount</span>
        <span className="flex-1 text-right">Time</span>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {recentTrades.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-[var(--text-secondary)] opacity-30 gap-2">
            <History className="w-8 h-8" />
            <span className="text-xs italic">Awaiting data...</span>
          </div>
        ) : (
          <div className="flex flex-col">
            {recentTrades.slice(0, 50).map((trade, idx) => (
              <div 
                key={trade.id} 
                className={`flex flex-col px-4 py-1.5 border-b border-[var(--border-color)]/10 hover:bg-[var(--item-hover)] transition-colors animate-in slide-in-from-right-1 fade-in duration-300`}
                style={{ animationDelay: `${idx * 20}ms` }}
              >
                <div className="flex items-center justify-between text-[11px]">
                  <span className={`flex-1 font-mono font-bold ${trade.taker_side === 'buy' ? 'text-[#0ECB81]' : 'text-[#F6465D]'}`}>
                    {Number(trade.price).toFixed(2)}
                  </span>
                  <span className="flex-1 text-center font-mono text-[var(--text-primary)]">
                    {Number(trade.size).toFixed(8)}
                  </span>
                  <span className="flex-1 text-right text-[var(--text-secondary)] font-mono opacity-60">
                    {new Date(trade.created_at).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {trade.block_hash && (
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(trade.block_hash);
                      }}
                      className="text-[9px] text-[var(--text-secondary)] opacity-50 hover:opacity-100 hover:text-[#dfff00] font-mono tracking-widest transition-all"
                      title="Click to copy hash"
                    >
                      {trade.block_hash.slice(0, 16)}...
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
