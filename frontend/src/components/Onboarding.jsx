/**
 * components/Onboarding.jsx
 *
 * 3-step onboarding wizard shown automatically to new users on their first login.
 * Once completed or skipped, it sets a localStorage flag and never shows again.
 *
 * Step flow:
 *   Step 1 - Welcome + set monthly budget  → PUT /api/auth/budget
 *   Step 2 - Add first income transaction  → POST /api/transactions
 *   Step 3 - Add first expense + celebration screen → POST /api/transactions
 *
 * The modal is rendered via createPortal so it escapes any overflow:hidden parent -
 * important since it needs to cover the entire viewport.
 *
 * Usage in DashboardPage:
 *   import { useOnboarding } from '../components/Onboarding';
 *   const { shouldShow, markComplete, OnboardingModal } = useOnboarding();
 *   // in JSX:
 *   {shouldShow && <OnboardingModal onComplete={markComplete} />}
 *
 * Data flow:
 *   Step 1 → PUT /api/auth/budget  → updateUser() patches AuthContext
 *   Step 2 → POST /api/transactions (Income)
 *   Step 3 → POST /api/transactions (Expense)
 *   → On completion: parent calls refreshKey++ to reload the dashboard
 */

import { useState, useEffect } from 'react';
import { createPortal }        from 'react-dom';
import axios                   from 'axios';
import {
  Wallet, TrendingUp, TrendingDown,
  ArrowRight, ArrowLeft, CheckCircle2,
  X, Loader2, Target, Sparkles, IndianRupee,
} from 'lucide-react';
import { useAuth }  from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

// localStorage key - checked on every login to decide whether to show the wizard
const ONBOARDING_KEY = 'trackwise_onboarded';

// --- Step progress dots -------------------------------------------------------
// Active step gets a wider pill shape; past steps get a filled dot; future = empty
const StepDots = ({ current, total }) => (
  <div className="flex items-center justify-center gap-2" aria-label={`Step ${current + 1} of ${total}`}>
    {Array.from({ length: total }).map((_, i) => (
      <div
        key={i}
        className={[
          'rounded-full transition-all duration-300',
          i === current  ? 'w-6 h-2 bg-emerald-500'                    // active - pill
          : i < current  ? 'w-2 h-2 bg-emerald-300 dark:bg-emerald-700' // done - filled
          :                'w-2 h-2 bg-slate-200 dark:bg-slate-600',     // upcoming - empty
        ].join(' ')}
        aria-hidden="true"
      />
    ))}
  </div>
);

// --- Step 1: Welcome + Budget -------------------------------------------------
const StepWelcome = ({ onNext, isLoading }) => {
  const { user, updateUser } = useAuth();
  const { toast } = useToast();
  const [budget, setBudget] = useState(user?.monthlyBudget?.toString() || '50000');
  const [error,  setError]  = useState('');

  const handleNext = async () => {
    const val = Number(budget);
    if (!budget || isNaN(val) || val < 1) {
      setError('Please enter a valid budget amount (minimum ₹1).');
      return;
    }
    setError('');

    try {
      const { data } = await axios.put('/api/auth/budget', { monthlyBudget: val });
      if (data.success) {
        // Patch AuthContext immediately so the Navbar shows the new budget
        // without needing a full page reload
        updateUser({ monthlyBudget: val });
        toast.success(`Monthly budget set to ₹${val.toLocaleString('en-IN')}!`);
        onNext();
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to save budget.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-3">
        <div className="w-16 h-16 rounded-2xl bg-emerald-500 flex items-center justify-center mx-auto shadow-glow-emerald">
          <Wallet size={30} className="text-white" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
          Welcome to TrackWise, {user?.name?.split(' ')[0]}! 🎉
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed max-w-sm mx-auto">
          Let's get your finances set up in 3 quick steps. First - what's your monthly spending goal?
        </p>
      </div>

      <div className="space-y-2">
        <label htmlFor="ob-budget" className="form-label">
          <span className="flex items-center gap-1.5">
            <Target size={11} />
            Monthly budget goal
          </span>
        </label>
        <div className="relative">
          <IndianRupee
            size={15}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
            aria-hidden="true"
          />
          <input
            id="ob-budget"
            type="number"
            value={budget}
            onChange={(e) => { setBudget(e.target.value); setError(''); }}
            placeholder="50000"
            min="1"
            className={`input-field pl-10 font-numeric text-lg ${error ? 'border-rose-400 focus:ring-rose-400' : ''}`}
          />
        </div>
        {error && <p className="text-xs text-rose-500 font-medium" role="alert">{error}</p>}
        <p className="text-xs text-slate-400 dark:text-slate-500">
          This drives the budget progress bar on your dashboard. You can change it anytime in Settings.
        </p>
      </div>

      <button onClick={handleNext} disabled={isLoading} className="btn-primary w-full py-3">
        {isLoading
          ? <Loader2 size={16} className="animate-spin" />
          : <><ArrowRight size={16} />Set my budget</>
        }
      </button>
    </div>
  );
};

// --- Step 2: First Income -----------------------------------------------------
const StepIncome = ({ onNext, onBack, isLoading }) => {
  const { toast } = useToast();
  const [form,  setForm]  = useState({ title: 'Monthly Salary', amount: '', category: 'Salary' });
  const [error, setError] = useState('');

  // Only showing income-relevant categories here - no point listing Housing etc.
  const INCOME_CATEGORIES = ['Salary', 'Housing', 'Other'];

  const handleNext = async () => {
    if (!form.amount || Number(form.amount) < 1) {
      setError('Please enter a valid income amount.');
      return;
    }
    if (!form.title.trim()) {
      setError('Please enter a title.');
      return;
    }
    setError('');

    try {
      await axios.post('/api/transactions', {
        title:    form.title.trim(),
        amount:   Number(form.amount),
        type:     'Income',
        category: form.category,
        date:     new Date().toISOString(),
      });
      toast.success('Income recorded!', `₹${Number(form.amount).toLocaleString('en-IN')} added.`);
      onNext();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to save income.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-3">
        <div className="w-16 h-16 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto">
          <TrendingUp size={30} className="text-emerald-500" />
        </div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
          Log your first income
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed max-w-sm mx-auto">
          Add a salary or any income source so TrackWise can calculate your savings rate.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label htmlFor="ob-income-title" className="form-label">Title</label>
          <input
            id="ob-income-title"
            type="text"
            value={form.title}
            onChange={(e) => setForm(p => ({ ...p, title: e.target.value }))}
            className="input-field"
            placeholder="e.g., Monthly Salary"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="ob-income-amount" className="form-label">Amount (₹)</label>
            <input
              id="ob-income-amount"
              type="number"
              value={form.amount}
              onChange={(e) => { setForm(p => ({ ...p, amount: e.target.value })); setError(''); }}
              className={`input-field font-numeric ${error ? 'border-rose-400' : ''}`}
              placeholder="75000"
              min="1"
            />
          </div>
          <div>
            <label htmlFor="ob-income-cat" className="form-label">Category</label>
            <select
              id="ob-income-cat"
              value={form.category}
              onChange={(e) => setForm(p => ({ ...p, category: e.target.value }))}
              className="select-field"
            >
              {INCOME_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {error && <p className="text-xs text-rose-500 font-medium" role="alert">{error}</p>}
      </div>

      <div className="flex gap-3">
        <button onClick={onBack} className="btn-secondary flex-shrink-0">
          <ArrowLeft size={15} />
        </button>
        <button onClick={handleNext} disabled={isLoading} className="btn-primary flex-1">
          {isLoading
            ? <Loader2 size={16} className="animate-spin" />
            : <><ArrowRight size={16} />Add income</>
          }
        </button>
      </div>
    </div>
  );
};

// --- Step 3: First Expense + Celebration screen -------------------------------
const StepExpense = ({ onComplete, onBack, isLoading }) => {
  const { toast } = useToast();
  const [form,  setForm]  = useState({ title: '', amount: '', category: 'Food & Groceries' });
  const [error, setError] = useState('');
  // Once the expense is saved, flip this to show the celebration screen
  const [done,  setDone]  = useState(false);

  const EXPENSE_CATEGORIES = [
    'Housing', 'Food & Groceries', 'Transport',
    'Utilities', 'Entertainment', 'Healthcare', 'Other',
  ];

  const handleFinish = async () => {
    if (!form.amount || Number(form.amount) < 1) {
      setError('Please enter a valid expense amount.');
      return;
    }
    if (!form.title.trim()) {
      setError('Please enter a title.');
      return;
    }
    setError('');

    try {
      await axios.post('/api/transactions', {
        title:    form.title.trim(),
        amount:   Number(form.amount),
        type:     'Expense',
        category: form.category,
        date:     new Date().toISOString(),
      });
      setDone(true);
      toast.success('Setup complete! 🎉', 'Your dashboard is ready.');
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to save expense.');
    }
  };

  // Celebration screen - shown after both transactions are saved
  if (done) {
    return (
      <div className="text-center space-y-6 py-4">
        <div className="w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto animate-pulse-soft">
          <CheckCircle2 size={40} className="text-emerald-500" />
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            You're all set! 🚀
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed max-w-xs mx-auto">
            Your dashboard is loaded with your first transactions. Explore your spending insights and keep tracking!
          </p>
        </div>
        {/* Quick feature highlights so the user knows what's waiting for them */}
        <div className="grid grid-cols-3 gap-3 text-xs text-slate-500 dark:text-slate-400">
          {['📊 Smart Insights', '🎤 Voice Entry', '📥 CSV Export'].map(f => (
            <div key={f} className="bg-slate-50 dark:bg-slate-700/50 rounded-xl p-3 font-medium">{f}</div>
          ))}
        </div>
        <button onClick={onComplete} className="btn-primary w-full py-3">
          <Sparkles size={16} />
          Go to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center space-y-3">
        <div className="w-16 h-16 rounded-2xl bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center mx-auto">
          <TrendingDown size={30} className="text-rose-500" />
        </div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
          Log your first expense
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed max-w-sm mx-auto">
          Almost done! Add any recent expense - groceries, rent, transport - whatever comes to mind.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label htmlFor="ob-exp-title" className="form-label">Title</label>
          <input
            id="ob-exp-title"
            type="text"
            value={form.title}
            onChange={(e) => setForm(p => ({ ...p, title: e.target.value }))}
            className="input-field"
            placeholder="e.g., Weekly groceries"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="ob-exp-amount" className="form-label">Amount (₹)</label>
            <input
              id="ob-exp-amount"
              type="number"
              value={form.amount}
              onChange={(e) => { setForm(p => ({ ...p, amount: e.target.value })); setError(''); }}
              className={`input-field font-numeric ${error ? 'border-rose-400' : ''}`}
              placeholder="850"
              min="1"
            />
          </div>
          <div>
            <label htmlFor="ob-exp-cat" className="form-label">Category</label>
            <select
              id="ob-exp-cat"
              value={form.category}
              onChange={(e) => setForm(p => ({ ...p, category: e.target.value }))}
              className="select-field"
            >
              {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {error && <p className="text-xs text-rose-500 font-medium" role="alert">{error}</p>}
      </div>

      <div className="flex gap-3">
        <button onClick={onBack} className="btn-secondary flex-shrink-0">
          <ArrowLeft size={15} />
        </button>
        <button onClick={handleFinish} disabled={isLoading} className="btn-primary flex-1">
          {isLoading
            ? <Loader2 size={16} className="animate-spin" />
            : <><CheckCircle2 size={16} />Finish setup</>
          }
        </button>
      </div>
    </div>
  );
};

// --- Onboarding Modal Shell ---------------------------------------------------
/**
 * Outer modal: backdrop, card, step dots, skip link.
 * createPortal is used to mount directly to <body> so the modal always
 * covers the full viewport regardless of any overflow:hidden ancestors.
 */
const OnboardingModal = ({ onComplete }) => {
  const [step]      = useState(0);
  // TODO: wire this up if we add any global loading state across steps
  const [isLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  const TOTAL_STEPS = 3;

  const handleSkip = () => {
    localStorage.setItem(ONBOARDING_KEY, 'true');
    onComplete?.();
  };

  const handleComplete = () => {
    localStorage.setItem(ONBOARDING_KEY, 'true');
    onComplete?.();
  };

  const steps = [
    <StepWelcome key={0} onNext={() => setCurrentStep(1)} isLoading={isLoading} />,
    <StepIncome  key={1} onNext={() => setCurrentStep(2)} onBack={() => setCurrentStep(0)} isLoading={isLoading} />,
    <StepExpense key={2} onComplete={handleComplete}      onBack={() => setCurrentStep(1)} isLoading={isLoading} />,
  ];

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      aria-modal="true"
      role="dialog"
      aria-label="Onboarding wizard"
    >
      {/* Dark backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/60 dark:bg-slate-950/70 backdrop-blur-sm"
        aria-hidden="true"
      />

      {/* Modal card */}
      <div className="relative w-full max-w-md bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-slide-down">

        {/* Thin emerald accent bar at the top */}
        <div className="h-1 bg-gradient-to-r from-emerald-400 via-emerald-500 to-teal-400" aria-hidden="true" />

        {/* Skip button - shown throughout so the user never feels trapped */}
        <button
          onClick={handleSkip}
          className="absolute top-4 right-4 btn-ghost p-1.5 text-slate-400"
          aria-label="Skip onboarding setup"
          title="Skip setup"
        >
          <X size={16} />
        </button>

        <div className="px-6 pt-6 pb-3">
          {steps[currentStep]}
        </div>

        <div className="px-6 pt-3 pb-5 flex flex-col items-center gap-3">
          <StepDots current={currentStep} total={TOTAL_STEPS} />
          {/* Hide the skip text link on the last step since it has its own completion button */}
          {currentStep < 2 && (
            <button
              onClick={handleSkip}
              className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-400 transition-colors"
            >
              Skip setup - I'll explore on my own
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

// --- useOnboarding Hook -------------------------------------------------------
/**
 * Decides whether to show the wizard based on the localStorage flag.
 * Returns shouldShow, markComplete, and the OnboardingModal component.
 *
 * Logic:
 *   - Read 'trackwise_onboarded' from localStorage on every login
 *   - If it's missing AND we have a logged-in user → show the wizard
 *   - After completion or skip → write the flag so it never shows again
 */
export const useOnboarding = () => {
  const { user } = useAuth();
  const [shouldShow, setShouldShow] = useState(false);

  useEffect(() => {
    if (!user) return;
    const done = localStorage.getItem(ONBOARDING_KEY);
    if (!done) setShouldShow(true);
  }, [user]);

  const markComplete = () => {
    localStorage.setItem(ONBOARDING_KEY, 'true');
    setShouldShow(false);
  };

  return { shouldShow, markComplete, OnboardingModal };
};

export { OnboardingModal };
export default OnboardingModal;