/**
 * App.jsx — Root Application Component  (Phase E — Final & Sprint 4)
 *
 * All routes and providers complete across Phases A–E:
 * - ToastProvider + ToastContainer — global notification stack
 * - Onboarding wizard — shown once to new users on first dashboard visit
 * - All protected routes wired: dashboard, history, settings, reports, budgets
 *
 * Provider order (outermost first):
 * ThemeProvider  → applies dark class to <html>
 * BrowserRouter  → enables React Router hooks
 * AuthProvider   → JWT session management + axios headers
 * ToastProvider  → global toast notification state  ✦
 * ErrorBoundary  → catches rendering errors
 *
 * MERN Data Flow:
 * AuthContext reads localStorage JWT on mount → validates via GET /api/auth/me
 * → sets `user` state → ProtectedRoute either renders children or redirects.
 */

import { Component } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider } from './context/ToastContext';

// Layout
import Navbar from './components/Navbar';
import ToastContainer from './components/ToastContainer';
import Chatbot from './components/Chatbot'; // ✦ Sprint 4: Financial Copilot

// Pages
import LoginPage     from './pages/LoginPage';
import RegisterPage  from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import HistoryPage   from './pages/HistoryPage';
import NotFoundPage  from './pages/NotFoundPage';

// Phase C pages — fully implemented
import SettingsPage from './pages/SettingsPage';
import ReportsPage  from './pages/ReportsPage';
import BudgetsPage  from './pages/BudgetsPage';

// Phase 4 Auth pages (OTP Upgrade)
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage  from './pages/ResetPasswordPage';
import VerifyEmailPage    from './pages/VerifyEmailPage';

// ── React Error Boundary ──────────────────────────────────────────────────────
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.href = '/dashboard';
  };

  render() {
    if (this.state.hasError) {
      return (
        <main className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-6">
          <section className="card max-w-md w-full text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center mx-auto">
              <span className="text-3xl">⚠️</span>
            </div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              Something went wrong
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              An unexpected error occurred. Your data is safe.
            </p>
            {import.meta.env.DEV && (
              <pre className="text-left text-xs bg-slate-100 dark:bg-slate-800 rounded-lg p-3 overflow-auto max-h-32 text-rose-600">
                {this.state.error?.message}
              </pre>
            )}
            <button onClick={this.handleReset} className="btn-primary w-full">
              Return to Dashboard
            </button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}

// ── Full-Screen Loading Spinner ───────────────────────────────────────────────
const AppLoadingScreen = () => (
  <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col items-center justify-center gap-4">
    <div className="relative">
      <div className="w-14 h-14 rounded-2xl bg-slate-900 dark:bg-slate-700 flex items-center justify-center shadow-lg">
        <span className="text-emerald-400 text-2xl font-bold font-mono">₹</span>
      </div>
      <div className="absolute inset-0 rounded-2xl border-2 border-emerald-500 border-t-transparent animate-spin" />
    </div>
    <p className="text-sm font-medium text-slate-400 dark:text-slate-500 animate-pulse-soft">
      Loading TrackWise…
    </p>
  </div>
);

// ── Protected Route Guard ─────────────────────────────────────────────────────
const ProtectedRoute = () => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return null;

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 transition-colors duration-300 relative">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 page-enter">
        <Outlet />
      </main>
      
      {/* ✦ Mounted globally across all protected pages */}
      <Chatbot />
    </div>
  );
};

// ── Public Route Guard ────────────────────────────────────────────────────────
const PublicRoute = () => {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return null;
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
};

// ── App Inner ─────────────────────────────────────────────────────────────────
const AppInner = () => {
  const { isLoading } = useAuth();
  if (isLoading) return <AppLoadingScreen />;

  return (
    <>
      <ToastContainer />

      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />

        <Route element={<PublicRoute />}>
          <Route path="/login"           element={<LoginPage />} />
          <Route path="/register"        element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          
          {/* ✦ Updated for OTP query param routing */}
          <Route path="/reset-password"  element={<ResetPasswordPage />} />
          <Route path="/verify-email"    element={<VerifyEmailPage />} />
        </Route>

        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/history"   element={<HistoryPage />} />
          <Route path="/settings"  element={<SettingsPage />} />
          <Route path="/reports"   element={<ReportsPage />} />
          <Route path="/budgets"   element={<BudgetsPage />} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
};

// ── Root App ──────────────────────────────────────────────────────────────────
const App = () => {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <ErrorBoundary>
              <AppInner />
            </ErrorBoundary>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
};

export default App;