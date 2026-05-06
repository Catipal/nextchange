import React, { useState } from 'react';
import { Copy, Check, AlertTriangle, Eye, EyeOff, ShieldCheck } from 'lucide-react';

/**
 * Animated seed phrase display with copy and confirmation step.
 */
export default function SeedPhraseDisplay({ mnemonic, onConfirmed, isLoading }) {
  const words = mnemonic.split(' ');
  const [copied, setCopied] = useState(false);
  const [showWords, setShowWords] = useState(true);
  const [confirmStep, setConfirmStep] = useState(false);
  const [confirmIndices, setConfirmIndices] = useState([]);
  const [confirmInputs, setConfirmInputs] = useState({});
  const [confirmError, setConfirmError] = useState('');

  const handleCopy = () => {
    navigator.clipboard.writeText(mnemonic);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const startConfirmation = () => {
    // Pick 3 random word indices
    const indices = [];
    while (indices.length < 3) {
      const idx = Math.floor(Math.random() * 24);
      if (!indices.includes(idx)) indices.push(idx);
    }
    indices.sort((a, b) => a - b);
    setConfirmIndices(indices);
    setConfirmInputs({});
    setConfirmError('');
    setConfirmStep(true);
  };

  const handleConfirm = () => {
    for (const idx of confirmIndices) {
      if ((confirmInputs[idx] || '').trim().toLowerCase() !== words[idx]) {
        setConfirmError(`Word #${idx + 1} is incorrect. Please check your seed phrase.`);
        return;
      }
    }
    onConfirmed();
  };

  if (confirmStep) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-2 text-[#FCD535]">
          <ShieldCheck className="w-5 h-5" />
          <h3 className="font-bold text-lg">Confirm Your Seed Phrase</h3>
        </div>
        <p className="text-sm text-gray-400">
          Enter the following words from your seed phrase to verify you saved it:
        </p>
        <div className="space-y-3">
          {confirmIndices.map(idx => (
            <div key={idx} className="flex items-center gap-3">
              <span className="text-xs text-gray-500 w-16 text-right font-mono">Word #{idx + 1}</span>
              <input
                type="text"
                autoComplete="off"
                value={confirmInputs[idx] || ''}
                onChange={e => setConfirmInputs(prev => ({ ...prev, [idx]: e.target.value }))}
                className="flex-1 bg-[#0B0E11] border border-[#2B3139] rounded-lg px-4 py-2.5 text-white font-mono text-sm focus:outline-none focus:border-[#FCD535] transition-colors"
                placeholder="..."
              />
            </div>
          ))}
        </div>
        {confirmError && (
          <div className="bg-[#F6465D]/10 border border-[#F6465D]/30 rounded-lg p-3 text-sm text-[#F6465D]">
            {confirmError}
          </div>
        )}
        <div className="flex gap-3">
          <button onClick={() => setConfirmStep(false)} disabled={isLoading}
            className="flex-1 py-3 border border-[#2B3139] text-gray-400 rounded-lg hover:text-white hover:border-gray-500 transition-colors disabled:opacity-50 text-sm font-bold">
            ← Back
          </button>
          <button onClick={handleConfirm} disabled={isLoading}
            className="flex-1 py-3 bg-[#0ECB81] text-black font-bold rounded-lg hover:bg-[#0ECB81]/90 transition-colors disabled:opacity-50 text-sm">
            {isLoading ? 'Verifying...' : 'Verify & Continue'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Warning */}
      <div className="bg-[#F6465D]/10 border border-[#F6465D]/30 rounded-lg p-4 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-[#F6465D] flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-bold text-[#F6465D]">Write these words down!</p>
          <p className="text-xs text-gray-400 mt-1">
            This is the <strong className="text-white">ONLY</strong> way to recover your wallet. 
            Never share your seed phrase. Store it securely offline.
          </p>
        </div>
      </div>

      {/* Word Grid */}
      <div className="relative">
        {!showWords && (
          <div className="absolute inset-0 bg-[#0B0E11]/90 backdrop-blur-md rounded-xl flex items-center justify-center z-10 cursor-pointer"
               onClick={() => setShowWords(true)}>
            <div className="text-center">
              <EyeOff className="w-8 h-8 text-gray-500 mx-auto mb-2" />
              <p className="text-gray-400 text-sm">Click to reveal</p>
            </div>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2 bg-[#0B0E11] rounded-xl p-4 border border-[#2B3139]">
          {words.map((word, i) => (
            <div key={i} className="flex items-center gap-2 bg-[#181A20] rounded-lg px-3 py-2.5 border border-[#2B3139]/50"
                 style={{ animationDelay: `${i * 40}ms` }}>
              <span className="text-xs text-gray-600 font-mono w-5 text-right">{i + 1}</span>
              <span className="text-sm font-mono text-white font-medium">{word}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button onClick={() => setShowWords(!showWords)}
          className="px-4 py-2.5 bg-[#2B3139] text-gray-300 rounded-lg hover:bg-[#353945] transition-colors text-sm flex items-center gap-2">
          {showWords ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          {showWords ? 'Hide' : 'Show'}
        </button>
        <button onClick={handleCopy}
          className="px-4 py-2.5 bg-[#2B3139] text-gray-300 rounded-lg hover:bg-[#353945] transition-colors text-sm flex items-center gap-2">
          {copied ? <Check className="w-4 h-4 text-[#0ECB81]" /> : <Copy className="w-4 h-4" />}
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      <button onClick={startConfirmation}
        className="w-full py-3.5 bg-[#FCD535] text-black font-bold rounded-lg hover:bg-[#FCD535]/90 transition-colors text-sm uppercase tracking-wide shadow-[0_0_20px_rgba(252,213,53,0.3)]">
        I've Saved My Seed Phrase
      </button>
    </div>
  );
}
