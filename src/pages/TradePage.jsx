import React, { useState, useEffect } from 'react';
import GridLayout from 'react-grid-layout';
import { RefreshCw, ChevronDown, Save } from 'lucide-react';
import Orderbook from '../components/Orderbook';
import OrderEntry from '../components/OrderEntry';
import TradeLog from '../components/TradeLog';
import MarketTrades from '../components/MarketTrades';
import TradingChart from '../components/TradingChart';
import MarketStatsBar from '../components/MarketStatsBar';
import MarketSelector from '../components/MarketSelector';
import DepthChart from '../components/DepthChart';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { useExchange } from '../context/ExchangeContext';

const layoutStorageKey = 'nextchange_hub_layout_v4';
const defaultLayoutKey = 'nextchange_hub_default_layout_v4';

const INTERVALS = [
  '1m', '5m', '15m', '1h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M', '3M', '12M'
];

const INITIAL_DEFAULT_LAYOUT = [
  { i: 'chart', x: 0, y: 0, w: 9, h: 5, minW: 4, minH: 3 },
  { i: 'orderbook', x: 9, y: 0, w: 3, h: 5, minW: 2, minH: 4 },
  { i: 'marketTrades', x: 9, y: 5, w: 3, h: 4, minW: 2, minH: 4 },
  { i: 'tradeLog', x: 0, y: 5, w: 9, h: 4, minW: 4, minH: 3 },
  { i: 'orderEntry', x: 0, y: 9, w: 12, h: 6, minW: 3, minH: 4 }
];

export default function TradePage() {
  const [layout, setLayout] = useState(() => {
    const savedLayout = localStorage.getItem(layoutStorageKey);
    if (savedLayout) {
      try {
        return JSON.parse(savedLayout);
      } catch (e) {
        return INITIAL_DEFAULT_LAYOUT;
      }
    }
    return INITIAL_DEFAULT_LAYOUT;
  });

  const [width, setWidth] = useState(window.innerWidth);
  const [activeMarketTab, setActiveMarketTab] = useState('trades');
  const [saveStatus, setSaveStatus] = useState(false);

  useEffect(() => {
    const handleResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const onLayoutChange = (newLayout) => {
    setLayout(newLayout);
    localStorage.setItem(layoutStorageKey, JSON.stringify(newLayout));
  };

  const resetLayout = () => {
    const customDefault = localStorage.getItem(defaultLayoutKey);
    const target = customDefault ? JSON.parse(customDefault) : INITIAL_DEFAULT_LAYOUT;
    setLayout(target);
    localStorage.setItem(layoutStorageKey, JSON.stringify(target));
  };

  const saveAsDefault = () => {
    localStorage.setItem(defaultLayoutKey, JSON.stringify(layout));
    setSaveStatus(true);
    setTimeout(() => setSaveStatus(false), 2000);
  };

  const { chartInterval, setChartInterval, chartType, setChartType } = useExchange();

  const components = {
    chart: (
      <div key="chart" className="flex flex-col h-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded transition-colors overflow-hidden">
        <div className="flex items-center justify-between px-4 py-1.5 border-b border-[var(--border-color)] drag-handle cursor-move bg-[var(--bg-secondary)]">
          <div className="flex items-center gap-3">
            <MarketSelector />

            <div className="flex items-center gap-1">
              <button
                onClick={resetLayout}
                className="p-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[#dfff00] hover:border-[#dfff00] transition-all cancel-drag"
                title="Reset to Default Layout"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
              <button
                onClick={saveAsDefault}
                className={`p-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border-color)] transition-all cancel-drag ${
                  saveStatus ? 'text-[#0ECB81] border-[#0ECB81]' : 'text-[var(--text-secondary)] hover:text-[#dfff00] hover:border-[#dfff00]'
                }`}
                title="Set Current as Default (Impost)"
              >
                <Save className="w-3 h-3" />
              </button>
            </div>

            <div className="h-4 w-[1px] bg-[var(--border-color)] mx-1" />

            <div className="relative">
              <select
                value={chartInterval}
                onChange={(e) => setChartInterval(e.target.value)}
                className="bg-[var(--bg-primary)] text-[var(--text-primary)] font-medium text-[10px] border border-[var(--border-color)] rounded px-2 py-0.5 pr-6 appearance-none focus:outline-none focus:border-[#dfff00] cursor-pointer cancel-drag transition-colors"
                onMouseDown={e => e.stopPropagation()}
              >
                {INTERVALS.map(iv => (
                  <option key={iv} value={iv}>{iv}</option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-1.5 text-gray-400 cancel-drag">
                <ChevronDown className="w-2.5 h-2.5" />
              </div>
            </div>

            <div className="relative">
              <select
                value={chartType}
                onChange={(e) => setChartType(e.target.value)}
                className="bg-[var(--bg-primary)] text-[var(--text-primary)] font-medium text-[10px] border border-[var(--border-color)] rounded px-2 py-0.5 pr-6 appearance-none focus:outline-none focus:border-[#dfff00] cursor-pointer cancel-drag transition-colors"
                onMouseDown={e => e.stopPropagation()}
              >
                <option value="candles">Candles</option>
                <option value="line">Line</option>
                <option value="area">Area</option>
                <option value="volume">Vol. Based</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-1.5 text-gray-400 cancel-drag">
                <ChevronDown className="w-2.5 h-2.5" />
              </div>
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-hidden cancel-drag" onMouseDown={e => e.stopPropagation()}>
          <ErrorBoundary>
            <TradingChart />
          </ErrorBoundary>
        </div>
      </div>
    ),
    orderbook: (
      <div key="orderbook" className="flex flex-col h-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded transition-colors overflow-hidden">
        <div className="flex justify-between items-center p-2.5 border-b border-[var(--border-color)] drag-handle cursor-move bg-[var(--bg-secondary)]">
          <h3 className="text-[10px] font-bold text-[var(--text-secondary)] hover:text-[#dfff00] uppercase tracking-widest transition-colors cursor-default">Orderbook</h3>
        </div>
        <div className="flex-1 overflow-hidden cancel-drag" onMouseDown={e => e.stopPropagation()}>
          <Orderbook />
        </div>
      </div>
    ),
    orderEntry: (
      <div key="orderEntry" className="flex flex-col h-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded transition-colors overflow-hidden">
        {/* Note: Header is now handled internally by OrderEntry for the toggle switch */}
        <div className="drag-handle cursor-move w-full h-1 bg-[var(--border-color)]/20" />
        <div className="flex-1 overflow-hidden cancel-drag" onMouseDown={e => e.stopPropagation()}>
          <OrderEntry />
        </div>
      </div>
    ),
    tradeLog: (
      <div key="tradeLog" className="flex flex-col h-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded transition-colors overflow-hidden">
        <div className="flex justify-between items-center p-2.5 border-b border-[var(--border-color)] drag-handle cursor-move bg-[var(--bg-secondary)]">
          <h3 className="text-[10px] font-bold text-[var(--text-secondary)] hover:text-[#dfff00] uppercase tracking-widest transition-colors cursor-default">Portfolio</h3>
        </div>
        <div className="flex-1 overflow-y-auto cancel-drag" onMouseDown={e => e.stopPropagation()}>
          <TradeLog />
        </div>
      </div>
    ),
    marketTrades: (
      <div key="marketTrades" className="flex flex-col h-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded overflow-hidden transition-colors">
        <div className="flex items-center px-2 pt-2 border-b border-[var(--border-color)] drag-handle cursor-move bg-[var(--bg-secondary)]">
          <button
            onClick={() => setActiveMarketTab('trades')}
            className={`px-3 py-1 text-[9px] font-bold uppercase tracking-widest transition-all border-b-2 ${activeMarketTab === 'trades'
                ? 'text-[#dfff00] border-[#dfff00]'
                : 'text-[var(--text-secondary)] border-transparent hover:text-[#dfff00]'
              }`}
          >
            History
          </button>
          <button
            onClick={() => setActiveMarketTab('depth')}
            className={`px-3 py-1 text-[9px] font-bold uppercase tracking-widest transition-all border-b-2 ${activeMarketTab === 'depth'
                ? 'text-[#dfff00] border-[#dfff00]'
                : 'text-[var(--text-secondary)] border-transparent hover:text-[#dfff00]'
              }`}
          >
            Depth
          </button>
        </div>
        <div className="flex-1 overflow-hidden cancel-drag" onMouseDown={e => e.stopPropagation()}>
          {activeMarketTab === 'trades' ? <MarketTrades /> : <DepthChart />}
        </div>
      </div>
    )
  };

  return (
    <div className="flex-1 flex flex-col bg-[var(--bg-primary)] overflow-hidden transition-colors">
      <MarketStatsBar />
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-2">
        <GridLayout
          className="layout"
          layout={layout}
          cols={12}
          rowHeight={80}
          width={width - 24}
          onLayoutChange={onLayoutChange}
          draggableHandle=".drag-handle"
          draggableCancel=".cancel-drag, input, textarea, button, select, option"
          resizeHandles={['s', 'w', 'e', 'n', 'sw', 'nw', 'se', 'ne']}
          margin={[6, 6]}
        >
          {layout.map(item => components[item.i])}
        </GridLayout>
      </div>
    </div>
  );
}
