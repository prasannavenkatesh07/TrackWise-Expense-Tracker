/**
 * pages/RegisterPage.jsx
 *
 * Two-path registration:
 *   Path A - Google OAuth: GoogleLogin button → POST /api/auth/google-login
 *             → backend verifies the ID token, auto-creates the account if new,
 *               and returns our own app JWT
 *   Path B - Email/password: form → POST /api/auth/register
 *             → backend creates the account in an unverified state and emails a
 *               6-digit OTP → redirect to /verify-email?email=... to confirm it
 *
 * Validation mirrors the backend express-validator rules so the user sees
 * errors before the request is even sent.
 *
 * The password strength indicator is purely cosmetic - it's a visual hint,
 * not a hard block. The backend still enforces the 6-character minimum.
 *
 * TODO: add a proper zxcvbn-style strength check instead of the length-based one
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import axios from 'axios';
import {
  Mail, Lock, Eye, EyeOff, User,
  Loader2, Wallet, ArrowRight, AlertCircle,
  Sun, Moon, CheckCircle2, IndianRupee,
} from 'lucide-react';
import { useAuth }  from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';

// --- Field error --------------------------------------------------------------
const FieldError = ({ message }) =>
  message ? (
    <p className="flex items-center gap-1.5 text-xs text-rose-500 mt-1.5 font-medium" role="alert">
      <AlertCircle size={11} aria-hidden="true" />
      {message}
    </p>
  ) : null;

// --- Background decoration ----------------------------------------------------
const BackgroundDecor = () => (
  <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
    <div className="absolute inset-0 opacity-[0.025] dark:opacity-[0.04]"
      style={{ backgroundImage: 'radial-gradient(circle, #10b981 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
    <div className="absolute -top-32 -right-32 w-96 h-96 bg-emerald-400/10 dark:bg-emerald-500/10 rounded-full blur-3xl" />
    <div className="absolute -bottom-32 -left-32 w-96 h-96 bg-blue-400/10 dark:bg-blue-500/10 rounded-full blur-3xl" />
  </div>
);

// --- OR divider ---------------------------------------------------------------
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

// --- Password strength indicator ----------------------------------------------
// Three segments: < 6 chars = red, 6–9 = amber, 10+ with mixed chars = green
// Purely visual - the backend enforces the real rules
const PasswordStrength = ({ password }) => {
  if (!password) return null;

  const hasUpper   = /[A-Z]/.test(password);
  const hasNumber  = /\d/.test(password);
  const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);
  const len        = password.length;

  const strength =
    len >= 10 && hasUpper && hasNumber && hasSpecial ? 3 :
    len >= 8  && (hasUpper || hasNumber)             ? 2 :
    len >= 6                                         ? 1 : 0;

  const config = [
    { label: 'Weak',   color: 'bg-rose-500',   text: 'text-rose-500'   },
    { label: 'Fair',   color: 'bg-amber-400',  text: 'text-amber-500'  },
    { label: 'Good',   color: 'bg-amber-400',  text: 'text-amber-500'  },
    { label: 'Strong', color: 'bg-emerald-500', text: 'text-emerald-500' },
  ][strength];

  return (
    <div className="mt-2 space-y-1" aria-label={`Password strength: ${config.label}`}>
      <div className="flex gap-1">
        {[0, 1, 2].map(i => (
          <div key={i}
            className={`h-1 flex-1 rounded-full transition-all duration-300 ${i <= strength - 1 ? config.color : 'bg-slate-200 dark:bg-slate-600'}`}
          />
        ))}
      </div>
      <p className={`text-[10px] font-semibold ${config.text}`}>{config.label} password</p>
    </div>
  );
};

// --- RegisterPage -------------------------------------------------------------
const RegisterPage = () => {
  const { loginWithGoogle } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const { toast }  = useToast();
  const navigate   = useNavigate();

  const [form, setForm] = useState({
    name: '', email: '', password: '', confirmPassword: '', monthlyBudget: '',
  });
  const [errors,         setErrors]         = useState({});
  const [apiError,       setApiError]       = useState('');
  const [isSubmitting,   setIsSubmitting]   = useState(false);
  const [googleLoading,  setGoogleLoading]  = useState(false);
  const [showPassword,   setShowPassword]   = useState(false);
  const [showConfirm,    setShowConfirm]    = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(p => ({ ...p, [name]: value }));
    if (errors[name]) setErrors(p => ({ ...p, [name]: '' }));
    if (apiError)     setApiError('');
  };

  // Client-side validation - mirrors the backend express-validator rules
  const validate = () => {
    const e = {};
    if (!form.name.trim() || form.name.trim().length < 2)
      e.name = 'Name must be at least 2 characters.';
    if (!form.email.trim())
      e.email = 'Email is required.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      e.email = 'Enter a valid email address.';
    if (!form.password)
      e.password = 'Password is required.';
    else if (form.password.length < 6)
      e.password = 'Password must be at least 6 characters.';
    if (form.password !== form.confirmPassword)
      e.confirmPassword = 'Passwords do not match.';
    if (form.monthlyBudget && (isNaN(Number(form.monthlyBudget)) || Number(form.monthlyBudget) < 1))
      e.monthlyBudget = 'Enter a valid budget (min ₹1).';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // --- Email/password registration ------------------------------------------
  const handleSubmit = async (e) => {
    e.preventDefault();
    setApiError('');
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const payload = {
        name:     form.name.trim(),
        email:    form.email.trim().toLowerCase(),
        password: form.password,
        ...(form.monthlyBudget ? { monthlyBudget: Number(form.monthlyBudget) } : {}),
      };
      const { data } = await axios.post('/api/auth/register', payload);
      if (data.success) {
        toast.success('Check your email for a 6-digit verification code.', 'Verify your email');
        // Navigate to the OTP verification page with the email pre-filled
        navigate(`/verify-email?email=${encodeURIComponent(form.email.trim().toLowerCase())}`);
      }
    } catch (err) {
      setApiError(err?.response?.data?.message || 'Registration failed. Please try again.');
    } finally { setIsSubmitting(false); }
  };

  // --- Google Sign-In -------------------------------------------------------
  // Google accounts are auto-verified - no OTP step needed
  const handleGoogleSuccess = async (credentialResponse) => {
    setGoogleLoading(true);
    setApiError('');
    try {
      const user = await loginWithGoogle(credentialResponse.credential);
      toast.success(`Welcome to TrackWise, ${user.name.split(' ')[0]}! 🎉`, 'Account created');
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setApiError(err?.response?.data?.message || err?.message || 'Google sign-in failed. Please try again.');
    } finally { setGoogleLoading(false); }
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
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">Create your account</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5">Start tracking smarter with TrackWise.</p>
        </div>

        <article className="card space-y-0">

          {/* Google Sign-In - no OTP step, goes straight to dashboard */}
          <div className="w-full mb-1">
            {googleLoading ? (
              <div className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm text-slate-500 dark:text-slate-400">
                <Loader2 size={16} className="animate-spin" />
                Signing in with Google…
              </div>
            ) : (
              /* The [&>div]:w-full hack forces the Google iframe to stretch full width -
                 the component renders an iframe internally which ignores normal CSS width */
              <div className="flex justify-center w-full">
                <GoogleLogin
                  onSuccess={handleGoogleSuccess}
                  onError={handleGoogleError}
                  useOneTap={false}
                  theme={isDark ? 'filled_black' : 'outline'}
                  shape="pill"
                  size="large"
                  text="signup_with"
                  width="340"
                />
              </div>
            )}
          </div>

          <OrDivider />

          {/* Email/password form */}
          <form onSubmit={handleSubmit} noValidate className="space-y-4">

            {apiError && (
              <div className="alert-danger text-xs animate-slide-down" role="alert">
                <AlertCircle size={15} className="flex-shrink-0" />{apiError}
              </div>
            )}

            {/* Full name */}
            <div>
              <label htmlFor="reg-name" className="form-label">Full name</label>
              <div className="relative">
                <User size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" aria-hidden="true" />
                <input id="reg-name" name="name" type="text" autoComplete="name"
                  value={form.name} onChange={handleChange} placeholder="Your full name"
                  className={`input-field pl-10 ${errors.name ? 'border-rose-400 focus:ring-rose-400' : ''}`}
                  aria-invalid={!!errors.name} />
              </div>
              <FieldError message={errors.name} />
            </div>

            {/* Email */}
            <div>
              <label htmlFor="reg-email" className="form-label">Email address</label>
              <div className="relative">
                <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" aria-hidden="true" />
                <input id="reg-email" name="email" type="email" autoComplete="email"
                  value={form.email} onChange={handleChange} placeholder="you@example.com"
                  className={`input-field pl-10 ${errors.email ? 'border-rose-400 focus:ring-rose-400' : ''}`}
                  aria-invalid={!!errors.email} />
              </div>
              <FieldError message={errors.email} />
            </div>

            {/* Password */}
            <div>
              <label htmlFor="reg-password" className="form-label">Password</label>
              <div className="relative">
                <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" aria-hidden="true" />
                <input id="reg-password" name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={form.password} onChange={handleChange} placeholder="Min. 6 characters"
                  className={`input-field pl-10 pr-11 ${errors.password ? 'border-rose-400 focus:ring-rose-400' : ''}`}
                  aria-invalid={!!errors.password} />
                <button type="button" onClick={() => setShowPassword(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors p-0.5"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}>
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <FieldError message={errors.password} />
              {/* Strength meter only shows once the user starts typing */}
              {form.password && <PasswordStrength password={form.password} />}
            </div>

            {/* Confirm password */}
            <div>
              <label htmlFor="reg-confirm" className="form-label">Confirm password</label>
              <div className="relative">
                <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" aria-hidden="true" />
                <input id="reg-confirm" name="confirmPassword"
                  type={showConfirm ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={form.confirmPassword} onChange={handleChange} placeholder="Re-enter password"
                  className={`input-field pl-10 pr-11 ${errors.confirmPassword ? 'border-rose-400 focus:ring-rose-400' : ''}`}
                  aria-invalid={!!errors.confirmPassword} />
                <button type="button" onClick={() => setShowConfirm(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors p-0.5"
                  aria-label={showConfirm ? 'Hide confirm password' : 'Show confirm password'}>
                  {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <FieldError message={errors.confirmPassword} />
              {/* Show a checkmark once the passwords match - small UX win */}
              {form.confirmPassword && !errors.confirmPassword && form.password === form.confirmPassword && (
                <p className="flex items-center gap-1.5 text-xs text-emerald-500 mt-1.5 font-medium">
                  <CheckCircle2 size={11} />Passwords match
                </p>
              )}
            </div>

            {/* Monthly budget - optional, defaults to ₹50,000 on the backend */}
            <div>
              <label htmlFor="reg-budget" className="form-label">
                Monthly budget goal{' '}
                <span className="normal-case font-normal text-slate-400 dark:text-slate-500 tracking-normal">(optional)</span>
              </label>
              <div className="relative">
                <IndianRupee size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" aria-hidden="true" />
                <input id="reg-budget" name="monthlyBudget" type="number" min="1"
                  value={form.monthlyBudget} onChange={handleChange} placeholder="e.g. 50000"
                  className={`input-field pl-10 font-numeric ${errors.monthlyBudget ? 'border-rose-400 focus:ring-rose-400' : ''}`}
                  aria-invalid={!!errors.monthlyBudget} />
              </div>
              <FieldError message={errors.monthlyBudget} />
              <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
                Defaults to ₹50,000 if left blank. Adjustable any time in Settings.
              </p>
            </div>

            <button type="submit" disabled={isSubmitting} className="btn-primary w-full py-3 text-base mt-2">
              {isSubmitting
                ? <><Loader2 size={17} className="animate-spin" />Creating account…</>
                : <>Create account<ArrowRight size={17} /></>
              }
            </button>
          </form>

          {/* Back to login */}
          <div className="relative mt-5">
            <div className="absolute inset-0 flex items-center" aria-hidden="true">
              <div className="w-full border-t border-slate-100 dark:border-slate-700" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-white dark:bg-slate-800 px-3 text-xs text-slate-400 dark:text-slate-500 font-medium">
                Already have an account?
              </span>
            </div>
          </div>
          <Link to="/login" className="btn-secondary w-full py-2.5 justify-center mt-4">
            Sign in instead
          </Link>
        </article>

        <p className="text-center text-xs text-slate-400 dark:text-slate-600 mt-6">
          Designed and Developed by Prasanna Venkatesh
        </p>
      </div>
    </main>
  );
};

export default RegisterPage;