import React from 'react';
import { Outlet } from 'react-router';
import Header from './Header';

export default function Layout() {
  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] font-sans selection:bg-[var(--accent-color)] selection:text-black flex flex-col items-stretch h-screen overflow-hidden transition-colors">
      <Header />
      <div className="flex-1 flex overflow-hidden">
        {/* Main Content Area */}
        <main className="flex-1 flex flex-col overflow-hidden relative">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
