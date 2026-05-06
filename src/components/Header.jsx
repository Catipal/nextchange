import React from 'react';
import { NavLink } from 'react-router';
import { Activity, ArrowRightLeft, BarChart3, Wallet, Globe, Landmark, LogOut, Copy, Bot } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import NetworkStatus from './NetworkStatus';

export default function Header() {
  const { user, logout, formatPublicKey, publicKey } = useAuth();
  const [copied, setCopied] = React.useState(false);

  const handleCopyPubKey = () => {
    if (publicKey) {
      navigator.clipboard.writeText(publicKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const navItems = [
    { path: '/', label: 'DAO', icon: Landmark },
    { path: '/ai', label: 'AI', icon: Bot },
    { path: '/trade', label: 'Trade', icon: BarChart3 },
    { path: '/wallet', label: 'Wallet', icon: Wallet },
    { path: '/network', label: 'Network', icon: Globe }
  ];

  return (
    <header className="bg-[var(--bg-secondary)] border-b border-[var(--border-color)] px-4 py-0 flex items-center justify-between h-14 flex-shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full overflow-hidden bg-[var(--bg-tertiary)] flex items-center justify-center border border-[var(--accent-color)]/30 shadow-[0_0_15px_rgba(223,255,0,0.2)]">
            <img src="/logo_circular.png?v=1" alt="Logo" className="w-full h-full object-cover scale-110" />
          </div>
          <span className="text-lg font-bold tracking-tight text-white">
            nextchange<span className="text-[var(--accent-color)]">.hub</span>
          </span>
        </div>

        {/* Nav */}
        <nav className="flex items-center gap-1">
          {navItems.map(({ path, label, icon: Icon }) => (
            <NavLink key={path} to={path} end={path === '/'}
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3 py-2 rounded text-sm font-medium transition-colors ${isActive ? 'bg-[var(--bg-tertiary)] text-[var(--accent-color)]' : 'text-gray-400 hover:text-white hover:bg-[var(--bg-tertiary)]/50'
                }`
              }>
              <Icon className="w-4 h-4" />
              {label}
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-4">
        <NetworkStatus />

        {/* User identity */}
        {user && (
          <div className="flex items-center gap-3">
            <button onClick={handleCopyPubKey}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[var(--bg-tertiary)] border border-[var(--border-color)] hover:border-[var(--accent-color)]/50 transition-colors group">
              <span className="text-xs font-mono text-gray-300 group-hover:text-white">
                {formatPublicKey(publicKey)}
              </span>
              <Copy className={`w-3 h-3 ${copied ? 'text-[#0ECB81]' : 'text-gray-500'}`} />
            </button>
            <button onClick={logout}
              className="p-2 rounded text-gray-400 hover:text-[#F6465D] hover:bg-[#F6465D]/10 transition-colors"
              title="Lock Wallet">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
