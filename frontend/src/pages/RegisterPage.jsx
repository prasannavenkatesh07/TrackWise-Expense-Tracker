/**
 * pages/RegisterPage.jsx  (Auth Upgrade — OTP Flow)
 *
 * Changes:
 * ✦ Google Sign-Up button at the top via <GoogleLogin />
 * ✦ Standard email sign-up now routes to the OTP Verification page
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import axios from 'axios';
import {
  User, Mail, Lock, Eye, EyeOff, Loader2,
  Wallet, ArrowRight, AlertCircle,
  CheckCircle2, IndianRupee, Sun, Moon,
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
    <div className="absolute -top-40 -right-32 w-96 h-96 bg-emerald-400/10 dark:bg-emerald-500/10 rounded-full blur-3xl" />
    <div className="absolute -bottom-40 -left-32 w-96 h-96 bg-violet-400/10 dark:bg-violet-500/10 rounded-full blur-3xl" />
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

// ── Password strength meter ────────────────────────────────────────────────────
const PasswordStrength = ({ password }) => {
  if (!password) return null;
  const checks  = [password.length >= 8, /[A-Z]/.test(password), /[0-9]/.test(password), /[^a-zA-Z0-9]/.test(password)];
  const score   = checks.filter(Boolean).length;
  const configs = {
    0: { label: 'Too weak',  color: 'bg-rose-500',    text: 'text-rose-500',    filled: 1 },
    1: { label: 'Weak',      color: 'bg-rose-400',    text: 'text-rose-400',    filled: 1 },
    2: { label: 'Fair',      color: 'bg-amber-400',   text: 'text-amber-500',   filled: 2 },
    3: { label: 'Good',      color: 'bg-blue-400',    text: 'text-blue-500',    filled: 3 },
    4: { label: 'Strong',    color: 'bg-emerald-500', text: 'text-emerald-500', filled: 4 },
  };
  const { label, color, text, filled } = configs[score];
  return (
    <div className="mt-2 space-y-1.5" aria-label={`Password strength: ${label}`}>
      <div className="flex gap-1" aria-hidden="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${i < filled ? color : 'bg-slate-200 dark:bg-slate-700'}`} />
        ))}
      </div>
      <p className={`text-xs font-semibold ${text}`}>{label}</p>
    </div>
  );
};

// ── Main RegisterPage ──────────────────────────────────────────────────────────
const RegisterPage = () => {
  const { loginWithGoogle }       = useAuth();
  const { isDark, toggleTheme }   = useTheme();
  const { toast }                 = useToast();
  const navigate                  = useNavigate();

  const [form, setForm] = useState({
    name: '', email: '', password: '', confirmPassword: '', monthlyBudget: '50000',
  });
  const [errors,        setErrors]        = useState({});
  const [apiError,      setApiError]      = useState('');
  const [isSubmitting,  setIsSubmitting]  = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showPassword,  setShowPassword]  = useState(false);
  const [showConfirm,   setShowConfirm]   = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(p => ({ ...p, [name]: value }));
    if (errors[name]) setErrors(p => ({ ...p, [name]: '' }));
    if (apiError)     setApiError('');
  };

  const validate = () => {
    const e = {};
    if (!form.name.trim() || form.name.trim().length < 2)
      e.name = 'Name must be at least 2 characters.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      e.email = 'Enter a valid email address.';
    if (!form.password)
      e.password = 'Password is required.';
    else if (form.password.length < 6)
      e.password = 'Password must be at least 6 characters.';
    if (form.password !== form.confirmPassword)
      e.confirmPassword = 'Passwords do not match.';
    if (form.monthlyBudget && (isNaN(Number(form.monthlyBudget)) || Number(form.monthlyBudget) < 1))
      e.monthlyBudget = 'Budget must be a positive number.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // ── Standard email/password registration ────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    setApiError('');
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const { data } = await axios.post('/api/auth/register', {
        name:          form.name.trim(),
        email:         form.email.trim().toLowerCase(),
        password:      form.password,
        monthlyBudget: Number(form.monthlyBudget) || 50000,
      });
      if (data.success) {
        // ✦ OTP Upgrade: Route to Verify Email page instead of Dashboard
        toast.success(`Account created! Please check your email for the verification code.`);
        navigate(`/verify-email?email=${encodeURIComponent(form.email.trim().toLowerCase())}`);
      }
    } catch (err) {
      setApiError(err?.response?.data?.message || 'Registration failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Google Sign-Up ────────────────────────────────────────────────────────
  const handleGoogleSuccess = async (credentialResponse) => {
    setGoogleLoading(true);
    setApiError('');
    try {
      const user = await loginWithGoogle(credentialResponse.credential);
      toast.success(`Account created! Welcome, ${user.name.split(' ')[0]}! 🎉`);
      // Google emails are already verified, route straight to dashboard
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setApiError(err?.response?.data?.message || err?.message || 'Google sign-up failed. Please try again.');
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleGoogleError = () => {
    setApiError('Google sign-up was cancelled or failed. Please try again.');
  };

  const passwordsMatch = form.confirmPassword && form.password === form.confirmPassword;

  return (
    <main className="relative min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center px-4 py-10 transition-colors duration-300">
      <BackgroundDecor />

      <button onClick={toggleTheme} className="absolute top-5 right-5 btn-ghost"
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}>
        {isDark ? <Sun size={18} className="text-amber-400" /> : <Moon size={18} className="text-slate-500" />}
      </button>

      <div className="relative w-full max-w-md">

        {/* Brand header */}
        <div className="text-center mb-7">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-slate-900 dark:bg-slate-700 shadow-lg mb-4 relative">
            <Wallet size={24} className="text-emerald-400" />
            <div className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/10" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
            Create your account
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5">
            Join TrackWise — free, forever.
          </p>
        </div>

        <article className="card">

          {/* ── ✦ Google Sign-Up button ───────────────────────────────────── */}
          <div className="w-full">
            {googleLoading ? (
              <div className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm text-slate-500 dark:text-slate-400">
                <Loader2 size={16} className="animate-spin" />
                Continuing with Google…
              </div>
            ) : (
              <div className="flex justify-center">
                <GoogleLogin
                  onSuccess={handleGoogleSuccess}
                  onError={handleGoogleError}
                  useOneTap={false}
                  theme={isDark ? 'filled_black' : 'outline'}
                  shape="rectangular"
                  size="large"
                  text="signup_with"
                />
              </div>
            )}
          </div>

          <OrDivider />

          {/* ── Standard registration form ──────────────────────────────── */}
          <form onSubmit={handleSubmit} noValidate className="space-y-4">

            {/* API error */}
            {apiError && (
              <div className="alert-danger text-xs animate-slide-down" role="alert">
                <AlertCircle size={15} className="flex-shrink-0" />{apiError}
              </div>
            )}

            {/* Full name */}
            <div>
              <label htmlFor="reg-name" className="form-label">Full name</label>
              <div className="relative">
                <User size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input id="reg-name" name="name" type="text" autoComplete="name"
                  value={form.name} onChange={handleChange} placeholder="Arjun Sharma"
                  className={`input-field pl-10 ${errors.name ? 'border-rose-400 focus:ring-rose-400' : ''}`}
                  maxLength={60} aria-invalid={!!errors.name} />
              </div>
              <FieldError message={errors.name} />
            </div>

            {/* Email */}
            <div>
              <label htmlFor="reg-email" className="form-label">Email address</label>
              <div className="relative">
                <Mail size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input id="reg-email" name="email" type="email" autoComplete="email"
                  value={form.email} onChange={handleChange} placeholder="you@example.com"
                  className={`input-field pl-10 ${errors.email ? 'border-rose-400 focus:ring-rose-400' : ''}`}
                  aria-invalid={!!errors.email} />
              </div>
              <FieldError message={errors.email} />
            </div>

            {/* Password + strength meter */}
            <div>
              <label htmlFor="reg-password" className="form-label">Password</label>
              <div className="relative">
                <Lock size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input id="reg-password" name="password" type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password" value={form.password} onChange={handleChange}
                  placeholder="Min. 6 characters"
                  className={`input-field pl-10 pr-11 ${errors.password ? 'border-rose-400 focus:ring-rose-400' : ''}`}
                  aria-invalid={!!errors.password} />
                <button type="button" onClick={() => setShowPassword(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors p-0.5"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}>
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <PasswordStrength password={form.password} />
              <FieldError message={errors.password} />
            </div>

            {/* Confirm password */}
            <div>
              <label htmlFor="reg-confirm" className="form-label">Confirm password</label>
              <div className="relative">
                <Lock size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input id="reg-confirm" name="confirmPassword" type={showConfirm ? 'text' : 'password'}
                  autoComplete="new-password" value={form.confirmPassword} onChange={handleChange}
                  placeholder="Re-enter your password"
                  className={`input-field pl-10 pr-11 ${errors.confirmPassword ? 'border-rose-400 focus:ring-rose-400' : ''}`}
                  aria-invalid={!!errors.confirmPassword} />
                <button type="button" onClick={() => setShowConfirm(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors p-0.5"
                  aria-label={showConfirm ? 'Hide confirm password' : 'Show confirm password'}>
                  {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {passwordsMatch && (
                <p className="flex items-center gap-1.5 text-xs text-emerald-500 mt-1.5 font-medium">
                  <CheckCircle2 size={11} aria-hidden="true" />Passwords match
                </p>
              )}
              <FieldError message={errors.confirmPassword} />
            </div>

            {/* Monthly budget */}
            <div>
              <label htmlFor="reg-budget" className="form-label">
                Monthly budget goal
                <span className="ml-1.5 normal-case tracking-normal font-normal text-slate-400">(optional)</span>
              </label>
              <div className="relative">
                <IndianRupee size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input id="reg-budget" name="monthlyBudget" type="number"
                  value={form.monthlyBudget} onChange={handleChange}
                  placeholder="50000" min="1"
                  className={`input-field pl-10 font-numeric ${errors.monthlyBudget ? 'border-rose-400 focus:ring-rose-400' : ''}`}
                  aria-invalid={!!errors.monthlyBudget} />
              </div>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                Drives the budget progress bar on your dashboard. Change anytime in Settings.
              </p>
              <FieldError message={errors.monthlyBudget} />
            </div>

            <button type="submit" disabled={isSubmitting}
              className="btn-primary w-full py-3 text-base mt-1">
              {isSubmitting
                ? <><Loader2 size={17} className="animate-spin" />Creating account…</>
                : <>Create account<ArrowRight size={17} /></>}
            </button>
          </form>

          {/* Login link */}
          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center" aria-hidden="true">
              <div className="w-full border-t border-slate-100 dark:border-slate-700" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-white dark:bg-slate-800 px-3 text-xs text-slate-400 dark:text-slate-500 font-medium">
                Already have an account?
              </span>
            </div>
          </div>
          <Link to="/login" className="btn-secondary w-full py-2.5 justify-center">
            Sign in instead
          </Link>
        </article>
      </div>
    </main>
  );
};

export default RegisterPage;