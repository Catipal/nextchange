import React, { useState, useEffect } from 'react';
import { useExchange } from '../context/ExchangeContext';
import { X, Gift, History, ListFilter, Edit2, Check } from 'lucide-react';

export default function TradeLog() {
  const { openOrders, orderHistory, cancelOrder, modifyOrder, fetchOrderHistory } = useExchange();
  const [activeTab, setActiveTab] = useState('open'); // 'open' or 'history'
  const [editingId, setEditingId] = useState(null);
  const [editPrice, setEditPrice] = useState('');
  const [editSize, setEditSize] = useState('');

  const startEdit = (order) => {
    setEditingId(order.id);
    setEditPrice(order.price.toString());
    setEditSize((order.size - order.filled).toString());
  };

  const handleModify = async () => {
    try {
      await modifyOrder(editingId, { price: editPrice, size: editSize });
      setEditingId(null);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to modify order');
    }
  };

  useEffect(() => {
    if (activeTab === 'history') {
      fetchOrderHistory();
    }
  }, [activeTab, fetchOrderHistory]);

  return (
    <div className="flex flex-col h-full bg-[var(--bg-secondary)] transition-colors">
      {/* Tab Header */}
      <div className="flex items-center px-2 pt-2 border-b border-[var(--border-color)] bg-[var(--bg-primary)]/30">
        <button
          onClick={() => setActiveTab('open')}
          className={`flex items-center gap-2 px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition-all border-b-2 ${
            activeTab === 'open' 
              ? 'text-[var(--accent-color)] border-[var(--accent-color)]' 
              : 'text-[var(--text-secondary)] border-transparent hover:text-[var(--text-primary)]'
          }`}
        >
          <ListFilter className="w-3 h-3" />
          Open Orders ({openOrders.length})
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`flex items-center gap-2 px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition-all border-b-2 ${
            activeTab === 'history' 
              ? 'text-[var(--accent-color)] border-[var(--accent-color)]' 
              : 'text-[var(--text-secondary)] border-transparent hover:text-[var(--text-primary)]'
          }`}
        >
          <History className="w-3 h-3" />
          Trade History
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {activeTab === 'open' ? (
          <>
            {openOrders.length > 0 ? (
              openOrders.map(order => (
                <div key={order.id} className={`flex items-center justify-between px-4 py-3 text-[11px] border-b border-[var(--border-color)]/20 hover:bg-[var(--item-hover)] group transition-all ${editingId === order.id ? 'bg-[var(--accent-color)]/5 ring-1 ring-inset ring-[var(--accent-color)]/20' : ''}`}>
                  <div className="flex flex-col gap-0.5 w-[60px]">
                    <span className={order.side === 'buy' ? 'text-[#0ECB81] font-bold uppercase' : 'text-[#F6465D] font-bold uppercase'}>
                      {order.side}
                    </span>
                    {order.is_reward ? (
                      <div className="flex items-center gap-1 text-[8px] text-[var(--accent-color)] font-bold uppercase bg-[var(--accent-color)]/10 px-1 py-0.5 rounded border border-[var(--accent-color)]/20">
                        <Gift className="w-2.5 h-2.5" />
                        Reward
                      </div>
                    ) : (
                      <span className="text-[10px] text-[var(--text-secondary)] font-mono">{order.pair}</span>
                    )}
                  </div>
                  
                  {editingId === order.id ? (
                    <>
                      <div className="flex flex-col gap-1 flex-1 px-4">
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] text-[var(--text-secondary)] uppercase w-8">Price</span>
                          <input 
                            type="number" 
                            value={editPrice} 
                            onChange={e => setEditPrice(e.target.value)}
                            className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-0.5 text-xs font-mono w-full focus:border-[var(--accent-color)] outline-none"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] text-[var(--text-secondary)] uppercase w-8">Size</span>
                          <input 
                            type="number" 
                            value={editSize} 
                            onChange={e => setEditSize(e.target.value)}
                            className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-0.5 text-xs font-mono w-full focus:border-[var(--accent-color)] outline-none"
                          />
                        </div>
                      </div>
                      <div className="flex gap-2 ml-2">
                        <button onClick={handleModify} className="p-1.5 rounded-full bg-[var(--accent-color)]/20 text-[var(--accent-color)] hover:bg-[var(--accent-color)] hover:text-white transition-all">
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setEditingId(null)} className="p-1.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex flex-col gap-0.5 items-end">
                        <span className="font-mono text-[var(--text-primary)] font-bold">{Number(order.price).toFixed(2)}</span>
                        <span className="text-[9px] text-[var(--text-secondary)] uppercase opacity-60">Price</span>
                      </div>

                      <div className="flex flex-col gap-0.5 items-end">
                        <span className="font-mono text-[var(--text-primary)]">{(order.size - order.filled).toFixed(8)}</span>
                        <span className="text-[9px] text-[var(--text-secondary)] uppercase opacity-60">Remaining</span>
                      </div>

                      <div className="flex gap-1">
                        <button 
                          onClick={() => startEdit(order)} 
                          className="p-1.5 rounded-full bg-[var(--bg-tertiary)] opacity-0 group-hover:opacity-100 hover:bg-[var(--accent-color)]/20 text-[var(--text-secondary)] hover:text-[var(--accent-color)] transition-all"
                          title="Modify Order"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button 
                          onClick={() => cancelOrder(order.id)} 
                          className="p-1.5 rounded-full bg-[var(--bg-tertiary)] opacity-0 group-hover:opacity-100 hover:bg-[#F6465D]/20 text-[var(--text-secondary)] hover:text-[#F6465D] transition-all"
                          title="Cancel Order"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))
            ) : (
              <div className="h-32 flex flex-col items-center justify-center text-[var(--text-secondary)] gap-2">
                <ListFilter className="w-6 h-6 opacity-20" />
                <span className="text-xs italic">No active orders</span>
              </div>
            )}
          </>
        ) : (
          <>
            {orderHistory.length > 0 ? (
              orderHistory.map(order => (
                  <div key={order.id} className="flex flex-col px-4 py-3 border-b border-[var(--border-color)]/20 hover:bg-[var(--item-hover)] group transition-all">
                    <div className="flex items-center justify-between text-[11px]">
                      <div className="flex flex-col gap-0.5 w-[60px]">
                        <span className={order.side === 'buy' ? 'text-[#0ECB81] font-bold uppercase' : 'text-[#F6465D] font-bold uppercase'}>
                          {order.side}
                        </span>
                        <span className="text-[10px] text-[var(--text-secondary)] font-mono">{order.pair}</span>
                      </div>

                      <div className="flex flex-col gap-0.5 items-end">
                        <span className="font-mono text-[var(--text-primary)]">{Number(order.price).toFixed(2)}</span>
                        <span className="text-[9px] text-[var(--text-secondary)] uppercase opacity-60">Price</span>
                      </div>

                      <div className="flex flex-col gap-0.5 items-end">
                        <span className="font-mono text-[var(--text-primary)]">{Number(order.filled).toFixed(8)}</span>
                        <span className="text-[9px] text-[var(--text-secondary)] uppercase opacity-60">Filled</span>
                      </div>

                      <div className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-tighter ${
                        order.status === 'filled' ? 'bg-[#0ECB81]/10 text-[#0ECB81]' : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
                      }`}>
                        {order.status}
                      </div>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      {order.block_hash ? (
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(order.block_hash);
                          }}
                          className="text-[10px] text-[var(--text-secondary)] opacity-50 hover:opacity-100 hover:text-[#dfff00] font-mono tracking-widest transition-all"
                          title="Click to copy hash"
                        >
                          {order.block_hash.slice(0, 32)}...
                        </button>
                      ) : (
                        <span className="text-[8px] text-[var(--text-secondary)] opacity-30 font-mono uppercase tracking-tighter italic">
                          Awaiting Confirmation...
                        </span>
                      )}
                    </div>
                  </div>
              ))
            ) : (
              <div className="h-32 flex flex-col items-center justify-center text-[var(--text-secondary)] gap-2">
                <History className="w-6 h-6 opacity-20" />
                <span className="text-xs italic">No trade history</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
