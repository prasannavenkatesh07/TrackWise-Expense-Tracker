/**
 * App.jsx - Root component and route configuration
 *
 * Provider order (outermost → innermost):
 *   ThemeProvider   - applies/removes `dark` class on <html>
 *   BrowserRouter   - enables React Router hooks throughout the tree
 *   AuthProvider    - JWT session management + axios default header
 *   ToastProvider   - global toast notification state
 *   ErrorBoundary   - catches rendering errors before they crash the whole app
 *
 * Route structure:
 *   PublicRoute  - redirects logged-in users away from /login, /register etc.
 *   ProtectedRoute - redirects anonymous users to /login, otherwise renders
 *                    Navbar + page content + the floating Chatbot widget
 *
 * MERN Data Flow:
 *   On load → AuthContext reads localStorage JWT → calls GET /api/auth/me
 *   → sets user state → ProtectedRoute renders or redirects accordingly
 */

import { Component } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth }   from './context/AuthContext';
import { ThemeProvider }           from './context/ThemeContext';
import { ToastProvider }           from './context/ToastContext';

// Layout components
import Navbar         from './components/Navbar';
import ToastContainer from './components/ToastContainer';
import Chatbot        from './components/Chatbot';

// Pages
import LoginPage          from './pages/LoginPage';
import RegisterPage       from './pages/RegisterPage';
import DashboardPage      from './pages/DashboardPage';
import HistoryPage        from './pages/HistoryPage';
import NotFoundPage       from './pages/NotFoundPage';
import SettingsPage       from './pages/SettingsPage';
import ReportsPage        from './pages/ReportsPage';
import BudgetsPage        from './pages/BudgetsPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage  from './pages/ResetPasswordPage';
import VerifyEmailPage    from './pages/VerifyEmailPage';

// --- Error boundary -----------------------------------------------------------
// React's class-based error boundary - hooks can't do this yet.
// Catches rendering errors that slip past normal try/catch (e.g. inside JSX).
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
            {/* Only show the raw error message in development - not in prod */}
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

// --- Full-screen loading spinner ----------------------------------------------
// Shown while AuthContext is doing the initial /api/auth/me check on page load -
// prevents a flash of the login page before the session is confirmed
const AppLoadingScreen = () => (
  <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col items-center justify-center gap-4">
    <div className="relative">
      <div className="w-14 h-14 rounded-2xl bg-slate-900 dark:bg-slate-700 flex items-center justify-center shadow-lg">
        <span className="text-emerald-400 text-2xl font-bold font-mono">₹</span>
      </div>
      <div className="absolute inset-0 rounded-2xl border-2 border-emerald-100 dark:border-slate-800 border-t-emerald-500 animate-spin" />
    </div>
    <p className="text-sm font-medium text-slate-400 dark:text-slate-500 animate-pulse-soft">
      Loading TrackWise…
    </p>
  </div>
);

// --- Protected route ----------------------------------------------------------
// Renders the full app shell (Navbar + page + Chatbot) for authenticated users.
// Redirects to /login for anyone who isn't logged in.
// Returns null while isLoading so we don't flash /login before the /me check finishes.
const ProtectedRoute = () => {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading)       return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 transition-colors duration-300 relative">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 page-enter">
        <Outlet />
      </main>
      {/* Chatbot is mounted here so it persists across page navigations
          without unmounting and losing chat history */}
      <Chatbot />
    </div>
  );
};

// --- Public route -------------------------------------------------------------
// Redirects already-logged-in users away from /login and /register.
// Returning null during isLoading prevents a flash of the login page on refresh.
const PublicRoute = () => {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading)      return null;
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
};

// --- App inner ----------------------------------------------------------------
// Separated from the root App so it can call useAuth() -
// hooks can't be called in the same component that provides the context
const AppInner = () => {
  const { isLoading } = useAuth();
  if (isLoading) return <AppLoadingScreen />;

  return (
    <>
      {/* ToastContainer renders the floating notification stack above everything */}
      <ToastContainer />

      <Routes>
        {/* Default redirect */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />

        {/* Public routes - redirect to dashboard if already logged in */}
        <Route element={<PublicRoute />}>
          <Route path="/login"           element={<LoginPage />} />
          <Route path="/register"        element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password"  element={<ResetPasswordPage />} />
          <Route path="/verify-email"    element={<VerifyEmailPage />} />
        </Route>

        {/* Protected routes - redirect to /login if not authenticated */}
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

// --- Root App -----------------------------------------------------------------
const App = () => (
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

export default App;