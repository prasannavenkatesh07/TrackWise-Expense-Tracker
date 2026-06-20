/**
 * pages/ForgotPasswordPage.jsx  (Auth Upgrade — OTP Flow)
 *
 * Flow:
 * 1. User enters their email address
 * 2. POST /api/auth/forgotpassword
 * 3. Redirect user to /reset-password?email=... to enter OTP
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  Mail, ArrowRight, Loader2, Wallet,
  ArrowLeft, AlertCircle, Sun, Moon,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';

// ── Background decoration ──────────────────────────────────────────────────────
const BackgroundDecor = () => (
  <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
    <div
      className="absolute inset-0 opacity-[0.025] dark:opacity-[0.04]"
      style={{ backgroundImage: 'radial-gradient(circle, #10b981 1px, transparent 1px)', backgroundSize: '28px 28px' }}
    />
    <div className="absolute -top-32 -right-32 w-96 h-96 bg-blue-400/10 rounded-full blur-3xl" />
    <div className="absolute -bottom-32 -left-32 w-96 h-96 bg-emerald-400/10 rounded-full blur-3xl" />
  </div>
);

// ── Main ForgotPasswordPage ────────────────────────────────────────────────────
const ForgotPasswordPage = () => {
  const { isDark, toggleTheme } = useTheme();
  const { toast }               = useToast();
  const navigate                = useNavigate();

  const [email,        setEmail]        = useState('');
  const [emailError,   setEmailError]   = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validate = () => {
    if (!email.trim()) {
      setEmailError('Email address is required.');
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError('Please enter a valid email address.');
      return false;
    }
    setEmailError('');
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      // POST /api/auth/forgotpassword
      await axios.post('/api/auth/forgotpassword', {
        email: email.trim().toLowerCase(),
      });
      
      // Navigate directly to the OTP input page with email in query string
      navigate(`/reset-password?email=${encodeURIComponent(email.trim().toLowerCase())}`);
    } catch (err) {
      const msg = err?.response?.data?.message || 'Something went wrong. Please try again.';
      toast.error(msg, 'Error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="relative min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center px-4 py-12 transition-colors duration-300">
      <BackgroundDecor />

      {/* Theme toggle */}
      <button onClick={toggleTheme} className="absolute top-5 right-5 btn-ghost"
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}>
        {isDark ? <Sun size={18} className="text-amber-400" /> : <Moon size={18} className="text-slate-500" />}
      </button>

      <div className="relative w-full max-w-md">

        {/* Brand mark */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-slate-900 dark:bg-slate-700 shadow-lg mb-4 relative">
            <Wallet size={24} className="text-emerald-400" />
            <div className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/10" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
            Forgot your password?
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5 max-w-xs mx-auto leading-relaxed">
            Enter your email and we'll send you a secure 6-digit code to reset it.
          </p>
        </div>

        <article className="card space-y-5">

          <form onSubmit={handleSubmit} noValidate className="space-y-4">

            {/* Email input */}
            <div>
              <label htmlFor="forgot-email" className="form-label">Email address</label>
              <div className="relative">
                <Mail size={15}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  id="forgot-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={e => { setEmail(e.target.value); if (emailError) setEmailError(''); }}
                  placeholder="you@example.com"
                  className={`input-field pl-10 ${emailError ? 'border-rose-400 focus:ring-rose-400' : ''}`}
                  aria-invalid={!!emailError}
                  aria-describedby={emailError ? 'forgot-email-error' : undefined}
                  autoFocus
                />
              </div>
              {emailError && (
                <p id="forgot-email-error"
                  className="flex items-center gap-1.5 text-xs text-rose-500 mt-1.5 font-medium"
                  role="alert">
                  <AlertCircle size={11} aria-hidden="true" />
                  {emailError}
                </p>
              )}
            </div>

            {/* Submit */}
            <button type="submit" disabled={isSubmitting} className="btn-primary w-full py-3 text-base">
              {isSubmitting
                ? <><Loader2 size={17} className="animate-spin" />Sending code…</>
                : <>Send code<ArrowRight size={17} /></>
              }
            </button>
          </form>

          {/* Divider */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center" aria-hidden="true">
              <div className="w-full border-t border-slate-100 dark:border-slate-700" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-white dark:bg-slate-800 px-3 text-xs text-slate-400 dark:text-slate-500 font-medium">
                Remember your password?
              </span>
            </div>
          </div>

          <Link to="/login"
            className="btn-secondary w-full py-2.5 justify-center">
            <ArrowLeft size={15} />
            Back to Sign In
          </Link>
        </article>
      </div>
    </main>
  );
};

export default ForgotPasswordPage;