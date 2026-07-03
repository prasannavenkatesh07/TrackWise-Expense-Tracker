/**
 * pages/NotFoundPage.jsx
 *
 * 404 page - rendered by the wildcard route `path="*"` in App.jsx.
 *
 * Shows a contextual message depending on whether the user is logged in:
 *   Authenticated → "Back to Dashboard" button + quick nav links
 *   Anonymous     → "Back to Login" button
 *
 * Auto-redirects after a 10-second countdown, to the appropriate destination.
 * The countdown is a nice UX touch that also helps during demos if someone
 * accidentally navigates to a broken URL.
 */

import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  Home, History, ArrowLeft,
  Wallet, MapPin, LayoutDashboard,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

// --- Background decoration ----------------------------------------------------
// Same dot-grid pattern as the auth pages for visual consistency
const BackgroundDecor = () => (
  <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
    <div
      className="absolute inset-0 opacity-[0.025] dark:opacity-[0.04]"
      style={{ backgroundImage: 'radial-gradient(circle, #10b981 1px, transparent 1px)', backgroundSize: '28px 28px' }}
    />
    <div className="absolute top-0 left-1/4 w-96 h-96 bg-rose-400/10 dark:bg-rose-500/8 rounded-full blur-3xl" />
    <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-emerald-400/10 dark:bg-emerald-500/8 rounded-full blur-3xl" />
  </div>
);

// --- Quick nav link -----------------------------------------------------------
const QuickLink = ({ to, icon: Icon, label }) => (
  <Link
    to={to}
    className="flex items-center gap-2.5 px-4 py-3 rounded-xl
               bg-slate-50 dark:bg-slate-800
               border border-slate-200 dark:border-slate-700
               text-slate-600 dark:text-slate-400 text-sm font-medium
               hover:bg-slate-100 dark:hover:bg-slate-700
               hover:text-slate-900 dark:hover:text-slate-200
               hover:border-slate-300 dark:hover:border-slate-600
               transition-all duration-200 group"
  >
    <Icon
      size={15}
      className="text-slate-400 dark:text-slate-500 group-hover:text-emerald-500 transition-colors duration-200"
      aria-hidden="true"
    />
    {label}
  </Link>
);

// --- Animated 404 digits ------------------------------------------------------
// Staggered fade-in on mount, gentle pulse on the middle "0" to draw the eye
const AnimatedCode = () => {
  const digits = ['4', '0', '4'];
  return (
    <div className="flex items-center justify-center gap-1 select-none" aria-hidden="true">
      {digits.map((digit, i) => (
        <span
          key={i}
          className={[
            'font-black leading-none tracking-tighter',
            'text-[6rem] sm:text-[8rem]',
            'animate-fade-in',
            i === 1
              ? 'text-emerald-500 dark:text-emerald-400 animate-pulse-soft'
              : 'text-slate-200 dark:text-slate-700',
          ].join(' ')}
          style={{ animationDelay: `${i * 80}ms`, animationFillMode: 'both' }}
        >
          {digit}
        </span>
      ))}
    </div>
  );
};

// --- NotFoundPage -------------------------------------------------------------
const NotFoundPage = () => {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  // Count down from 10 then auto-navigate - stops if the user clicks manually
  const [countdown, setCountdown] = useState(10);

  useEffect(() => {
    if (countdown <= 0) {
      navigate(isAuthenticated ? '/dashboard' : '/login', { replace: true });
      return;
    }
    const timer = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown, navigate, isAuthenticated]);

  return (
    <main
      className="relative min-h-screen bg-slate-50 dark:bg-slate-900
                 flex flex-col items-center justify-center
                 px-4 py-16 transition-colors duration-300"
    >
      <BackgroundDecor />

      <div className="relative z-10 w-full max-w-md text-center space-y-6">

        {/* Logo - links back to the right place */}
        <Link
          to={isAuthenticated ? '/dashboard' : '/login'}
          className="inline-flex items-center gap-2 mb-2 group"
          aria-label="Go to TrackWise home"
        >
          <div className="w-9 h-9 rounded-xl bg-slate-900 dark:bg-slate-700 flex items-center justify-center shadow-md group-hover:shadow-lg transition-shadow">
            <Wallet size={17} className="text-emerald-400" />
          </div>
          <span className="text-sm font-bold text-slate-500 dark:text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-300 transition-colors">
            TrackWise
          </span>
        </Link>

        <AnimatedCode />

        {/* Heading */}
        <div className="space-y-2 animate-fade-in" style={{ animationDelay: '200ms', animationFillMode: 'both' }}>
          <div className="flex items-center justify-center gap-2">
            <MapPin size={16} className="text-rose-400 flex-shrink-0" aria-hidden="true" />
            <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 tracking-tight">
              Page not found
            </h1>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed max-w-xs mx-auto">
            The page you're looking for doesn't exist, was moved, or you may have mistyped the URL.
          </p>
        </div>

        {/* Primary CTA */}
        <div className="animate-fade-in" style={{ animationDelay: '300ms', animationFillMode: 'both' }}>
          <Link
            to={isAuthenticated ? '/dashboard' : '/login'}
            className="btn-primary px-8 py-3 text-sm"
          >
            <ArrowLeft size={15} />
            {isAuthenticated ? 'Back to Dashboard' : 'Back to Login'}
          </Link>
        </div>

        {/* Quick nav - only shown to logged-in users */}
        {isAuthenticated && (
          <nav
            aria-label="Suggested pages"
            className="animate-fade-in"
            style={{ animationDelay: '400ms', animationFillMode: 'both' }}
          >
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3">
              Where would you like to go?
            </p>
            <div className="grid grid-cols-2 gap-2">
              <QuickLink to="/dashboard" icon={LayoutDashboard} label="Dashboard" />
              <QuickLink to="/history"   icon={History}         label="History"   />
            </div>
          </nav>
        )}

        {/* Countdown */}
        <p
          className="text-xs text-slate-400 dark:text-slate-600 animate-fade-in"
          style={{ animationDelay: '500ms', animationFillMode: 'both' }}
          aria-live="polite"
          aria-atomic="true"
        >
          Redirecting automatically in{' '}
          <span className="font-numeric font-bold text-emerald-500 dark:text-emerald-400">
            {countdown}s
          </span>
          …
        </p>
      </div>
    </main>
  );
};

export default NotFoundPage;