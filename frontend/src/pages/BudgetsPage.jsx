/**
 * pages/BudgetsPage.jsx  (Phase C)
 *
 * Per-Category Budget Goals Page
 *
 * Features:
 * - Month/year selector to view any past or current month
 * - Header health strip: total allocated, total spent, over-budget count
 * - Budget cards grid: each shows category, limit, spent, remaining,
 * animated progress bar (green/amber/red thresholds), over-budget badge
 * - "Add / Edit Budget" modal — POST /api/budgets (upsert by category + month)
 * - Delete button per card — DELETE /api/budgets/:id
 * - "Add budgets for all unset categories" quick-fill shortcut
 *
 * API consumed:
 * GET    /api/budgets?month=&year=      → list with actual spend merged in
 * GET    /api/budgets/summary?month=&year= → health stats for header
 * POST   /api/budgets                   → create or update (upsert)
 * DELETE /api/budgets/:id               → remove budget entry
 *
 * MERN Data Flow:
 * BudgetsPage mounts → GET /api/budgets → Budget.getBudgetsWithSpend()
 * aggregation (budgets + Transaction spend per category) → merged JSON
 * → React state → animated progress bars rendered
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import {
  Target, Plus, Trash2, Loader2, Edit3,
  ChevronLeft, ChevronRight, TrendingDown,
  AlertTriangle, CheckCircle2, X, ChevronDown
} from 'lucide-react';
import { useToast } from '../context/ToastContext';

// ── All categories from the Transaction model ──────────────────────────────────
const ALL_CATEGORIES = [
  'Housing', 'Food & Groceries', 'Transport', 'Utilities',
  'Entertainment', 'Healthcare', 'Salary', 'Other',
];

// ── Category accent colours ────────────────────────────────────────────────────
const CAT_COLOR = {
  'Housing':          '#6366f1',
  'Food & Groceries': '#f59e0b',
  'Transport':        '#3b82f6',
  'Utilities':        '#8b5cf6',
  'Entertainment':    '#ec4899',
  'Healthcare':       '#10b981',
  'Salary':           '#06b6d4',
  'Other':            '#94a3b8',
};

// ── Helpers ────────────────────────────────────────────────────────────────────
const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const fmtINR = (n) => `₹${(n||0).toLocaleString('en-IN', { minimumFractionDigits: 0 })}`;

// ── Custom Select Component ────────────────────────────────────────────────────
// Replaces the ugly native browser <select> with a sleek, theme-aware dropdown
const CustomSelect = ({ value, onChange, options, placeholder, disabled, error }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  // Close dropdown if clicked outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between input-field text-left ${
          error ? 'border-rose-400 focus:ring-rose-400' : ''
        } ${disabled ? 'opacity-50 cursor-not-allowed bg-slate-50 dark:bg-slate-900/50' : 'bg-white dark:bg-slate-900'}`}
      >
        <span className={`block truncate ${value ? 'text-slate-800 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500'}`}>
          {value || placeholder}
        </span>
        <ChevronDown 
          size={16} 
          className={`text-slate-400 transition-transform duration-200 flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} 
        />
      </button>

      {isOpen && !disabled && (
        <div className="absolute z-50 w-full mt-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl max-h-60 overflow-y-auto animate-slide-down py-1.5">
          {options.length === 0 ? (
            <div className="px-4 py-3 text-sm text-slate-500 text-center">No categories left</div>
          ) : (
            options.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  onChange(opt);
                  setIsOpen(false);
                }}
                className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between ${
                  value === opt
                    ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'
                }`}
              >
                {opt}
                {value === opt && <CheckCircle2 size={14} className="text-emerald-500" />}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};

// ── Header health pill ─────────────────────────────────────────────────────────
const HealthPill = ({ label, value, accent, isLoading }) => (
  <div className="px-3 sm:px-4 py-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-card text-center overflow-hidden">
    <p className="text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-0.5 truncate" title={label}>{label}</p>
    {isLoading
      ? <div className="skeleton h-6 w-16 mx-auto rounded" />
      : <p className={`font-numeric text-sm sm:text-base font-bold truncate ${accent}`} title={typeof value === 'string' ? value : ''}>{value}</p>
    }
  </div>
);

// ── Budget Card ───────────────────────────────────────────────────────────────
const BudgetCard = ({ budget, onEdit, onDelete, deleting }) => {
  const { category, limit, spent, remaining, percentage, isOverBudget } = budget;
  const color = CAT_COLOR[category] || '#94a3b8';
  const displayPct = Math.min(100, Math.max(0, percentage || 0));

  const barColor = displayPct >= 80 ? '#f43f5e'
    : displayPct >= 50 ? '#f59e0b'
    : '#10b981';

  return (
    <article className="card hover:scale-[1.01] transition-transform duration-200 relative group">
      
      {/* Delete button (Absolute Top Right) */}
      <button
        onClick={() => onDelete(budget._id)}
        disabled={deleting === budget._id}
        className="absolute top-3 right-3 z-20 btn-ghost p-1.5 opacity-0 group-hover:opacity-100
                   hover:opacity-100 focus:opacity-100 transition-opacity"
        aria-label={`Delete budget for ${category}`}
        title="Delete"
      >
        {deleting === budget._id
          ? <Loader2 size={13} className="animate-spin text-rose-400" />
          : <X size={13} className="text-slate-400 hover:text-rose-500 transition-colors" />
        }
      </button>

      {/* Category header */}
      <div className="flex items-start gap-3 mb-4">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
          style={{ backgroundColor: `${color}20` }}
          aria-hidden="true"
        >
          <Target size={16} style={{ color }} />
        </div>
        <div className="min-w-0 pr-6 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{category}</h3>
            {/* INLINE OVER-BUDGET BADGE */}
            {isOverBudget && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-900/30 flex-shrink-0" title="This category has exceeded its limit">
                <AlertTriangle size={9} className="text-rose-500" />
                <span className="text-[9px] font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wider">Over budget</span>
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 dark:text-slate-500 truncate mt-0.5">
            {fmtINR(spent)} spent of {fmtINR(limit)}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div
        className="w-full h-2.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden mb-3"
        role="progressbar"
        aria-valuenow={displayPct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${category}: ${displayPct.toFixed(0)}% of budget used`}
      >
        <div
          className="h-full rounded-full progress-bar-fill"
          style={{ '--progress-width': `${displayPct}%`, backgroundColor: barColor }}
        />
      </div>

      {/* Stats row */}
      <div className="flex items-center justify-between text-xs">
        <span className={`font-numeric font-bold ${displayPct >= 80 ? 'text-rose-500' : displayPct >= 50 ? 'text-amber-500' : 'text-emerald-500'}`}>
          {displayPct.toFixed(1)}% used
        </span>
        <span className={`font-numeric font-semibold ${remaining < 0 ? 'text-rose-500' : 'text-slate-500 dark:text-slate-400'}`}>
          {remaining < 0 ? `${fmtINR(Math.abs(remaining))} over` : `${fmtINR(remaining)} left`}
        </span>
      </div>

      {/* Edit button */}
      <button
        onClick={() => onEdit(budget)}
        className="mt-4 w-full flex items-center justify-center gap-2 py-1.5 rounded-lg
                   text-xs font-semibold text-slate-500 dark:text-slate-400
                   bg-slate-50 dark:bg-slate-700/50
                   hover:bg-slate-100 dark:hover:bg-slate-700
                   hover:text-slate-700 dark:hover:text-slate-200
                   transition-all duration-150"
        aria-label={`Edit budget for ${category}`}
      >
        <Edit3 size={12} />Edit limit
      </button>
    </article>
  );
};

// ── Add / Edit Modal ──────────────────────────────────────────────────────────
const BudgetModal = ({ initial, month, year, usedCategories, onSave, onClose }) => {
  const { toast } = useToast();
  const isEdit = !!initial;

  const [category, setCategory] = useState(initial?.category || '');
  const [limit,    setLimit]    = useState(initial?.limit?.toString() || '');
  const [saving,   setSaving]   = useState(false);
  const [err,      setErr]      = useState({});

  // Available categories = all minus already-budgeted (unless editing)
  const available = isEdit
    ? ALL_CATEGORIES
    : ALL_CATEGORIES.filter(c => !usedCategories.includes(c));

  const validate = () => {
    const e = {};
    if (!category)                         e.category = 'Please select a category.';
    if (!limit || Number(limit) < 1)       e.limit    = 'Enter a valid limit (min ₹1).';
    setErr(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const { data } = await axios.post('/api/budgets', {
        category, limit: Number(limit), month, year,
      });
      if (data.success) {
        toast.success(`Budget for ${category} saved.`, 'Saved');
        onSave();
      }
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to save budget.', 'Error');
    } finally { setSaving(false); }
  };

  return (
    // Backdrop
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         role="dialog" aria-modal="true" aria-label={isEdit ? 'Edit budget' : 'Add budget'}>
      <div className="absolute inset-0 bg-slate-900/50 dark:bg-slate-950/60 backdrop-blur-sm"
           onClick={onClose} aria-hidden="true" />

      <div className="relative w-full max-w-sm bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 p-6 animate-slide-down">
        {/* Close */}
        <button onClick={onClose} className="absolute top-4 right-4 btn-ghost p-1.5" aria-label="Close modal">
          <X size={16} />
        </button>

        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-5">
          {isEdit ? `Edit: ${initial.category}` : 'Add Budget Limit'}
        </h2>

        <div className="space-y-4">
          {/* ✦ FIX: Replaced native select with CustomSelect */}
          <div className="relative z-20">
            <label className="form-label">Category</label>
            <CustomSelect
              value={category}
              onChange={(val) => { setCategory(val); setErr(er => ({ ...er, category: '' })); }}
              options={available}
              placeholder="Select category…"
              disabled={isEdit}
              error={err.category}
            />
            {err.category && <p className="text-xs text-rose-500 mt-1 font-medium" role="alert">{err.category}</p>}
          </div>

          {/* Limit */}
          <div className="relative z-10">
            <label htmlFor="bm-limit" className="form-label">Monthly limit (₹)</label>
            <input id="bm-limit" type="number" min="1" value={limit}
              onChange={e => { setLimit(e.target.value); setErr(er => ({ ...er, limit: '' })); }}
              className={`input-field font-numeric ${err.limit ? 'border-rose-400 focus:ring-rose-400' : ''}`}
              placeholder="e.g. 8000"
            />
            {err.limit && <p className="text-xs text-rose-500 mt-1 font-medium" role="alert">{err.limit}</p>}
          </div>

          {/* Month/year indicator */}
          <p className="text-xs text-slate-400 dark:text-slate-500 pt-1">
            This limit applies to <strong className="text-slate-600 dark:text-slate-300">{MONTH_NAMES[month - 1]} {year}</strong>.
          </p>
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="btn-secondary flex-1 py-2.5">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary flex-1 py-2.5">
            {saving ? <><Loader2 size={14} className="animate-spin"/>Saving…</> : <><CheckCircle2 size={14}/>{isEdit ? 'Update' : 'Add'} budget</>}
          </button>
        </div>
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
const BudgetsPage = () => {
  const { toast } = useToast();

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year,  setYear]  = useState(now.getFullYear());

  const [budgets,   setBudgets]   = useState([]);
  const [summary,   setSummary]   = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [deletingId, setDeletingId] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);

  // ── Fetch ────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [bdRes, sumRes] = await Promise.all([
        axios.get(`/api/budgets?month=${month}&year=${year}`),
        axios.get(`/api/budgets/summary?month=${month}&year=${year}`),
      ]);
      if (bdRes.data.success)  setBudgets(bdRes.data.data);
      if (sumRes.data.success) setSummary(sumRes.data.data);
    } catch (e) {
      toast.error('Failed to load budgets.', 'Error');
      console.error(e);
    } finally { setLoading(false); }
  }, [month, year]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Navigate month ───────────────────────────────────────────────────────
  const prevMonth = () => {
    if (month === 1) { setMonth(12); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    const nowM = now.getMonth() + 1, nowY = now.getFullYear();
    if (year > nowY || (year === nowY && month >= nowM)) return; // Don't go into future
    if (month === 12) { setMonth(1); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  };
  const isCurrentMonth = month === now.getMonth() + 1 && year === now.getFullYear();

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = async (id) => {
    setDeletingId(id);
    try {
      const { data } = await axios.delete(`/api/budgets/${id}`);
      if (data.success) {
        toast.success('Budget removed.', 'Deleted');
        setBudgets(prev => prev.filter(b => b._id !== id));
        fetchData(); // Re-fetch summary
      }
    } catch (e) { toast.error(e?.response?.data?.message || 'Failed to delete.', 'Error'); }
    finally { setDeletingId(null); }
  };

  // ── Open modal ────────────────────────────────────────────────────────────
  const openAdd  = () => { setEditTarget(null); setModalOpen(true); };
  const openEdit = (b) => { setEditTarget(b);   setModalOpen(true); };
  const onSave   = () => { setModalOpen(false); setEditTarget(null); fetchData(); };

  const usedCategories = budgets.map(b => b.category);
  const uncovered = ALL_CATEGORIES.filter(c => !usedCategories.includes(c)).length;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Add/Edit Modal */}
      {modalOpen && (
        <BudgetModal
          initial={editTarget}
          month={month} year={year}
          usedCategories={usedCategories}
          onSave={onSave}
          onClose={() => { setModalOpen(false); setEditTarget(null); }}
        />
      )}

      {/* ── Page header ──────────────────────────────────────────────── */}
      <header className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-900 dark:bg-slate-700 flex items-center justify-center shadow-md flex-shrink-0">
            <Target size={18} className="text-emerald-400" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">Budget Goals</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Set per-category spending limits and track progress.
            </p>
          </div>
        </div>

        <button onClick={openAdd} disabled={uncovered === 0} className="btn-primary flex-shrink-0 self-start sm:self-auto">
          <Plus size={16} />Add budget limit
        </button>
      </header>

      {/* ── Month navigator ───────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-5 card py-3 px-4">
        <button onClick={prevMonth} className="btn-ghost p-2" aria-label="Previous month">
          <ChevronLeft size={18} />
        </button>
        <div className="text-center">
          <p className="text-base font-bold text-slate-900 dark:text-slate-100">
            {MONTH_NAMES[month - 1]} {year}
          </p>
          {isCurrentMonth && (
            <p className="text-xs text-emerald-500 font-semibold">Current month</p>
          )}
        </div>
        <button onClick={nextMonth} disabled={isCurrentMonth} className="btn-ghost p-2 disabled:opacity-30" aria-label="Next month">
          <ChevronRight size={18} />
        </button>
      </div>

      {/* ── Health strip ─────────────────────────────────────────────── */}
      <section aria-label="Budget health summary" className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <HealthPill label="Total allocated"  value={fmtINR(summary?.totalAllocated)}  accent="text-slate-800 dark:text-slate-100" isLoading={loading} />
        <HealthPill label="Total spent"      value={fmtINR(summary?.totalSpent)}      accent="text-rose-600 dark:text-rose-400"   isLoading={loading} />
        <HealthPill label="Remaining"        value={fmtINR(summary?.totalRemaining)}  accent="text-emerald-600 dark:text-emerald-400" isLoading={loading} />
        <HealthPill label="Over budget"      value={`${summary?.overBudgetCount ?? 0} categories`} accent={summary?.overBudgetCount > 0 ? 'text-rose-500' : 'text-emerald-500'} isLoading={loading} />
      </section>

      {/* ── Budget cards grid ─────────────────────────────────────────── */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({length: 6}).map((_, i) => (
            <div key={i} className="card space-y-3 relative">
              <div className="skeleton h-9 w-9 rounded-xl" />
              <div className="skeleton h-4 w-2/3 rounded" />
              <div className="skeleton h-3 w-full rounded-full" />
              <div className="skeleton h-3 w-1/2 rounded" />
            </div>
          ))}
        </div>
      ) : budgets.length === 0 ? (
        // Empty state
        <section className="card text-center py-16 space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center mx-auto">
            <Target size={28} className="text-slate-400 dark:text-slate-500" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-700 dark:text-slate-300">No budget limits set</h2>
            <p className="text-sm text-slate-400 dark:text-slate-500 mt-1 max-w-xs mx-auto">
              Add spending limits for your categories to track how well you stay within budget.
            </p>
          </div>
          <button onClick={openAdd} className="btn-primary mx-auto">
            <Plus size={15} />Set your first budget
          </button>
        </section>
      ) : (
        <>
          {/* Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 group">
            {budgets.map(b => (
              <BudgetCard
                key={b._id}
                budget={b}
                onEdit={openEdit}
                onDelete={handleDelete}
                deleting={deletingId}
              />
            ))}
          </div>

          {/* Uncovered categories hint */}
          {uncovered > 0 && (
            <div className="mt-5 flex items-center gap-3 px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 rounded-xl animate-slide-down">
              <TrendingDown size={15} className="text-amber-500 flex-shrink-0" aria-hidden="true" />
              <p className="text-xs font-medium text-amber-700 dark:text-amber-400 flex-1">
                <strong>{uncovered} {uncovered === 1 ? 'category has' : 'categories have'}</strong> no budget limit set for this month.
              </p>
              <button onClick={openAdd} className="text-xs font-bold text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300 underline flex-shrink-0">
                Add limit
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
};

export default BudgetsPage;