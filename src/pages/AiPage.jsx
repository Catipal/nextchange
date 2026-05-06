import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Bot, Send, Brain, Activity, Trophy, ThumbsUp, ThumbsDown, Loader2, Trash2, Zap, TrendingUp, BarChart3, Sparkles, Globe } from 'lucide-react';
import { useExchange } from '../context/ExchangeContext';
import api from '../api/client';

// Stable session ID per page mount — identifies this chat session to the server
function makeSessionId() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

const SUGGESTIONS = [
  { icon: TrendingUp, label: 'Market Overview', prompt: 'Give me a market overview of all trading pairs' },
  { icon: BarChart3, label: 'Analyze BTC/BPS', prompt: 'Analyze the BTC/BPS orderbook and recent trades' },
  { icon: Zap, label: 'Trading Strategy', prompt: 'Suggest a trading strategy based on current market conditions' },
  { icon: Globe, label: 'Latest Crypto News', prompt: 'What is the latest crypto news?' },
];

function formatTime(d) { return new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

// ── Markdown renderer ─────────────────────────────────────────────────────────

function renderInline(text) {
  if (!text) return null;
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) => {
    if (!part) return null;
    if (part.startsWith('`') && part.endsWith('`'))
      return <code key={i} className="bg-black/20 px-1.5 py-0.5 rounded text-[var(--accent-color)] text-xs font-mono">{part.slice(1, -1)}</code>;
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i} className="font-bold">{part.slice(2, -2)}</strong>;
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

function SimpleMarkdown({ text }) {
  if (!text) return null;
  return (
    <div className="space-y-1">
      {text.split('\n').map((line, i) => {
        if (!line) return <div key={i} className="h-2" />;
        if (line.startsWith('## ')) return <h3 key={i} className="text-base font-bold mt-3 mb-1">{line.slice(3)}</h3>;
        if (line.startsWith('> ')) return <p key={i} className="border-l-2 border-[var(--accent-color)]/40 pl-3 text-xs text-[var(--text-secondary)] italic my-1">{renderInline(line.slice(2))}</p>;
        if (line.startsWith('---')) return <hr key={i} className="border-[var(--border-color)] my-2" />;
        if (line.startsWith('| ') && line.includes('---')) return null;
        if (line.startsWith('| ')) {
          const cells = line.split('|').filter(Boolean).map(c => c.trim());
          return <div key={i} className="flex gap-4 font-mono text-xs py-0.5">{cells.map((c, j) => <span key={j} className="min-w-[60px]">{c.replace(/`/g, '')}</span>)}</div>;
        }
        if (line.startsWith('- ')) return <p key={i} className="pl-2 text-sm">• {renderInline(line.slice(2))}</p>;
        if (line.trim() === '') return <div key={i} className="h-1" />;
        return <p key={i} className="text-sm">{renderInline(line)}</p>;
      })}
    </div>
  );
}

// ── Message Bubble ────────────────────────────────────────────────────────────

function MessageBubble({ msg, onFeedback }) {
  const isUser = msg.role === 'user';
  const isReward = msg.role === 'reward';

  if (isReward) {
    return (
      <div className="flex justify-center animate-[fadeSlide_0.4s_ease]">
        <div className="flex items-center gap-3 bg-[#0ECB81]/10 border border-[#0ECB81]/30 rounded-full px-6 py-2 text-sm">
          <Sparkles className="w-4 h-4 text-[#0ECB81]" />
          <span className="text-[#0ECB81] font-bold">{msg.content}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''} animate-[fadeSlide_0.3s_ease]`}>
      {!isUser && (
        <div className="w-8 h-8 rounded-lg bg-[var(--accent-color)]/15 flex items-center justify-center shrink-0 border border-[var(--accent-color)]/20 mt-1">
          <Bot className="w-4 h-4 text-[var(--accent-color)]" />
        </div>
      )}
      <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
        isUser
          ? 'bg-[var(--accent-color)] text-black rounded-br-md'
          : 'bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-color)] rounded-bl-md'
      }`}>
        <SimpleMarkdown text={msg.content} />
        <div className={`flex flex-col gap-2 mt-2 pt-2 border-t ${isUser ? 'border-black/10' : 'border-[var(--border-color)]/50'}`}>
          {!isUser && msg.hemisphere && msg.hemisphere !== 'offline' && (
            <div className="flex items-center gap-1.5 text-[9px] font-mono text-[var(--text-secondary)] bg-[var(--bg-primary)]/30 border border-[var(--border-color)]/50 px-2 py-1 rounded w-fit">
              <Brain className="w-3 h-3 text-[#F59E0B]" />
              <span>Hemisphere: {msg.hemisphere === 'left' ? '🔵 Left' : msg.hemisphere === 'right' ? '🔴 Right' : '🟣 Both'}</span>
              {msg.providers?.length > 0 && (
                <>
                  <span className="text-[var(--text-secondary)] mx-1">➔</span>
                  {msg.providers.map((p, i) => (
                    <span key={i} className="text-[var(--text-secondary)]">
                      {p.hemisphere === 'left' ? '🔵' : p.hemisphere === 'right' ? '🔴' : '🟣'} {p.tier}@{( (p.weight || 0) * 100).toFixed(0)}%
                      {i < msg.providers.length - 1 ? ' | ' : ''}
                    </span>
                  ))}
                </>
              )}
            </div>
          )}
          {!isUser && msg.routing && (
            <div className="flex items-center gap-1.5 text-[9px] font-mono text-[var(--text-secondary)] bg-[var(--bg-primary)]/30 border border-[var(--border-color)]/50 px-2 py-1 rounded w-fit">
              <Activity className="w-3 h-3 text-[#F59E0B]" />
              <span>Routed via [{msg.routing?.routerId?.slice(0, 6) || 'Local'}]</span>
              <span className="text-[var(--text-secondary)] mx-1">➔</span>
              <Brain className="w-3 h-3 text-[#8A2BE2]" />
              <span>Processed by [{msg.routing?.providerId?.slice(0, 6) || 'Local'}]</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <p className={`text-[10px] ${isUser ? 'text-black/40' : 'text-[var(--text-secondary)]'}`}>
              {formatTime(msg.time)}{msg.sector && ` • ${msg.sector.name}`}
            </p>
            {!isUser && msg.interactionId && (
              <div className="flex gap-2">
                <button onClick={() => onFeedback(msg.interactionId, 1)} className="text-[var(--text-secondary)] hover:text-[#0ECB81] transition-colors"><ThumbsUp className="w-3 h-3" /></button>
                <button onClick={() => onFeedback(msg.interactionId, -1)} className="text-[var(--text-secondary)] hover:text-[#F6465D] transition-colors"><ThumbsDown className="w-3 h-3" /></button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Thinking States ───────────────────────────────────────────────────────────

const THINKING_STATES = [
  { icon: Brain, label: 'Routing through Brainstem…' },
  { icon: Activity, label: 'Activating hemispheres…' },
  { icon: Sparkles, label: 'Cortex mixing response…' },
];

function ThinkingBubble({ stage }) {
  const { icon: Icon, label } = THINKING_STATES[Math.min(stage, THINKING_STATES.length - 1)];
  return (
    <div className="flex gap-3 animate-[fadeSlide_0.3s_ease]">
      <div className="w-8 h-8 rounded-lg bg-[var(--accent-color)]/15 flex items-center justify-center shrink-0 border border-[var(--accent-color)]/20 mt-1">
        <Bot className="w-4 h-4 text-[var(--accent-color)]" />
      </div>
      <div className="bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-2xl rounded-bl-md px-4 py-3 flex items-center gap-3">
        <Loader2 className="w-4 h-4 text-[var(--accent-color)] animate-spin shrink-0" />
        <div className="flex items-center gap-2">
          <Icon className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
          <span className="text-sm text-[var(--text-secondary)]">{label}</span>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AiPage() {
  const { balances } = useExchange();
  const sessionId = useMemo(() => makeSessionId(), []);
  const [activeTab, setActiveTab] = useState('chat');

  // Chat state
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [thinkingStage, setThinkingStage] = useState(0);
  const [awaitingTeaching, setAwaitingTeaching] = useState(false);
  const scrollRef = useRef(null);

  // Brain/Leaderboard state
  const [brainData, setBrainData] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [modelStatus, setModelStatus] = useState({ status: 'idle', progress: 0 });
  const [providerEnabled, setProviderEnabled] = useState(false);
  const [providerTier, setProviderTier] = useState('micro');
  const [providerCapabilities, setProviderCapabilities] = useState([]);
  const [repoId, setRepoId] = useState('unknown');
  const [ggufPath, setGgufPath] = useState('');
  const [contextSize, setContextSize] = useState(2048);
  const [benchmarkScore, setBenchmarkScore] = useState(0.0);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, thinking]);

  useEffect(() => {
    if (activeTab === 'brain') fetchBrainState();
    if (activeTab === 'leaderboard') fetchLeaderboard();
  }, [activeTab]);

  const fetchBrainState = async () => {
    try {
      const bRes = await api.get('/ai/brain-state').catch(() => null);
      if (bRes?.data) setBrainData(bRes.data);
    } catch (e) { console.warn('UI Sync Error:', e.message); }
  };

  const fetchProviderState = async () => {
    try {
      const res = await api.get('/ai/provider').catch(() => null);
      if (res?.data) {
        setProviderEnabled(res.data.enabled);
        if (res.data.tier) setProviderTier(res.data.tier);
        if (res.data.benchmark) setBenchmarkScore(res.data.benchmark);
        if (res.data.capabilities) setProviderCapabilities(res.data.capabilities);
        if (res.data.loader) {
          setModelStatus(res.data.loader);
          if (res.data.loader.modelPath && res.data.enabled) {
            setGgufPath(res.data.loader.modelPath);
          }
        }
      }
    } catch (e) {}
  };

  useEffect(() => {
    fetchProviderState();
    if (activeTab === 'provider') {
      const interval = setInterval(fetchProviderState, 2000);
      return () => clearInterval(interval);
    }
  }, [activeTab]);

  const toggleProvider = async () => {
    const newState = !providerEnabled;
    setProviderEnabled(newState); // optimistic update
    try {
      await api.post('/ai/provider', {
        enabled: newState,
        tier: providerTier,
        repoId,
        ggufPath,
        contextSize
      });
      fetchProviderState();
    } catch (e) {
      setProviderEnabled(!newState); // rollback
      console.error('Failed to toggle provider:', e);
    }
  };

  const fetchLeaderboard = async () => {
    try { const r = await api.get('/ai/leaderboard'); setLeaderboard(r.data); } catch {}
  };

  const handleSend = useCallback(async (text) => {
    const prompt = (text || input).trim();
    if (!prompt || thinking) return;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: prompt, time: Date.now() }]);
    setThinking(true);
    setThinkingStage(0);

    // Advance through thinking stages for UX
    const t1 = setTimeout(() => setThinkingStage(1), 800);
    const t2 = setTimeout(() => setThinkingStage(2), 2000);

    try {
      const res = await api.post('/ai/query', { query: prompt, balances, sessionId });
      clearTimeout(t1); clearTimeout(t2);

      const { response, sector, interactionId, awaiting, reward, entropyDelta, hemisphere, providers } = res.data;

      setAwaitingTeaching(!!awaiting);
      setMessages(prev => [...prev, {
        role: 'ai', content: response, sector, interactionId,
        hemisphere, providers,
        time: Date.now()
      }]);

      // If State 2 resolved with a reward, inject a reward bubble
      if (reward > 0 && entropyDelta > 0) {
        setMessages(prev => [...prev, {
          role: 'reward',
          content: `Entropy reduced by ${(entropyDelta || 0).toFixed(4)} — +${(reward || 0).toFixed(4)} BPS added to your wallet!`,
          time: Date.now()
        }]);
      }
    } catch {
      clearTimeout(t1); clearTimeout(t2);
      setMessages(prev => [...prev, { role: 'ai', content: 'Connection to Brainstem failed. Please try again.', time: Date.now() }]);
    } finally {
      setThinking(false);
      setThinkingStage(0);
    }
  }, [input, thinking, balances, sessionId]);

  const handleFeedback = async (interactionId, val) => {
    try { await api.post('/ai/feedback', { interactionId, feedback: val }); } catch {}
  };

  const tabs = [
    { id: 'chat', label: 'Chat', icon: Bot, color: 'var(--accent-color)' },
    { id: 'brain', label: 'Brain State', icon: Brain, color: '#0ECB81' },
    { id: 'provider', label: 'Provider Node', icon: Activity, color: '#F59E0B' },
    { id: 'leaderboard', label: 'Leaderboard', icon: Trophy, color: '#3B82F6' },
  ];

  return (
    <div className="flex-1 flex flex-col bg-[var(--bg-primary)] overflow-hidden">

      {/* Tab Nav */}
      <div className="flex items-center gap-6 px-8 py-4 border-b border-[var(--border-color)] bg-[var(--bg-secondary)]">
        {tabs.map((tab) => {
          const TabIcon = tab.icon;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 font-black uppercase tracking-widest text-xs transition-colors ${activeTab === tab.id ? '' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
              style={activeTab === tab.id ? { color: tab.color } : {}}>
              <TabIcon className="w-4 h-4" /> {tab.label}
            </button>
          );
        })}
        {awaitingTeaching && (
          <div className="ml-auto flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[#8A2BE2] animate-pulse">
            <Sparkles className="w-3.5 h-3.5" /> Listening — reply to teach & earn BPS
          </div>
        )}
      </div>

      {/* CHAT TAB */}
      {activeTab === 'chat' && (
        <>
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
            <div className="max-w-3xl mx-auto space-y-6">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center pt-16 pb-8 animate-[fadeSlide_0.5s_ease]">
                  <div className="w-20 h-20 rounded-2xl bg-[var(--accent-color)]/10 border border-[var(--accent-color)]/20 flex items-center justify-center mb-6">
                    <Bot className="w-10 h-10 text-[var(--accent-color)]" />
                  </div>
                  <h1 className="text-2xl font-bold mb-2">Decentralized Intelligence</h1>
                  <p className="text-[var(--text-secondary)] text-sm max-w-md text-center mb-10">
                    Ask me anything. If I don't know, I'll search the web and learn from your reply — earning you BPS automatically.
                  </p>
                  <div className="grid grid-cols-2 gap-3 w-full max-w-lg">
                    {SUGGESTIONS.map((s) => {
                      const SugIcon = s.icon;
                      return (
                        <button key={s.label} onClick={() => handleSend(s.prompt)}
                          className="flex items-center gap-3 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl px-4 py-3.5 text-left hover:border-[var(--accent-color)]/40 hover:bg-[var(--bg-tertiary)] transition-all group">
                          <div className="w-9 h-9 rounded-lg bg-[var(--accent-color)]/10 flex items-center justify-center shrink-0 group-hover:bg-[var(--accent-color)]/20">
                            <SugIcon className="w-4 h-4 text-[var(--accent-color)]" />
                          </div>
                          <div>
                            <p className="text-sm font-medium">{s.label}</p>
                            <p className="text-[11px] text-[var(--text-secondary)] line-clamp-1">{s.prompt}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {messages.map((msg, i) => <MessageBubble key={i} msg={msg} onFeedback={handleFeedback} />)}
              {thinking && <ThinkingBubble stage={thinkingStage} />}
            </div>
          </div>

          <div className="border-t border-[var(--border-color)] bg-[var(--bg-secondary)] px-6 py-4">
            <div className="max-w-3xl mx-auto flex items-end gap-3">
              {messages.length > 0 && (
                <button onClick={() => { setMessages([]); setAwaitingTeaching(false); }}
                  className="p-2.5 rounded-xl text-[var(--text-secondary)] hover:text-[#F6465D] hover:bg-[#F6465D]/10 mb-0.5">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              <div className="flex-1 relative">
                <textarea value={input} onChange={e => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
                  placeholder={awaitingTeaching ? 'Verify or expand on the above to earn BPS…' : 'Ask the Global Brain…'}
                  rows={1}
                  className={`w-full bg-[var(--bg-primary)] border rounded-xl px-4 py-3 pr-12 text-sm text-[var(--text-primary)] focus:outline-none resize-none transition-colors ${awaitingTeaching ? 'border-[#8A2BE2]/50 focus:border-[#8A2BE2]' : 'border-[var(--border-color)] focus:border-[var(--accent-color)]/50'}`}
                  style={{ minHeight: '44px', maxHeight: '120px' }} />
                <button onClick={() => handleSend()} disabled={!input.trim() || thinking}
                  className="absolute right-2 bottom-2 p-2 rounded-lg bg-[var(--accent-color)] text-black disabled:opacity-30">
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
            <p className="text-center text-[10px] text-[var(--text-secondary)]/50 mt-2 max-w-3xl mx-auto">
              {awaitingTeaching ? '🟣 Teaching mode — your reply will permanently reduce entropy and earn BPS.' : 'Responses are enriched with live market data and web context.'}
            </p>
          </div>
        </>
      )}

      {/* BRAIN STATE TAB */}
      {activeTab === 'brain' && (
        <div className="flex-1 overflow-y-auto px-8 py-8 animate-[fadeSlide_0.3s_ease]">
          <div className="max-w-5xl mx-auto space-y-8">
            {!brainData ? (
              <div className="flex items-center justify-center h-40"><Loader2 className="w-8 h-8 animate-spin text-[var(--text-secondary)]" /></div>
            ) : (
              <>
                {/* Top Stats */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  {[
                    { label: 'AI Pot Balance', value: `${(brainData?.pot?.totalBps || 0).toFixed(2)} BPS`, sub: 'DAO-funded reward pool', color: 'var(--accent-color)' },
                    { label: 'Next Reward Event', value: `${(brainData?.pot?.nextRewardEvent || 0).toFixed(4)} BPS`, sub: '0.5% drawdown per query', color: '#0ECB81' },
                    { label: 'Brain Readiness', value: `${brainData?.readinessPct || 0}%`, sub: `Hemispheric Health: ${brainData?.hemispheres?.logic ? '🔵' : '⚪'}${brainData?.hemispheres?.creative ? '🔴' : '⚪'}`, color: '#F59E0B' },
                    { label: 'Active Neural Nodes', value: brainData?.activeNodes || 0, sub: 'Total inference providers', color: '#8A2BE2' },
                  ].map(({ label, value, sub, color }) => (
                    <div key={label} className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl p-5">
                      <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)] mb-2">{label}</p>
                      <p className="text-2xl font-mono font-black" style={{ color }}>{value}</p>
                      <p className="text-[10px] text-[var(--text-secondary)] mt-1">{sub}</p>
                    </div>
                  ))}
                </div>

                {/* Hemispheric Mesh Architecture Diagram */}
                <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl p-6">
                  <h3 className="text-sm font-black uppercase tracking-widest text-[var(--text-secondary)] mb-5">Hemispheric Mesh Architecture</h3>
                  <div className="flex items-center justify-center gap-4 py-4">
                    {/* Router / Brainstem */}
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shadow-[0_0_20px_rgba(245,158,11,0.1)]">
                        <Activity className="w-7 h-7 text-amber-500" />
                      </div>
                      <span className="text-[10px] font-black uppercase tracking-widest">Brainstem Router</span>
                      <span className="text-[9px] text-[var(--text-secondary)]">Intent Classification</span>
                    </div>

                    {/* Bifurcation Arrows */}
                    <div className="flex flex-col gap-6">
                      <div className="flex items-center gap-1">
                        <div className="h-px w-12 bg-gradient-to-r from-amber-500 to-blue-500"></div>
                        <span className="text-[8px] font-mono text-blue-400">LOGIC</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="h-px w-12 bg-gradient-to-r from-amber-500 to-red-500"></div>
                        <span className="text-[8px] font-mono text-red-400">CREATIVE</span>
                      </div>
                    </div>

                    {/* Hemispheres */}
                    <div className="flex flex-col gap-4">
                      <div className="flex items-center gap-3 bg-[var(--bg-primary)] border border-blue-500/20 rounded-xl px-4 py-2 w-48">
                        <div className={`w-3 h-3 rounded-full ${brainData?.hemispheres?.logic ? 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]' : 'bg-gray-600'}`}></div>
                        <div className="flex-1">
                          <p className="text-[10px] font-black uppercase tracking-widest text-blue-400">Left Hemisphere</p>
                          <p className="text-[8px] text-[var(--text-secondary)]">Analytical / Logic Tiers</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 bg-[var(--bg-primary)] border border-red-500/20 rounded-xl px-4 py-2 w-48">
                        <div className={`w-3 h-3 rounded-full ${brainData?.hemispheres?.creative ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]' : 'bg-gray-600'}`}></div>
                        <div className="flex-1">
                          <p className="text-[10px] font-black uppercase tracking-widest text-red-400">Right Hemisphere</p>
                          <p className="text-[8px] text-[var(--text-secondary)]">Creative / Generative Tiers</p>
                        </div>
                      </div>
                    </div>

                    {/* Convergence Arrow */}
                    <div className="flex flex-col items-center gap-1 px-2">
                      <div className="h-px w-12 bg-gradient-to-r from-purple-500 to-[#8A2BE2]"></div>
                      <span className="text-[8px] font-mono text-purple-400">MIXER</span>
                    </div>

                    {/* Cortex Output */}
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-16 h-16 rounded-2xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center">
                        <Sparkles className="w-7 h-7 text-purple-400" />
                      </div>
                      <span className="text-[10px] font-black uppercase tracking-widest">Global Response</span>
                      <span className="text-[9px] font-mono text-[#0ECB81]">Reward Split</span>
                    </div>
                  </div>
                </div>

                {/* Sector Intelligence Heatmap */}
                <div className="space-y-4">
                  <h3 className="text-lg font-black uppercase tracking-tighter flex items-center gap-2"><Activity className="w-5 h-5 text-[var(--text-secondary)]" /> Network Intelligence Map</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* ROUTER — Active Nodes Heatmap */}
                    {(() => {
                      const tierColor = '#F59E0B';
                      const allNodes = brainData?.inferenceNodes || [];
                      const peerCount = allNodes.length || 0;
                      return (
                        <div className="space-y-4 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl p-5">
                          <div className="flex items-center justify-between pb-3 border-b border-[var(--border-color)]">
                            <div className="flex items-center gap-2">
                              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: tierColor }}></div>
                              <p className="font-black uppercase tracking-widest text-xs">Router</p>
                            </div>
                            <span className="text-[10px] font-mono px-2 py-1 rounded border border-[var(--border-color)]" style={{ color: tierColor }}>2% share</span>
                          </div>
                          <div className="flex justify-between text-[10px] font-mono bg-[var(--bg-primary)] rounded-lg p-2.5 border border-[var(--border-color)]">
                            <span className="text-[var(--text-secondary)]">Reward / Hit</span>
                            <span style={{ color: tierColor }}>{(brainData?.pot?.breakdown?.router?.rewardPerHit || 0).toFixed(4)} BPS</span>
                          </div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)]">Active Nodes ({peerCount})</p>
                          <div className="flex flex-wrap gap-2">
                            {allNodes.length > 0 ? allNodes.map((n, i) => {
                              const heat = Math.min(n.benchmark_score || 0.5, 1);
                              const bg = heat > 0.8 ? 'bg-[#0ECB81]/30 border-[#0ECB81]/60' : heat > 0.5 ? 'bg-yellow-400/20 border-yellow-400/50' : 'bg-[var(--bg-primary)] border-[var(--border-color)]';
                              return (
                                <div key={n.node_id || i} className="relative group">
                                  <div className={`w-10 h-10 rounded-lg border ${bg} transition-transform hover:scale-110 cursor-crosshair flex items-center justify-center`}>
                                    <Activity className="w-4 h-4 text-amber-500/60" />
                                  </div>
                                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-44 p-2.5 rounded-xl bg-[var(--bg-primary)] border border-[var(--border-color)] shadow-2xl opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-10">
                                    <p className="font-bold text-xs mb-1 truncate">{n.node_id?.slice(0, 12) || 'Node'}…</p>
                                    <div className="text-[9px] font-mono space-y-0.5 text-[var(--text-secondary)]">
                                      <div className="flex justify-between"><span>Tier</span><span className="text-amber-400">{n.model_tier}</span></div>
                                      <div className="flex justify-between"><span>Model</span><span className="text-[var(--text-primary)]">{n.model_repo_id}</span></div>
                                      <div className="flex justify-between"><span>Earned</span><span className="text-[#0ECB81]">{(n.total_earned_bps || 0).toFixed(4)} BPS</span></div>
                                    </div>
                                  </div>
                                </div>
                              );
                            }) : (
                              <p className="text-[10px] text-[var(--text-secondary)] italic py-4">No active router nodes. Enable Provider Mode to join.</p>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* MACRO — Active Models Heatmap */}
                    {(() => {
                      const tierColor = '#8A2BE2';
                      const macroNodes = (brainData?.inferenceNodes || []).filter(n => n.model_tier === 'macro');
                      // Group by model
                      const modelGroups = {};
                      macroNodes.forEach(n => {
                        if (!modelGroups[n.model_repo_id]) modelGroups[n.model_repo_id] = { nodes: [], totalBps: 0, bestBenchmark: 0 };
                        modelGroups[n.model_repo_id].nodes.push(n);
                        modelGroups[n.model_repo_id].totalBps += n.total_earned_bps || 0;
                        modelGroups[n.model_repo_id].bestBenchmark = Math.max(modelGroups[n.model_repo_id].bestBenchmark, n.benchmark_score || 0);
                      });
                      const models = Object.entries(modelGroups).sort((a, b) => b[1].totalBps - a[1].totalBps);
                      return (
                        <div className="space-y-4 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl p-5">
                          <div className="flex items-center justify-between pb-3 border-b border-[var(--border-color)]">
                            <div className="flex items-center gap-2">
                              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: tierColor }}></div>
                              <p className="font-black uppercase tracking-widest text-xs">Macro</p>
                            </div>
                            <span className="text-[10px] font-mono px-2 py-1 rounded border border-[var(--border-color)]" style={{ color: tierColor }}>64% share</span>
                          </div>
                          <div className="flex justify-between text-[10px] font-mono bg-[var(--bg-primary)] rounded-lg p-2.5 border border-[var(--border-color)]">
                            <span className="text-[var(--text-secondary)]">Reward / Hit</span>
                            <span style={{ color: tierColor }}>{(brainData?.pot?.breakdown?.macro?.rewardPerHit || 0).toFixed(4)} BPS</span>
                          </div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)]">Active Models ({models.length})</p>
                          <div className="flex flex-wrap gap-2">
                            {models.length > 0 ? models.map(([repoId, data]) => {
                              const heat = data.bestBenchmark;
                              const size = data.nodes.length <= 3 ? 'w-14 h-14' : data.nodes.length <= 10 ? 'w-12 h-12' : 'w-10 h-10';
                              const bg = heat > 0.85 ? 'bg-[#8A2BE2]/30 border-[#8A2BE2]/60' : heat > 0.7 ? 'bg-[#8A2BE2]/15 border-[#8A2BE2]/40' : 'bg-[var(--bg-primary)] border-[var(--border-color)]';
                              return (
                                <div key={repoId} className="relative group">
                                  <div className={`${size} rounded-lg border ${bg} transition-transform hover:scale-110 cursor-crosshair flex items-center justify-center`}>
                                    <Brain className="w-5 h-5 text-[#8A2BE2]/60" />
                                  </div>
                                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 p-2.5 rounded-xl bg-[var(--bg-primary)] border border-[var(--border-color)] shadow-2xl opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-10">
                                    <p className="font-bold text-xs mb-1" style={{ color: tierColor }}>{repoId}</p>
                                    <div className="text-[9px] font-mono space-y-0.5 text-[var(--text-secondary)]">
                                      <div className="flex justify-between"><span>Nodes Running</span><span className="text-[var(--text-primary)]">{data.nodes.length}</span></div>
                                      <div className="flex justify-between"><span>Best Benchmark</span><span className="text-yellow-400">{((data.bestBenchmark || 0) * 100).toFixed(1)}%</span></div>
                                      <div className="flex justify-between"><span>Total Earned</span><span className="text-[#0ECB81]">{(data.totalBps || 0).toFixed(4)} BPS</span></div>
                                    </div>
                                  </div>
                                </div>
                              );
                            }) : (
                              <p className="text-[10px] text-[var(--text-secondary)] italic py-4">No macro models online. Run a 1T+ model to earn 64% rewards.</p>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* MICRO — Active Models Heatmap */}
                    {(() => {
                      const tierColor = '#0ECB81';
                      const microNodes = (brainData?.inferenceNodes || []).filter(n => n.model_tier === 'micro');
                      const modelGroups = {};
                      microNodes.forEach(n => {
                        if (!modelGroups[n.model_repo_id]) modelGroups[n.model_repo_id] = { nodes: [], totalBps: 0, bestBenchmark: 0 };
                        modelGroups[n.model_repo_id].nodes.push(n);
                        modelGroups[n.model_repo_id].totalBps += n.total_earned_bps || 0;
                        modelGroups[n.model_repo_id].bestBenchmark = Math.max(modelGroups[n.model_repo_id].bestBenchmark, n.benchmark_score || 0);
                      });
                      const models = Object.entries(modelGroups).sort((a, b) => b[1].totalBps - a[1].totalBps);
                      return (
                        <div className="space-y-4 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl p-5">
                          <div className="flex items-center justify-between pb-3 border-b border-[var(--border-color)]">
                            <div className="flex items-center gap-2">
                              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: tierColor }}></div>
                              <p className="font-black uppercase tracking-widest text-xs">Micro</p>
                            </div>
                            <span className="text-[10px] font-mono px-2 py-1 rounded border border-[var(--border-color)]" style={{ color: tierColor }}>33% share</span>
                          </div>
                          <div className="flex justify-between text-[10px] font-mono bg-[var(--bg-primary)] rounded-lg p-2.5 border border-[var(--border-color)]">
                            <span className="text-[var(--text-secondary)]">Reward / Hit</span>
                            <span style={{ color: tierColor }}>{(brainData?.pot?.breakdown?.micro?.rewardPerHit || 0).toFixed(4)} BPS</span>
                          </div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)]">Active Models ({models.length})</p>
                          <div className="flex flex-wrap gap-2">
                            {models.length > 0 ? models.map(([repoId, data]) => {
                              const heat = data.bestBenchmark;
                              const size = data.nodes.length <= 3 ? 'w-14 h-14' : data.nodes.length <= 10 ? 'w-12 h-12' : 'w-10 h-10';
                              const bg = heat > 0.8 ? 'bg-[#0ECB81]/30 border-[#0ECB81]/60' : heat > 0.6 ? 'bg-[#0ECB81]/15 border-[#0ECB81]/40' : 'bg-[var(--bg-primary)] border-[var(--border-color)]';
                              return (
                                <div key={repoId} className="relative group">
                                  <div className={`${size} rounded-lg border ${bg} transition-transform hover:scale-110 cursor-crosshair flex items-center justify-center`}>
                                    <Zap className="w-4 h-4 text-[#0ECB81]/60" />
                                  </div>
                                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 p-2.5 rounded-xl bg-[var(--bg-primary)] border border-[var(--border-color)] shadow-2xl opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-10">
                                    <p className="font-bold text-xs mb-1" style={{ color: tierColor }}>{repoId}</p>
                                    <div className="text-[9px] font-mono space-y-0.5 text-[var(--text-secondary)]">
                                      <div className="flex justify-between"><span>Nodes Running</span><span className="text-[var(--text-primary)]">{data.nodes.length}</span></div>
                                      <div className="flex justify-between"><span>Best Benchmark</span><span className="text-yellow-400">{((data.bestBenchmark || 0) * 100).toFixed(1)}%</span></div>
                                      <div className="flex justify-between"><span>Total Earned</span><span className="text-[#0ECB81]">{(data.totalBps || 0).toFixed(4)} BPS</span></div>
                                    </div>
                                  </div>
                                </div>
                              );
                            }) : (
                              <p className="text-[10px] text-[var(--text-secondary)] italic py-4">No micro models online. Run Phi-2 or SmolLM to earn 33% rewards.</p>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Event Log */}
                <div className="space-y-4">
                  <h3 className="text-lg font-black uppercase tracking-tighter">Synaptic Chain Event Log</h3>
                  <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl overflow-hidden">
                    <table className="w-full text-left text-sm">
                      <thead><tr className="border-b border-[var(--border-color)] text-[10px] uppercase tracking-widest text-[var(--text-secondary)] bg-[var(--bg-primary)]/50">
                        <th className="p-4">Block</th><th className="p-4">Type</th><th className="p-4">Payload</th>
                      </tr></thead>
                      <tbody>
                        {brainData?.events?.map((ev, i) => (
                          <tr key={i} className="border-b border-[var(--border-color)]/30">
                            <td className="p-4 font-mono text-xs">{ev.blockIndex}</td>
                            <td className="p-4"><span className="text-[9px] bg-[#8A2BE2]/10 text-[#8A2BE2] px-2 py-1 rounded font-black uppercase tracking-widest">{ev.type}</span></td>
                            <td className="p-4 text-xs font-mono text-[var(--text-secondary)] max-w-xs truncate">{JSON.stringify(ev.payload)}</td>
                          </tr>
                        ))}
                        {(!brainData?.events || brainData.events.length === 0) && <tr><td colSpan="3" className="p-6 text-center text-xs text-[var(--text-secondary)]">No AI events logged yet.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* PROVIDER TAB */}
      {activeTab === 'provider' && (
        <div className="flex-1 overflow-y-auto px-8 py-8 animate-[fadeSlide_0.3s_ease]">
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-12 h-12 bg-amber-500/10 rounded-xl flex items-center justify-center"><Activity className="w-6 h-6 text-amber-500" /></div>
              <div>
                <h2 className="text-2xl font-black uppercase tracking-tighter">Inference Provider Node</h2>
                <p className="text-[var(--text-secondary)] text-sm">Contribute compute power to the Synaptic Aggregator and earn BPS for every request you process.</p>
              </div>
            </div>

            <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl p-8">
              <div className="flex items-center justify-between mb-8 pb-8 border-b border-[var(--border-color)]">
                <div>
                  <h3 className="text-lg font-bold mb-1">Provider Mode</h3>
                  <p className="text-xs text-[var(--text-secondary)]">When active, your Hub will accept and process AI requests from the P2P network.</p>
                </div>
                <button 
                  onClick={toggleProvider}
                  className={`w-14 h-8 rounded-full p-1 transition-colors ${providerEnabled ? 'bg-[#0ECB81]' : 'bg-[var(--border-color)]'}`}
                >
                  <div className={`w-6 h-6 rounded-full bg-white transition-transform ${providerEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
              </div>

              <div className={`space-y-6 transition-opacity ${providerEnabled ? 'opacity-80' : ''}`}>
                <div>
                  <label className="block text-xs font-black uppercase tracking-widest text-[var(--text-secondary)] mb-3">Local GGUF File Path</label>
                  <input 
                    type="text" 
                    value={ggufPath}
                    onChange={e => setGgufPath(e.target.value)}
                    disabled={providerEnabled}
                    className={`w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl px-4 py-3 text-sm focus:outline-none ${providerTier === 'macro' ? 'focus:border-[#8A2BE2]' : 'focus:border-[#0ECB81]'}`}
                    placeholder={providerTier === 'macro' ? "C:\\models\\llama-4-1t.Q4_K_M.gguf" : "C:\\models\\llama-3-8b.Q4_K_M.gguf"}
                  />
                  <p className="text-[10px] text-[var(--text-secondary)] mt-2 italic">Requires node-llama-cpp and AVX2/CUDA support.</p>
                </div>

                <div>
                  <label className="block text-xs font-black uppercase tracking-widest text-[var(--text-secondary)] mb-3">Context Window (Tokens)</label>
                  <div className="flex items-center gap-4">
                    <input 
                      type="range" 
                      min="512" 
                      max="32768" 
                      step="512"
                      value={contextSize}
                      onChange={e => setContextSize(parseInt(e.target.value))}
                      disabled={providerEnabled}
                      className="flex-1 accent-[var(--accent-color)]"
                    />
                    <div className="w-24 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl px-3 py-2 text-center text-xs font-mono font-bold">
                      {contextSize}
                    </div>
                  </div>
                  <p className="text-[10px] text-[var(--text-secondary)] mt-2 italic">Higher values use more RAM. Start low (2048) and increase as needed.</p>
                </div>

                <div>
                  <label className="block text-xs font-black uppercase tracking-widest text-[var(--text-secondary)] mb-3">Model Status & Verifiable Benchmark</label>
                  <div className="flex items-center gap-4 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl p-4">
                    {modelStatus.status === 'ready' ? <Trophy className="w-5 h-5 text-yellow-400" /> : <Loader2 className={`w-5 h-5 ${modelStatus.status === 'loading' ? 'animate-spin text-[var(--accent-color)]' : 'text-[var(--text-secondary)]'}`} />}
                    <div className="flex-1">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-bold">
                          {modelStatus.status === 'ready' 
                            ? `Model Ready & Verified (${providerTier.toUpperCase()} TIER)` 
                            : modelStatus.status === 'loading' 
                              ? `Loading... ${modelStatus.progress}%` 
                              : 'Provider Offline'}
                        </span>
                        {benchmarkScore > 0 && <span className="font-mono text-yellow-400">Score: {(benchmarkScore * 100).toFixed(1)}%</span>}
                      </div>
                      <div className="w-full bg-[var(--bg-secondary)] rounded-full h-2 mb-1 overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-300 ${modelStatus.status === 'ready' ? (providerTier === 'macro' ? 'bg-[#8A2BE2]' : 'bg-[#0ECB81]') : 'bg-[var(--accent-color)]'}`} style={{ width: `${modelStatus.status === 'ready' ? 100 : modelStatus.progress}%` }}></div>
                      </div>
                      {providerCapabilities.length > 0 && modelStatus.status === 'ready' && (
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-[10px] text-[var(--text-secondary)]">Hemisphere Capabilities:</span>
                          {providerCapabilities.includes('logic') && (
                            <span className="text-[9px] bg-blue-500/15 text-blue-400 px-2 py-0.5 rounded-full font-bold">🔵 Logic</span>
                          )}
                          {providerCapabilities.includes('creative') && (
                            <span className="text-[9px] bg-red-500/15 text-red-400 px-2 py-0.5 rounded-full font-bold">🔴 Creative</span>
                          )}
                          {providerCapabilities.includes('general') && (
                            <span className="text-[9px] bg-purple-500/15 text-purple-400 px-2 py-0.5 rounded-full font-bold">🟣 General</span>
                          )}
                        </div>
                      )}
                      <p className="text-[10px] text-[var(--text-secondary)] mt-1">
                        {modelStatus.error || `Oracle auto-detects Tier, Score, and Hemisphere capabilities at model load time.`}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* LEADERBOARD TAB */}
      {activeTab === 'leaderboard' && (
        <div className="flex-1 overflow-y-auto px-8 py-8 animate-[fadeSlide_0.3s_ease]">
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-12 h-12 bg-blue-500/10 rounded-xl flex items-center justify-center"><Trophy className="w-6 h-6 text-blue-400" /></div>
              <div>
                <h2 className="text-2xl font-black uppercase tracking-tighter">Network Intelligence Leaderboard</h2>
                <p className="text-[var(--text-secondary)] text-sm">Ranked by total BPS earned across all provider nodes running these specific models.</p>
              </div>
            </div>
            <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl overflow-hidden">
              <table className="w-full text-left">
                <thead><tr className="border-b border-[var(--border-color)] text-[10px] uppercase tracking-widest text-[var(--text-secondary)] bg-[var(--bg-primary)]/50">
                  <th className="p-6">Rank</th><th className="p-6">Model Repository</th><th className="p-6 text-right">Active Nodes</th><th className="p-6 text-right">Total BPS Earned</th>
                </tr></thead>
                <tbody>
                  {leaderboard.map((model, i) => (
                    <tr key={i} className="border-b border-[var(--border-color)]/30 hover:bg-[var(--bg-primary)]/50">
                      <td className="p-6 font-black text-xl text-[var(--text-secondary)]">#{i + 1}</td>
                      <td className="p-6 font-mono text-sm text-[var(--accent-color)]">{model.id}</td>
                      <td className="p-6 text-right font-mono text-sm text-[var(--text-secondary)]">{model.active_nodes}</td>
                      <td className="p-6 text-right font-mono text-lg font-black text-[#0ECB81]">{(model.total_bps || 0).toFixed(4)}</td>
                    </tr>
                  ))}
                  {leaderboard.length === 0 && <tr><td colSpan="4" className="p-8 text-center text-[var(--text-secondary)] text-sm">No models have earned rewards yet. Start a provider node to begin!</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes fadeSlide { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }`}</style>
    </div>
  );
}
