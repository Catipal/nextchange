import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff, Box } from 'lucide-react';
import api from '../api/client';

/**
 * Compact network status indicator for the header.
 * Polls at a relaxed 30s interval since the active page also polls /status.
 */
export default function NetworkStatus() {
  const [status, setStatus] = useState({ peerCount: 0, chainHeight: 0, listening: false });

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await api.get('/network/status');
        setStatus(res.data);
      } catch {}
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const isConnected = status.peerCount > 0;

  return (
    <div className="flex items-center gap-3 text-xs">
      <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border ${
        isConnected
          ? 'bg-[#0ECB81]/10 border-[#0ECB81]/30 text-[#0ECB81]'
          : 'bg-[#F6465D]/10 border-[#F6465D]/30 text-[#F6465D]'
      }`}>
        {isConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
        <span className="font-bold">{status.peerCount}</span>
        <span className="text-gray-400 hidden sm:inline">peers</span>
      </div>
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-[#2B3139] border border-[#2B3139] text-gray-300">
        <Box className="w-3 h-3 text-[var(--accent-color)]" />
        <span className="font-mono font-bold">{status.chainHeight}</span>
        <span className="text-gray-500 hidden sm:inline">blocks</span>
      </div>
    </div>
  );
}
