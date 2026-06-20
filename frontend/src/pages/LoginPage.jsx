/**
 * pages/LoginPage.jsx  (Auth Upgrade — Phase 4)
 *
 * Changes from previous version:
 * ✦ Google Sign-In button via <GoogleLogin /> from @react-oauth/google
 * ✦ "OR" divider between Google button and email/password form
 * ✦ "EMAIL_NOT_VERIFIED" error code shows a specific resend-verification hint
 * ✦ "Forgot password?" link now navigates to /forgot-password
 * ✦ Automatic redirect to /verify-email on unverified login attempt
 * ✦ All existing validation, show/hide toggle, dark mode unchanged
 */

import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';          // ✦ Auth Upgrade
import axios from 'axios';
import {
  Mail, Lock, Eye, EyeOff, Loader2,
  Wallet, ArrowRight, AlertCircle, Sun, Moon,
} from 'lucide-react';
import { useAuth }  from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';

// ── Field error ────────────────────────────────────────────────────────────────
const FieldError = ({ message }) =>
  message ? (
    <p className="flex items-center gap-1.5 text-xs text-rose-500 mt-1.5 font-medium" role="alert">
      <AlertCircle size={11} aria-hidden="true" />
      {message}
    </p>
  ) : null;

// ── Background decoration ──────────────────────────────────────────────────────
const BackgroundDecor = () => (
  <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
    <div className="absolute inset-0 opacity-[0.025] dark:opacity-[0.04]"
      style={{ backgroundImage: 'radial-gradient(circle, #10b981 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
    <div className="absolute -top-32 -left-32 w-96 h-96 bg-emerald-400/10 dark:bg-emerald-500/10 rounded-full blur-3xl" />
    <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-blue-400/10 dark:bg-blue-500/10 rounded-full blur-3xl" />
  </div>
);

// ── OR Divider ─────────────────────────────────────────────────────────────────
const OrDivider = () => (
  <div className="relative my-5">
    <div className="absolute inset-0 flex items-center" aria-hidden="true">
      <div className="w-full border-t border-slate-200 dark:border-slate-700" />
    </div>
    <div className="relative flex justify-center">
      <span className="bg-white dark:bg-slate-800 px-3 text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
        or
      </span>
    </div>
  </div>
);

// ── Main LoginPage ─────────────────────────────────────────────────────────────
const LoginPage = () => {
  const { login, loginWithGoogle } = useAuth();
  const { isDark, toggleTheme }    = useTheme();
  const { toast }                  = useToast();
  const navigate  = useNavigate();
  const location  = useLocation();
  const from      = location.state?.from?.pathname || '/dashboard';

  const [form,         setForm]         = useState({ email: '', password: '' });
  const [errors,       setErrors]       = useState({});
  const [apiError,     setApiError]     = useState('');
  const [notVerified,  setNotVerified]  = useState(false); // ✦ special state for unverified
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(p => ({ ...p, [name]: value }));
    if (errors[name])    setErrors(p => ({ ...p, [name]: '' }));
    if (apiError)        setApiError('');
    if (notVerified)     setNotVerified(false);
  };

  const validate = () => {
    const e = {};
    if (!form.email.trim())                              e.email    = 'Email is required.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Enter a valid email address.';
    if (!form.password)                                  e.password = 'Password is required.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // ── Standard email/password submit ────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    setApiError('');
    setNotVerified(false);
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const { data } = await axios.post('/api/auth/login', {
        email:    form.email.trim().toLowerCase(),
        password: form.password,
      });
      if (data.success) {
        login(data.token, data.user);
        toast.success(`Welcome back, ${data.user.name.split(' ')[0]}! 👋`, 'Signed in');
        navigate(from, { replace: true });
      }
    } catch (err) {
      // ✦ Special handling: backend sends code: 'EMAIL_NOT_VERIFIED' on 403
      if (err?.response?.data?.code === 'EMAIL_NOT_VERIFIED') {
        setNotVerified(true);
        toast.error("Please enter your OTP to verify your account.");
        //navigate(`/verify-email?email=${encodeURIComponent(form.email.trim().toLowerCase())}`);
        //return;
      } else {
        setApiError(err?.response?.data?.message || 'Login failed. Please check your credentials.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Google Sign-In success ─────────────────────────────────────────────────
  /**
   * @react-oauth/google calls onSuccess with { credential: '<Google ID token>' }
   * We pass that token to loginWithGoogle() in AuthContext which POSTs it to
   * /api/auth/google-login, gets back our own JWT, and persists the session.
   */
  const handleGoogleSuccess = async (credentialResponse) => {
    setGoogleLoading(true);
    setApiError('');
    try {
      const user = await loginWithGoogle(credentialResponse.credential);
      toast.success(`Welcome, ${user.name.split(' ')[0]}! 👋`, 'Signed in with Google');
      navigate(from, { replace: true });
    } catch (err) {
      setApiError(err?.response?.data?.message || err?.message || 'Google sign-in failed. Please try again.');
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleGoogleError = () => {
    setApiError('Google sign-in was cancelled or failed. Please try again.');
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

        {/* Brand header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-slate-900 dark:bg-slate-700 shadow-lg mb-4 relative">
            <Wallet size={24} className="text-emerald-400" />
            <div className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/10" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">Welcome back</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5">Sign in to your TrackWise account</p>
        </div>

        <article className="card">

          {/* ── ✦ Google Sign-In button ─────────────────────────────────── */}
          <div className="w-full">
            {googleLoading ? (
              <div className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm text-slate-500 dark:text-slate-400">
                <Loader2 size={16} className="animate-spin" />
                Signing in with Google…
              </div>
            ) : (
              /*
                Hardcoded width attribute removed here.
                This allows the button to dynamically size to fit mobile containers perfectly.
              */
              <div className="flex justify-center">
                <GoogleLogin
                  onSuccess={handleGoogleSuccess}
                  onError={handleGoogleError}
                  useOneTap={false}
                  theme={isDark ? 'filled_black' : 'outline'}
                  shape="rectangular"
                  size="large"
                  text="signin_with"
                />
              </div>
            )}
          </div>

          <OrDivider />

          {/* ── Standard email/password form ─────────────────────────────── */}
          <form onSubmit={handleSubmit} noValidate className="space-y-5">

            {/* API error banner */}
            {apiError && (
              <div className="alert-danger text-xs animate-slide-down" role="alert">
                <AlertCircle size={15} className="flex-shrink-0" />{apiError}
              </div>
            )}

            {/* ✦ Email-not-verified banner with action link */}
            {notVerified && (
              <div className="alert-warning text-xs animate-slide-down" role="alert">
                <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Email not verified</p>
                  <p className="mt-0.5">
                    Please check your inbox for the 6-digit code.{' '}
                    <Link to={`/verify-email?email=${encodeURIComponent(form.email.trim().toLowerCase())}`} className="underline font-medium hover:text-amber-800">
                      Click here to verify your account.
                    </Link>
                  </p>
                </div>
              </div>
            )}

            {/* Email */}
            <div>
              <label htmlFor="login-email" className="form-label">Email address</label>
              <div className="relative">
                <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input id="login-email" name="email" type="email" autoComplete="email"
                  value={form.email} onChange={handleChange} placeholder="you@example.com"
                  className={`input-field pl-10 ${errors.email ? 'border-rose-400 focus:ring-rose-400' : ''}`}
                  aria-invalid={!!errors.email} />
              </div>
              <FieldError message={errors.email} />
            </div>

            {/* Password */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="login-password" className="form-label mb-0">Password</label>
                {/* ✦ Now links to the real forgot-password page */}
                <Link to="/forgot-password"
                  className="text-xs text-emerald-500 hover:text-emerald-600 dark:text-emerald-400 font-semibold transition-colors">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input id="login-password" name="password" type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password" value={form.password} onChange={handleChange}
                  placeholder="••••••••"
                  className={`input-field pl-10 pr-11 ${errors.password ? 'border-rose-400 focus:ring-rose-400' : ''}`}
                  aria-invalid={!!errors.password} />
                <button type="button" onClick={() => setShowPassword(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors p-0.5"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}>
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <FieldError message={errors.password} />
            </div>

            <button type="submit" disabled={isSubmitting} className="btn-primary w-full py-3 text-base mt-2">
              {isSubmitting
                ? <><Loader2 size={17} className="animate-spin" />Signing in…</>
                : <>Sign in<ArrowRight size={17} /></>}
            </button>
          </form>

          {/* Register link */}
          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center" aria-hidden="true">
              <div className="w-full border-t border-slate-100 dark:border-slate-700" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-white dark:bg-slate-800 px-3 text-xs text-slate-400 dark:text-slate-500 font-medium">
                New to TrackWise?
              </span>
            </div>
          </div>
          <Link to="/register" className="btn-secondary w-full py-2.5 justify-center">
            Create a free account
          </Link>
        </article>

        <p className="text-center text-xs text-slate-400 dark:text-slate-600 mt-6">
          Designed and Developed by Prasanna Venkatesh
        </p>
      </div>
    </main>
  );
};

export default LoginPage;