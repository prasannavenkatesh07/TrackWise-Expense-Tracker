/**
 * pages/HistoryPage.jsx
 *
 * Full transaction history with date range filtering, summary pills,
 * and a slide-in quick-add panel.
 *
 * Layout:
 *   Page header + Add button
 *   Summary pills (transaction count, income total, expense total)
 *   Date range filter row (From / To pickers + "This Month" shortcut)
 *   TransactionTable (search, autocomplete, filters, edit, delete, CSV export, pagination)
 *   QuickAddPanel (slide-in from the right)
 *
 * The `from` and `to` state lives here and gets passed down to TransactionTable
 * as props. The table appends them to GET /api/transactions?from=&to=,
 * which the backend converts to a Mongoose date range filter.
 *
 * The same date range is also applied to the summary pills so the totals
 * reflect the filtered period, not all time.
 *
 * refreshKey is incremented after a transaction is added via the panel,
 * which triggers both the summary fetch and the table re-fetch.
 */

import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import {
  History, TrendingUp, TrendingDown, Activity,
  PlusCircle, X, ChevronRight, Calendar, Filter, ChevronLeft,
} from 'lucide-react';
import TransactionTable from '../components/TransactionTable';
import TransactionForm  from '../components/TransactionForm';

// Custom date picker - native inputs don't match the design system
// and behave inconsistently across browsers.
// Dates stored as YYYY-MM-DD strings (avoids timezone offset issues).
const CustomDatePicker = ({ value, onChange, min, max, error, className = '' }) => {
  const [isOpen,    setIsOpen]    = useState(false);
  const containerRef              = useRef(null);
  const parseDate   = (dateStr) => {
    if (!dateStr) return new Date();
    const [y, m, d] = dateStr.split('-');
    return new Date(y, m - 1, d); // local midnight - avoids UTC offset shifting the date
  };
  const [viewDate, setViewDate] = useState(parseDate(value));

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target))
        setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentMonth = viewDate.getMonth();
  const currentYear  = viewDate.getFullYear();
  const daysInMonth  = new Date(currentYear, currentMonth + 1, 0).getDate();
  const firstDay     = new Date(currentYear, currentMonth, 1).getDay();

  const handlePrevMonth = (e) => { e.preventDefault(); setViewDate(new Date(currentYear, currentMonth - 1, 1)); };
  const handleNextMonth = (e) => { e.preventDefault(); setViewDate(new Date(currentYear, currentMonth + 1, 1)); };

  const handleSelectDate = (day) => {
    const mm = String(currentMonth + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    onChange(`${currentYear}-${mm}-${dd}`);
    setIsOpen(false);
  };

  const isDateDisabled = (day) => {
    const checkDateObj = new Date(currentYear, currentMonth, day);
    if (max) {
      const [maxY, maxM, maxD] = max.split('-');
      if (checkDateObj > new Date(maxY, maxM - 1, maxD)) return true;
    }
    if (min) {
      const [minY, minM, minD] = min.split('-');
      if (checkDateObj < new Date(minY, minM - 1, minD)) return true;
    }
    return false;
  };

  const days = Array.from({ length: firstDay }, () => null)
    .concat(Array.from({ length: daysInMonth }, (_, i) => i + 1));

  const displayDate = value
    ? new Date(parseDate(value)).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : 'dd-mm-yyyy';

  const MONTH_NAMES  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DAYS_OF_WEEK = ['Su','Mo','Tu','We','Th','Fr','Sa'];
  const [valY, valM, valD] = value ? value.split('-') : [];

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between input-field text-left ${error ? 'border-rose-400 focus:ring-rose-400' : ''}`}
      >
        <span className={`block truncate ${value ? 'text-slate-800 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500'}`}>
          {displayDate}
        </span>
        <Calendar size={16} className="text-slate-400 flex-shrink-0 ml-2" />
      </button>

      {isOpen && (
        <div className="absolute z-50 left-0 sm:right-0 sm:left-auto w-[280px] mt-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl p-4 animate-slide-down">
          <div className="flex items-center justify-between mb-4">
            <button type="button" onClick={handlePrevMonth} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 transition-colors">
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-bold text-slate-800 dark:text-slate-100">
              {MONTH_NAMES[currentMonth]} {currentYear}
            </span>
            <button type="button" onClick={handleNextMonth} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 transition-colors">
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 mb-2">
            {DAYS_OF_WEEK.map(d => (
              <div key={d} className="text-center text-[10px] font-semibold text-slate-400 dark:text-slate-500 py-1">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {days.map((day, idx) => {
              if (!day) return <div key={`empty-${idx}`} />;
              const isSelected = value && Number(valY) === currentYear && Number(valM) === currentMonth + 1 && Number(valD) === day;
              const disabled   = isDateDisabled(day);
              const isToday    = new Date().getDate() === day && new Date().getMonth() === currentMonth && new Date().getFullYear() === currentYear;
              return (
                <button
                  key={day}
                  type="button"
                  disabled={disabled}
                  onClick={() => handleSelectDate(day)}
                  className={[
                    'h-8 w-full rounded-lg flex items-center justify-center text-xs transition-all duration-150',
                    isSelected ? 'bg-emerald-500 text-white font-bold shadow-sm scale-105'
                    : disabled  ? 'text-slate-300 dark:text-slate-600 cursor-not-allowed opacity-50'
                    : isToday   ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 font-bold hover:bg-emerald-100'
                    :             'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 font-medium',
                  ].join(' ')}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// Summary pill shown above the table
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

// Slide-in panel from the right - keeps the table visible so the user
// can see their new transaction appear without navigating away
const QuickAddPanel = ({ isOpen, onClose, onSuccess }) => (
  <>
    {isOpen && (
      <div
        className="fixed inset-0 z-30 bg-slate-900/30 dark:bg-slate-950/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
    )}
    <aside
      id="quick-add-panel"
      className={`fixed right-0 top-0 h-full w-full max-w-md z-40 bg-white dark:bg-slate-800
                  border-l border-slate-200 dark:border-slate-700 shadow-2xl
                  flex flex-col transform transition-transform duration-300 ease-in-out
                  ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      aria-label="Quick add transaction"
      aria-hidden={!isOpen}
    >
      <header className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex-shrink-0">
        <div className="flex items-center gap-2">
          <PlusCircle size={18} className="text-emerald-500" aria-hidden="true" />
          <h2 className="section-title">Add Transaction</h2>
        </div>
        <button onClick={onClose} className="btn-ghost p-2" aria-label="Close panel"><X size={18} /></button>
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

const fmtINR          = val => `₹${(val ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 0 })}`;
const todayStr        = ()  => new Date().toISOString().split('T')[0];
const firstOfMonthStr = ()  => { const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0]; };

const HistoryPage = () => {
  const [summary,        setSummary]        = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [refreshKey,     setRefreshKey]     = useState(0);
  const [isPanelOpen,    setIsPanelOpen]    = useState(false);

  // Empty strings = no filter (show all time)
  const [from, setFrom] = useState('');
  const [to,   setTo]   = useState('');

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
      } finally { setSummaryLoading(false); }
    };
    fetchSummary();
  }, [refreshKey, from, to]);

  const handleTransactionSuccess = () => setRefreshKey(prev => prev + 1);
  const setThisMonth = () => { setFrom(firstOfMonthStr()); setTo(todayStr()); };
  const clearRange   = () => { setFrom(''); setTo(''); };

  return (
    <>
      <QuickAddPanel isOpen={isPanelOpen} onClose={() => setIsPanelOpen(false)} onSuccess={handleTransactionSuccess} />

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
        <button
          onClick={() => setIsPanelOpen(true)}
          className="btn-primary flex-shrink-0 self-start sm:self-auto"
          aria-expanded={isPanelOpen}
          aria-controls="quick-add-panel"
        >
          <PlusCircle size={16} />Add Transaction<ChevronRight size={14} className="opacity-70" />
        </button>
      </header>

      {/* Summary pills reflect the active date filter */}
      <section aria-label="Period summary" className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <StatPill
          label="Total Transactions"
          value={summary?.totalTransactions ? summary.totalTransactions.toLocaleString('en-IN') : '0'}
          icon={Activity}
          colorClass="bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
          isLoading={summaryLoading}
        />
        <StatPill label="Total Income"   value={fmtINR(summary?.totalIncome)}  icon={TrendingUp}  colorClass="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400" isLoading={summaryLoading} />
        <StatPill label="Total Expenses" value={fmtINR(summary?.totalExpense)} icon={TrendingDown} colorClass="bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400"          isLoading={summaryLoading} />
      </section>

      {/* Date range filter */}
      <section aria-label="Date range filter" className="card py-4 px-5 mb-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="flex items-center gap-2 flex-shrink-0">
            <Calendar size={15} className="text-slate-400" aria-hidden="true" />
            <span className="text-sm font-semibold text-slate-600 dark:text-slate-400">Date range</span>
          </div>
          <div className="flex items-center gap-2 flex-1 w-full sm:w-auto">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400 flex-shrink-0">From</label>
            <CustomDatePicker value={from} max={to || todayStr()} onChange={val => { setFrom(val); setRefreshKey(k => k + 1); }} className="flex-1 min-w-0" />
          </div>
          <div className="flex items-center gap-2 flex-1 w-full sm:w-auto">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400 flex-shrink-0">To</label>
            <CustomDatePicker value={to} min={from} max={todayStr()} onChange={val => { setTo(val); setRefreshKey(k => k + 1); }} className="flex-1 min-w-0" />
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={setThisMonth} className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors px-2 py-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20">
              This month
            </button>
            {(from || to) && (
              <button onClick={clearRange} className="btn-ghost p-1.5" title="Clear date range" aria-label="Clear date range">
                <X size={14} />
              </button>
            )}
          </div>
        </div>
        {(from || to) && (
          <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1.5">
            <Filter size={11} aria-hidden="true" />
            Showing {from ? `from ${from}` : ''}{from && to ? ' ' : ''}{to ? `to ${to}` : ''}
          </p>
        )}
      </section>

      {/* from/to props flow into the table's URLSearchParams */}
      <section className="page-section" aria-label="Transaction list">
        <TransactionTable refreshTrigger={refreshKey} from={from} to={to} />
      </section>
    </>
  );
};

export default HistoryPage;