/**
 * components/TransactionTable.jsx
 *
 * Paginated, filterable transaction list with inline edit and delete.
 *
 * Features:
 *   - Search with title autocomplete (GET /api/transactions/titles?q=)
 *   - Type and category filter dropdowns
 *   - Recurring/Auto-generated badges on rows
 *   - Edit modal (pre-fills form → PUT /api/transactions/:id)
 *   - Delete confirmation modal (no window.confirm - uses a proper portal dialog)
 *   - CSV export (GET /api/transactions/export → blob download)
 *   - Custom dropdown components replacing native <select> tags for consistent theming
 *
 * Props:
 *   refreshTrigger {number} - parent increments this to force a re-fetch (e.g. after adding a transaction)
 *   from           {string} - YYYY-MM-DD date range start (optional, passed from HistoryPage)
 *   to             {string} - YYYY-MM-DD date range end   (optional)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import {
  Search, Filter, Download, Trash2, Edit3,
  ChevronLeft, ChevronRight, Loader2, FileText,
  TrendingUp, TrendingDown, X, Check, Repeat,
  RefreshCw, AlertTriangle, ChevronDown
} from 'lucide-react';
import { useToast } from '../context/ToastContext';

// --- Constants ----------------------------------------------------------------
const CATEGORIES = [
  'Housing', 'Food & Groceries', 'Transport', 'Utilities',
  'Entertainment', 'Healthcare', 'Salary', 'Other',
];
const PAGE_LIMIT = 10;

// --- Custom Select ------------------------------------------------------------
// Same reason as in TransactionForm - native <select> can't be styled to match
// the design system across browsers, so using a custom dropdown instead
const CustomSelect = ({ value, onChange, options, placeholder, disabled, error, icon: Icon, className = '' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target))
        setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = options.find(o => o.value === value);
  const displayText    = selectedOption ? selectedOption.label : placeholder;

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        // Removed hardcoded background so it inherits .input-field dark mode styles
        className={`w-full flex items-center justify-between input-field text-left ${
          error    ? 'border-rose-400 focus:ring-rose-400'   : ''
        } ${disabled ? 'opacity-50 cursor-not-allowed'       : ''
        } ${Icon    ? 'pl-9'                                  : ''}`}
      >
        {Icon && <Icon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />}
        <span className={`block truncate ${value !== undefined && value !== '' ? 'text-slate-800 dark:text-slate-200' : 'text-slate-500 dark:text-slate-400'}`}>
          {displayText}
        </span>
        <ChevronDown size={16} className={`text-slate-400 transition-transform duration-200 flex-shrink-0 ml-2 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && !disabled && (
        <div className="absolute z-50 w-full min-w-max mt-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl max-h-60 overflow-y-auto animate-slide-down py-1.5">
          {options.length === 0 ? (
            <div className="px-4 py-3 text-sm text-slate-500 text-center">No options</div>
          ) : (
            options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setIsOpen(false); }}
                className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between whitespace-nowrap ${
                  value === opt.value
                    ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'
                }`}
              >
                {opt.label}
                {value === opt.value && <Check size={14} className="text-emerald-500 ml-3" />}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};

// --- Skeleton row -------------------------------------------------------------
// Shown while transactions are loading - widths approximate real cell content
const SkeletonRow = () => (
  <tr>
    {[100,160,110,80,90,70,50].map((w, i) => (
      <td key={i} className="px-4 py-3">
        <div className="skeleton h-4 rounded" style={{ width: w }} />
      </td>
    ))}
  </tr>
);

// --- Empty state --------------------------------------------------------------
const EmptyState = ({ hasFilters, onClear }) => (
  <tr><td colSpan={7} className="px-4 py-16 text-center">
    <div className="flex flex-col items-center gap-3">
      <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
        <FileText size={24} className="text-slate-400 dark:text-slate-500" />
      </div>
      <div>
        <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">
          {hasFilters ? 'No transactions match your filters' : 'No transactions yet'}
        </p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
          {hasFilters ? 'Try adjusting your search or filter criteria.' : 'Add your first transaction using the form.'}
        </p>
      </div>
      {hasFilters && (
        <button onClick={onClear} className="btn-secondary text-xs py-1.5 px-3">
          <X size={12} />Clear filters
        </button>
      )}
    </div>
  </td></tr>
);

// --- Type badge ---------------------------------------------------------------
const TypeBadge = ({ type }) => type === 'Income'
  ? <span className="badge-income"><TrendingUp size={11} />Income</span>
  : <span className="badge-expense"><TrendingDown size={11} />Expense</span>;

// --- Delete confirmation modal ------------------------------------------------
// Using a proper dialog instead of window.confirm - looks nicer and matches the design
const DeleteConfirmModal = ({ title, onConfirm, onCancel }) =>
  createPortal(
    <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4"
         role="alertdialog" aria-modal="true" aria-labelledby="del-title">
      <div className="absolute inset-0 bg-slate-900/50 dark:bg-slate-950/60 backdrop-blur-sm"
           onClick={onCancel} aria-hidden="true" />
      <div className="relative w-full max-w-sm bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 p-6 animate-slide-down">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center flex-shrink-0">
            <AlertTriangle size={18} className="text-rose-500" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 id="del-title" className="text-base font-bold text-slate-900 dark:text-slate-100">Delete transaction?</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 truncate">
              <span className="font-semibold text-slate-700 dark:text-slate-300">"{title}"</span>
              {' '}will be permanently removed.
            </p>
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={onCancel} className="btn-secondary flex-1 py-2.5">Cancel</button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 active:scale-95 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-200"
          >
            <Trash2 size={14} />Delete
          </button>
        </div>
      </div>
    </div>,
    document.body
  );

// --- Edit transaction modal ---------------------------------------------------
// Pre-fills all fields from the selected transaction row.
// Only sends changed fields to the backend via PUT - the schema handles partial updates.
const EditModal = ({ tx, onSave, onClose }) => {
  const { toast } = useToast();
  const [form, setForm] = useState({
    title:    tx.title    || '',
    amount:   tx.amount?.toString() || '',
    type:     tx.type     || 'Expense',
    category: tx.category || 'Food & Groceries',
    date:     tx.date ? new Date(tx.date).toISOString().split('T')[0] : '',
    notes:    tx.notes    || '',
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const validate = () => {
    const e = {};
    if (!form.title.trim() || form.title.trim().length < 2) e.title  = 'Title must be at least 2 characters.';
    if (!form.amount || isNaN(Number(form.amount)) || Number(form.amount) < 1) e.amount = 'Amount must be at least ₹1.';
    if (!form.date)  e.date   = 'Date is required.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const { data } = await axios.put(`/api/transactions/${tx._id}`, {
        title:    form.title.trim(),
        amount:   Number(form.amount),
        type:     form.type,
        category: form.category,
        date:     form.date,
        notes:    form.notes.trim(),
      });
      if (data.success) {
        toast.success('Transaction updated.', 'Saved');
        onSave(data.data);
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to update transaction.', 'Error');
    } finally { setSaving(false); }
  };

  // Small helper to avoid repeating the same input boilerplate four times
  const field = (id, label, type, name, opts = {}) => (
    <div>
      <label htmlFor={id} className="form-label">{label}</label>
      <input
        id={id} type={type} name={name} value={form[name]}
        onChange={e => { setForm(p => ({ ...p, [name]: e.target.value })); setErrors(er => ({ ...er, [name]: '' })); }}
        className={`input-field ${opts.mono ? 'font-numeric' : ''} ${errors[name] ? 'border-rose-400 focus:ring-rose-400' : ''}`}
        {...opts}
      />
      {errors[name] && <p className="text-xs text-rose-500 mt-1.5 font-medium" role="alert">{errors[name]}</p>}
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4"
         role="dialog" aria-modal="true" aria-labelledby="edit-title">
      <div className="absolute inset-0 bg-slate-900/50 dark:bg-slate-950/60 backdrop-blur-sm"
           onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-lg bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 animate-slide-down">

        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <Edit3 size={16} className="text-emerald-500" aria-hidden="true" />
            <h2 id="edit-title" className="section-title">Edit Transaction</h2>
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5" aria-label="Close edit modal">
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Type toggle */}
          <div>
            <label className="form-label">Type</label>
            <div className="grid grid-cols-2 gap-2">
              {['Income','Expense'].map(t => (
                <button key={t} type="button"
                  onClick={() => setForm(p => ({ ...p, type: t }))}
                  className={[
                    'flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold border transition-all duration-200 focus:outline-none focus:ring-2',
                    form.type === t && t === 'Income'  ? 'bg-emerald-500 border-emerald-500 text-white focus:ring-emerald-400'
                    : form.type === t                   ? 'bg-rose-500 border-rose-500 text-white focus:ring-rose-400'
                    :                                    'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 focus:ring-slate-400',
                  ].join(' ')}
                  aria-pressed={form.type === t}
                >
                  {t === 'Income' ? <TrendingUp size={14}/> : <TrendingDown size={14}/>}{t}
                </button>
              ))}
            </div>
          </div>

          {field('em-title',  'Title',      'text',   'title',  { placeholder: 'Transaction title' })}
          {field('em-amount', 'Amount (₹)', 'number', 'amount', { mono: true, min: 1, placeholder: '0.00' })}

          <div className="grid grid-cols-2 gap-3 relative z-20">
            <div>
              <label className="form-label">Category</label>
              <CustomSelect
                value={form.category}
                onChange={val => setForm(p => ({ ...p, category: val }))}
                options={CATEGORIES.map(c => ({ label: c, value: c }))}
                placeholder="Select category…"
              />
            </div>
            <div>
              <label htmlFor="em-date" className="form-label">Date</label>
              <input
                id="em-date" type="date" value={form.date}
                onChange={e => { setForm(p => ({ ...p, date: e.target.value })); setErrors(er => ({ ...er, date: '' })); }}
                max={new Date().toISOString().split('T')[0]}
                className={`input-field ${errors.date ? 'border-rose-400' : ''}`}
              />
              {errors.date && <p className="text-xs text-rose-500 mt-1 font-medium" role="alert">{errors.date}</p>}
            </div>
          </div>

          <div>
            <label htmlFor="em-notes" className="form-label">
              Notes <span className="normal-case font-normal text-slate-400">(optional)</span>
            </label>
            <textarea
              id="em-notes" value={form.notes} rows={2} maxLength={250}
              onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
              className="input-field resize-none" placeholder="Any extra details…"
            />
          </div>
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-slate-100 dark:border-slate-700">
          <button onClick={onClose}    className="btn-secondary flex-1 py-2.5">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary flex-1 py-2.5">
            {saving ? <><Loader2 size={14} className="animate-spin"/>Saving…</> : <><Check size={14}/>Save changes</>}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

// --- Autocomplete dropdown ----------------------------------------------------
// Shows title suggestions below the search input while the user types.
// Uses onMouseDown instead of onClick so it fires before the input's onBlur
// (which would hide the dropdown before the click registers).
const AutocompleteDropdown = ({ suggestions, onSelect }) => {
  if (!suggestions.length) return null;
  return (
    <ul
      className="absolute top-full left-0 right-0 mt-1 z-30 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-card-hover overflow-hidden animate-slide-down"
      role="listbox"
      aria-label="Title suggestions"
    >
      {suggestions.map((s, i) => (
        <li key={i}>
          <button
            type="button"
            onMouseDown={e => { e.preventDefault(); onSelect(s); }}
            className="w-full text-left px-4 py-2.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors duration-100"
            role="option"
          >
            {s}
          </button>
        </li>
      ))}
    </ul>
  );
};

// --- Main TransactionTable component -----------------------------------------
const TransactionTable = ({ refreshTrigger = 0, from = '', to = '' }) => {
  const { toast } = useToast();

  // Data
  const [transactions, setTransactions] = useState([]);
  const [totalCount,   setTotalCount]   = useState(0);
  const [totalPages,   setTotalPages]   = useState(1);
  const [isLoading,    setIsLoading]    = useState(true);

  // Filters + pagination
  const [searchInput,     setSearchInput]     = useState('');
  const [search,          setSearch]          = useState('');
  const [typeFilter,      setTypeFilter]      = useState('');
  const [categoryFilter,  setCategoryFilter]  = useState('');
  const [page,            setPage]            = useState(1);

  // Modal + action state
  const [editTarget,    setEditTarget]    = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deletingId,    setDeletingId]    = useState(null);
  const [isExporting,   setIsExporting]   = useState(false);

  // Autocomplete
  const [suggestions,     setSuggestions]     = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestTimer   = useRef(null);
  const searchInputRef = useRef(null);

  // -- Debounced search + autocomplete ----------------------------------------
  // Two separate timers: one for the actual search (400ms) and one for
  // autocomplete suggestions (300ms) - suggestions should feel snappier
  const debounceTimer = useRef(null);
  const handleSearchInput = (val) => {
    setSearchInput(val);
    clearTimeout(debounceTimer.current);
    clearTimeout(suggestTimer.current);

    debounceTimer.current = setTimeout(() => {
      setSearch(val);
      setPage(1);
    }, 400);

    if (val.trim().length >= 1) {
      suggestTimer.current = setTimeout(async () => {
        try {
          const { data } = await axios.get(`/api/transactions/titles?q=${encodeURIComponent(val.trim())}`);
          if (data.success) { setSuggestions(data.data); setShowSuggestions(true); }
        } catch { /* autocomplete errors shouldn't show an error state - just silently fail */ }
      }, 300);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  };

  const handleSuggestionSelect = (title) => {
    setSearchInput(title);
    setSearch(title);
    setPage(1);
    setSuggestions([]);
    setShowSuggestions(false);
  };

  // -- Fetch transactions ------------------------------------------------------
  const fetchTransactions = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        page,
        limit: PAGE_LIMIT,
        ...(search         && { search }),
        ...(typeFilter     && { type: typeFilter }),
        ...(categoryFilter && { category: categoryFilter }),
        ...(from           && { from }),
        ...(to             && { to }),
      });

      const { data } = await axios.get(`/api/transactions?${params.toString()}`);
      if (data.success) {
        setTransactions(data.data);
        setTotalCount(data.totalCount);
        setTotalPages(data.totalPages);
      }
    } catch (err) {
      console.error('Failed to fetch transactions:', err);
    } finally {
      setIsLoading(false);
    }
  }, [page, search, typeFilter, categoryFilter, refreshTrigger, from, to]);

  useEffect(() => { fetchTransactions(); }, [fetchTransactions]);

  // Reset to page 1 when filters change - otherwise the user could be on page 5
  // of a filtered set that only has 1 page
  useEffect(() => { setPage(1); }, [typeFilter, categoryFilter, from, to]);

  // -- Delete flow ------------------------------------------------------------
  const requestDelete = (tx) => setConfirmDelete({ _id: tx._id, title: tx.title });

  const confirmDeleteAction = async () => {
    if (!confirmDelete) return;
    setDeletingId(confirmDelete._id);
    setConfirmDelete(null);
    try {
      const { data } = await axios.delete(`/api/transactions/${confirmDelete._id}`);
      if (data.success) {
        // Remove from local state immediately instead of re-fetching the whole page
        setTransactions(prev => prev.filter(t => t._id !== confirmDelete._id));
        setTotalCount(prev => prev - 1);
        toast.success('Transaction deleted.', 'Deleted');
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to delete transaction.', 'Delete Failed');
    } finally { setDeletingId(null); }
  };

  // -- Edit save --------------------------------------------------------------
  // Optimistic row update - replace the old object in local state immediately
  // so the table updates without a round trip
  const handleEditSave = (updatedTx) => {
    setTransactions(prev => prev.map(t => t._id === updatedTx._id ? updatedTx : t));
    setEditTarget(null);
  };

  // -- CSV Export -------------------------------------------------------------
  // Fetches the CSV as a blob, creates a temporary object URL, clicks it
  // programmatically, then revokes the URL to free memory
  const handleCSVExport = async () => {
    setIsExporting(true);
    try {
      const response = await axios.get('/api/transactions/export', { responseType: 'blob' });
      const url  = window.URL.createObjectURL(new Blob([response.data], { type: 'text/csv;charset=utf-8;' }));
      const link = document.createElement('a');
      link.href  = url;
      link.setAttribute('download', `trackwise_report_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
      window.URL.revokeObjectURL(url);
      toast.success('Report downloaded successfully!', 'CSV Export');
    } catch (err) {
      toast.error(err?.response?.data?.message || 'No transactions to export, or export failed.', 'Export Failed');
    } finally { setIsExporting(false); }
  };

  const clearFilters = () => {
    setSearchInput(''); setSearch('');
    setTypeFilter(''); setCategoryFilter('');
    setSuggestions([]); setShowSuggestions(false);
    setPage(1);
  };

  const hasFilters = !!(search || typeFilter || categoryFilter || from || to);

  const formatDate = (d) =>
    new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <section aria-label="Transaction history">

      {/* Modals - rendered via createPortal in their own components above */}
      {editTarget    && <EditModal tx={editTarget} onSave={handleEditSave} onClose={() => setEditTarget(null)} />}
      {confirmDelete && (
        <DeleteConfirmModal
          title={confirmDelete.title}
          onConfirm={confirmDeleteAction}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {/* -- Controls row ---------------------------------------------------- */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3 mb-5">

        {/* Search input with autocomplete */}
        <div className="relative flex-1 min-w-[200px] z-20">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" aria-hidden="true" />
          <input
            ref={searchInputRef}
            type="search"
            placeholder="Search transactions…"
            value={searchInput}
            onChange={e => handleSearchInput(e.target.value)}
            onFocus={() => suggestions.length && setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            className="input-field pl-9 pr-4 w-full"
            aria-label="Search transactions by title"
            aria-autocomplete="list"
            aria-expanded={showSuggestions}
          />
          {showSuggestions && (
            <AutocompleteDropdown
              suggestions={suggestions}
              onSelect={handleSuggestionSelect}
            />
          )}
        </div>

        {/* Filter dropdowns + action buttons */}
        <div className="flex flex-wrap items-center gap-3 flex-shrink-0 relative z-10">
          <CustomSelect
            value={typeFilter}
            onChange={val => setTypeFilter(val)}
            options={[
              { label: 'All Types',  value: '' },
              { label: 'Income',     value: 'Income' },
              { label: 'Expense',    value: 'Expense' },
            ]}
            placeholder="All Types"
            icon={Filter}
            className="flex-1 sm:flex-initial w-full sm:w-36"
          />
          <CustomSelect
            value={categoryFilter}
            onChange={val => setCategoryFilter(val)}
            options={[
              { label: 'All Categories', value: '' },
              ...CATEGORIES.map(c => ({ label: c, value: c })),
            ]}
            placeholder="All Categories"
            className="flex-1 sm:flex-initial w-full sm:w-48"
          />

          {/* Clear filters - only shown when at least one filter is active */}
          {hasFilters && (
            <button onClick={clearFilters} className="btn-ghost p-2 flex-shrink-0" title="Clear all filters" aria-label="Clear filters">
              <X size={15} />
            </button>
          )}

          <button onClick={fetchTransactions} disabled={isLoading} className="btn-ghost p-2 flex-shrink-0" aria-label="Refresh list">
            <RefreshCw size={15} className={isLoading ? 'animate-spin text-emerald-500' : 'text-slate-400'} />
          </button>

          <button onClick={handleCSVExport} disabled={isExporting} className="btn-secondary whitespace-nowrap flex-shrink-0" aria-label="Download transactions as CSV">
            {isExporting ? <Loader2 size={14} className="animate-spin"/> : <Download size={14}/>}
            {isExporting ? 'Exporting…' : 'Download CSV'}
          </button>
        </div>
      </div>

      {/* Results count */}
      {!isLoading && totalCount > 0 && (
        <p className="text-xs text-slate-400 dark:text-slate-500 mb-3 font-medium">
          Showing{' '}
          <span className="text-slate-700 dark:text-slate-300 font-semibold">
            {(page - 1) * PAGE_LIMIT + 1}–{Math.min(page * PAGE_LIMIT, totalCount)}
          </span>
          {' '}of <span className="text-slate-700 dark:text-slate-300 font-semibold">{totalCount}</span> transactions
          {hasFilters && <span className="text-emerald-500 dark:text-emerald-400"> (filtered)</span>}
        </p>
      )}

      {/* -- Table ----------------------------------------------------------- */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
        <table className="w-full text-sm" role="table" aria-label="Transactions list">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-700">
              {['Date','Title','Category','Type','Amount','Actions'].map(col => (
                <th key={col} scope="col"
                  className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {col}
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50 bg-white dark:bg-slate-800/30">
            {isLoading && Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)}
            {!isLoading && transactions.length === 0 && <EmptyState hasFilters={hasFilters} onClear={clearFilters} />}

            {!isLoading && transactions.map(tx => (
              <tr key={tx._id} className="table-row-alt transition-colors duration-150 group" role="row">

                <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                  {formatDate(tx.date)}
                </td>

                <td className="px-4 py-3 max-w-[200px]">
                  <div className="flex items-center gap-1.5">
                    <p className="font-semibold text-slate-800 dark:text-slate-200 truncate" title={tx.title}>
                      {tx.title}
                    </p>
                    {/* Recurring template badge */}
                    {tx.isRecurring && (
                      <span title="Recurring template" aria-label="Recurring transaction">
                        <Repeat size={11} className="text-emerald-500 flex-shrink-0" />
                      </span>
                    )}
                    {/* Auto-generated copy badge */}
                    {tx.isGeneratedCopy && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full flex-shrink-0">
                        AUTO
                      </span>
                    )}
                  </div>
                  {tx.notes && (
                    <p className="text-xs text-slate-400 dark:text-slate-500 truncate mt-0.5" title={tx.notes}>
                      {tx.notes}
                    </p>
                  )}
                </td>

                <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                  {tx.category}
                </td>

                <td className="px-4 py-3 whitespace-nowrap">
                  <TypeBadge type={tx.type} />
                </td>

                <td className="px-4 py-3 whitespace-nowrap">
                  <span className={`font-numeric font-semibold text-sm ${tx.type === 'Income' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                    {tx.type === 'Income' ? '+' : '−'}₹{tx.amount.toLocaleString('en-IN')}
                  </span>
                </td>

                <td className="px-4 py-3 whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setEditTarget(tx)}
                      className="inline-flex items-center justify-center p-2 rounded-lg
                                 text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400
                                 hover:bg-emerald-50 dark:hover:bg-emerald-900/20
                                 transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                      aria-label={`Edit transaction: ${tx.title}`}
                      title="Edit"
                    >
                      <Edit3 size={14} />
                    </button>
                    <button
                      onClick={() => requestDelete(tx)}
                      disabled={deletingId === tx._id}
                      className="btn-danger p-2 rounded-lg"
                      aria-label={`Delete transaction: ${tx.title}`}
                      title="Delete"
                    >
                      {deletingId === tx._id
                        ? <Loader2 size={14} className="animate-spin"/>
                        : <Trash2 size={14}/>
                      }
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* -- Pagination ------------------------------------------------------- */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1 || isLoading}
            className="btn-secondary py-2 px-3 disabled:opacity-40"
            aria-label="Previous page"
          >
            <ChevronLeft size={15}/>Prev
          </button>

          <div className="flex items-center gap-1.5">
            {Array.from({ length: Math.min(totalPages, 7) }).map((_, i) => {
              const pageNum = i + 1;
              return (
                <button
                  key={pageNum}
                  onClick={() => setPage(pageNum)}
                  disabled={isLoading}
                  className={[
                    'w-8 h-8 rounded-lg text-xs font-semibold transition-all duration-150',
                    pageNum === page
                      ? 'bg-emerald-500 text-white shadow-sm'
                      : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700',
                  ].join(' ')}
                  aria-current={pageNum === page ? 'page' : undefined}
                  aria-label={`Page ${pageNum}`}
                >
                  {pageNum}
                </button>
              );
            })}
            {totalPages > 7 && <span className="text-slate-400 text-xs px-1">…{totalPages}</span>}
          </div>

          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages || isLoading}
            className="btn-secondary py-2 px-3 disabled:opacity-40"
            aria-label="Next page"
          >
            Next<ChevronRight size={15}/>
          </button>
        </div>
      )}
    </section>
  );
};

export default TransactionTable;