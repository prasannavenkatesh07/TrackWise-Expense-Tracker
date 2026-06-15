/**
 * pages/HistoryPage.jsx  (Phase D — date range filter added)
 *
 * Layout:
 * Page header + Add button
 * Summary pills (income / expense totals)
 * Date range filter row  ✦ Phase D
 * TransactionTable (search, autocomplete, filter, edit, delete, export, pagination)
 * Quick-Add slide panel
 *
 * Phase D additions:
 * ✦ `from` / `to` date pickers that pass down to TransactionTable as props.
 * TransactionTable appends them to GET /api/transactions?from=&to=
 * ✦ "This Month" and "Clear" shortcuts for the date range
 *
 * MERN Data Flow:
 * HistoryPage owns `from`/`to` state → passes to <TransactionTable />
 * TransactionTable builds URLSearchParams with from/to → Express controller
 * → Mongoose filter.date.$gte / $lte → MongoDB → JSON → React rows
 */

import { useState, useEffect } from 'react';
import axios from 'axios';
import {
  History, TrendingUp, TrendingDown, Activity,
  PlusCircle, X, ChevronRight, Calendar, Filter,
} from 'lucide-react';
import TransactionTable from '../components/TransactionTable';
import TransactionForm  from '../components/TransactionForm';

// ── Mini Stat Pill ─────────────────────────────────────────────────────────────
const StatPill = ({ label, value, icon: Icon, colorClass, isLoading }) => (
  <div className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-card flex-1 min-w-0">
    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${colorClass}`}>
      <Icon size={15} aria-hidden="true" />
    </div>
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 truncate">{label}</p>
      {isLoading
        ? <div className="skeleton h-5 w-20 mt-0.5 rounded" />
        : <p className="font-numeric text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{value}</p>
      }
    </div>
  </div>
);

// ── Quick-Add Slide Panel ──────────────────────────────────────────────────────
const QuickAddPanel = ({ isOpen, onClose, onSuccess }) => (
  <>
    {isOpen && (
      <div className="fixed inset-0 bg-slate-900/40 dark:bg-slate-900/60 backdrop-blur-sm z-40 transition-opacity duration-300"
           onClick={onClose} aria-hidden="true" />
    )}
    <aside
      className={[
        'fixed top-0 right-0 h-full w-full max-w-sm z-50',
        'bg-white dark:bg-slate-800 shadow-2xl border-l border-slate-200 dark:border-slate-700 flex flex-col',
        'transition-transform duration-300 ease-in-out',
        isOpen ? 'translate-x-0' : 'translate-x-full',
      ].join(' ')}
      aria-label="Quick add transaction panel"
      role="complementary"
    >
      <header className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex-shrink-0">
        <div className="flex items-center gap-2">
          <PlusCircle size={18} className="text-emerald-500" aria-hidden="true" />
          <h2 className="section-title">Add Transaction</h2>
        </div>
        <button onClick={onClose} className="btn-ghost p-2" aria-label="Close panel"><X size={18}/></button>
      </header>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <TransactionForm onSuccess={tx => { onSuccess(tx); onClose(); }} />
      </div>
      <footer className="px-6 py-4 border-t border-slate-100 dark:border-slate-700 flex-shrink-0">
        <p className="text-xs text-slate-400 dark:text-slate-500 text-center">
          Transaction will appear in the table immediately.
        </p>
      </footer>
    </aside>
  </>
);

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtINR = val => `₹${(val ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 0 })}`;
const todayStr = () => new Date().toISOString().split('T')[0];
const firstOfMonthStr = () => {
  const d = new Date(); d.setDate(1);
  return d.toISOString().split('T')[0];
};

// ── Main HistoryPage ───────────────────────────────────────────────────────────
const HistoryPage = () => {
  const [summary,        setSummary]        = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [refreshKey,     setRefreshKey]     = useState(0);
  const [isPanelOpen,    setIsPanelOpen]    = useState(false);

  // ✦ Phase D — date range state
  const [from, setFrom] = useState('');
  const [to,   setTo]   = useState('');

  // ── Fetch summary ────────────────────────────────────────────────────────
  useEffect(() => {
    const fetchSummary = async () => {
      setSummaryLoading(true);
      try {
        const params = new URLSearchParams();
        if (from) params.set('from', from);
        if (to)   params.set('to',   to);
        const { data } = await axios.get(`/api/transactions/summary?${params.toString()}`);
        if (data.success) setSummary(data.data);
      } catch (err) {
        console.error('History page summary fetch failed:', err);
      } finally {
        setSummaryLoading(false);
      }
    };
    fetchSummary();
  }, [refreshKey, from, to]);

  const handleTransactionSuccess = () => setRefreshKey(prev => prev + 1);

  // ✦ Phase D — Quick shortcuts for date range
  const setThisMonth = () => { setFrom(firstOfMonthStr()); setTo(todayStr()); };
  const clearRange   = () => { setFrom(''); setTo(''); };

  return (
    <>
      <QuickAddPanel isOpen={isPanelOpen} onClose={() => setIsPanelOpen(false)} onSuccess={handleTransactionSuccess} />

      {/* ── Page Header ──────────────────────────────────────────────── */}
      <header className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-900 dark:bg-slate-700 flex items-center justify-center shadow-md flex-shrink-0">
            <History size={18} className="text-emerald-400" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">Transaction History</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Search, filter, and export all your transactions.</p>
          </div>
        </div>
        <button onClick={() => setIsPanelOpen(true)}
          className="btn-primary flex-shrink-0 self-start sm:self-auto"
          aria-expanded={isPanelOpen} aria-controls="quick-add-panel">
          <PlusCircle size={16}/>Add Transaction<ChevronRight size={14} className="opacity-70"/>
        </button>
      </header>

      {/* ── Summary Pills ─────────────────────────────────────────────── */}
      <section aria-label="Period summary" className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <StatPill
          label="Total Transactions"
          // FIX: Swapped placeholder logic for real summary data
          value={summary?.totalTransactions ? summary.totalTransactions.toLocaleString('en-IN') : '0'}
          icon={Activity}
          colorClass="bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
          isLoading={summaryLoading}
        />
        <StatPill label="Total Income"   value={fmtINR(summary?.totalIncome)}  icon={TrendingUp}  colorClass="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400" isLoading={summaryLoading} />
        <StatPill label="Total Expenses" value={fmtINR(summary?.totalExpense)} icon={TrendingDown} colorClass="bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400"         isLoading={summaryLoading} />
      </section>

      {/* ── ✦ Phase D: Date Range Filter ─────────────────────────────── */}
      <section
        aria-label="Date range filter"
        className="card py-4 px-5 mb-5"
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          {/* Label */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <Calendar size={15} className="text-slate-400" aria-hidden="true" />
            <span className="text-sm font-semibold text-slate-600 dark:text-slate-400">Date range</span>
          </div>

          {/* From */}
          <div className="flex items-center gap-2 flex-1">
            <label htmlFor="hist-from" className="text-xs font-medium text-slate-500 dark:text-slate-400 flex-shrink-0">From</label>
            <input
              id="hist-from"
              type="date"
              value={from}
              max={to || todayStr()}
              onChange={e => { setFrom(e.target.value); setRefreshKey(k => k + 1); }}
              className="input-field py-2 text-xs flex-1 min-w-0"
            />
          </div>

          {/* To */}
          <div className="flex items-center gap-2 flex-1">
            <label htmlFor="hist-to" className="text-xs font-medium text-slate-500 dark:text-slate-400 flex-shrink-0">To</label>
            <input
              id="hist-to"
              type="date"
              value={to}
              min={from}
              max={todayStr()}
              onChange={e => { setTo(e.target.value); setRefreshKey(k => k + 1); }}
              className="input-field py-2 text-xs flex-1 min-w-0"
            />
          </div>

          {/* Shortcuts */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={setThisMonth}
              className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors px-2 py-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
              title="Set to current month"
            >
              This month
            </button>
            {(from || to) && (
              <button
                onClick={clearRange}
                className="btn-ghost p-1.5"
                title="Clear date range"
                aria-label="Clear date range"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Active filter indicator */}
        {(from || to) && (
          <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1.5">
            <Filter size={11} aria-hidden="true" />
            Showing {from ? `from ${from}` : ''}{from && to ? ' ' : ''}{to ? `to ${to}` : ''}
          </p>
        )}
      </section>

      {/* ── Transaction Table ─────────────────────────────────────────── */}
      <section className="page-section" aria-label="Transaction list">
        {/*
         * ✦ Phase D: `from` and `to` props passed here.
         * TransactionTable appends them to the GET /api/transactions query string.
         * The backend controller filters by date.$gte / $lte in MongoDB.
         */}
        <TransactionTable
          refreshTrigger={refreshKey}
          from={from}
          to={to}
        />
      </section>

      {/* ── Tip footer ───────────────────────────────────────────────── */}
      <footer className="mt-6 flex items-start gap-3 px-1">
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-2 flex-shrink-0" aria-hidden="true" />
        <p className="text-xs text-slate-400 dark:text-slate-500 leading-relaxed">
          <strong className="text-slate-500 dark:text-slate-400 font-semibold">Tip:</strong>{' '}
          Use the{' '}
          <span className="font-semibold text-slate-600 dark:text-slate-300">date range filter</span>{' '}
          above to scope your view, then hit{' '}
          <span className="font-semibold text-slate-600 dark:text-slate-300">Download CSV</span>{' '}
          to export only that filtered period.
        </p>
      </footer>
    </>
  );
};

export default HistoryPage;