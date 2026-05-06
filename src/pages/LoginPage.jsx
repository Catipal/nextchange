import React, { useState } from 'react';
import { useNavigate, Navigate } from 'react-router';
import { Activity, KeyRound, RotateCcw, Lock, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import SeedPhraseDisplay from '../components/SeedPhraseDisplay';

export default function LoginPage() {
  const { isAuthenticated, walletExists, createWallet, restoreWallet, unlockWallet } = useAuth();
  const navigate = useNavigate();

  // Flow: 'welcome' | 'create-pin' | 'show-seed' | 'restore' | 'unlock'
  const [flow, setFlow] = useState(walletExists ? 'unlock' : 'welcome');
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [mnemonic, setMnemonic] = useState('');
  const [restoreWords, setRestoreWords] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (isAuthenticated) return <Navigate to="/" replace />;

  // ── Create wallet: set PIN first ──
  const handleCreateStart = () => { setFlow('create-pin'); setError(''); setPin(''); setPinConfirm(''); };

  const handlePinSet = async () => {
    if (pin.length < 4) { setError('PIN must be at least 4 characters'); return; }
    if (pin !== pinConfirm) { setError('PINs do not match'); return; }
    setLoading(true); setError('');
    try {
      const result = await createWallet(pin);
      setMnemonic(result.mnemonic);
      setFlow('show-seed');
    } catch (err) { setError(err.message); }
    setLoading(false);
  };

  const handleSeedConfirmed = async () => {
    setLoading(true); setError('');
    try {
      await unlockWallet(pin);
      navigate('/');
    } catch (err) { setError(err.message); }
    setLoading(false);
  };

  // ── Restore wallet ──
  const handleRestore = async () => {
    if (!restoreWords.trim()) { setError('Enter your seed phrase'); return; }
    if (pin.length < 4) { setError('PIN must be at least 4 characters'); return; }
    setLoading(true); setError('');
    try {
      await restoreWallet(restoreWords.trim().toLowerCase(), pin);
      await unlockWallet(pin);
      navigate('/');
    } catch (err) { setError(err.message || 'Invalid seed phrase'); }
    setLoading(false);
  };

  // ── Unlock existing wallet ──
  const handleUnlock = async (e) => {
    e.preventDefault();
    if (!pin) return;
    setLoading(true); setError('');
    try {
      await unlockWallet(pin);
      navigate('/');
    } catch (err) { setError(err.message || 'Wrong PIN'); }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center px-4 relative overflow-hidden">
      {/* Background effects removed */}

      <div className="relative z-10 w-full max-w-lg">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="w-16 h-16 rounded-full overflow-hidden bg-[var(--bg-secondary)] flex items-center justify-center border-2 border-[var(--accent-color)]/40 shadow-[0_0_40px_rgba(223,255,0,0.25)]">
              <img src="/logo.png?v=1" alt="Logo" className="w-full h-full object-cover scale-110" />
            </div>
            <span className="text-3xl font-bold tracking-tight text-white">
              nextchange<span className="text-[var(--accent-color)]">.hub</span>
            </span>
          </div>
          <p className="text-gray-400 text-sm">P2P Decentralized Exchange</p>
        </div>

        <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-color)] p-8 shadow-2xl">

          {/* ═══ WELCOME ═══ */}
          {flow === 'welcome' && (
            <div className="space-y-6">
              <div className="text-center">
                <KeyRound className="w-12 h-12 text-[var(--accent-color)] mx-auto mb-3" />
                <h2 className="text-xl font-bold text-white mb-2">Welcome to NextChange</h2>
                <p className="text-sm text-gray-400">Your keys, your coins. No account needed — just a seed phrase.</p>
              </div>
              <button onClick={handleCreateStart}
                className="w-full py-3.5 bg-[var(--accent-color)] text-black font-bold rounded-lg hover:bg-[var(--accent-color)]/90 transition-colors text-sm uppercase tracking-wide shadow-[0_0_20px_rgba(252,213,53,0.3)]">
                Create New Wallet
              </button>
              <button onClick={() => { setFlow('restore'); setError(''); setPin(''); }}
                className="w-full py-3.5 border border-[var(--border-color)] text-gray-300 rounded-lg hover:bg-[var(--border-color)] transition-colors text-sm font-bold flex items-center justify-center gap-2">
                <RotateCcw className="w-4 h-4" /> Restore from Seed Phrase
              </button>
            </div>
          )}

          {/* ═══ CREATE: SET PIN ═══ */}
          {flow === 'create-pin' && (
            <div className="space-y-5">
              <div className="text-center">
                <Lock className="w-10 h-10 text-[var(--accent-color)] mx-auto mb-3" />
                <h2 className="text-lg font-bold text-white mb-1">Set Your PIN</h2>
                <p className="text-xs text-gray-400">This PIN encrypts your wallet on this device. You'll need it every time you open the app.</p>
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1.5 block font-medium">PIN / Password</label>
                <div className="relative">
                  <input type={showPin ? 'text' : 'password'} value={pin} onChange={e => setPin(e.target.value)}
                    className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-4 py-3 text-white focus:outline-none focus:border-[var(--accent-color)] transition-colors pr-12"
                    placeholder="Min. 4 characters" autoFocus />
                  <button type="button" onClick={() => setShowPin(!showPin)} className="absolute right-3 top-3 text-gray-500 hover:text-gray-300">
                    {showPin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1.5 block font-medium">Confirm PIN</label>
                <input type={showPin ? 'text' : 'password'} value={pinConfirm} onChange={e => setPinConfirm(e.target.value)}
                  className="w-full bg-[#0B0E11] border border-[#2B3139] rounded-lg px-4 py-3 text-white focus:outline-none focus:border-[var(--accent-color)] transition-colors"
                  placeholder="Repeat PIN" />
              </div>
              {error && <div className="bg-[#F6465D]/10 border border-[#F6465D]/30 rounded-lg p-3 text-sm text-[#F6465D]">{error}</div>}
              <div className="flex gap-3">
                <button onClick={() => setFlow('welcome')} className="flex-1 py-3 border border-[#2B3139] text-gray-400 rounded-lg hover:text-white transition-colors text-sm font-bold">Back</button>
                <button onClick={handlePinSet} disabled={loading}
                  className="flex-1 py-3 bg-[var(--accent-color)] text-black font-bold rounded-lg hover:bg-[var(--accent-color)]/90 transition-colors disabled:opacity-50 text-sm">
                  {loading ? 'Generating...' : 'Generate Wallet'}
                </button>
              </div>
            </div>
          )}

          {/* ═══ CREATE: SHOW SEED ═══ */}
          {flow === 'show-seed' && mnemonic && (
            <div className="space-y-4">
              <SeedPhraseDisplay mnemonic={mnemonic} onConfirmed={handleSeedConfirmed} isLoading={loading} />
              {error && <div className="bg-[#F6465D]/10 border border-[#F6465D]/30 rounded-lg p-3 text-sm text-[#F6465D] mt-2">{error}</div>}
            </div>
          )}

          {/* ═══ RESTORE ═══ */}
          {flow === 'restore' && (
            <div className="space-y-5">
              <div className="text-center">
                <RotateCcw className="w-10 h-10 text-[var(--accent-color)] mx-auto mb-3" />
                <h2 className="text-lg font-bold text-white mb-1">Restore Wallet</h2>
                <p className="text-xs text-gray-400">Enter your 24-word seed phrase to restore your wallet.</p>
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1.5 block font-medium">Seed Phrase</label>
                <textarea value={restoreWords} onChange={e => setRestoreWords(e.target.value)} rows={4}
                  className="w-full bg-[#0B0E11] border border-[#2B3139] rounded-lg px-4 py-3 text-white font-mono text-sm focus:outline-none focus:border-[var(--accent-color)] transition-colors resize-none"
                  placeholder="Enter all 24 words separated by spaces..." />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1.5 block font-medium">Set PIN for this device</label>
                <input type="password" value={pin} onChange={e => setPin(e.target.value)}
                  className="w-full bg-[#0B0E11] border border-[#2B3139] rounded-lg px-4 py-3 text-white focus:outline-none focus:border-[var(--accent-color)] transition-colors"
                  placeholder="Min. 4 characters" />
              </div>
              {error && <div className="bg-[#F6465D]/10 border border-[#F6465D]/30 rounded-lg p-3 text-sm text-[#F6465D]">{error}</div>}
              <div className="flex gap-3">
                <button onClick={() => { setFlow('welcome'); setError(''); }} className="flex-1 py-3 border border-[#2B3139] text-gray-400 rounded-lg hover:text-white transition-colors text-sm font-bold">Back</button>
                <button onClick={handleRestore} disabled={loading}
                  className="flex-1 py-3 bg-[#0ECB81] text-black font-bold rounded-lg hover:bg-[#0ECB81]/90 transition-colors disabled:opacity-50 text-sm">
                  {loading ? 'Restoring...' : 'Restore Wallet'}
                </button>
              </div>
            </div>
          )}

          {/* ═══ UNLOCK ═══ */}
          {flow === 'unlock' && (
            <form onSubmit={handleUnlock} className="space-y-5">
              <div className="text-center">
                <Lock className="w-10 h-10 text-[var(--accent-color)] mx-auto mb-3" />
                <h2 className="text-lg font-bold text-white mb-1">Unlock Wallet</h2>
                <p className="text-xs text-gray-400">Enter your PIN to access your wallet.</p>
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1.5 block font-medium">PIN / Password</label>
                <div className="relative">
                  <input type={showPin ? 'text' : 'password'} value={pin} onChange={e => setPin(e.target.value)}
                    className="w-full bg-[#0B0E11] border border-[#2B3139] rounded-lg px-4 py-3 text-white focus:outline-none focus:border-[var(--accent-color)] transition-colors pr-12"
                    placeholder="Enter your PIN" autoFocus />
                  <button type="button" onClick={() => setShowPin(!showPin)} className="absolute right-3 top-3 text-gray-500 hover:text-gray-300">
                    {showPin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>
              {error && <div className="bg-[#F6465D]/10 border border-[#F6465D]/30 rounded-lg p-3 text-sm text-[#F6465D]">{error}</div>}
              <button type="submit" disabled={loading}
                className="w-full py-3.5 bg-[var(--accent-color)] text-black font-bold rounded-lg hover:bg-[var(--accent-color)]/90 transition-colors disabled:opacity-50 text-sm uppercase tracking-wide shadow-[0_0_20px_rgba(252,213,53,0.3)]">
                {loading ? 'Unlocking...' : 'Unlock'}
              </button>
              <p className="text-center text-xs text-gray-500">
                Different wallet?{' '}
                <button type="button" onClick={() => { setFlow('welcome'); setError(''); setPin(''); }}
                  className="text-[var(--accent-color)] hover:underline font-medium">
                  Create or restore
                </button>
              </p>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-gray-600 mt-6">
          Powered by P2P Network · Trades are Blocks
        </p>
      </div>
    </div>
  );
}
