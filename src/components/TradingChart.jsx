import React, { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, CandlestickSeries, BarSeries, LineSeries, AreaSeries, HistogramSeries, PriceScaleMode } from 'lightweight-charts';
import { useExchange } from '../context/ExchangeContext';
import { Settings, Palette } from 'lucide-react';
import api from '../api/client';

export default function TradingChart() {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const indicatorSeriesRef = useRef({});

  const {
    recentTrades, selectedPair, chartInterval, chartType,
    isLogScale, setIsLogScale, activeIndicators, setActiveIndicators, theme
  } = useExchange();

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState([]);
  const [showGrid, setShowGrid] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [currentDate, setCurrentDate] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentDate(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const [chartColors, setChartColors] = useState(() => {
    const saved = localStorage.getItem('nextchange_chart_colors');
    if (saved) return JSON.parse(saved);
    return {
      up: '#0ECB81',
      down: '#F6465D',
      background: '#282f35',
      grid: '#3b444d'
    };
  });

  const getChartColors = (currentTheme) => {
    const isDark = currentTheme === 'dark';
    return {
      background: isDark ? chartColors.background : '#B2B5B9',
      text: isDark ? '#848E9C' : '#4A4D51',
      grid: isDark ? chartColors.grid : '#8E9194',
      up: chartColors.up,
      down: chartColors.down,
      accent: isDark ? '#DFFF00' : '#8DAA00'
    };
  };

  const updateColor = (key, value) => {
    const newColors = { ...chartColors, [key]: value };
    setChartColors(newColors);
    localStorage.setItem('nextchange_chart_colors', JSON.stringify(newColors));
  };

  // Initialize Chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const colors = getChartColors(theme);
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: colors.background },
        textColor: colors.text,
        fontSize: 11,
        fontFamily: 'Inter, system-ui, sans-serif',
      },
      grid: {
        vertLines: { color: showGrid ? colors.grid : 'transparent' },
        horzLines: { color: showGrid ? colors.grid : 'transparent' },
      },
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      crosshair: {
        vertLine: { color: colors.accent, width: 1, style: 2, labelBackgroundColor: colors.accent },
        horzLine: { color: colors.accent, width: 1, style: 2, labelBackgroundColor: colors.accent },
      },
      timeScale: {
        borderColor: colors.grid,
        timeVisible: true,
      },
      rightPriceScale: {
        borderColor: colors.grid,
        autoScale: true,
      }
    });

    chartRef.current = chart;

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(chartContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      indicatorSeriesRef.current = {};
    };
  }, []);

  // Sync Chart Options
  useEffect(() => {
    if (!chartRef.current) return;
    const colors = getChartColors(theme);

    chartRef.current.applyOptions({
      layout: { background: { type: ColorType.Solid, color: colors.background }, textColor: colors.text },
      grid: {
        vertLines: { color: showGrid ? colors.grid : 'transparent' },
        horzLines: { color: showGrid ? colors.grid : 'transparent' },
      },
      crosshair: {
        vertLine: { color: colors.accent, labelBackgroundColor: colors.accent },
        horzLine: { color: colors.accent, labelBackgroundColor: colors.accent },
      },
      timeScale: { borderColor: colors.grid },
      rightPriceScale: { borderColor: colors.grid, mode: isLogScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal }
    });
  }, [theme, showGrid, isLogScale, chartColors]);

  // Handle Main Data Series
  useEffect(() => {
    if (!chartRef.current) return;
    const chart = chartRef.current;
    const colors = getChartColors(theme);

    if (seriesRef.current) chart.removeSeries(seriesRef.current);

    const config = { upColor: colors.up, downColor: colors.down, borderVisible: false, wickUpColor: colors.up, wickDownColor: colors.down };

    if (chartType === 'bars') seriesRef.current = chart.addSeries(BarSeries, config);
    else if (chartType === 'line') seriesRef.current = chart.addSeries(LineSeries, { color: colors.up });
    else if (chartType === 'area') seriesRef.current = chart.addSeries(AreaSeries, { topColor: `${colors.up}44`, bottomColor: 'transparent', lineColor: colors.up });
    else if (chartType === 'volume') {
      // Restore Volume-Based Candle Logic
      const maxVol = Math.max(...data.map(d => d.volume), 1);
      seriesRef.current = chart.addSeries(CandlestickSeries, config);
      const volumeData = data.map(d => {
        const ratio = d.volume / maxVol;
        const isUp = d.close >= d.open;
        const color = isUp ? colors.up : colors.down;
        
        // Synchronized Opacity Tiers
        let opacity = 'FF'; // Solid
        if (ratio < 0.3) opacity = '44';      // Ghost
        else if (ratio < 0.6) opacity = '88'; // Transparent
        else if (ratio < 0.8) opacity = 'BB'; // Semi-Solid
        
        const finalColor = `${color}${opacity}`;
        
        return {
          ...d,
          color: finalColor,
          wickColor: finalColor,
          borderColor: ratio > 0.8 ? 'rgba(255,255,255,0.5)' : finalColor,
          borderVisible: ratio > 0.5,
        };
      });
      seriesRef.current.setData(volumeData);
      return;
    } 
    else seriesRef.current = chart.addSeries(CandlestickSeries, config);

    if (data.length) {
      seriesRef.current.setData(chartType === 'line' || chartType === 'area' ? data.map(d => ({ time: d.time, value: d.close })) : data);
    }
  }, [chartType, theme, data, chartColors]);

  // Handle Indicators (Volume Histogram)
  useEffect(() => {
    if (!chartRef.current || !data.length) return;
    const chart = chartRef.current;
    const colors = getChartColors(theme);

    if (activeIndicators.volume) {
      if (!indicatorSeriesRef.current.volume) {
        indicatorSeriesRef.current.volume = chart.addSeries(HistogramSeries, {
          priceFormat: { type: 'volume' },
          priceScaleId: '',
        });
        indicatorSeriesRef.current.volume.priceScale().applyOptions({
          scaleMargins: { top: 0.8, bottom: 0 },
        });
      }
      indicatorSeriesRef.current.volume.setData(data.map(d => ({
        time: d.time,
        value: d.volume,
        color: d.close >= d.open ? `${colors.up}66` : `${colors.down}66`
      })));
    } else if (indicatorSeriesRef.current.volume) {
      chart.removeSeries(indicatorSeriesRef.current.volume);
      delete indicatorSeriesRef.current.volume;
    }
  }, [data, activeIndicators.volume, theme, chartColors]);

  // Fetch Data
  useEffect(() => {
    const fetchChart = async () => {
      try {
        const res = await api.get(`/market/chart?pair=${selectedPair}&interval=${chartInterval}&limit=1000`);
        const formatted = res.data.map(c => ({
          time: Math.floor(new Date(c.time).getTime() / 1000),
          open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close), volume: Number(c.volume)
        })).sort((a, b) => a.time - b.time);

        const clean = [];
        const seen = new Set();
        for (let d of formatted) { if (!seen.has(d.time)) { clean.push(d); seen.add(d.time); } }

        setData(clean);
        setLoading(false);
      } catch (err) { console.error('Chart fetch error:', err); }
    };
    fetchChart();
  }, [chartInterval, recentTrades, selectedPair]);

  const toggleIndicator = (id) => setActiveIndicators(prev => ({ ...prev, [id]: !prev[id] }));

  return (
    <div className="w-full h-full flex flex-col bg-[var(--bg-secondary)] transition-colors relative">
      {/* Settings Overlay */}
      <div className="absolute top-2 right-2 z-20 flex flex-col items-end gap-2">
        <button onClick={() => setShowSettings(!showSettings)} className={`p-1.5 rounded bg-[var(--bg-tertiary)] border border-[var(--border-color)] hover:border-[var(--accent-color)] transition-all ${showSettings ? 'text-[var(--accent-color)]' : 'text-gray-400'}`}>
          <Settings className="w-4 h-4" />
        </button>
        {showSettings && (
          <div className="w-64 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-2xl p-3 space-y-4 max-h-[80vh] overflow-y-auto custom-scrollbar">
            <h4 className="text-[10px] font-bold text-white uppercase tracking-widest border-b border-[var(--border-color)] pb-1.5 flex items-center gap-2">
              <Palette className="w-3 h-3" /> Chart Settings
            </h4>

            <div className="space-y-1.5 pt-1.5 border-t border-[var(--border-color)]">
              <p className="text-[9px] text-gray-500 uppercase font-bold">Indicators</p>
              <label className="flex items-center justify-between cursor-pointer group">
                <span className="text-xs text-gray-300 group-hover:text-white uppercase">Volume</span>
                <input type="checkbox" checked={activeIndicators.volume} onChange={() => toggleIndicator('volume')} className="w-3 h-3 rounded border-[var(--border-color)] bg-[var(--bg-primary)] checked:bg-[var(--accent-color)]" />
              </label>
            </div>

            <div className="space-y-1.5 pt-1.5 border-t border-[var(--border-color)]">
              <p className="text-[9px] text-gray-500 uppercase font-bold">Colors</p>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(chartColors).map(([key, value]) => (
                  <div key={key} className="space-y-1">
                    <label className="text-[8px] text-gray-400 uppercase">{key}</label>
                    <input type="color" value={value} onChange={e => updateColor(key, e.target.value)} className="w-full h-6 rounded bg-transparent border-none cursor-pointer" />
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-1.5 pt-1.5 border-t border-[var(--border-color)]">
              <p className="text-[9px] text-gray-500 uppercase font-bold">Visuals</p>
              <label className="flex items-center justify-between cursor-pointer group">
                <span className="text-xs text-gray-300 group-hover:text-white">Grid Lines</span>
                <input type="checkbox" checked={showGrid} onChange={() => setShowGrid(!showGrid)} className="w-3 h-3 rounded border-[var(--border-color)] bg-[var(--bg-primary)] checked:bg-[var(--accent-color)]" />
              </label>
              <label className="flex items-center justify-between cursor-pointer group">
                <span className="text-xs text-gray-300 group-hover:text-white">Log Scale</span>
                <input type="checkbox" checked={isLogScale} onChange={() => setIsLogScale(!isLogScale)} className="w-3 h-3 rounded border-[var(--border-color)] bg-[var(--bg-primary)] checked:bg-[var(--accent-color)]" />
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Main Chart Container */}
      <div className="flex-1 relative overflow-hidden" ref={chartContainerRef}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-[var(--bg-secondary)]/50 backdrop-blur-sm">
            <div className="w-6 h-6 border-2 border-[var(--accent-color)] border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="flex items-center justify-between px-3 py-1 text-[9px] text-[var(--text-secondary)] border-t border-[var(--border-color)] bg-[var(--bg-primary)] font-mono transition-colors">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-[#0ECB81] animate-pulse" />
            <span className="text-[var(--text-primary)]">LIVE</span>
          </div>
          <span>{selectedPair}</span>
          <span>{chartInterval}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-[var(--accent-color)] font-bold uppercase tracking-wider">
            {currentDate.getUTCHours().toString().padStart(2, '0')}:{currentDate.getUTCMinutes().toString().padStart(2, '0')}:{currentDate.getUTCSeconds().toString().padStart(2, '0')} UTC
          </span>
        </div>
      </div>
    </div>
  );
}
