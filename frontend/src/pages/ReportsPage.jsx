/**
 * pages/ReportsPage.jsx
 *
 * Sprint 2: Wrapped existing chart UI in a two-tab layout.
 * Tab 1 "Charts & Trends" — exact existing UI, zero changes.
 * Tab 2 "AI Coach"        — GET /api/transactions/ai-report → Financial Roast & Report.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import axios from 'axios';
import {
  Chart as ChartJS, CategoryScale, LinearScale,
  BarElement, LineElement, PointElement,
  ArcElement, Filler, Tooltip, Legend,
} from 'chart.js';
import { Bar, Line } from 'react-chartjs-2';
import {
  BarChart2, TrendingUp, TrendingDown,
  PiggyBank, RefreshCw, Calendar,
  Sparkles, Flame, Target, Brain,
  AlertCircle, RotateCcw,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Filler, Tooltip, Legend);

// ─── Unchanged constants ───────────────────────────────────────────────────────
const PALETTE = {
  income:  { solid: 'rgba(16,185,129,0.85)',  hover: '#10b981' },
  expense: { solid: 'rgba(244,63,94,0.75)',   hover: '#f43f5e' },
  savings: { solid: 'rgba(59,130,246,0.15)',  border: '#3b82f6' },
};

const CATEGORY_COLORS = {
  'Housing': '#6366f1', 'Food & Groceries': '#f59e0b', 'Transport': '#3b82f6',
  'Utilities': '#8b5cf6', 'Entertainment': '#ec4899', 'Healthcare': '#10b981',
  'Salary': '#06b6d4', 'Other': '#94a3b8',
};

const fmtINR = (n) => `₹${(n||0).toLocaleString('en-IN', { minimumFractionDigits: 0 })}`;
const getChartText = () => getComputedStyle(document.documentElement).getPropertyValue('--chart-text').trim() || '#94a3b8';
const getChartGrid = () => getComputedStyle(document.documentElement).getPropertyValue('--chart-grid').trim() || '#f1f5f9';

// ─── Unchanged sub-components ──────────────────────────────────────────────────
const Pill = ({ label, value, icon: Icon, colorClass, isLoading }) => (
  <article className="card flex items-center gap-3 py-4">
    <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${colorClass}`}>
      <Icon size={16} aria-hidden="true" />
    </div>
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 truncate">{label}</p>
      {isLoading ? <div className="skeleton h-6 w-24 mt-0.5 rounded" /> : <p className="font-numeric text-base font-bold text-slate-800 dark:text-slate-100 truncate">{value}</p>}
    </div>
  </article>
);

const CategoryRow = ({ category, total, percentage, rank }) => {
  const color = CATEGORY_COLORS[category] || '#94a3b8';
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-400 dark:text-slate-500 w-4">#{rank}</span>
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} aria-hidden="true" />
          <span className="font-medium text-slate-700 dark:text-slate-300 truncate max-w-[140px]">{category}</span>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="font-numeric text-xs text-slate-500 dark:text-slate-400">{fmtINR(total)}</span>
          <span className="font-numeric text-xs font-bold text-slate-700 dark:text-slate-300 w-10 text-right">{percentage}%</span>
        </div>
      </div>
      <div className="w-full h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
        <div className="h-full rounded-full progress-bar-fill transition-all duration-700" style={{ '--progress-width': `${Math.min(100, percentage)}%`, backgroundColor: color }} />
      </div>
    </div>
  );
};

const ChartSkeleton = ({ height = 260 }) => (
  <div className="flex flex-col gap-3"><div className="skeleton w-full rounded-xl" style={{ height }} /></div>
);

// ─── AI Coach sub-components ───────────────────────────────────────────────────

/**
 * ScoreRing — SVG circular progress ring with dynamic colour banding.
 * score < 50  → rose (danger)
 * score 50–79 → amber (warning)
 * score 80+   → emerald (success)
 */
const ScoreRing = ({ score }) => {
  const radius = 52;
  const stroke = 7;
  const normalised = radius - stroke / 2;
  const circumference = 2 * Math.PI * normalised;
  const progress = circumference - (score / 100) * circumference;

  const { color, label, textClass } =
    score >= 80 ? { color: '#10b981', label: 'Excellent',   textClass: 'text-emerald-500' } :
    score >= 50 ? { color: '#f59e0b', label: 'Fair',        textClass: 'text-amber-500'   } :
                  { color: '#f43f5e', label: 'Needs work',  textClass: 'text-rose-500'    };

  return (
    <div className="flex flex-col items-center gap-2 select-none" aria-label={`Financial health score: ${score} out of 100`}>
      <div className="relative w-32 h-32">
        {/* Track ring */}
        <svg className="absolute inset-0 -rotate-90" viewBox="0 0 120 120" aria-hidden="true">
          <circle cx="60" cy="60" r={normalised} fill="none"
            stroke="currentColor" strokeWidth={stroke}
            className="text-slate-100 dark:text-slate-700" />
          <circle cx="60" cy="60" r={normalised} fill="none"
            stroke={color} strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={progress}
            style={{ transition: 'stroke-dashoffset 1s cubic-bezier(0.4,0,0.2,1)' }}
          />
        </svg>
        {/* Score number */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`font-numeric text-3xl font-bold leading-none ${textClass}`}>{score}</span>
          <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest mt-0.5">/100</span>
        </div>
      </div>
      <span className={`text-xs font-bold uppercase tracking-wider ${textClass}`}>{label}</span>
    </div>
  );
};

/**
 * AIReportSkeleton — pulsing skeleton with flavour copy shown while Gemini thinks.
 */
const AI_LOADING_STEPS = [
  'Scanning your transaction history…',
  'Crunching the numbers…',
  'Drafting your financial roast…',
  'Polishing the advice…',
];

const AIReportSkeleton = () => {
  const [stepIdx, setStepIdx] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setStepIdx(prev => (prev + 1) % AI_LOADING_STEPS.length);
    }, 1800);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="space-y-5 animate-pulse" aria-busy="true" aria-label="Loading AI report">
      {/* Header skeleton */}
      <div className="card flex flex-col items-center gap-5 py-8">
        {/* Fake score ring */}
        <div className="relative w-32 h-32 flex items-center justify-center">
          <div className="w-32 h-32 rounded-full bg-slate-100 dark:bg-slate-700" />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
            <div className="skeleton h-8 w-12 rounded" />
            <div className="skeleton h-3 w-8 rounded" />
          </div>
        </div>
        {/* Pulsing status text */}
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-2">
            <Brain size={14} className="text-indigo-500 animate-bounce" aria-hidden="true" />
            <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 transition-all duration-500">
              {AI_LOADING_STEPS[stepIdx]}
            </p>
          </div>
          <div className="flex gap-1.5">
            {[0, 1, 2].map(i => (
              <span key={i} className="w-1.5 h-1.5 rounded-full bg-indigo-400 dark:bg-indigo-500"
                style={{ animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` }} />
            ))}
          </div>
        </div>
        <div className="w-full max-w-lg space-y-2 px-4">
          <div className="skeleton h-4 w-full rounded" />
          <div className="skeleton h-4 w-5/6 rounded" />
          <div className="skeleton h-4 w-4/6 rounded" />
        </div>
      </div>

      {/* Roast + Praise skeletons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          'border-rose-200 dark:border-rose-800/50',
          'border-emerald-200 dark:border-emerald-800/50',
        ].map((borderCls, i) => (
          <div key={i} className={`card border ${borderCls} space-y-3`}>
            <div className="skeleton h-4 w-24 rounded" />
            <div className="skeleton h-4 w-full rounded" />
            <div className="skeleton h-4 w-4/5 rounded" />
          </div>
        ))}
      </div>

      {/* Action items skeleton */}
      <div className="card space-y-4">
        <div className="skeleton h-4 w-36 rounded" />
        {[0, 1, 2].map(i => (
          <div key={i} className="flex items-start gap-3">
            <div className="skeleton w-5 h-5 rounded-full flex-shrink-0 mt-0.5" />
            <div className="flex-1 space-y-1.5">
              <div className="skeleton h-3.5 w-full rounded" />
              <div className="skeleton h-3.5 w-3/4 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/**
 * AIReportError — shown on fetch failure or 204 (no data) responses.
 */
const AIReportError = ({ noData, onRetry }) => (
  <div className="card flex flex-col items-center gap-4 py-14 text-center">
    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${noData ? 'bg-slate-100 dark:bg-slate-800 text-slate-400' : 'bg-rose-50 dark:bg-rose-900/20 text-rose-400'}`}>
      <AlertCircle size={22} aria-hidden="true" />
    </div>
    <div className="max-w-xs">
      <p className="font-semibold text-slate-800 dark:text-slate-200 mb-1">
        {noData ? 'No transactions this month' : 'Report unavailable'}
      </p>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        {noData
          ? 'Add some transactions this month and your AI Coach will have something to work with.'
          : 'Something went wrong generating your report. It usually fixes itself.'}
      </p>
    </div>
    {!noData && (
      <button onClick={onRetry}
        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors">
        <RotateCcw size={13} />
        Try again
      </button>
    )}
  </div>
);

/**
 * AIReportPanel — the full rendered report UI.
 * Receives the parsed `data` object and `month` string from the API.
 */
const AIReportPanel = ({ data, month }) => {
  const { score, summary, roast, praise, actionItems } = data;

  const scoreLabel =
    score >= 80 ? 'Your finances are in great shape this month.' :
    score >= 50 ? 'A decent month — some room for improvement.' :
                  'This month was rough. Let\'s fix that.';

  return (
    <div className="space-y-5">

      {/* ── Score + Summary hero card ──────────────────────────────────────── */}
      <article className="card">
        <div className="flex flex-col items-center gap-5 py-3">
          <ScoreRing score={score} />

          <div className="text-center max-w-lg space-y-1">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
              {month} · Financial Health Score
            </p>
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">{scoreLabel}</p>
          </div>

          {/* Summary paragraph */}
          <div className="w-full max-w-2xl bg-slate-50 dark:bg-slate-800/60 rounded-2xl px-5 py-4 border border-slate-100 dark:border-slate-700/60">
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed text-center">{summary}</p>
          </div>
        </div>
      </article>

      {/* ── Roast & Praise side-by-side ────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        {/* Roast — rose theme */}
        <article className="card border border-rose-200 dark:border-rose-800/50 bg-rose-50/40 dark:bg-rose-900/10 space-y-3">
          <header className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-rose-100 dark:bg-rose-900/40 flex items-center justify-center flex-shrink-0">
              <Flame size={13} className="text-rose-500" aria-hidden="true" />
            </div>
            <span className="text-xs font-bold uppercase tracking-widest text-rose-500 dark:text-rose-400">
              The Roast
            </span>
          </header>
          <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{roast}</p>
        </article>

        {/* Praise — emerald theme */}
        <article className="card border border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/40 dark:bg-emerald-900/10 space-y-3">
          <header className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center flex-shrink-0">
              <Sparkles size={13} className="text-emerald-500" aria-hidden="true" />
            </div>
            <span className="text-xs font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
              The Praise
            </span>
          </header>
          <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{praise}</p>
        </article>
      </div>

      {/* ── Action Items checklist ─────────────────────────────────────────── */}
      <article className="card">
        <header className="flex items-center gap-2 mb-5">
          <Target size={15} className="text-indigo-500" aria-hidden="true" />
          <h2 className="section-title">Action Items for Next Month</h2>
        </header>
        <ol className="space-y-4" aria-label="Action items">
          {actionItems.map((item, i) => (
            <li key={i} className="flex items-start gap-3 group">
              {/* Numbered circle */}
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900/40
                               text-indigo-600 dark:text-indigo-400 text-xs font-bold
                               flex items-center justify-center mt-0.5 group-hover:bg-indigo-200
                               dark:group-hover:bg-indigo-800/60 transition-colors">
                {i + 1}
              </span>
              <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed pt-0.5">{item}</p>
            </li>
          ))}
        </ol>
      </article>

      {/* ── Disclaimer footer ──────────────────────────────────────────────── */}
      <p className="text-center text-[11px] text-slate-400 dark:text-slate-600 pb-1">
        AI analysis is based on your recorded transactions only and is not financial advice.
      </p>
    </div>
  );
};

// ─── Main ReportsPage component ────────────────────────────────────────────────
const ReportsPage = () => {
  const { isDark }  = useTheme();
  const { toast }   = useToast();
  const barRef      = useRef(null);
  const lineRef     = useRef(null);

  // ── Tab state ──────────────────────────────────────────────────────────────
  // 'charts' | 'ai'
  const [activeTab, setActiveTab] = useState('charts');

  // ── Chart tab state (unchanged) ────────────────────────────────────────────
  const [months, setMonths]   = useState(6);
  const [trend,  setTrend]    = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  // ── AI Coach state ─────────────────────────────────────────────────────────
  const [aiReport, setAiReport]     = useState(null);   // { score, summary, roast, praise, actionItems }
  const [aiMonth, setAiMonth]       = useState('');     // e.g. "June 2025"
  const [aiLoading, setAiLoading]   = useState(false);
  const [aiError, setAiError]       = useState(false);  // true = fetch failed
  const [aiNoData, setAiNoData]     = useState(false);  // true = 204 response
  const hasFetchedAI                = useRef(false);    // only auto-fetch once per mount

  // ── Chart data fetch (unchanged logic) ────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const d = new Date();
      const toStr   = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59).toISOString().split('T')[0];
      const fromStr = new Date(d.getFullYear(), d.getMonth() - months + 1, 1).toISOString().split('T')[0];

      const [trendRes, summaryRes] = await Promise.all([
        axios.get(`/api/transactions/monthly?months=${months}`),
        axios.get(`/api/transactions/summary?from=${fromStr}&to=${toStr}`),
      ]);
      if (trendRes.data.success)   setTrend(trendRes.data.data);
      if (summaryRes.data.success) setSummary(summaryRes.data.data);
    } catch (e) {
      toast.error('Failed to load report data.', 'Error');
    } finally {
      setLoading(false);
    }
  }, [months, toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    [barRef, lineRef].forEach(ref => { if (ref.current) ref.current.update('none'); });
  }, [isDark]);

  // ── AI Coach fetch ─────────────────────────────────────────────────────────
  const fetchAIReport = useCallback(async () => {
    setAiLoading(true);
    setAiError(false);
    setAiNoData(false);
    setAiReport(null);
    try {
      const res = await axios.get('/api/transactions/ai-report');
      // 204 = no transactions this month — axios resolves it, body is empty
      if (res.status === 204) {
        setAiNoData(true);
        return;
      }
      if (res.data.success) {
        setAiReport(res.data.data);
        setAiMonth(res.data.month || '');
      } else {
        setAiError(true);
      }
    } catch (e) {
      // axios throws for non-2xx except 204 — surface cleanly
      setAiError(true);
      toast.error(
        e?.response?.data?.message || 'Could not load AI report.',
        'AI Coach',
      );
    } finally {
      setAiLoading(false);
    }
  }, [toast]);

  // Auto-fetch AI report the first time the user switches to the AI tab
  useEffect(() => {
    if (activeTab === 'ai' && !hasFetchedAI.current) {
      hasFetchedAI.current = true;
      fetchAIReport();
    }
  }, [activeTab, fetchAIReport]);

  // ── Chart-derived memos (unchanged) ───────────────────────────────────────
  const totalIncome  = useMemo(() => trend.reduce((sum, item) => sum + (item.income  || 0), 0), [trend]);
  const totalExpense = useMemo(() => trend.reduce((sum, item) => sum + (item.expense || 0), 0), [trend]);
  const savingsRate  = totalIncome > 0
    ? Math.max(0, ((totalIncome - totalExpense) / totalIncome * 100)).toFixed(1)
    : '0.0';

  const top5 = useMemo(() => {
    const bd = summary?.categoryBreakdown || [];
    return [...bd].sort((a, b) => b.total - a.total).slice(0, 5).map(item => ({
      ...item,
      percentage: totalExpense > 0 ? parseFloat(((item.total / totalExpense) * 100).toFixed(1)) : 0,
    }));
  }, [summary, totalExpense]);

  const sharedOptions = useMemo(() => {
    const text = getChartText();
    const grid = getChartGrid();
    return {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: text, font: { family: 'Sora', size: 11, weight: '600' }, boxWidth: 12, boxHeight: 12, borderRadius: 4 } },
        tooltip: {
          backgroundColor: isDark ? '#1e293b' : '#0f172a', titleColor: '#f1f5f9', bodyColor: text,
          borderColor: isDark ? '#334155' : '#1e293b', borderWidth: 1, padding: 12, cornerRadius: 10,
          titleFont: { family: 'Sora', size: 12, weight: '600' }, bodyFont: { family: 'JetBrains Mono', size: 12 },
          callbacks: { label: ctx => `  ${ctx.dataset.label}: ₹${ctx.parsed.y.toLocaleString('en-IN')}` },
        },
      },
      scales: {
        x: { ticks: { color: text, font: { family: 'Sora', size: 10 } }, grid: { color: grid } },
        y: { ticks: { color: text, font: { family: 'JetBrains Mono', size: 10 }, callback: v => `₹${(v/1000).toFixed(0)}k` }, grid: { color: grid }, beginAtZero: true },
      },
      animation: { duration: 400, easing: 'easeOutQuart' },
    };
  }, [isDark]);

  const barData = useMemo(() => ({
    labels: trend.map(t => t.month),
    datasets: [
      { label: 'Income',  data: trend.map(t => t.income),  backgroundColor: PALETTE.income.solid,  hoverBackgroundColor: PALETTE.income.hover,  borderRadius: 6, borderSkipped: false },
      { label: 'Expense', data: trend.map(t => t.expense), backgroundColor: PALETTE.expense.solid, hoverBackgroundColor: PALETTE.expense.hover, borderRadius: 6, borderSkipped: false },
    ],
  }), [trend]);

  const lineData = useMemo(() => ({
    labels: trend.map(t => t.month),
    datasets: [
      { label: 'Income',  data: trend.map(t => t.income),                borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.08)', pointBackgroundColor: '#10b981', pointRadius: 4, pointHoverRadius: 6, fill: false, tension: 0.35 },
      { label: 'Expense', data: trend.map(t => t.expense),               borderColor: '#f43f5e', backgroundColor: 'rgba(244,63,94,0.08)',  pointBackgroundColor: '#f43f5e', pointRadius: 4, pointHoverRadius: 6, fill: false, tension: 0.35 },
      { label: 'Savings', data: trend.map(t => Math.max(0, t.savings)),  borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.10)', pointBackgroundColor: '#3b82f6', pointRadius: 3, pointHoverRadius: 5, fill: true,  tension: 0.35, borderDash: [5, 3] },
    ],
  }), [trend]);

  // ── Tab definitions ────────────────────────────────────────────────────────
  const TABS = [
    { id: 'charts', label: 'Charts & Trends', icon: BarChart2 },
    { id: 'ai',     label: 'AI Coach',        icon: Sparkles  },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ════════════════════════════════════════════════════════════════════
          PAGE HEADER — always visible; time-range controls shown only on
          the charts tab; AI refresh button shown only on the AI tab.
          ════════════════════════════════════════════════════════════════════ */}
      <header className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-900 dark:bg-slate-700 flex items-center justify-center shadow-md flex-shrink-0">
            <BarChart2 size={18} className="text-emerald-400" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
              Reports & Analytics
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Month-over-month trends and spending breakdown.
            </p>
          </div>
        </div>

        {/* Right-side controls — conditionally rendered per tab */}
        <div className="flex items-center gap-2">
          {activeTab === 'charts' && (
            <>
              <div className="flex items-center bg-slate-100 dark:bg-slate-800 rounded-xl p-1 gap-1"
                role="group" aria-label="Select time range">
                {[3, 6, 12].map(m => (
                  <button key={m} onClick={() => setMonths(m)}
                    className={['px-3 py-1.5 rounded-lg text-sm font-semibold transition-all duration-200',
                      months === m
                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300',
                    ].join(' ')}
                    aria-pressed={months === m}>
                    {m}M
                  </button>
                ))}
              </div>
              <button onClick={fetchData} disabled={loading} className="btn-ghost p-2" aria-label="Refresh chart data">
                <RefreshCw size={16} className={loading ? 'animate-spin text-emerald-500' : 'text-slate-400'} />
              </button>
            </>
          )}

          {activeTab === 'ai' && (
            <button
              onClick={() => { hasFetchedAI.current = false; fetchAIReport(); }}
              disabled={aiLoading}
              className="btn-ghost p-2"
              aria-label="Regenerate AI report">
              <RefreshCw size={16} className={aiLoading ? 'animate-spin text-indigo-500' : 'text-slate-400'} />
            </button>
          )}
        </div>
      </header>

      {/* ════════════════════════════════════════════════════════════════════
          TAB TOGGLE
          ════════════════════════════════════════════════════════════════════ */}
      <div className="flex justify-center w-full mb-8 mt-2">
        <div
          className="flex items-center bg-slate-100 dark:bg-slate-800/80 rounded-2xl p-1.5 gap-1 w-full sm:w-auto"
          role="tablist"
          aria-label="Report sections">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                aria-controls={`tabpanel-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className={[
                  'flex items-center justify-center gap-2 flex-1 sm:flex-none px-6 py-2.5 rounded-xl text-sm font-bold transition-all duration-200',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1',
                  isActive
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/50 dark:hover:bg-slate-700/50',
                ].join(' ')}>
                <Icon size={16} className={isActive ? (tab.id === 'ai' ? 'text-indigo-500' : 'text-emerald-500') : 'text-slate-400 dark:text-slate-500'} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          TAB PANEL 1 — Charts & Trends (exact existing UI, zero changes)
          ════════════════════════════════════════════════════════════════════ */}
      <section
        id="tabpanel-charts"
        role="tabpanel"
        aria-labelledby="tab-charts"
        hidden={activeTab !== 'charts'}>

        <section aria-label="Period summary" className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <Pill label={`Total Income (${months}M)`}  value={fmtINR(totalIncome)}  icon={TrendingUp}  colorClass="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-500" isLoading={loading} />
          <Pill label={`Total Expenses (${months}M)`} value={fmtINR(totalExpense)} icon={TrendingDown} colorClass="bg-rose-100 dark:bg-rose-900/30 text-rose-500"         isLoading={loading} />
          <Pill label="Savings Rate"                  value={`${savingsRate}%`}    icon={PiggyBank}    colorClass="bg-blue-100 dark:bg-blue-900/30 text-blue-500"          isLoading={loading} />
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <article className="card">
            <header className="flex items-center gap-2 mb-5">
              <BarChart2 size={15} className="text-slate-400 dark:text-slate-500" aria-hidden="true" />
              <h2 className="section-title">Income vs Expenses</h2>
              <span className="ml-auto text-xs text-slate-400 dark:text-slate-500 font-medium flex items-center gap-1">
                <Calendar size={11} />{months} months
              </span>
            </header>
            {loading
              ? <ChartSkeleton height={260} />
              : trend.length === 0
                ? <p className="text-sm text-slate-400 text-center py-16">No data for this period.</p>
                : <div style={{ height: 260 }}>
                    <Bar ref={barRef} data={barData}
                      options={{ ...sharedOptions, plugins: { ...sharedOptions.plugins, legend: { ...sharedOptions.plugins.legend, position: 'top' } } }}
                      aria-label="Income vs Expense bar chart" role="img" />
                  </div>
            }
          </article>

          <article className="card">
            <header className="flex items-center gap-2 mb-5">
              <TrendingUp size={15} className="text-slate-400 dark:text-slate-500" aria-hidden="true" />
              <h2 className="section-title">Monthly Trend</h2>
              <span className="ml-auto text-xs text-slate-400 dark:text-slate-500 font-medium flex items-center gap-1">
                <Calendar size={11} />{months} months
              </span>
            </header>
            {loading
              ? <ChartSkeleton height={260} />
              : trend.length === 0
                ? <p className="text-sm text-slate-400 text-center py-16">No data for this period.</p>
                : <div style={{ height: 260 }}>
                    <Line ref={lineRef} data={lineData}
                      options={{ ...sharedOptions, plugins: { ...sharedOptions.plugins, legend: { ...sharedOptions.plugins.legend, position: 'top' } } }}
                      aria-label="Monthly trend line chart" role="img" />
                  </div>
            }
          </article>
        </div>

        <article className="card">
          <header className="flex items-center gap-2 mb-6">
            <TrendingDown size={15} className="text-slate-400 dark:text-slate-500" aria-hidden="true" />
            <h2 className="section-title">Top 5 Spending Categories</h2>
          </header>
          {loading
            ? <div className="space-y-4">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-8 w-full rounded" />)}</div>
            : top5.length === 0
              ? <p className="text-sm text-slate-400 text-center py-8">No expense data yet.</p>
              : <div className="space-y-5">{top5.map((item, i) => <CategoryRow key={item.category} rank={i + 1} {...item} />)}</div>
          }
        </article>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          TAB PANEL 2 — AI Coach
          ════════════════════════════════════════════════════════════════════ */}
      <section
        id="tabpanel-ai"
        role="tabpanel"
        aria-labelledby="tab-ai"
        hidden={activeTab !== 'ai'}>

        {aiLoading && <AIReportSkeleton />}

        {!aiLoading && (aiError || aiNoData) && (
          <AIReportError
            noData={aiNoData}
            onRetry={() => { hasFetchedAI.current = false; fetchAIReport(); }}
          />
        )}

        {!aiLoading && !aiError && !aiNoData && aiReport && (
          <AIReportPanel data={aiReport} month={aiMonth} />
        )}
      </section>
    </>
  );
};

export default ReportsPage;