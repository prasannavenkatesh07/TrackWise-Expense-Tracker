/**
 * pages/VerifyEmailPage.jsx
 *
 * Email OTP verification - the page users land on right after registering.
 *
 * Flow:
 *   POST /api/auth/register → backend emails a 6-digit OTP → redirect here
 *   User types the code → POST /api/auth/verify-email { email, otp }
 *   → backend hashes the submitted OTP and compares against stored hash
 *   → on match: marks account as verified, returns a JWT
 *   → login() called → navigate to /dashboard
 *
 * Guard: if ?email= is missing from the URL the user is sent back to /register.
 *
 * Resend:
 *   POST /api/auth/resend-otp → backend generates a fresh OTP and emails it.
 *   A 60-second cooldown timer prevents spam - the button stays disabled
 *   and counts down visibly so the user knows when they can try again.
 *
 * The OTP input strips non-numeric characters on every keystroke and the
 * submit button stays disabled until exactly 6 digits are entered.
 */

import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import {
  Wallet, ArrowRight, Loader2, Mail,
  AlertCircle, CheckCircle2, RefreshCw,
} from 'lucide-react';
import { useAuth }  from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

// Background decoration - dot-grid pattern consistent with auth pages
const BackgroundDecor = () => (
  <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
    <div
      className="absolute inset-0 opacity-[0.025] dark:opacity-[0.04]"
      style={{ backgroundImage: 'radial-gradient(circle, #10b981 1px, transparent 1px)', backgroundSize: '28px 28px' }}
    />
    <div className="absolute -top-32 -left-32 w-96 h-96 bg-emerald-400/10 rounded-full blur-3xl" />
    <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-blue-400/10 rounded-full blur-3xl" />
  </div>
);

const VerifyEmailPage = () => {
  const [searchParams] = useSearchParams();
  const email          = searchParams.get('email') || '';
  const navigate       = useNavigate();
  const { login }      = useAuth();
  const { toast }      = useToast();

  const [otp,          setOtp]          = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending,  setIsResending]  = useState(false);
  const [error,        setError]        = useState('');
  const [countdown,    setCountdown]    = useState(0); // seconds left on resend cooldown

  // Redirect back to register if the email query param is missing -
  // this page is useless without knowing whose OTP to verify
  useEffect(() => {
    if (!email) {
      toast.error('No email found. Please register or log in first.', 'Error');
      navigate('/register');
    }
  }, [email, navigate, toast]);

  // Count the resend cooldown down to zero, then stop
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  // Verify the OTP the user typed
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (otp.length !== 6) { setError('Please enter the 6-digit code.'); return; }

    setIsSubmitting(true);
    setError('');
    try {
      const { data } = await axios.post('/api/auth/verify-email', { email, otp });
      if (data.success) {
        toast.success('Email verified successfully!', 'Welcome');
        // Log in immediately - no need for a separate login step
        login(data.token, data.user);
        navigate('/dashboard', { replace: true });
      }
    } catch (err) {
      setError(err?.response?.data?.message || 'Invalid or expired OTP.');
    } finally { setIsSubmitting(false); }
  };

  // Resend a fresh OTP and start the 60-second cooldown timer.
  // The backend rate-limits this too, but the UI timer is a friendlier first barrier.
  const handleResend = async () => {
    if (countdown > 0) return; // button should already be disabled, but guard anyway

    setIsResending(true);
    setError('');
    try {
      const { data } = await axios.post('/api/auth/resend-otp', { email });
      if (data.success) {
        toast.success(
          "A new 6-digit code has been sent. If you didn't receive it, check your spam folder.",
          'Code Sent',
        );
        setOtp('');       // clear the old code so the user starts fresh
        setCountdown(60); // lock the button for 60 seconds
      }
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to resend code. Please try again later.');
    } finally { setIsResending(false); }
  };

  return (
    <main className="relative min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center px-4 py-12 transition-colors duration-300">
      <BackgroundDecor />

      <div className="relative w-full max-w-md">

        {/* Brand header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-slate-900 dark:bg-slate-700 shadow-lg mb-4 relative">
            <Mail size={24} className="text-emerald-400" />
            <div className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/10" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
            Check your email
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
            We sent a 6-digit code to{' '}
            <span className="font-semibold text-slate-700 dark:text-slate-300">{email}</span>.
            <br className="hidden sm:block" />
            If you didn't receive it, check your spam folder.
          </p>
        </div>

        <article className="card">
          <form onSubmit={handleSubmit} noValidate className="space-y-6">
            <div>
              <label htmlFor="otp" className="form-label text-center block mb-3">
                Enter verification code
              </label>

              {/* tracking-[0.5em] spaces the digits out so they read like a code, not a word */}
              <input
                id="otp"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={otp}
                onChange={(e) => {
                  setOtp(e.target.value.replace(/\D/g, '')); // strip anything non-numeric
                  if (error) setError('');
                }}
                className={`input-field text-center text-3xl tracking-[0.5em] font-mono py-4 ${
                  error ? 'border-rose-400 focus:ring-rose-400' : ''
                }`}
                placeholder="000000"
                autoFocus
                aria-invalid={!!error}
                aria-describedby={error ? 'otp-error' : undefined}
              />

              {error && (
                <p id="otp-error"
                  className="flex items-center justify-center gap-1.5 text-xs text-rose-500 mt-3 font-medium"
                  role="alert">
                  <AlertCircle size={14} aria-hidden="true" />
                  {error}
                </p>
              )}
            </div>

            {/* Disabled until all 6 digits are typed - no point sending an incomplete code */}
            <button
              type="submit"
              disabled={isSubmitting || otp.length < 6}
              className="btn-primary w-full py-3"
            >
              {isSubmitting
                ? <><Loader2 size={17} className="animate-spin" />Verifying…</>
                : <><CheckCircle2 size={17} />Verify Email</>
              }
            </button>
          </form>

          {/* Resend section */}
          <div className="mt-6 pt-6 border-t border-slate-100 dark:border-slate-800 text-center space-y-3">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Code expired or didn't receive it?
            </p>
            <button
              type="button"
              onClick={handleResend}
              disabled={isResending || countdown > 0}
              className="inline-flex items-center gap-2 text-sm font-semibold
                         text-emerald-600 hover:text-emerald-700
                         dark:text-emerald-400 dark:hover:text-emerald-300
                         disabled:opacity-50 disabled:cursor-not-allowed
                         transition-colors"
            >
              {isResending ? (
                <><Loader2 size={15} className="animate-spin" />Sending…</>
              ) : countdown > 0 ? (
                // Live countdown so the user knows exactly when they can retry
                `Resend available in ${countdown}s`
              ) : (
                <><RefreshCw size={15} />Resend Code</>
              )}
            </button>
          </div>
        </article>

        <p className="text-center text-xs text-slate-400 dark:text-slate-500 mt-6">
          Need to use a different email?{' '}
          <Link to="/register" className="text-emerald-600 dark:text-emerald-400 hover:underline font-medium">
            Register again
          </Link>.
        </p>
      </div>
    </main>
  );
};

export default VerifyEmailPage;