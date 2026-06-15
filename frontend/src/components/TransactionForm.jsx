/**
 * components/TransactionForm.jsx
 *
 * Quick-Add Transaction Form — with 🎤 Voice Dictation + 🤖 AI Quick Add
 *
 * Features:
 *   - AI Quick Add: type or speak a natural language sentence to auto-fill
 *     the entire form via the Gemini NLP backend (/api/transactions/quick-add)
 *   - Web Speech API voice capture for both the AI Quick Add field AND
 *     the individual Title / Notes fields (graceful degradation if unsupported)
 *   - Controlled form inputs with client-side HTML5 + JS validation
 *   - Category and Type dropdowns matching the backend Mongoose enums
 *   - Optimistic UI: calls `onSuccess(newTransaction)` so DashboardPage
 *     can update summary state immediately without a page reload
 *
 * MERN Data Flow:
 *   AI Quick Add → axios.post('/api/transactions/quick-add', { text })
 *   → Gemini parses NLP → returns { title, amount, type, category, date }
 *   → auto-fills form states → user verifies → submit
 *   → axios.post('/api/transactions', payload) → onSuccess(doc)
 *
 * Voice (AI Quick Add) Flow:
 *   Mic click → SpeechRecognition.start() → user speaks full sentence
 *   → transcript → quickAddText state → user clicks "Auto-fill"
 *   → handleQuickAdd() → Gemini API → form fields populated
 *
 * Receipt Scanner (Sprint 3) Flow:
 *   Camera icon click → hidden <input type="file"> → user picks image
 *   → handleScanReceipt() → FormData POST to /api/transactions/scan-receipt
 *   → Gemini Vision OCR → returns { title, amount, type, category, date }
 *   → auto-fills form states → user verifies → submit
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useToast } from '../context/ToastContext';
import {
  Mic,
  MicOff,
  PlusCircle,
  Loader2,
  DollarSign,
  Tag,
  AlignLeft,
  Calendar,
  LayoutGrid,
  ArrowUpCircle,
  ArrowDownCircle,
  CheckCircle2,
  Repeat,
  Sparkles,
  Wand2,
  X,
  Camera,
} from 'lucide-react';

// ── Constants matching backend Transaction model enums ─────────────────────────
const CATEGORIES = [
  'Housing',
  'Food & Groceries',
  'Transport',
  'Utilities',
  'Entertainment',
  'Healthcare',
  'Salary',
  'Other',
];

const RECURRING_FREQUENCIES = ['Daily', 'Weekly', 'Monthly'];

// Factory — called fresh on each mount so the default date is never stale
// (fixes the "INITIAL_FORM computed once at module load" bug: if the app is left
//  open past midnight the default date would otherwise be yesterday)
const makeInitialForm = () => ({
  title: '',
  amount: '',
  type: 'Expense',
  category: 'Food & Groceries',
  date: new Date().toISOString().split('T')[0],
  notes: '',
  isRecurring: false,
  recurringFrequency: 'Monthly',
});

// ── Mic Button Sub-Component ───────────────────────────────────────────────────
/**
 * Renders an animated microphone button.
 * Shows a pulsing ring while actively recording.
 */
const MicButton = ({ isListening, onClick, targetField, activeField, size = 'sm' }) => {
  const isActiveForThisField = isListening && activeField === targetField;
  const dimension = size === 'md' ? 'w-10 h-10' : 'w-9 h-9';
  const iconSize = size === 'md' ? 16 : 15;

  return (
    <button
      type="button"
      onClick={onClick}
      title={isActiveForThisField ? 'Stop recording' : `Record ${targetField}`}
      aria-label={isActiveForThisField ? 'Stop voice recording' : `Start voice recording for ${targetField}`}
      className={[
        `relative flex-shrink-0 ${dimension} rounded-lg flex items-center justify-center`,
        'transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1',
        isActiveForThisField
          ? 'bg-rose-500 text-white focus:ring-rose-400 shadow-lg scale-105'
          : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600 focus:ring-slate-400',
      ].join(' ')}
    >
      {isActiveForThisField && (
        <span className="absolute inset-0 rounded-lg bg-rose-400 animate-ping opacity-30" />
      )}
      {isActiveForThisField ? (
        <MicOff size={iconSize} className="relative z-10" />
      ) : (
        <Mic size={iconSize} className="relative z-10" />
      )}
    </button>
  );
};

// ── Field Error Message ────────────────────────────────────────────────────────
const FieldError = ({ message }) =>
  message ? (
    <p className="text-xs text-rose-500 mt-1 font-medium" role="alert">
      {message}
    </p>
  ) : null;

// ── Success Toast ──────────────────────────────────────────────────────────────
const SuccessToast = ({ show }) =>
  show ? (
    <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-sm font-semibold animate-slide-down">
      <CheckCircle2 size={16} />
      Transaction added!
    </div>
  ) : null;

// ── Main TransactionForm Component ─────────────────────────────────────────────
const TransactionForm = ({ onSuccess }) => {
  const { toast } = useToast();

  // ── Form state ───────────────────────────────────────────────────────────
  const [form, setForm] = useState(makeInitialForm);
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  // ── AI Quick Add state ────────────────────────────────────────────────────
  const [quickAddText, setQuickAddText] = useState('');
  const [isQuickAddLoading, setIsQuickAddLoading] = useState(false);
  const [quickAddFilled, setQuickAddFilled] = useState(false); // shows confirmation banner

  // ── Receipt Scanner state ─────────────────────────────────────────────────
  const [isScanLoading, setIsScanLoading]   = useState(false);
  const receiptInputRef                     = useRef(null);  // hidden <input type="file">

  // ── Voice Dictation state — shared for ALL fields ────────────────────────
  // activeField can be: 'quickAdd' | 'title' | 'notes' | null
  const [isListening, setIsListening] = useState(false);
  const [activeField, setActiveField] = useState(null);
  const [speechSupported, setSpeechSupported] = useState(false);
  const recognitionRef = useRef(null);
  const activeFieldRef = useRef(activeField);

  // Keep ref in sync with state for the onresult closure
  useEffect(() => {
    activeFieldRef.current = activeField;
  }, [activeField]);

  // ── Check Web Speech API support + init recogniser on mount ─────────────
  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) return;

    setSpeechSupported(true);

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-IN';

    recognition.onend = () => {
      setIsListening(false);
      setActiveField(null);
    };

    recognition.onerror = (event) => {
      console.error('SpeechRecognition error:', event.error);
      setIsListening(false);
      setActiveField(null);
      if (event.error === 'not-allowed') {
        toast.error(
          'Microphone access denied. Please allow microphone permission in your browser settings.',
          'Mic Error',
        );
      }
    };

    recognitionRef.current = recognition;

    return () => recognitionRef.current?.abort();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Patch onresult to always read the current activeField via ref ────────
  useEffect(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((r) => r[0].transcript)
        .join(' ')
        .trim();

      const field = activeFieldRef.current;
      if (!field) return;

      if (field === 'quickAdd') {
        setQuickAddText(transcript);
      } else {
        setForm((prev) => ({ ...prev, [field]: transcript }));
        setErrors((prev) => ({ ...prev, [field]: '' }));
      }
    };
  }, []);

  // ── Toggle Dictation for any field ───────────────────────────────────────
  const toggleDictation = useCallback((fieldName) => {
    const recognition = recognitionRef.current;
    if (!recognition) return;

    if (isListening) {
      recognition.stop();
      setIsListening(false);
      setActiveField(null);
    } else {
      setActiveField(fieldName);
      setIsListening(true);
      try {
        recognition.start();
      } catch (e) {
        console.warn('Recognition start error:', e);
        setIsListening(false);
        setActiveField(null);
      }
    }
  }, [isListening]);

  // ── AI Quick Add handler ──────────────────────────────────────────────────
  /**
   * POSTs the natural language text to /api/transactions/quick-add.
   * On success, auto-fills all form fields and shows a verification toast.
   */
  const handleQuickAdd = async () => {
    // Stop any active dictation before sending
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      setActiveField(null);
    }

    if (!quickAddText.trim()) {
      toast.error('Please type or speak a sentence describing your transaction.', 'AI Quick Add');
      return;
    }

    setIsQuickAddLoading(true);
    setQuickAddFilled(false);

    try {
      const { data } = await axios.post('/api/transactions/quick-add', {
        text: quickAddText.trim(),
      });

      if (data.success && data.data) {
        const { title, amount, type, category, date } = data.data;

        // Auto-fill the form — only overwrite fields the AI returned confidently
        setForm((prev) => ({
          ...prev,
          ...(title    ? { title }    : {}),
          ...(amount   ? { amount: String(amount) } : {}),
          ...(type     ? { type }     : {}),
          ...(category ? { category } : {}),
          ...(date     ? { date }     : {}),
        }));

        // Clear any existing validation errors since fields are now populated
        setErrors({});

        // Show the inline confirmation banner
        setQuickAddFilled(true);

        // Fire a persistent toast prompting the user to verify
        toast.success(
          'Form auto-filled! Please review the fields below, then click "Add Transaction" to save.',
          '🤖 AI Quick Add',
        );
      }
    } catch (err) {
      const msg =
        err?.response?.data?.message ||
        'AI parsing failed. Try rephrasing your sentence or fill the form manually.';
      toast.error(msg, 'AI Quick Add Failed');
    } finally {
      setIsQuickAddLoading(false);
    }
  };

  // ── Receipt Scanner handler ──────────────────────────────────────────────
  /**
   * Called when the user picks an image from the hidden file input.
   * Builds a FormData payload (key: "receiptImage") and POSTs it to
   * /api/transactions/scan-receipt. On success, auto-fills all form fields
   * exactly like handleQuickAdd does, then shows the verification banner.
   */
  const handleScanReceipt = async (e) => {
    const file = e.target.files?.[0];
    // Reset the input so the same file can be re-selected if the user wants to retry
    e.target.value = '';

    if (!file) return;

    // Client-side size guard (5 MB matches the multer limit on the server)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be under 5 MB. Please choose a smaller file.', 'Receipt Scanner');
      return;
    }

    // Stop any active voice dictation before scanning
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      setActiveField(null);
    }

    setIsScanLoading(true);
    setQuickAddFilled(false);

    try {
      const formData = new FormData();
      formData.append('receiptImage', file);

      // axios automatically sets the correct multipart/form-data Content-Type
      // (including the boundary) when the body is a FormData instance.
      // The JWT auth header is already attached globally via axios defaults
      // set in AuthContext — no manual header needed here.
      const { data } = await axios.post('/api/transactions/scan-receipt', formData);

      if (data.success && data.data) {
        const { title, amount, type, category, date } = data.data;

        // Auto-fill only fields the AI returned confidently (same pattern as handleQuickAdd)
        setForm((prev) => ({
          ...prev,
          ...(title    ? { title }               : {}),
          ...(amount   ? { amount: String(amount) } : {}),
          ...(type     ? { type }                : {}),
          ...(category ? { category }            : {}),
          ...(date     ? { date }                : {}),
        }));

        setErrors({});
        setQuickAddFilled(true);

        // The backend sends a specific message when amount is missing (blurry receipt)
        const msg = data.message?.includes('manually')
          ? data.message
          : 'Receipt scanned! Please review the fields, then click "Add Transaction" to save.';

        toast.success(msg, '📸 Receipt Scanner');
      }
    } catch (err) {
      const msg =
        err?.response?.data?.message ||
        'Could not read this receipt. Try a clearer, well-lit photo.';
      toast.error(msg, 'Receipt Scanner Failed');
    } finally {
      setIsScanLoading(false);
    }
  };

  // Allow pressing Enter inside the quick-add input to trigger auto-fill
  const handleQuickAddKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleQuickAdd();
    }
  };

  // Clear the quick-add bar and its confirmation state
  const clearQuickAdd = () => {
    setQuickAddText('');
    setQuickAddFilled(false);
  };

  // ── Field change handler ──────────────────────────────────────────────────
  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: '' }));
  };

  // ── Client-side validation ────────────────────────────────────────────────
  const validate = () => {
    const newErrors = {};

    if (!form.title.trim()) {
      newErrors.title = 'Title is required.';
    } else if (form.title.trim().length < 2) {
      newErrors.title = 'Title must be at least 2 characters.';
    }

    if (!form.amount) {
      newErrors.amount = 'Amount is required.';
    } else if (isNaN(Number(form.amount)) || Number(form.amount) < 1) {
      newErrors.amount = 'Amount must be at least ₹1.';
    }

    if (!form.category) newErrors.category = 'Please select a category.';
    if (!form.date)     newErrors.date     = 'Date is required.';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // ── Form submission ───────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    }

    if (!validate()) return;

    setIsSubmitting(true);

    try {
      const { data } = await axios.post('/api/transactions', {
        title:              form.title.trim(),
        amount:             Number(form.amount),
        type:               form.type,
        category:           form.category,
        date:               form.date,
        notes:              form.notes.trim(),
        isRecurring:        form.isRecurring,
        recurringFrequency: form.isRecurring ? form.recurringFrequency : undefined,
      });

      if (data.success) {
        onSuccess?.(data.data);

        setShowSuccess(true);
        setTimeout(() => setShowSuccess(false), 2500);

        // Reset everything including the quick-add bar
        setForm(makeInitialForm());
        setErrors({});
        setQuickAddText('');
        setQuickAddFilled(false);
      }
    } catch (err) {
      toast.error(
        err?.response?.data?.message || 'Failed to save transaction. Please try again.',
        'Save Failed',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <article aria-label="Add new transaction form">
      <form onSubmit={handleSubmit} noValidate className="space-y-4">

        {/* ════════════════════════════════════════════════════════════════
            AI QUICK ADD SECTION
            ════════════════════════════════════════════════════════════════ */}
        <div className="rounded-2xl border border-indigo-200 dark:border-indigo-800/60 bg-gradient-to-br from-indigo-50 to-slate-50 dark:from-indigo-950/30 dark:to-slate-900/40 p-4 space-y-3">
          {/* Header row */}
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-indigo-100 dark:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 flex-shrink-0">
              <Sparkles size={14} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-indigo-700 dark:text-indigo-300 leading-tight">
                AI Quick Add
              </p>
              <p className="text-[10px] text-indigo-500 dark:text-indigo-400 leading-tight mt-0.5">
                Speak, type, or scan a receipt — AI fills the form instantly
              </p>
            </div>
            {/* Listening indicator badge */}
            {isListening && activeField === 'quickAdd' && (
              <span className="ml-auto flex items-center gap-1.5 text-[10px] font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-700/50 rounded-full px-2 py-0.5 animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" />
                Listening…
              </span>
            )}
          </div>

          {/* Input row */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                id="quickAddText"
                type="text"
                value={quickAddText}
                onChange={(e) => {
                  setQuickAddText(e.target.value);
                  if (quickAddFilled) setQuickAddFilled(false);
                }}
                onKeyDown={handleQuickAddKeyDown}
                placeholder={
                  isListening && activeField === 'quickAdd'
                    ? '🎤 Listening… speak your transaction'
                    : 'e.g. "Paid ₹1200 for groceries at Spar today"'
                }
                disabled={isQuickAddLoading}
                maxLength={500}
                aria-label="Describe your transaction in plain English"
                className={[
                  'input-field w-full pr-8 text-sm',
                  'bg-white dark:bg-slate-800',
                  'border-indigo-200 dark:border-indigo-700/60',
                  'focus:ring-indigo-400 focus:border-indigo-400',
                  isQuickAddLoading ? 'opacity-60 cursor-not-allowed' : '',
                ].join(' ')}
              />
              {/* Clear button — appears when there's text and AI isn't running */}
              {quickAddText && !isQuickAddLoading && (
                <button
                  type="button"
                  onClick={clearQuickAdd}
                  aria-label="Clear AI Quick Add input"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Microphone button — only shown when Speech API is available */}
            {speechSupported && (
              <MicButton
                isListening={isListening}
                onClick={() => toggleDictation('quickAdd')}
                targetField="quickAdd"
                activeField={activeField}
                size="md"
              />
            )}

            {/* ── Receipt Scanner: hidden file input + Camera trigger button ── */}
            {/* The input is visually hidden; the Camera button acts as its label */}
            <input
              ref={receiptInputRef}
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/webp"
              onChange={handleScanReceipt}
              className="sr-only"
              aria-hidden="true"
              tabIndex={-1}
            />
            <button
              type="button"
              onClick={() => receiptInputRef.current?.click()}
              disabled={isScanLoading || isQuickAddLoading}
              title="Scan a receipt"
              aria-label="Scan a receipt image to auto-fill the form"
              className={[
                'relative flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center',
                'transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1',
                isScanLoading
                  ? 'bg-violet-500 text-white focus:ring-violet-400 shadow-lg'
                  : isQuickAddLoading
                  ? 'bg-slate-100 dark:bg-slate-700 text-slate-300 dark:text-slate-600 cursor-not-allowed'
                  : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-violet-100 dark:hover:bg-violet-900/40 hover:text-violet-600 dark:hover:text-violet-400 focus:ring-violet-400',
              ].join(' ')}
            >
              {isScanLoading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Camera size={16} />
              )}
            </button>

            {/* Auto-fill button */}
            <button
              type="button"
              onClick={handleQuickAdd}
              disabled={isQuickAddLoading || isScanLoading || !quickAddText.trim()}
              aria-label="Auto-fill form using AI"
              className={[
                'flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold',
                'transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1',
                'flex-shrink-0',
                isQuickAddLoading || isScanLoading || !quickAddText.trim()
                  ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed border border-slate-200 dark:border-slate-700'
                  : 'bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white shadow-sm shadow-indigo-200 dark:shadow-indigo-900 focus:ring-indigo-400 border border-transparent',
              ].join(' ')}
            >
              {isQuickAddLoading ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span className="hidden sm:inline">Parsing…</span>
                </>
              ) : (
                <>
                  <Wand2 size={14} />
                  <span className="hidden sm:inline">Auto-fill</span>
                </>
              )}
            </button>
          </div>

          {/* Success confirmation banner — shown after AI fills the form */}
          {quickAddFilled && !isQuickAddLoading && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700/50 px-3 py-2.5 animate-slide-down"
            >
              <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-emerald-700 dark:text-emerald-300 font-medium leading-snug">
                Fields auto-filled below.{' '}
                <strong className="font-bold">Review each field</strong> before clicking "Add Transaction".
              </p>
            </div>
          )}

          {/* Hint: voice not supported */}
          {!speechSupported && (
            <p className="flex items-center gap-1.5 text-[10px] text-indigo-400 dark:text-indigo-500">
              <MicOff size={11} />
              Voice input requires Chrome or Edge — you can still type your sentence above.
            </p>
          )}
        </div>

        {/* ── Visual divider between AI section and manual form ─────────── */}
        <div className="flex items-center gap-3" aria-hidden="true">
          <span className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
          <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
            or fill manually
          </span>
          <span className="flex-1 h-px bg-slate-200 dark:bg-slate-700" />
        </div>

        {/* ── Type Toggle: Income / Expense ─────────────────────────────── */}
        <div>
          <label className="form-label">Type</label>
          <div className="grid grid-cols-2 gap-2">
            {['Income', 'Expense'].map((t) => {
              const isSelected = form.type === t;
              const isIncome = t === 'Income';
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, type: t }))}
                  className={[
                    'flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-sm font-semibold',
                    'border transition-all duration-200 focus:outline-none focus:ring-2',
                    isSelected && isIncome
                      ? 'bg-emerald-500 border-emerald-500 text-white shadow-sm focus:ring-emerald-400'
                      : isSelected && !isIncome
                      ? 'bg-rose-500 border-rose-500 text-white shadow-sm focus:ring-rose-400'
                      : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600 focus:ring-slate-400',
                  ].join(' ')}
                  aria-pressed={isSelected}
                >
                  {isIncome ? <ArrowUpCircle size={15} /> : <ArrowDownCircle size={15} />}
                  {t}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Title field with Mic button ───────────────────────────────── */}
        <div>
          <label htmlFor="title" className="form-label">
            <span className="flex items-center gap-1.5">
              <Tag size={11} />
              Title
              {speechSupported && (
                <span className="text-emerald-500 dark:text-emerald-400 text-[10px] font-bold ml-1">
                  🎤 VOICE
                </span>
              )}
            </span>
          </label>
          <div className="flex gap-2">
            <input
              id="title"
              name="title"
              type="text"
              value={form.title}
              onChange={handleChange}
              placeholder={
                isListening && activeField === 'title'
                  ? '🎤 Listening…'
                  : 'e.g., Grocery run at D-Mart'
              }
              className={`input-field ${errors.title ? 'border-rose-400 focus:ring-rose-400' : ''}`}
              maxLength={100}
              aria-describedby={errors.title ? 'title-error' : undefined}
              aria-invalid={!!errors.title}
            />
            {speechSupported && (
              <MicButton
                isListening={isListening}
                onClick={() => toggleDictation('title')}
                targetField="title"
                activeField={activeField}
              />
            )}
          </div>
          <FieldError message={errors.title} />
        </div>

        {/* ── Amount field ──────────────────────────────────────────────── */}
        <div>
          <label htmlFor="amount" className="form-label">
            <span className="flex items-center gap-1.5">
              <DollarSign size={11} />
              Amount (₹)
            </span>
          </label>
          <input
            id="amount"
            name="amount"
            type="number"
            value={form.amount}
            onChange={handleChange}
            placeholder="0.00"
            min="1"
            step="0.01"
            className={`input-field font-numeric ${errors.amount ? 'border-rose-400 focus:ring-rose-400' : ''}`}
            aria-invalid={!!errors.amount}
          />
          <FieldError message={errors.amount} />
        </div>

        {/* ── Category + Date row ───────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="category" className="form-label">
              <span className="flex items-center gap-1.5">
                <LayoutGrid size={11} />
                Category
              </span>
            </label>
            <select
              id="category"
              name="category"
              value={form.category}
              onChange={handleChange}
              className={`select-field ${errors.category ? 'border-rose-400 focus:ring-rose-400' : ''}`}
              aria-invalid={!!errors.category}
            >
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
            <FieldError message={errors.category} />
          </div>

          <div>
            <label htmlFor="date" className="form-label">
              <span className="flex items-center gap-1.5">
                <Calendar size={11} />
                Date
              </span>
            </label>
            <input
              id="date"
              name="date"
              type="date"
              value={form.date}
              onChange={handleChange}
              max={new Date().toISOString().split('T')[0]}
              className={`input-field ${errors.date ? 'border-rose-400 focus:ring-rose-400' : ''}`}
              aria-invalid={!!errors.date}
            />
            <FieldError message={errors.date} />
          </div>
        </div>

        {/* ── Notes field with Mic button ───────────────────────────────── */}
        <div>
          <label htmlFor="notes" className="form-label">
            <span className="flex items-center gap-1.5">
              <AlignLeft size={11} />
              Notes
              <span className="text-slate-400 dark:text-slate-500 normal-case tracking-normal font-normal">
                (optional)
              </span>
            </span>
          </label>
          <div className="flex gap-2 items-start">
            <textarea
              id="notes"
              name="notes"
              value={form.notes}
              onChange={handleChange}
              placeholder={
                isListening && activeField === 'notes'
                  ? '🎤 Listening…'
                  : 'Any extra details…'
              }
              rows={2}
              maxLength={250}
              className="input-field resize-none"
            />
            {speechSupported && (
              <MicButton
                isListening={isListening}
                onClick={() => toggleDictation('notes')}
                targetField="notes"
                activeField={activeField}
              />
            )}
          </div>
        </div>

        {/* ── Recurring toggle ──────────────────────────────────────────── */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <button
            type="button"
            onClick={() => setForm((prev) => ({ ...prev, isRecurring: !prev.isRecurring }))}
            className="w-full flex items-center justify-between px-4 py-3
                       bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100
                       dark:hover:bg-slate-700/60 transition-colors duration-150
                       focus:outline-none focus:ring-2 focus:ring-inset focus:ring-emerald-500"
            aria-pressed={form.isRecurring}
            aria-expanded={form.isRecurring}
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
              <Repeat
                size={14}
                className={form.isRecurring ? 'text-emerald-500' : 'text-slate-400'}
                aria-hidden="true"
              />
              Recurring transaction
            </span>
            <span
              className={[
                'relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200',
                form.isRecurring ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600',
              ].join(' ')}
              aria-hidden="true"
            >
              <span
                className={[
                  'inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-200',
                  form.isRecurring ? 'translate-x-4' : 'translate-x-0.5',
                ].join(' ')}
              />
            </span>
          </button>

          {form.isRecurring && (
            <div className="px-4 py-3 bg-emerald-50/50 dark:bg-emerald-900/10 border-t border-slate-200 dark:border-slate-700 animate-slide-down">
              <label className="form-label">Repeat frequency</label>
              <div className="flex gap-2 mt-1">
                {RECURRING_FREQUENCIES.map((freq) => (
                  <button
                    key={freq}
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, recurringFrequency: freq }))}
                    className={[
                      'flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all duration-150',
                      'border focus:outline-none focus:ring-2 focus:ring-emerald-400',
                      form.recurringFrequency === freq
                        ? 'bg-emerald-500 border-emerald-500 text-white shadow-sm'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-emerald-300',
                    ].join(' ')}
                    aria-pressed={form.recurringFrequency === freq}
                  >
                    {freq}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-2 font-medium">
                🔄 The cron scheduler will auto-generate copies at midnight IST.
              </p>
            </div>
          )}
        </div>

        {/* ── Submit row ────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between pt-1">
          <SuccessToast show={showSuccess} />
          <button
            type="submit"
            disabled={isSubmitting}
            className="btn-primary ml-auto"
          >
            {isSubmitting ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <PlusCircle size={15} />
                Add Transaction
              </>
            )}
          </button>
        </div>
      </form>

      {/* ── Voice Dictation Status Bar (shown for ANY active field) ─────── */}
      {isListening && (
        <div className="mt-3 flex items-center gap-2 px-3 py-2 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-700/50 rounded-xl animate-slide-down">
          <div className="flex items-end gap-0.5 h-4" aria-hidden="true">
            {[0, 100, 200, 100, 0].map((delay, i) => (
              <span
                key={i}
                className="w-1 bg-rose-500 rounded-full animate-pulse"
                style={{ height: `${8 + (i % 3) * 4}px`, animationDelay: `${delay}ms` }}
              />
            ))}
          </div>
          <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">
            Listening to{' '}
            <strong className="font-bold capitalize">
              {activeField === 'quickAdd' ? 'AI Quick Add' : activeField}
            </strong>
            … speak now
          </span>
          <button
            type="button"
            onClick={() => toggleDictation(activeField)}
            className="ml-auto text-xs text-rose-500 hover:text-rose-700 font-semibold underline"
          >
            Stop
          </button>
        </div>
      )}

      {/* ── Browser support note ──────────────────────────────────────────── */}
      {!speechSupported && (
        <p className="mt-3 text-xs text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
          <MicOff size={12} />
          Voice dictation requires Chrome or Edge.
        </p>
      )}
    </article>
  );
};

export default TransactionForm;