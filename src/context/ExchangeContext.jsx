import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../api/client';
import { useAuth } from './AuthContext';

const ExchangeContext = createContext(null);

export function ExchangeProvider({ children }) {
  const { isAuthenticated, signOrder } = useAuth();

  const [selectedPair, setSelectedPair] = useState(() => localStorage.getItem('selectedPair') || 'BTC/BPS');
  const [chartInterval, setChartInterval] = useState(() => localStorage.getItem('chartInterval') || '1h');
  const [chartType, setChartType] = useState(() => localStorage.getItem('chartType') || 'candles');
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');

  const [isLogScale, setIsLogScale] = useState(() => localStorage.getItem('isLogScale') === 'true');
  const [activeIndicators, setActiveIndicators] = useState(() => {
    const saved = localStorage.getItem('activeIndicators');
    try {
      return saved ? JSON.parse(saved) : {
        ema7: false,
        ema25: true,
        ema99: false,
        bollinger: false,
        heatmap: true
      };
    } catch (e) {
      return {
        ema7: false,
        ema25: true,
        ema99: false,
        bollinger: false,
        heatmap: true
      };
    }
  });

  useEffect(() => {
    localStorage.setItem('selectedPair', selectedPair);
  }, [selectedPair]);

  useEffect(() => {
    localStorage.setItem('chartInterval', chartInterval);
  }, [chartInterval]);

  useEffect(() => {
    localStorage.setItem('chartType', chartType);
  }, [chartType]);

  useEffect(() => {
    localStorage.setItem('isLogScale', isLogScale);
  }, [isLogScale]);

  useEffect(() => {
    localStorage.setItem('activeIndicators', JSON.stringify(activeIndicators));
  }, [activeIndicators]);

  useEffect(() => {
    localStorage.setItem('theme', theme);
    document.documentElement.className = theme;
  }, [theme]);

  const [orderbook, setOrderbook] = useState({ bids: [], asks: [] });
  const [balances, setBalances] = useState({ btc: { available: 0, locked: 0 }, eth: { available: 0, locked: 0 }, bps: { available: 0, locked: 0 } });
  const [recentTrades, setRecentTrades] = useState([]);
  const [chartData, setChartData] = useState([]);
  const [ticker, setTicker] = useState(null);
  const [allTickers, setAllTickers] = useState([]);
  const [openOrders, setOpenOrders] = useState([]);
  const [orderHistory, setOrderHistory] = useState([]);
  const [pendingPrice, setPendingPrice] = useState('');

  const fetchOrderbook = useCallback(async () => {
    try {
      const res = await api.get(`/market/orderbook?pair=${selectedPair}`);
      setOrderbook(res.data);
    } catch (err) { /* silent */ }
  }, [selectedPair]);

  const fetchBalances = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const res = await api.get('/wallet/balances');
      setBalances(res.data);
    } catch (err) { /* silent */ }
  }, [isAuthenticated]);

  const fetchRecentTrades = useCallback(async () => {
    try {
      const res = await api.get(`/market/trades?pair=${selectedPair}&limit=50`);
      setRecentTrades(res.data);
    } catch (err) { /* silent */ }
  }, [selectedPair]);

  const fetchChartData = useCallback(async (interval = chartInterval) => {
    try {
      const res = await api.get(`/market/chart?pair=${selectedPair}&interval=${interval}`);
      setChartData(res.data);
    } catch (err) { /* silent */ }
  }, [selectedPair, chartInterval]);

  const fetchTicker = useCallback(async () => {
    try {
      const res = await api.get(`/market/ticker?pair=${selectedPair}`);
      setTicker(res.data);
    } catch (err) { /* silent */ }
  }, [selectedPair]);

  const fetchAllTickers = useCallback(async () => {
    try {
      const res = await api.get('/market/all-tickers');
      setAllTickers(res.data.sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0)));
    } catch (err) { /* silent */ }
  }, []);

  const fetchOpenOrders = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const res = await api.get(`/orders?pair=${selectedPair}`);
      setOpenOrders(res.data);
    } catch (err) { /* silent */ }
  }, [isAuthenticated, selectedPair]);

  const fetchOrderHistory = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const res = await api.get(`/orders/history?pair=${selectedPair}`);
      setOrderHistory(res.data);
    } catch (err) { /* silent */ }
  }, [isAuthenticated, selectedPair]);

  // Place an order
  const placeOrder = async (orderData) => {
    const rawOrder = { ...orderData, pair: selectedPair };
    const signedOrder = await signOrder(rawOrder);
    const res = await api.post('/orders', signedOrder);
    // Refresh data after order
    await Promise.all([fetchOrderbook(), fetchBalances(), fetchRecentTrades(), fetchOpenOrders(), fetchChartData()]);
    return res.data;
  };

  // Modify an order
  const modifyOrder = async (orderId, updates) => {
    const res = await api.patch(`/orders/${orderId}`, updates);
    await Promise.all([fetchOrderbook(), fetchBalances(), fetchOpenOrders()]);
    return res.data;
  };

  // Cancel an order
  const cancelOrder = async (orderId) => {
    const res = await api.delete(`/orders/${orderId}`);
    await Promise.all([fetchOrderbook(), fetchBalances(), fetchOpenOrders()]);
    return res.data;
  };

  // Poll for updates
  useEffect(() => {
    if (!isAuthenticated) return;

    // Initial fetch
    fetchOrderbook();
    fetchBalances();
    fetchRecentTrades();
    fetchChartData();
    fetchTicker();
    fetchAllTickers();
    fetchOpenOrders();

    // Poll interval
    const interval = setInterval(() => {
      fetchOrderbook();
      fetchBalances();
      fetchRecentTrades();
      fetchTicker();
      fetchAllTickers();
    }, 5000);

    return () => clearInterval(interval);
  }, [isAuthenticated, fetchOrderbook, fetchBalances, fetchRecentTrades, fetchTicker, fetchAllTickers, fetchChartData, fetchOpenOrders, selectedPair]);

  return (
    <ExchangeContext.Provider value={{
      selectedPair, setSelectedPair,
      chartInterval, setChartInterval,
      chartType, setChartType,
      theme, setTheme,
      isLogScale, setIsLogScale,
      activeIndicators, setActiveIndicators,
      orderbook, balances, recentTrades, chartData, ticker, allTickers, openOrders, orderHistory,
      pendingPrice, setPendingPrice,
      placeOrder, cancelOrder, modifyOrder,
      fetchOrderbook, fetchBalances, fetchRecentTrades, fetchChartData, fetchOpenOrders, fetchOrderHistory, fetchAllTickers
    }}>
      {children}
    </ExchangeContext.Provider>
  );
}

export function useExchange() {
  const context = useContext(ExchangeContext);
  if (!context) throw new Error('useExchange must be used within ExchangeProvider');
  return context;
}
