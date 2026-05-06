import React, { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown, Star, BarChart2 } from 'lucide-react';
import { useExchange } from '../context/ExchangeContext';

export default function MarketSelector() {
  const { allTickers, selectedPair, setSelectedPair } = useExchange();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef(null);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredTickers = allTickers.filter(t => 
    t.pair.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-3 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-3 py-1.5 hover:border-[var(--accent-color)] transition-all group cancel-drag"
      >
        <span className="text-[var(--accent-color)] font-bold text-sm tracking-widest">{selectedPair}</span>
        <ChevronDown className={`w-4 h-4 text-gray-500 group-hover:text-[var(--accent-color)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-80 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-2xl z-[100] overflow-hidden flex flex-col cancel-drag animate-in fade-in slide-in-from-top-2 duration-200">
          {/* Search Header */}
          <div className="p-3 border-b border-[var(--border-color)] bg-[var(--bg-primary)]/50">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-500" />
              <input
                autoFocus
                type="text"
                placeholder="Search markets..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-full pl-9 pr-4 py-2 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-color)] transition-colors"
              />
            </div>
          </div>

          {/* List Headers */}
          <div className="flex px-4 py-2 text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-tighter border-b border-[var(--border-color)]/50">
            <div className="flex-1">Market / Vol</div>
            <div className="w-24 text-right">Price</div>
          </div>

          {/* Market List */}
          <div className="max-h-80 overflow-y-auto custom-scrollbar">
            {filteredTickers.length > 0 ? (
              filteredTickers.map(t => (
                <div
                  key={t.pair}
                  onClick={() => {
                    setSelectedPair(t.pair);
                    setIsOpen(false);
                    setSearch('');
                  }}
                  className={`flex items-center px-4 py-3 hover:bg-[var(--item-hover)] cursor-pointer border-b border-[var(--border-color)]/10 transition-colors ${
                    selectedPair === t.pair ? 'bg-[var(--accent-color)]/5' : ''
                  }`}
                >
                  <div className="flex-1 flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <Star className="w-3 h-3 text-gray-600 hover:text-yellow-500 transition-colors" />
                      <span className={`text-sm font-bold ${selectedPair === t.pair ? 'text-[var(--accent-color)]' : 'text-[var(--text-primary)]'}`}>
                        {t.pair}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 opacity-50">
                      <BarChart2 className="w-3 h-3" />
                      <span className="text-[10px] font-mono">{Number(t.volume24h).toFixed(2)}</span>
                    </div>
                  </div>

                  {/* Sparkline Overlay */}
                  <div className="w-16 h-8 mx-4 opacity-70">
                    <Sparkline data={t.trend || []} isUp={(t.priceChangePct24h || 0) >= 0} />
                  </div>

                  <div className="w-24 text-right flex flex-col items-end">
                    <span className="text-sm font-mono font-bold text-[var(--text-primary)]">
                      {Number(t.lastPrice).toFixed(2)}
                    </span>
                    <span className={`text-[10px] font-bold ${ (t.priceChangePct24h || 0) >= 0 ? 'text-[#0ECB81]' : 'text-[#F6465D]'}`}>
                      {(t.priceChangePct24h || 0) >= 0 ? '+' : ''}{Number(t.priceChangePct24h || 0).toFixed(2)}%
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-8 text-center text-gray-500 italic text-xs">
                No markets found matching "{search}"
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-3 bg-[var(--bg-primary)]/50 border-t border-[var(--border-color)] text-center">
            <button className="text-[10px] text-[var(--accent-color)] font-bold uppercase tracking-widest hover:underline">
              View All Markets
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Sparkline({ data, isUp }) {
  if (!data || data.length < 2) {
    return (
      <div className="w-full h-full flex items-center justify-center opacity-20">
        <div className="w-full h-[1px] bg-gray-500" />
      </div>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  
  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * 64;
    const y = 30 - ((val - min) / range) * 28; // Padding of 2px
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width="100%" height="100%" viewBox="0 0 64 32" className="overflow-visible">
      <polyline
        fill="none"
        stroke={isUp ? '#0ECB81' : '#F6465D'}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}
