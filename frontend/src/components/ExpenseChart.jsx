/**
 * components/ExpenseChart.jsx
 *
 * Doughnut chart showing how the current month's expenses break down by category.
 * Built with react-chartjs-2 (a thin wrapper around Chart.js).
 *
 * Dark mode headache:
 *   Chart.js draws to a <canvas> element, so Tailwind's dark: classes can't
 *   reach it. Instead, I read the --chart-text CSS custom property from index.css
 *   via getComputedStyle - that property automatically switches value when the
 *   `dark` class toggles on <html>. A useEffect watching isDark then pushes the
 *   new colour into the Chart.js instance without a full re-render.
 *
 * Data flow:
 *   GET /api/transactions/summary → categoryBreakdown array
 *   → DashboardPage state → <ExpenseChart breakdown={categoryBreakdown} />
 */

import { useEffect, useRef, useMemo } from 'react';
import { Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  DoughnutController,
} from 'chart.js';
import { useTheme }  from '../context/ThemeContext';
import { PieChart }  from 'lucide-react';

// Only register what we actually use - Chart.js is big and tree-shaking helps
ChartJS.register(ArcElement, Tooltip, Legend, DoughnutController);

// --- Category colour palette --------------------------------------------------
// Two values per category: `alpha` is used for the normal arc fill (slightly
// translucent), `solid` is used on hover and in the custom legend dots.
// Order matches the Transaction model enum so colours stay consistent.
const CATEGORY_COLORS = {
  'Housing':          { solid: '#6366f1', alpha: 'rgba(99,102,241,0.85)'  },  // indigo
  'Food & Groceries': { solid: '#f59e0b', alpha: 'rgba(245,158,11,0.85)' },  // amber
  'Transport':        { solid: '#3b82f6', alpha: 'rgba(59,130,246,0.85)'  },  // blue
  'Utilities':        { solid: '#8b5cf6', alpha: 'rgba(139,92,246,0.85)'  },  // violet
  'Entertainment':    { solid: '#ec4899', alpha: 'rgba(236,72,153,0.85)'  },  // pink
  'Healthcare':       { solid: '#10b981', alpha: 'rgba(16,185,129,0.85)'  },  // emerald
  'Salary':           { solid: '#06b6d4', alpha: 'rgba(6,182,212,0.85)'   },  // cyan
  'Other':            { solid: '#94a3b8', alpha: 'rgba(148,163,184,0.85)' },  // slate
};

// Fallback for any category that somehow isn't in the palette above
const FALLBACK_COLOR = { solid: '#64748b', alpha: 'rgba(100,116,139,0.85)' };

// --- Skeleton loader ----------------------------------------------------------
const ChartSkeleton = () => (
  <div className="flex flex-col items-center gap-4">
    <div className="skeleton w-48 h-48 rounded-full" />
    <div className="space-y-2 w-full">
      {[80, 65, 50, 40].map((w) => (
        <div key={w} className="flex items-center gap-2">
          <div className="skeleton w-3 h-3 rounded-full" />
          <div className="skeleton h-3 rounded" style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  </div>
);

// --- Empty state --------------------------------------------------------------
const ChartEmpty = () => (
  <div className="flex flex-col items-center justify-center py-8 gap-3">
    <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
      <PieChart size={28} className="text-slate-400 dark:text-slate-500" />
    </div>
    <div className="text-center">
      <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">No expense data yet</p>
      <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
        Add some expenses to see your breakdown.
      </p>
    </div>
  </div>
);

// --- Custom legend row --------------------------------------------------------
// Chart.js's built-in legend doesn't match the design system,
// so rendering a custom one beneath the chart instead
const LegendItem = ({ label, total, percentage, color }) => (
  <div className="flex items-center justify-between gap-2 py-1.5 group">
    <div className="flex items-center gap-2 min-w-0">
      <span
        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      <span className="text-xs font-medium text-slate-600 dark:text-slate-400 truncate group-hover:text-slate-900 dark:group-hover:text-slate-200 transition-colors">
        {label}
      </span>
    </div>
    <div className="flex items-center gap-2 flex-shrink-0">
      <span className="text-xs font-numeric text-slate-500 dark:text-slate-400">
        ₹{total.toLocaleString('en-IN')}
      </span>
      <span className="text-xs font-semibold font-numeric text-slate-700 dark:text-slate-300 w-10 text-right">
        {percentage}%
      </span>
    </div>
  </div>
);

// --- Main ExpenseChart component ----------------------------------------------
// Props:
//   breakdown {Array<{ category: string, total: number }>} - from the summary API
//   isLoading {boolean}
const ExpenseChart = ({ breakdown = [], isLoading = false }) => {
  const { isDark } = useTheme();
  const chartRef   = useRef(null);

  // Build the Chart.js data object and legend from the breakdown prop.
  // Memoised so we don't recompute on every theme-toggle re-render.
  const { chartData, totalExpense, legendItems } = useMemo(() => {
    if (!breakdown || breakdown.length === 0)
      return { chartData: null, totalExpense: 0, legendItems: [] };

    const total       = breakdown.reduce((sum, item) => sum + item.total, 0);
    const labels      = breakdown.map((item) => item.category);
    const amounts     = breakdown.map((item) => item.total);
    const colors      = breakdown.map((item) => (CATEGORY_COLORS[item.category] || FALLBACK_COLOR).alpha);
    const solidColors = breakdown.map((item) => (CATEGORY_COLORS[item.category] || FALLBACK_COLOR).solid);

    const legend = breakdown.map((item) => ({
      label:      item.category,
      total:      item.total,
      // toFixed(1) so we get "34.5%" not a long float string
      percentage: total > 0 ? ((item.total / total) * 100).toFixed(1) : '0.0',
      color:      (CATEGORY_COLORS[item.category] || FALLBACK_COLOR).solid,
    }));

    return {
      chartData: {
        labels,
        datasets: [{
          data:                amounts,
          backgroundColor:     colors,
          hoverBackgroundColor: solidColors,
          borderColor:         'transparent',
          borderWidth:         0,
          hoverOffset:         6,
        }],
      },
      totalExpense: total,
      legendItems:  legend,
    };
  }, [breakdown]);

  // Read the CSS custom property for the current theme's text colour.
  // Chart.js needs an actual hex/rgb value, not a Tailwind class name.
  const getChartTextColor = () =>
    getComputedStyle(document.documentElement)
      .getPropertyValue('--chart-text')
      .trim() || '#94a3b8';

  // When the theme switches, push the new text colour into the existing chart
  // instance rather than destroying and recreating it.
  // Passing 'none' as the update mode skips the re-draw animation.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const textColor = getChartTextColor();
    chart.options.plugins.tooltip.bodyColor  = textColor;
    chart.options.plugins.tooltip.titleColor = textColor;
    chart.update('none');
  }, [isDark]);

  // Chart options - recomputed when isDark changes so tooltip colours stay in sync
  const chartOptions = useMemo(() => {
    const textColor = getChartTextColor();
    return {
      responsive:          true,
      maintainAspectRatio: true,
      cutout:              '68%', // size of the hole in the doughnut

      plugins: {
        legend:  { display: false }, // hiding built-in legend - using LegendItem rows below

        tooltip: {
          backgroundColor: isDark ? '#1e293b' : '#0f172a',
          titleColor:      '#f1f5f9',
          bodyColor:       textColor,
          borderColor:     isDark ? '#334155' : '#1e293b',
          borderWidth:     1,
          padding:         12,
          cornerRadius:    10,
          titleFont:       { family: 'Sora', size: 12, weight: '600' },
          bodyFont:        { family: 'JetBrains Mono', size: 12 },
          callbacks: {
            // e.g. "  ₹12,500  (34.5%)" - leading spaces add a bit of visual padding
            label: (context) => {
              const value = context.parsed;
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const pct   = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
              return `  ₹${value.toLocaleString('en-IN')}  (${pct}%)`;
            },
          },
        },
      },

      animation: {
        animateRotate: true,
        animateScale:  true,
        duration:      500,
        easing:        'easeOutQuart',
      },
    };
  }, [isDark]);

  if (isLoading) return <ChartSkeleton />;
  if (!chartData) return <ChartEmpty />;

  return (
    <div className="flex flex-col gap-5">
      {/* Doughnut with total spend label centred in the hole */}
      <div className="relative flex items-center justify-center">
        <div className="w-48 h-48">
          <Doughnut
            ref={chartRef}
            data={chartData}
            options={chartOptions}
            aria-label="Expense category breakdown doughnut chart"
            role="img"
          />
        </div>

        {/* Positioned over the doughnut hole - pointer-events-none so it
            doesn't block hover interactions on the chart arcs */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none">
          <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
            Total
          </span>
          <span className="font-numeric text-lg font-semibold text-slate-800 dark:text-slate-100 leading-tight">
            ₹{totalExpense.toLocaleString('en-IN')}
          </span>
        </div>
      </div>

      {/* Custom legend beneath the chart */}
      <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
        {legendItems.map((item) => (
          <LegendItem key={item.label} {...item} />
        ))}
      </div>
    </div>
  );
};

export default ExpenseChart;