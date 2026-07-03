/**
 * pages/SettingsPage.jsx
 *
 * Four sections:
 *   1. Profile    - name, email, avatar colour picker (10 swatches)
 *   2. Security   - change password (requires current password to confirm)
 *   3. Budget Goal - monthly budget cap shown on the dashboard progress bar
 *   4. Danger Zone - 3-step delete-account gate so nobody does it by accident
 *
 * API calls:
 *   PUT    /api/auth/profile   → name, email, avatarColor
 *   PUT    /api/auth/password  → currentPassword, newPassword
 *   PUT    /api/auth/budget    → monthlyBudget
 *   DELETE /api/auth/account   → password confirmation
 *
 * After profile/budget saves, AuthContext.updateUser() patches local state
 * so the Navbar reflects the changes immediately without a full re-fetch.
 */

import { useState }    from 'react';
import { useNavigate } from 'react-router-dom';
import axios           from 'axios';
import {
  User, Mail, Lock, Eye, EyeOff, Save, Loader2,
  AlertTriangle, Trash2, Settings, IndianRupee,
  Palette, ShieldCheck, CheckCircle2,
} from 'lucide-react';
import { useAuth }  from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

// --- Avatar colour palette ----------------------------------------------------
// 10 swatches - user can pick any of these as their avatar background colour
const AVATAR_COLORS = [
  '#10b981','#3b82f6','#8b5cf6','#f59e0b',
  '#ef4444','#ec4899','#06b6d4','#f97316',
  '#84cc16','#6366f1',
];

// --- Section wrapper ----------------------------------------------------------
// Reusable card with a consistent icon + title + subtitle header
const Section = ({ icon: Icon, title, subtitle, accent = 'text-emerald-500', children }) => (
  <section
    className="card space-y-5"
    aria-labelledby={`sec-${title.replace(/\s+/g, '-').toLowerCase()}`}
  >
    <header className="flex items-start gap-3 pb-4 border-b border-slate-100 dark:border-slate-700">
      <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
        <Icon size={16} className={accent} aria-hidden="true" />
      </div>
      <div>
        <h2 id={`sec-${title.replace(/\s+/g, '-').toLowerCase()}`} className="section-title">{title}</h2>
        {subtitle && <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
    </header>
    {children}
  </section>
);

// --- Field error --------------------------------------------------------------
const FErr = ({ msg }) => msg
  ? <p className="text-xs text-rose-500 mt-1.5 font-medium" role="alert">{msg}</p>
  : null;

// --- Live avatar preview ------------------------------------------------------
// Updates in real time as the user types their name or picks a colour
const AvatarPreview = ({ name, color }) => {
  const initials = (name || '?').trim().split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div
      className="w-14 h-14 rounded-2xl flex items-center justify-center text-white font-bold text-lg flex-shrink-0 shadow-md transition-colors duration-300"
      style={{ backgroundColor: color }}
      aria-label={`Avatar preview: ${name}`}
    >
      {initials}
    </div>
  );
};

// --- Password field -----------------------------------------------------------
// Extracted as a named component outside SettingsPage so React doesn't
// re-create the DOM element on every parent render - this was causing
// the input to lose focus mid-typing before I moved it out here.
const PwField = ({ id, label, field, complete, pw, setPw, pwErr, setPwErr, showPw, setShowPw }) => (
  <div>
    <label htmlFor={id} className="form-label">{label}</label>
    <div className="relative">
      <Lock size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" aria-hidden="true" />
      <input
        id={id}
        type={showPw[field] ? 'text' : 'password'}
        value={pw[field]}
        onChange={e => {
          setPw(p => ({ ...p, [field]: e.target.value }));
          setPwErr(er => ({ ...er, [field]: '' }));
        }}
        className={`input-field pl-10 pr-10 ${pwErr[field] ? 'border-rose-400 focus:ring-rose-400' : ''}`}
        autoComplete={field === 'current' ? 'current-password' : 'new-password'}
        placeholder={field !== 'current' ? 'Min. 6 characters' : undefined}
      />
      <button
        type="button"
        onClick={() => setShowPw(s => ({ ...s, [field]: !s[field] }))}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
        aria-label={showPw[field] ? 'Hide' : 'Show'}
      >
        {showPw[field] ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
    {/* Passwords-match indicator - only shown on the confirm field once they match */}
    {complete && pw[field] && pw.next === pw.confirm && (
      <p className="flex items-center gap-1 text-xs text-emerald-500 mt-1.5 font-medium">
        <CheckCircle2 size={11} />Passwords match
      </p>
    )}
    <FErr msg={pwErr[field]} />
  </div>
);

// --- SettingsPage -------------------------------------------------------------
const SettingsPage = () => {
  const { user, updateUser, logout } = useAuth();
  const { toast }  = useToast();
  const navigate   = useNavigate();

  // -- Profile state ---------------------------------------------------------
  const [prof, setProf] = useState({
    name:        user?.name        || '',
    email:       user?.email       || '',
    avatarColor: user?.avatarColor || '#10b981',
  });
  const [profErr,    setProfErr]    = useState({});
  const [savingProf, setSavingProf] = useState(false);

  const saveProfile = async (e) => {
    e.preventDefault();
    const err = {};
    if (!prof.name.trim() || prof.name.trim().length < 2) err.name  = 'Name must be at least 2 characters.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(prof.email))  err.email = 'Enter a valid email address.';
    setProfErr(err);
    if (Object.keys(err).length) return;

    setSavingProf(true);
    try {
      const { data } = await axios.put('/api/auth/profile', {
        name:        prof.name.trim(),
        email:       prof.email.trim().toLowerCase(),
        avatarColor: prof.avatarColor,
      });
      if (data.success) {
        // Patch AuthContext directly so the Navbar avatar updates immediately
        updateUser(data.user);
        toast.success('Profile saved.', 'Saved');
      }
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to save profile.', 'Error');
    } finally { setSavingProf(false); }
  };

  // -- Password state --------------------------------------------------------
  const [pw,      setPw]      = useState({ current: '', next: '', confirm: '' });
  const [pwErr,   setPwErr]   = useState({});
  const [savingPw, setSavingPw] = useState(false);
  const [showPw,  setShowPw]  = useState({ current: false, next: false, confirm: false });

  const changePassword = async (e) => {
    e.preventDefault();
    const err = {};
    if (!pw.current)            err.current  = 'Current password is required.';
    if (!pw.next)               err.next     = 'New password is required.';
    else if (pw.next.length < 6) err.next    = 'New password must be at least 6 characters.';
    if (pw.next !== pw.confirm) err.confirm  = 'Passwords do not match.';
    setPwErr(err);
    if (Object.keys(err).length) return;

    setSavingPw(true);
    try {
      const { data } = await axios.put('/api/auth/password', {
        currentPassword: pw.current,
        newPassword:     pw.next,
      });
      if (data.success) {
        toast.success('Password changed. Signing you out…', 'Done');
        setPw({ current: '', next: '', confirm: '' });
        // Short delay so the user sees the toast before being redirected
        setTimeout(() => { logout(); navigate('/login'); }, 1600);
      }
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to change password.', 'Error');
    } finally { setSavingPw(false); }
  };

  // -- Budget state ----------------------------------------------------------
  const [budget,      setBudget]      = useState(user?.monthlyBudget?.toString() || '50000');
  const [budgetErr,   setBudgetErr]   = useState('');
  const [savingBudget, setSavingBudget] = useState(false);

  const saveBudget = async (e) => {
    e.preventDefault();
    const val = Number(budget);
    if (!budget || isNaN(val) || val < 1) {
      setBudgetErr('Enter a valid amount (min ₹1).');
      return;
    }
    setBudgetErr('');
    setSavingBudget(true);
    try {
      const { data } = await axios.put('/api/auth/budget', { monthlyBudget: val });
      if (data.success) {
        updateUser({ monthlyBudget: val });
        toast.success(`Budget set to ₹${val.toLocaleString('en-IN')}.`, 'Saved');
      }
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to update budget.', 'Error');
    } finally { setSavingBudget(false); }
  };

  // -- Delete account state --------------------------------------------------
  // 3-step gate: 0 = idle button, 1 = warning with bullet list, 2 = password confirm
  // Each step requires an extra click so nobody deletes by accident
  const [delStep,  setDelStep]  = useState(0);
  const [delPw,    setDelPw]    = useState('');
  const [deleting, setDeleting] = useState(false);

  const deleteAccount = async () => {
    if (!delPw) { toast.error('Enter your password to confirm.'); return; }
    setDeleting(true);
    try {
      const { data } = await axios.delete('/api/auth/account', { data: { password: delPw } });
      if (data.success) {
        toast.success('Account deleted.');
        logout();
        navigate('/login', { replace: true });
      }
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to delete account.', 'Error');
    } finally { setDeleting(false); }
  };

  // --- Render ---------------------------------------------------------------
  return (
    <>
      {/* Page header */}
      <header className="mb-8 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-slate-900 dark:bg-slate-700 flex items-center justify-center shadow-md flex-shrink-0">
          <Settings size={18} className="text-emerald-400" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">Settings</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Manage your profile, security, and preferences.</p>
        </div>
      </header>

      {/* Responsive two-column grid - Profile + Security take 2/3, Budget + Danger take 1/3 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left column */}
        <div className="lg:col-span-2 space-y-6">

          {/* Profile section */}
          <Section icon={User} title="Profile" subtitle="Your public identity on TrackWise.">
            <form onSubmit={saveProfile} noValidate className="space-y-5">
              {/* Live avatar preview + colour swatches */}
              <div className="flex items-center gap-4">
                <AvatarPreview name={prof.name} color={prof.avatarColor} />
                <div className="flex-1 space-y-2">
                  <p className="form-label flex items-center gap-1.5 mb-0">
                    <Palette size={11} aria-hidden="true" />Avatar colour
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {AVATAR_COLORS.map(c => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setProf(p => ({ ...p, avatarColor: c }))}
                        className={[
                          'w-7 h-7 rounded-lg transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-slate-400',
                          prof.avatarColor === c ? 'ring-2 ring-offset-2 ring-slate-600 dark:ring-slate-300 scale-110' : 'hover:scale-110',
                        ].join(' ')}
                        style={{ backgroundColor: c }}
                        aria-label={`Colour ${c}`}
                        aria-pressed={prof.avatarColor === c}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Name */}
              <div>
                <label htmlFor="s-name" className="form-label">Full name</label>
                <div className="relative">
                  <User size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" aria-hidden="true" />
                  <input
                    id="s-name" type="text" value={prof.name} maxLength={60} autoComplete="name"
                    onChange={e => { setProf(p => ({ ...p, name: e.target.value })); setProfErr(er => ({ ...er, name: '' })); }}
                    className={`input-field pl-10 ${profErr.name ? 'border-rose-400 focus:ring-rose-400' : ''}`}
                  />
                </div>
                <FErr msg={profErr.name} />
              </div>

              {/* Email */}
              <div>
                <label htmlFor="s-email" className="form-label">Email address</label>
                <div className="relative">
                  <Mail size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" aria-hidden="true" />
                  <input
                    id="s-email" type="email" value={prof.email} autoComplete="email"
                    onChange={e => { setProf(p => ({ ...p, email: e.target.value })); setProfErr(er => ({ ...er, email: '' })); }}
                    className={`input-field pl-10 ${profErr.email ? 'border-rose-400 focus:ring-rose-400' : ''}`}
                  />
                </div>
                <FErr msg={profErr.email} />
              </div>

              <button type="submit" disabled={savingProf} className="btn-primary">
                {savingProf ? <><Loader2 size={14} className="animate-spin" />Saving…</> : <><Save size={14} />Save profile</>}
              </button>
            </form>
          </Section>

          {/* Security section */}
          <Section icon={Lock} title="Security" subtitle="Change your password. You will be signed out afterwards." accent="text-blue-500">
            <form onSubmit={changePassword} noValidate className="space-y-4">
              <PwField id="s-cur"  label="Current password"      field="current"  pw={pw} setPw={setPw} pwErr={pwErr} setPwErr={setPwErr} showPw={showPw} setShowPw={setShowPw} />
              <PwField id="s-new"  label="New password"          field="next"     pw={pw} setPw={setPw} pwErr={pwErr} setPwErr={setPwErr} showPw={showPw} setShowPw={setShowPw} />
              <PwField id="s-conf" label="Confirm new password"  field="confirm"  complete pw={pw} setPw={setPw} pwErr={pwErr} setPwErr={setPwErr} showPw={showPw} setShowPw={setShowPw} />
              <button type="submit" disabled={savingPw} className="btn-primary bg-blue-500 hover:bg-blue-600 focus:ring-blue-500">
                {savingPw ? <><Loader2 size={14} className="animate-spin" />Updating…</> : <><ShieldCheck size={14} />Change password</>}
              </button>
            </form>
          </Section>
        </div>

        {/* Right column */}
        <div className="space-y-6">

          {/* Budget section */}
          <Section icon={IndianRupee} title="Budget Goal" subtitle="Monthly spending limit shown on your dashboard.">
            <form onSubmit={saveBudget} noValidate className="space-y-4">
              <div>
                <label htmlFor="s-budget" className="form-label">Monthly budget (₹)</label>
                <div className="relative">
                  <IndianRupee size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" aria-hidden="true" />
                  <input
                    id="s-budget" type="number" min="1" value={budget}
                    onChange={e => { setBudget(e.target.value); setBudgetErr(''); }}
                    className={`input-field pl-10 font-numeric ${budgetErr ? 'border-rose-400 focus:ring-rose-400' : ''}`}
                    placeholder="50000"
                  />
                </div>
                <FErr msg={budgetErr} />
              </div>
              <button type="submit" disabled={savingBudget} className="btn-primary w-full">
                {savingBudget ? <><Loader2 size={14} className="animate-spin" />Saving…</> : <><Save size={14} />Save budget</>}
              </button>
            </form>
          </Section>

          {/* Danger zone */}
          <Section icon={AlertTriangle} title="Danger Zone" subtitle="Permanent actions - cannot be undone." accent="text-rose-500">

            {/* Step 0 - initial delete button */}
            {delStep === 0 && (
              <div className="space-y-3">
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Permanently erases all your transactions, budgets, and account data.
                </p>
                <button onClick={() => setDelStep(1)} className="btn-danger w-full py-2.5">
                  <Trash2 size={14} />Delete my account
                </button>
              </div>
            )}

            {/* Step 1 - warning list */}
            {delStep === 1 && (
              <div className="space-y-4 animate-slide-down">
                <div className="p-3 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-700/50 rounded-xl">
                  <p className="text-xs font-semibold text-rose-700 dark:text-rose-400 mb-1">⚠️ This will permanently delete:</p>
                  <ul className="text-xs text-rose-600 dark:text-rose-300 space-y-0.5 ml-3 list-disc">
                    <li>All your transactions</li>
                    <li>All your budget goals</li>
                    <li>Your account and profile</li>
                  </ul>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setDelStep(0)} className="btn-secondary flex-1 py-2">Cancel</button>
                  <button onClick={() => setDelStep(2)} className="btn-danger flex-1 py-2">Yes, continue</button>
                </div>
              </div>
            )}

            {/* Step 2 - password confirmation before the actual DELETE request fires */}
            {delStep === 2 && (
              <div className="space-y-4 animate-slide-down">
                <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">Enter your password to confirm:</p>
                <input
                  type="password" value={delPw}
                  onChange={e => setDelPw(e.target.value)}
                  autoFocus
                  placeholder="Your current password"
                  className="input-field border-rose-300 dark:border-rose-700 focus:ring-rose-400"
                  aria-label="Password confirmation for account deletion"
                />
                <div className="flex gap-2">
                  <button onClick={() => { setDelStep(0); setDelPw(''); }} className="btn-secondary flex-1 py-2">Cancel</button>
                  <button
                    onClick={deleteAccount}
                    disabled={deleting || !delPw}
                    className="flex-1 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-200 disabled:opacity-50"
                  >
                    {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    {deleting ? 'Deleting…' : 'Delete forever'}
                  </button>
                </div>
              </div>
            )}
          </Section>
        </div>
      </div>
    </>
  );
};

export default SettingsPage;