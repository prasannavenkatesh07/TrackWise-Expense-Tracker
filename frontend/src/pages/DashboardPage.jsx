/**
 * pages/DashboardPage.jsx
 *
 * Main landing page after login. Shows this month's financial snapshot:
 *   - Time-of-day greeting
 *   - Rule-based spending insights (SmartInsights)
 *   - Monthly budget progress bar
 *   - Income / Expense / Balance stat cards
 *   - Category breakdown doughnut chart (ExpenseChart)
 *   - Quick-add transaction form (TransactionForm)
 *
 * The onboarding wizard (Onboarding.jsx) auto-shows on first visit via
 * the useOnboarding() hook - it checks a localStorage flag.
 *
 * All data is scoped to the current calendar month by passing from/to
 * date strings to GET /api/transactions/summary. Insights always use
 * the current month too (the backend locks them to the current month internally).
 *
 * refreshKey is incremented whenever a transaction is added - this triggers
 * fetchSummary and fetchInsights to re-run via their useCallback deps.
 */

import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
  TrendingUp, TrendingDown, Wallet, Target,
  RefreshCw, Sparkles, PlusCircle, PieChart,
} from 'lucide-react';
import SmartInsights    from '../components/SmartInsights';
import ExpenseChart     from '../components/ExpenseChart';
import TransactionForm  from '../components/TransactionForm';
import { useAuth }      from '../context/AuthContext';
import { useOnboarding } from '../components/Onboarding';

// --- Greeting -----------------------------------------------------------------
// Simple time-of-day greeting - purely cosmetic but makes the dashboard feel warmer
const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
};

// --- Stat card ----------------------------------------------------------------
// Used for Income, Expense, and Balance - colour changes based on the `color` prop
const StatCard = ({ label, value, icon: Icon, color, isLoading, prefix = '' }) => {
  const colorMap = {
    emerald: { bg: 'bg-emerald-50 dark:bg-emerald-900/20', icon: 'text-emerald-500', value: 'text-emerald-600 dark:text-emerald-400', ring: 'ring-emerald-200 dark:ring-emerald-800' },
    rose:    { bg: 'bg-rose-50 dark:bg-rose-900/20',       icon: 'text-rose-500',    value: 'text-rose-600 dark:text-rose-400',       ring: 'ring-rose-200 dark:ring-rose-800'    },
    blue:    { bg: 'bg-blue-50 dark:bg-blue-900/20',       icon: 'text-blue-500',    value: 'text-blue-600 dark:text-blue-400',       ring: 'ring-blue-200 dark:ring-blue-800'    },
    slate:   { bg: 'bg-slate-100 dark:bg-slate-700/50',    icon: 'text-slate-500',   value: 'text-slate-700 dark:text-slate-300',     ring: 'ring-slate-200 dark:ring-slate-700'  },
  };
  const c = colorMap[color] || colorMap.slate;

  return (
    <article className="card hover:scale-[1.01] transition-transform duration-300">
      <div className="flex items-start justify-between gap-3">
        <div className={`w-10 h-10 rounded-xl ${c.bg} flex items-center justify-center flex-shrink-0 ring-1 ${c.ring}`}>
          <Icon size={18} className={c.icon} aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0 text-right">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{label}</p>
          {isLoading ? (
            <div className="skeleton h-7 w-28 mt-1.5 ml-auto rounded" />
          ) : (
            <p className={`stat-number mt-0.5 ${c.value}`}>
              {prefix}₹{Math.abs(value ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 0 })}
            </p>
          )}
        </div>
      </div>
    </article>
  );
};

// --- Budget progress bar ------------------------------------------------------
// Colour thresholds: green < 50%, amber 50–79%, red 80%+
// The bar uses the --progress-width CSS variable because Tailwind JIT can't
// generate arbitrary dynamic width classes at runtime
const BudgetProgressBar = ({ spent, budget, percent, isLoading }) => {
  const displayPercent = Math.min(100, Math.max(0, percent ?? 0));
  const barColor  = displayPercent >= 80 ? 'bg-rose-500'  : displayPercent >= 50 ? 'bg-amber-400'  : 'bg-emerald-500';
  const textColor = displayPercent >= 80 ? 'text-rose-600 dark:text-rose-400' : displayPercent >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400';

  return (
    <article className="card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Target size={16} className="text-slate-400 dark:text-slate-500" aria-hidden="true" />
          <h2 className="section-title">Monthly Budget</h2>
        </div>
        {isLoading ? (
          <div className="skeleton h-5 w-24 rounded" />
        ) : (
          <div className="flex items-baseline gap-1.5">
            <span className={`font-numeric text-sm font-bold ${textColor}`}>{displayPercent.toFixed(1)}%</span>
            <span className="text-xs text-slate-400 dark:text-slate-500">used</span>
          </div>
        )}
      </div>

      <div
        className="w-full h-3 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={displayPercent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`h-full rounded-full progress-bar-fill ${barColor}`}
          style={{ '--progress-width': `${displayPercent}%` }}
        />
      </div>

      {!isLoading && (
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-slate-500 dark:text-slate-400">₹{(spent ?? 0).toLocaleString('en-IN')} spent</span>
          <span className="text-xs text-slate-400 dark:text-slate-500">of ₹{(budget ?? 50000).toLocaleString('en-IN')} goal</span>
        </div>
      )}
    </article>
  );
};

// --- DashboardPage ------------------------------------------------------------
const DashboardPage = () => {
  const { user } = useAuth();
  const { shouldShow, markComplete, OnboardingModal } = useOnboarding();

  const [summary,        setSummary]        = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError,   setSummaryError]   = useState('');

  const [insights,        setInsights]        = useState([]);
  const [insightsLoading, setInsightsLoading] = useState(true);

  // Incrementing this triggers both fetches to re-run via their useCallback deps
  const [refreshKey, setRefreshKey] = useState(0);

  // --- Fetch summary (current month only) ----------------------------------
  // Scoping to the current month so the dashboard always shows
  // "this month's" numbers rather than all-time totals
  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError('');
    try {
      const d        = new Date();
      const firstDay = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
      const lastDay  = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0];

      const { data } = await axios.get(`/api/transactions/summary?from=${firstDay}&to=${lastDay}`);
      if (data.success) setSummary(data.data);
    } catch (err) {
      setSummaryError(err?.response?.data?.message || 'Failed to load summary data.');
    } finally {
      setSummaryLoading(false);
    }
  }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Fetch insights -------------------------------------------------------
  const fetchInsights = useCallback(async () => {
    setInsightsLoading(true);
    try {
      const { data } = await axios.get('/api/transactions/insights');
      if (data.success) setInsights(data.data.insights);
    } catch (err) {
      // Insights failing shouldn't break the whole dashboard - just hide the section
      console.error('Insights fetch error:', err);
      setInsights([]);
    } finally {
      setInsightsLoading(false);
    }
  }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchSummary();
    fetchInsights();
  }, [fetchSummary, fetchInsights]);
  
  //Listen for transactions logged by the global AI Chatbot
  useEffect(() => {
    const handleGlobalTransaction = () => setRefreshKey((prev) => prev + 1);
    
    window.addEventListener('transaction-added', handleGlobalTransaction);
    return () => window.removeEventListener('transaction-added', handleGlobalTransaction);
  }, []);

  // Called by TransactionForm after a successful save -
  // triggers a full data refresh so the stat cards and chart update immediately
  const handleTransactionSuccess = () => setRefreshKey((prev) => prev + 1);

  return (
    <>
      {/* Onboarding wizard - only shown once, controlled by localStorage flag */}
      {shouldShow && (
        <OnboardingModal
          onComplete={() => {
            markComplete();
            setRefreshKey((prev) => prev + 1); // refresh after wizard adds first transactions
          }}
        />
      )}

      {/* Page header */}
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
            {getGreeting()}, {user?.name?.split(' ')[0] ?? 'there'} 👋
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Here's your financial snapshot for this month.
          </p>
        </div>
        <button
          onClick={() => setRefreshKey((prev) => prev + 1)}
          disabled={summaryLoading}
          className="btn-ghost mt-1 flex-shrink-0"
          aria-label="Refresh dashboard data"
        >
          <RefreshCw size={16} className={summaryLoading ? 'animate-spin text-emerald-500' : 'text-slate-400'} />
        </button>
      </header>

      {summaryError && (
        <div className="alert-danger mb-4" role="alert">{summaryError}</div>
      )}

      {/* Insights section */}
      <section aria-labelledby="insights-heading" className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={15} className="text-emerald-500" aria-hidden="true" />
          <h2 id="insights-heading" className="section-title">Smart Insights</h2>
        </div>
        <SmartInsights insights={insights} isLoading={insightsLoading} />
      </section>

      {/* Budget progress bar */}
      <section aria-label="Monthly budget progress" className="mb-6">
        <BudgetProgressBar
          spent={summary?.totalExpense}
          budget={summary?.monthlyBudget}
          percent={summary?.budgetUsedPercent}
          isLoading={summaryLoading}
        />
      </section>

      {/* Stat cards row */}
      <section aria-label="Financial summary" className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatCard label="Total Income"   value={summary?.totalIncome}  icon={TrendingUp}  color="emerald" isLoading={summaryLoading} prefix="+" />
        <StatCard label="Total Expenses" value={summary?.totalExpense} icon={TrendingDown} color="rose"    isLoading={summaryLoading} prefix="−" />
        <StatCard
          label="Current Balance"
          value={summary?.balance}
          icon={Wallet}
          color={summary?.balance >= 0 ? 'blue' : 'rose'} // goes rose if spending exceeds income
          isLoading={summaryLoading}
        />
      </section>

      {/* Chart + Quick Add - chart takes 1/3 width, form takes 2/3 on large screens */}
      <section aria-label="Category breakdown and quick add" className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <article className="card lg:col-span-1">
          <header className="flex items-center gap-2 mb-5">
            <PieChart size={16} className="text-slate-400 dark:text-slate-500" aria-hidden="true" />
            <h2 className="section-title">Category Breakdown</h2>
          </header>
          <ExpenseChart breakdown={summary?.categoryBreakdown} isLoading={summaryLoading} />
        </article>

        <article className="card lg:col-span-2">
          <header className="flex items-center gap-2 mb-5">
            <PlusCircle size={16} className="text-slate-400 dark:text-slate-500" aria-hidden="true" />
            <h2 className="section-title">Quick Add Transaction</h2>
          </header>
          <TransactionForm onSuccess={handleTransactionSuccess} />
        </article>
      </section>
    </>
  );
};

export default DashboardPage;