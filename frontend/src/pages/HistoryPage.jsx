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

import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import {
  History, TrendingUp, TrendingDown, Activity,
  PlusCircle, X, ChevronRight, Calendar, Filter, ChevronLeft
} from 'lucide-react';
import TransactionTable from '../components/TransactionTable';
import TransactionForm  from '../components/TransactionForm';

// ── Custom Date Picker Component ───────────────────────────────────────────────
const CustomDatePicker = ({ value, onChange, min, max, error, className = '' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  // Parse current value safely (YYYY-MM-DD to local Date object)
  const parseDate = (dateStr) => {
    if (!dateStr) return new Date();
    const [y, m, d] = dateStr.split('-');
    return new Date(y, m - 1, d);
  };

  const [viewDate, setViewDate] = useState(parseDate(value));

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentMonth = viewDate.getMonth();
  const currentYear = viewDate.getFullYear();

  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const firstDay = new Date(currentYear, currentMonth, 1).getDay();

  const handlePrevMonth = (e) => { e.preventDefault(); setViewDate(new Date(currentYear, currentMonth - 1, 1)); };
  const handleNextMonth = (e) => { e.preventDefault(); setViewDate(new Date(currentYear, currentMonth + 1, 1)); };

  const handleSelectDate = (day) => {
    const yyyy = currentYear;
    const mm = String(currentMonth + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    onChange(`${yyyy}-${mm}-${dd}`);
    setIsOpen(false);
  };

  const isDateDisabled = (day) => {
    const checkDateObj = new Date(currentYear, currentMonth, day);
    if (max) {
      const [maxY, maxM, maxD] = max.split('-');
      const maxDateObj = new Date(maxY, maxM - 1, maxD);
      if (checkDateObj > maxDateObj) return true;
    }
    if (min) {
      const [minY, minM, minD] = min.split('-');
      const minDateObj = new Date(minY, minM - 1, minD);
      if (checkDateObj < minDateObj) return true;
    }
    return false;
  };

  const days = Array.from({ length: firstDay }, () => null).concat(
    Array.from({ length: daysInMonth }, (_, i) => i + 1)
  );

  const displayDate = value
    ? new Date(parseDate(value)).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : 'dd-mm-yyyy';

  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DAYS_OF_WEEK = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const [valY, valM, valD] = value ? value.split('-') : [];

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between input-field text-left ${
          error ? 'border-rose-400 focus:ring-rose-400' : ''
        }`}
      >
        <span className={`block truncate ${value ? 'text-slate-800 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500'}`}>
          {displayDate}
        </span>
        <Calendar size={16} className="text-slate-400 flex-shrink-0 ml-2" />
      </button>

      {isOpen && (
        <div className="absolute z-50 left-0 sm:right-0 sm:left-auto w-[280px] mt-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl p-4 animate-slide-down">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <button type="button" onClick={handlePrevMonth} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 transition-colors">
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-bold text-slate-800 dark:text-slate-100">
              {MONTH_NAMES[currentMonth]} {currentYear}
            </span>
            <button type="button" onClick={handleNextMonth} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 transition-colors">
              <ChevronRight size={16} />
            </button>
          </div>
          
          {/* Days of Week */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {DAYS_OF_WEEK.map(d => (
              <div key={d} className="text-center text-[10px] font-semibold text-slate-400 dark:text-slate-500 py-1">
                {d}
              </div>
            ))}
          </div>

          {/* Days Grid */}
          <div className="grid grid-cols-7 gap-1">
            {days.map((day, idx) => {
              if (!day) return <div key={`empty-${idx}`} />;
              
              const isSelected = value && Number(valY) === currentYear && Number(valM) === currentMonth + 1 && Number(valD) === day;
              const disabled = isDateDisabled(day);
              const isToday = new Date().getDate() === day && new Date().getMonth() === currentMonth && new Date().getFullYear() === currentYear;

              return (
                <button
                  key={day}
                  type="button"
                  disabled={disabled}
                  onClick={() => handleSelectDate(day)}
                  className={[
                    'h-8 w-full rounded-lg flex items-center justify-center text-xs transition-all duration-150',
                    isSelected ? 'bg-emerald-500 text-white font-bold shadow-sm scale-105' : 
                    disabled ? 'text-slate-300 dark:text-slate-600 cursor-not-allowed opacity-50' :
                    isToday ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 font-bold hover:bg-emerald-100 dark:hover:bg-emerald-900/50' :
                    'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 font-medium'
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
          <div className="flex items-center gap-2 flex-1 w-full sm:w-auto">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400 flex-shrink-0">From</label>
            <CustomDatePicker
              value={from}
              max={to || todayStr()}
              onChange={val => { setFrom(val); setRefreshKey(k => k + 1); }}
              className="flex-1 min-w-0"
            />
          </div>

          {/* To */}
          <div className="flex items-center gap-2 flex-1 w-full sm:w-auto">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400 flex-shrink-0">To</label>
            <CustomDatePicker
              value={to}
              min={from}
              max={todayStr()}
              onChange={val => { setTo(val); setRefreshKey(k => k + 1); }}
              className="flex-1 min-w-0"
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
    </>
  );
};

export default HistoryPage;