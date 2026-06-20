/**
 * pages/ResetPasswordPage.jsx  (OTP Upgrade)
 *
 * Flow:
 * 1. User requests reset → Backend sends 6-digit OTP.
 * 2. User is redirected here: /reset-password?email=test@example.com
 * 3. User enters OTP + New Password.
 * 4. PUT /api/auth/reset-password { email, otp, newPassword }
 * 5. On success → auto-login → Dashboard.
 */

import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import {
  Lock, Eye, EyeOff, Loader2, Wallet, CheckCircle2, 
  ShieldCheck, AlertCircle, Sun, Moon, Hash
} from 'lucide-react';
import { useAuth }  from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';

// ── Background decoration ──────────────────────────────────────────────────────
const BackgroundDecor = () => (
  <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
    <div className="absolute inset-0 opacity-[0.025] dark:opacity-[0.04]" style={{ backgroundImage: 'radial-gradient(circle, #10b981 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
    <div className="absolute -top-32 -left-32 w-96 h-96 bg-emerald-400/10 rounded-full blur-3xl" />
    <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-blue-400/10 rounded-full blur-3xl" />
  </div>
);

// ── Password strength meter ────────────────────────────────────────────────────
const PasswordStrength = ({ password }) => {
  if (!password) return null;
  const checks  = [password.length >= 8, /[A-Z]/.test(password), /[0-9]/.test(password), /[^a-zA-Z0-9]/.test(password)];
  const score = checks.filter(Boolean).length;
  const map   = {
    0: { label: 'Too weak',  color: 'bg-rose-500',    text: 'text-rose-500',    filled: 1 },
    1: { label: 'Weak',      color: 'bg-rose-400',    text: 'text-rose-400',    filled: 1 },
    2: { label: 'Fair',      color: 'bg-amber-400',   text: 'text-amber-500',   filled: 2 },
    3: { label: 'Good',      color: 'bg-blue-400',    text: 'text-blue-500',    filled: 3 },
    4: { label: 'Strong',    color: 'bg-emerald-500', text: 'text-emerald-500', filled: 4 },
  };
  const { label, color, text, filled } = map[score];
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

const FieldError = ({ message }) => message ? (
  <p className="flex items-center gap-1.5 text-xs text-rose-500 mt-1.5 font-medium" role="alert"><AlertCircle size={11} />{message}</p>
) : null;

const ResetPasswordPage = () => {
  const [searchParams] = useSearchParams();
  const email          = searchParams.get('email') || '';
  const navigate       = useNavigate();
  const { login }      = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const { toast }      = useToast();

  const [form, setForm] = useState({ otp: '', password: '', confirmPassword: '' });
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!email) {
      toast.error('No email found. Please request a new reset code.', 'Error');
      navigate('/forgot-password');
    }
  }, [email, navigate, toast]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    // Restrict OTP to numbers only
    const val = name === 'otp' ? value.replace(/\D/g, '') : value;
    setForm(p => ({ ...p, [name]: val }));
    if (errors[name]) setErrors(p => ({ ...p, [name]: '' }));
  };

  const validate = () => {
    const e = {};
    if (form.otp.length !== 6) e.otp = 'Please enter the 6-digit code.';
    if (!form.password || form.password.length < 6) e.password = 'Password must be at least 6 characters.';
    if (form.password !== form.confirmPassword) e.confirmPassword = 'Passwords do not match.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const { data } = await axios.put('/api/auth/reset-password', {
        email,
        otp: form.otp,
        newPassword: form.password,
      });

      if (data.success) {
        toast.success('Password reset successfully!', 'Done');
        login(data.token, data.user);
        navigate('/dashboard', { replace: true });
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Invalid OTP or expired. Please try again.', 'Error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="relative min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center px-4 py-12 transition-colors duration-300">
      <BackgroundDecor />
      <button onClick={toggleTheme} className="absolute top-5 right-5 btn-ghost">
        {isDark ? <Sun size={18} className="text-amber-400" /> : <Moon size={18} className="text-slate-500" />}
      </button>

      <div className="relative w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-slate-900 dark:bg-slate-700 shadow-lg mb-4 relative">
            <Wallet size={24} className="text-emerald-400" />
            <div className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/10" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">Set new password</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5 max-w-xs mx-auto leading-relaxed">
            Enter the 6-digit code sent to <strong>{email}</strong>
          </p>
        </div>

        <article className="card">
          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            {/* ── OTP Field ────────────────────────────────────────────── */}
            <div>
              <label htmlFor="otp" className="form-label"><span className="flex items-center gap-1.5"><Hash size={11} />6-Digit Code</span></label>
              <input
                id="otp" name="otp" type="text" maxLength={6}
                value={form.otp} onChange={handleChange}
                placeholder="000000"
                className={`input-field tracking-widest font-mono text-lg ${errors.otp ? 'border-rose-400 focus:ring-rose-400' : ''}`}
                autoFocus
              />
              <FieldError message={errors.otp} />
            </div>

            {/* ── New Password Field ───────────────────────────────────── */}
            <div>
              <label htmlFor="password" className="form-label"><span className="flex items-center gap-1.5"><ShieldCheck size={11} />New password</span></label>
              <div className="relative">
                <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  id="password" name="password" type={showPassword ? 'text' : 'password'}
                  value={form.password} onChange={handleChange}
                  placeholder="Min. 6 characters"
                  className={`input-field pl-10 pr-11 ${errors.password ? 'border-rose-400 focus:ring-rose-400' : ''}`}
                />
                <button type="button" onClick={() => setShowPassword(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-0.5">
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <PasswordStrength password={form.password} />
              <FieldError message={errors.password} />
            </div>

            {/* ── Confirm Password Field ───────────────────────────────── */}
            <div>
              <label htmlFor="confirmPassword" className="form-label">Confirm new password</label>
              <div className="relative">
                <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  id="confirmPassword" name="confirmPassword" type={showPassword ? 'text' : 'password'}
                  value={form.confirmPassword} onChange={handleChange}
                  placeholder="Re-enter your password"
                  className={`input-field pl-10 pr-11 ${errors.confirmPassword ? 'border-rose-400 focus:ring-rose-400' : ''}`}
                />
              </div>
              {form.confirmPassword.length > 0 && form.password === form.confirmPassword && (
                <p className="flex items-center gap-1.5 text-xs text-emerald-500 mt-1.5 font-medium"><CheckCircle2 size={11} />Passwords match</p>
              )}
              <FieldError message={errors.confirmPassword} />
            </div>

            {/* ── Submit ────────────────────────────────────────────────── */}
            <button type="submit" disabled={isSubmitting} className="btn-primary w-full py-3 text-base">
              {isSubmitting ? <><Loader2 size={17} className="animate-spin" />Resetting…</> : <><ShieldCheck size={17} />Reset Password</>}
            </button>
          </form>

          <div className="mt-5 border-t border-slate-100 dark:border-slate-700 pt-5">
            <Link to="/login" className="btn-secondary w-full py-2.5 justify-center">Back to Sign In</Link>
          </div>
        </article>
      </div>
    </main>
  );
};

export default ResetPasswordPage;