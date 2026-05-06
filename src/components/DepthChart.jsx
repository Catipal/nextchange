import React, { useMemo, useState, useRef, useEffect } from 'react';
import { useExchange } from '../context/ExchangeContext';

export default function DepthChart() {
  const { orderbook } = useExchange();
  const { bids, asks } = orderbook;
  const [zoom, setZoom] = useState(0.5); // 0.5 = viewport shows 50% of mid price by default
  const [hoverData, setHoverData] = useState(null);
  
  const bidScrollRef = useRef(null);
  const askScrollRef = useRef(null);
  const bidSvgRef = useRef(null);
  const askSvgRef = useRef(null);

  const data = useMemo(() => {
    if (!bids.length && !asks.length) return null;

    const parsedBids = bids.map(b => ({ price: Number(b.price), size: Number(b.size) }));
    const parsedAsks = asks.map(a => ({ price: Number(a.price), size: Number(a.size) }));

    const sortedBids = parsedBids.sort((a, b) => b.price - a.price);
    const sortedAsks = parsedAsks.sort((a, b) => a.price - b.price);

    let bidTotal = 0;
    const bidPoints = sortedBids.map(b => { bidTotal += b.size; return { price: b.price, total: bidTotal }; });

    let askTotal = 0;
    const askPoints = sortedAsks.map(a => { askTotal += a.size; return { price: a.price, total: askTotal }; });

    const bestBid = sortedBids[0]?.price ?? 0;
    const bestAsk = sortedAsks[0]?.price ?? 0;
    const midPrice = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : bestBid || bestAsk || 100;

    const minPrice = sortedBids.length ? sortedBids.at(-1).price : midPrice * 0.95;
    const maxPrice = sortedAsks.length ? sortedAsks.at(-1).price : midPrice * 1.05;

    const viewportPriceRange = midPrice * zoom;

    const bidVisible = bidPoints.filter(p => p.price >= bestBid - viewportPriceRange);
    const askVisible = askPoints.filter(p => p.price <= bestAsk + viewportPriceRange);

    const bidViewportMax = bidVisible.at(-1)?.total || bidPoints.at(-1)?.total || 0.01;
    const askViewportMax = askVisible.at(-1)?.total || askPoints.at(-1)?.total || 0.01;

    return { 
      bidPoints, askPoints,
      bestBid, bestAsk, minPrice, maxPrice,
      bidViewportMax, askViewportMax, viewportPriceRange
    };
  }, [bids, asks, zoom]);

  // Keep both sides scrolled to the center (the spread) when zoom or data changes
  useEffect(() => {
    const snapToSpread = () => {
      if (bidScrollRef.current) bidScrollRef.current.scrollLeft = bidScrollRef.current.scrollWidth;
      if (askScrollRef.current) askScrollRef.current.scrollLeft = 0;
    };

    // Fire immediately, then double-check after layout painting is fully complete
    requestAnimationFrame(() => {
      snapToSpread();
      setTimeout(snapToSpread, 50);
    });
  }, [zoom, data?.bidPoints?.length, data?.askPoints?.length]);

  if (!data) return <div className="h-full flex items-center justify-center text-xs opacity-30 italic">Hydrating Depth…</div>;

  const { bidPoints, askPoints, bestBid, bestAsk, minPrice, maxPrice, bidViewportMax, askViewportMax, viewportPriceRange } = data;

  const bidRange = bestBid - minPrice || midPrice * 0.05;
  const askRange = maxPrice - bestAsk || midPrice * 0.05;

  const maxRenderMultiplier = 10;
  const renderBidRange = Math.min(Math.max(bidRange, viewportPriceRange), viewportPriceRange * maxRenderMultiplier);
  const renderAskRange = Math.min(Math.max(askRange, viewportPriceRange), viewportPriceRange * maxRenderMultiplier);

  const bidSvgWidth = (renderBidRange / viewportPriceRange) * 100;
  const askSvgWidth = (renderAskRange / viewportPriceRange) * 100;

  // Bids: X=100 is bestBid, X=0 is (bestBid - renderBidRange)
  const getBidX = p => Math.max(0, Math.min(100, ((p - (bestBid - renderBidRange)) / renderBidRange) * 100));
  // Asks: X=0 is bestAsk, X=100 is (bestAsk + renderAskRange)
  const getAskX = p => Math.max(0, Math.min(100, ((p - bestAsk) / renderAskRange) * 100));
  
  const getBidY = t => 100 - Math.min((t / bidViewportMax) * 90, 95);
  const getAskY = t => 100 - Math.min((t / askViewportMax) * 90, 95);

  const spread = (bestAsk > 0 && bestBid > 0) ? Math.max(0, bestAsk - bestBid) : 0;
  const totalVisiblePrice = (viewportPriceRange * 2) + spread;
  
  const sideWidthPct = (viewportPriceRange / totalVisiblePrice) * 100;
  const spreadWidthPct = (spread / totalVisiblePrice) * 100;

  const makeBidPath = (points, closed) => {
    if (!points.length) return '';
    let d = `M 100 100 L 100 ${getBidY(points[0].total)}`;
    for (let i = 1; i < points.length; i++) {
      d += ` L ${getBidX(points[i].price)} ${getBidY(points[i - 1].total)} L ${getBidX(points[i].price)} ${getBidY(points[i].total)}`;
    }
    const endX = getBidX(points.at(-1).price);
    const endY = getBidY(points.at(-1).total);
    if (closed) d += ` L ${endX} ${endY} L ${endX} 100 Z`;
    else d += ` L ${endX} ${endY}`;
    return d;
  };

  const makeAskPath = (points, closed) => {
    if (!points.length) return '';
    let d = `M 0 100 L 0 ${getAskY(points[0].total)}`;
    for (let i = 1; i < points.length; i++) {
      d += ` L ${getAskX(points[i].price)} ${getAskY(points[i - 1].total)} L ${getAskX(points[i].price)} ${getAskY(points[i].total)}`;
    }
    const endX = getAskX(points.at(-1).price);
    const endY = getAskY(points.at(-1).total);
    if (closed) d += ` L ${endX} ${endY} L ${endX} 100 Z`;
    else d += ` L ${endX} ${endY}`;
    return d;
  };

  const handleBidMove = (e) => {
    if (!bidSvgRef.current) return;
    const rect = bidSvgRef.current.getBoundingClientRect();
    const xPct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const price = (bestBid - renderBidRange) + (xPct * renderBidRange);
    
    let active = null;
    for (let i = 0; i < bidPoints.length; i++) {
      if (bidPoints[i].price <= price) { active = { ...bidPoints[i], side: 'bid', xPct }; break; }
    }
    if (!active && bidPoints.length) active = { ...bidPoints[0], side: 'bid', xPct };
    setHoverData(active);
  };

  const handleAskMove = (e) => {
    if (!askSvgRef.current) return;
    const rect = askSvgRef.current.getBoundingClientRect();
    const xPct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const price = bestAsk + (xPct * renderAskRange);
    
    let active = null;
    for (let i = askPoints.length - 1; i >= 0; i--) {
      if (askPoints[i].price >= price) { active = { ...askPoints[i], side: 'ask', xPct }; break; }
    }
    if (!active && askPoints.length) active = { ...askPoints.at(-1), side: 'ask', xPct };
    setHoverData(active);
  };

  return (
    <div className="w-full h-full bg-[var(--bg-primary)] relative flex select-none">
      
      {/* Bid Side (Left) */}
      <div 
        ref={bidScrollRef}
        className="relative overflow-x-auto custom-scrollbar"
        style={{ width: `${sideWidthPct}%` }}
      >
        <div 
          ref={bidSvgRef}
          className="h-full relative cursor-crosshair"
          style={{ width: `${bidSvgWidth}%` }}
          onMouseMove={handleBidMove}
          onMouseLeave={() => setHoverData(null)}
        >
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
            <path d={makeBidPath(bidPoints, true)} fill="#0ECB81" fillOpacity="0.15" />
            <path d={makeBidPath(bidPoints, false)} fill="none" stroke="#0ECB81" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            
            {hoverData?.side === 'bid' && (() => {
              const hx = getBidX(hoverData.price);
              const hy = getBidY(hoverData.total);
              return (
                <>
                  <line x1={hx} y1="0" x2={hx} y2="100" stroke="#0ECB81" strokeWidth="1" strokeDasharray="2,2" opacity="0.6" vectorEffect="non-scaling-stroke" />
                  <line x1="0" y1={hy} x2="100" y2={hy} stroke="#0ECB81" strokeWidth="1" opacity="0.3" vectorEffect="non-scaling-stroke" />
                  <circle cx={hx} cy={hy} r="1.5" fill="#0ECB81" opacity="0.3" vectorEffect="non-scaling-stroke" />
                  <circle cx={hx} cy={hy} r="0.8" fill="#0ECB81" vectorEffect="non-scaling-stroke" />
                </>
              );
            })()}
          </svg>
          <div className="absolute bottom-0 left-0 right-0 flex justify-between px-2 pb-1 pointer-events-none">
            <span className="text-[8px] font-mono text-[var(--text-secondary)] bg-[var(--bg-primary)] px-1 rounded">{minPrice.toFixed(2)}</span>
            <span className="text-[9px] font-mono font-bold text-[#0ECB81] bg-[var(--bg-primary)] px-1 rounded">{bestBid.toFixed(2)}</span>
          </div>
        </div>
        <div className="absolute top-2 left-2 bg-[var(--bg-secondary)]/90 px-1.5 py-0.5 rounded border border-[var(--border-color)] pointer-events-none">
          <span className="text-[6px] text-[#0ECB81] uppercase tracking-wider block leading-none mb-0.5">Bid Scale</span>
          <span className="text-[9px] font-mono font-bold text-[var(--text-primary)] leading-none">{bidViewportMax.toFixed(2)}</span>
        </div>
      </div>

      {/* Spread Area (Middle) */}
      <div 
        className="bg-transparent border-x border-[var(--border-color)] border-dashed flex flex-col items-center justify-center relative z-10 overflow-hidden whitespace-nowrap transition-all duration-200"
        style={{ width: `${spreadWidthPct}%` }}
      >
        <span className="text-[6px] text-[var(--text-secondary)] uppercase tracking-widest mb-1 opacity-80">Spread</span>
        <span className="text-[9px] font-mono font-bold text-[#DFFF00]">
          {(spread > 0) ? spread.toFixed(2) : '--'}
        </span>
        <span className="text-[7px] font-mono text-[var(--text-secondary)] mt-0.5">
          {(spread > 0) ? ((spread / bestAsk) * 100).toFixed(2) + '%' : '--%'}
        </span>
      </div>

      {/* Ask Side (Right) */}
      <div 
        ref={askScrollRef}
        className="relative overflow-x-auto custom-scrollbar"
        style={{ width: `${sideWidthPct}%` }}
      >
        <div 
          ref={askSvgRef}
          className="h-full relative cursor-crosshair"
          style={{ width: `${askSvgWidth}%` }}
          onMouseMove={handleAskMove}
          onMouseLeave={() => setHoverData(null)}
        >
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
            <path d={makeAskPath(askPoints, true)} fill="#F6465D" fillOpacity="0.15" />
            <path d={makeAskPath(askPoints, false)} fill="none" stroke="#F6465D" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            
            {hoverData?.side === 'ask' && (() => {
              const hx = getAskX(hoverData.price);
              const hy = getAskY(hoverData.total);
              return (
                <>
                  <line x1={hx} y1="0" x2={hx} y2="100" stroke="#F6465D" strokeWidth="1" strokeDasharray="2,2" opacity="0.6" vectorEffect="non-scaling-stroke" />
                  <line x1="0" y1={hy} x2="100" y2={hy} stroke="#F6465D" strokeWidth="1" opacity="0.3" vectorEffect="non-scaling-stroke" />
                  <circle cx={hx} cy={hy} r="1.5" fill="#F6465D" opacity="0.3" vectorEffect="non-scaling-stroke" />
                  <circle cx={hx} cy={hy} r="0.8" fill="#F6465D" vectorEffect="non-scaling-stroke" />
                </>
              );
            })()}
          </svg>
          <div className="absolute bottom-0 left-0 right-0 flex justify-between px-2 pb-1 pointer-events-none">
            <span className="text-[9px] font-mono font-bold text-[#F6465D] bg-[var(--bg-primary)] px-1 rounded">{bestAsk.toFixed(2)}</span>
            <span className="text-[8px] font-mono text-[var(--text-secondary)] bg-[var(--bg-primary)] px-1 rounded">{maxPrice.toFixed(2)}</span>
          </div>
        </div>
        <div className="absolute top-2 right-2 bg-[var(--bg-secondary)]/90 px-1.5 py-0.5 rounded border border-[var(--border-color)] pointer-events-none">
          <span className="text-[6px] text-[#F6465D] uppercase tracking-wider block leading-none mb-0.5 text-right">Ask Scale</span>
          <span className="text-[9px] font-mono font-bold text-[var(--text-primary)] leading-none block text-right">{askViewportMax.toFixed(2)}</span>
        </div>
      </div>

      {/* Shared Tooltip */}
      {hoverData && (
        <div
          className="absolute top-3 pointer-events-none bg-[var(--bg-secondary)]/95 border border-[var(--border-color)] rounded-lg px-3 py-2 z-20 min-w-[130px] shadow-2xl"
          style={{
            left: hoverData.side === 'bid' ? 'auto' : '52%',
            right: hoverData.side === 'bid' ? '52%' : 'auto',
          }}
        >
          <p className="text-[9px] font-bold uppercase tracking-widest mb-1.5" style={{ color: hoverData.side === 'bid' ? '#0ECB81' : '#F6465D' }}>
            {hoverData.side === 'bid' ? 'Bid Depth' : 'Ask Depth'}
          </p>
          <div className="flex justify-between gap-4 text-[10px] mb-0.5">
            <span className="text-[var(--text-secondary)]">Price</span>
            <span className="font-mono font-bold text-white">{hoverData.price.toFixed(2)}</span>
          </div>
          <div className="flex justify-between gap-4 text-[10px]">
            <span className="text-[var(--text-secondary)]">Volume</span>
            <span className="font-mono font-bold text-white">{hoverData.total.toFixed(4)}</span>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="absolute bottom-6 right-2 flex items-center gap-1.5 z-10">
        <div className="flex gap-1 shadow-md">
          <button onClick={() => setZoom(z => Math.max(0.001, z * 0.7))}
            className="w-6 h-6 flex items-center justify-center rounded bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--accent-color)] text-xs font-bold transition-colors" title="Zoom in">+</button>
          <button onClick={() => setZoom(z => Math.min(10, z * 1.4))}
            className="w-6 h-6 flex items-center justify-center rounded bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--accent-color)] text-xs font-bold transition-colors" title="Zoom out">−</button>
          {Math.abs(zoom - 0.5) > 0.005 && (
            <button onClick={() => setZoom(0.5)}
              className="px-2 h-6 rounded bg-[var(--bg-tertiary)] border border-[var(--border-color)] text-[8px] text-[var(--text-secondary)] hover:text-[var(--accent-color)] uppercase font-bold transition-colors">Reset</button>
          )}
        </div>
      </div>
    </div>
  );
}
