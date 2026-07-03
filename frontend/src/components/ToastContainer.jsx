/**
 * components/ToastContainer.jsx
 *
 * Renders the global toast notification stack.
 * Mounted once in App.jsx above all routes so it's always visible no matter
 * which page is active.
 *
 * Each toast looks like this:
 *   ┌---------------------------------------------┐
 *   │  [Icon]  Title (bold)            [× dismiss]│
 *   │          Message body text                  │
 *   │  ██████████░░░░░ progress bar               │
 *   └---------------------------------------------┘
 *
 * Type → colour mapping:
 *   success → emerald
 *   error   → rose
 *   warning → amber
 *   info    → blue
 *
 * Animation approach:
 *   Entry and exit are pure CSS - no animation library needed.
 *   The progress bar depletes using a CSS @keyframe animation whose duration
 *   matches the toast's auto-dismiss timeout.
 *   The keyframes are injected once into <head> on first mount via a
 *   self-contained helper so there's no separate CSS file to maintain.
 *
 * Accessibility:
 *   success/info → role="status"  + aria-live="polite"
 *   error/warning → role="alert" + aria-live="assertive"
 *   Each toast has a visible dismiss button with an aria-label.
 *
 * createPortal is used so the stack always floats above everything -
 * modals, navbars, dropdowns - regardless of z-index stacking contexts.
 */

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { useToast } from '../context/ToastContext';

// --- Type config --------------------------------------------------------------
const TYPE_CONFIG = {
  success: {
    Icon:        CheckCircle2,
    iconClass:   'text-emerald-500',
    borderClass: 'border-l-emerald-500',
    bgClass:     'bg-white dark:bg-slate-800',
    titleClass:  'text-emerald-700 dark:text-emerald-400',
    barClass:    'bg-emerald-500',
    ariaRole:    'status',
    ariaLive:    'polite',
  },
  error: {
    Icon:        XCircle,
    iconClass:   'text-rose-500',
    borderClass: 'border-l-rose-500',
    bgClass:     'bg-white dark:bg-slate-800',
    titleClass:  'text-rose-700 dark:text-rose-400',
    barClass:    'bg-rose-500',
    ariaRole:    'alert',
    ariaLive:    'assertive',
  },
  warning: {
    Icon:        AlertTriangle,
    iconClass:   'text-amber-500',
    borderClass: 'border-l-amber-500',
    bgClass:     'bg-white dark:bg-slate-800',
    titleClass:  'text-amber-700 dark:text-amber-400',
    barClass:    'bg-amber-500',
    ariaRole:    'alert',
    ariaLive:    'assertive',
  },
  info: {
    Icon:        Info,
    iconClass:   'text-blue-500',
    borderClass: 'border-l-blue-500',
    bgClass:     'bg-white dark:bg-slate-800',
    titleClass:  'text-blue-700 dark:text-blue-400',
    barClass:    'bg-blue-500',
    ariaRole:    'status',
    ariaLive:    'polite',
  },
};

// --- Progress bar -------------------------------------------------------------
// Shrinks from full width to zero over `duration` ms using a CSS animation.
// Sticky toasts (duration === 0) don't show a bar at all.
const ProgressBar = ({ duration, colorClass }) => {
  if (!duration || duration === 0) return null;
  return (
    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-100 dark:bg-slate-700 overflow-hidden rounded-b-xl">
      <div
        className={`h-full ${colorClass} origin-left`}
        style={{ animation: `toast-deplete ${duration}ms linear forwards` }}
        aria-hidden="true"
      />
    </div>
  );
};

// --- Keyframe injection -------------------------------------------------------
// Appended to <head> exactly once so we don't add a separate stylesheet.
// The IIFE + `injected` flag makes sure it's idempotent even in strict mode's
// double-invoke of effects.
const injectToastKeyframe = (() => {
  let injected = false;
  return () => {
    if (injected || typeof document === 'undefined') return;
    injected = true;
    const style = document.createElement('style');
    style.textContent = `
      @keyframes toast-deplete {
        from { transform: scaleX(1); }
        to   { transform: scaleX(0); }
      }
      @keyframes toast-slide-in {
        from { opacity: 0; transform: translateY(12px) scale(0.97); }
        to   { opacity: 1; transform: translateY(0)    scale(1);    }
      }
      @keyframes toast-slide-out {
        from { opacity: 1; transform: translateY(0)    scale(1);    max-height: 200px; margin-bottom: 0.5rem; }
        to   { opacity: 0; transform: translateY(8px)  scale(0.97); max-height: 0;     margin-bottom: 0;     }
      }
      .toast-enter { animation: toast-slide-in  0.28s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
      .toast-exit  { animation: toast-slide-out 0.22s ease-in forwards; }
    `;
    document.head.appendChild(style);
  };
})();

// --- Single toast card --------------------------------------------------------
const ToastCard = ({ toast, onRemove }) => {
  const config = TYPE_CONFIG[toast.type] || TYPE_CONFIG.info;
  const { Icon, iconClass, borderClass, bgClass, titleClass, barClass, ariaRole, ariaLive } = config;

  const [isExiting, setIsExiting] = useState(false);

  // Trigger the CSS exit animation, then remove from context after it finishes
  const handleDismiss = () => {
    setIsExiting(true);
    setTimeout(() => onRemove(toast.id), 210); // matches toast-slide-out duration
  };

  return (
    <div
      role={ariaRole}
      aria-live={ariaLive}
      aria-atomic="true"
      className={[
        'relative w-80 max-w-[calc(100vw-2rem)] overflow-hidden',
        `rounded-xl border border-l-4 ${borderClass}`,
        'border-slate-200 dark:border-slate-700',
        `${bgClass} shadow-card-hover`,
        'px-4 py-3.5',
        isExiting ? 'toast-exit' : 'toast-enter',
      ].join(' ')}
    >
      <div className="flex items-start gap-3">
        <Icon size={18} className={`${iconClass} flex-shrink-0 mt-0.5`} aria-hidden="true" />

        <div className="flex-1 min-w-0 pr-2">
          {toast.title && (
            <p className={`text-sm font-bold leading-tight mb-0.5 ${titleClass}`}>
              {toast.title}
            </p>
          )}
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-snug">
            {toast.message}
          </p>
        </div>

        <button
          onClick={handleDismiss}
          aria-label="Dismiss notification"
          className="flex-shrink-0 -mt-0.5 -mr-1 p-1.5 rounded-lg
                     text-slate-400 dark:text-slate-500
                     hover:text-slate-600 dark:hover:text-slate-300
                     hover:bg-slate-100 dark:hover:bg-slate-700
                     transition-colors duration-150
                     focus:outline-none focus:ring-2 focus:ring-slate-400"
        >
          <X size={14} />
        </button>
      </div>

      <ProgressBar duration={toast.duration} colorClass={barClass} />
    </div>
  );
};

// --- Toast container ----------------------------------------------------------
// Mounted once in App.jsx. Uses createPortal to render directly on <body> so
// it floats above every other z-index stacking context on the page.
// Newest toasts appear at the bottom of the stack (natural array order).
const ToastContainer = () => {
  const { toasts, removeToast } = useToast();

  // Inject the CSS keyframes once on first render
  const keyframesInjected = useRef(false);
  useEffect(() => {
    if (!keyframesInjected.current) {
      injectToastKeyframe();
      keyframesInjected.current = true;
    }
  }, []);

  if (toasts.length === 0) return null;

  return createPortal(
    <div
      className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2 items-end"
      aria-label="Notifications"
      onClick={(e) => e.stopPropagation()} // stop clicks bubbling to the page behind
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onRemove={removeToast} />
      ))}
    </div>,
    document.body
  );
};

export default ToastContainer;