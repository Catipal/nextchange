import React from 'react';
import { Routes, Route, Navigate } from 'react-router';
import { AuthProvider } from './context/AuthContext';
import { ExchangeProvider } from './context/ExchangeContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import TradePage from './pages/TradePage';
import WalletPage from './pages/WalletPage';
import DaoPage from './pages/DaoPage';
import NetworkPage from './pages/NetworkPage';
import AiPage from './pages/AiPage';

// Simple Error Boundary
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) { console.error("Crash in App:", error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#121619] text-white flex flex-col items-center justify-center p-8 text-center">
          <h1 className="text-2xl font-bold text-[#F6465D] mb-4">Application Crash</h1>
          <pre className="bg-black/50 p-4 rounded text-xs font-mono mb-4 max-w-full overflow-auto border border-red-900/30">
            {this.state.error?.toString()}
          </pre>
          <button onClick={() => window.location.reload()} className="px-6 py-2 bg-[#DFFF00] text-black font-bold rounded hover:bg-[#DFFF00]/90">
            Reload Application
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppRoutes() {
  React.useEffect(() => {
    console.log("[App] AppRoutes mounted");
  }, []);

  return (
    <ExchangeProvider>
      <Routes>
        <Route element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }>
          <Route path="/" element={<DaoPage />} />
          <Route path="/trade" element={<TradePage />} />
          <Route path="/wallet" element={<WalletPage />} />
          <Route path="/ai" element={<AiPage />} />
          <Route path="/network" element={<NetworkPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ExchangeProvider>
  );
}

export default function App() {
  React.useEffect(() => {
    console.log("[App] App root mounted");
  }, []);

  return (
    <ErrorBoundary>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/*" element={<AppRoutes />} />
        </Routes>
      </AuthProvider>
    </ErrorBoundary>
  );
}
