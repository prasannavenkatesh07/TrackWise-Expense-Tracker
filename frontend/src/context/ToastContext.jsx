/**
 * context/ToastContext.jsx
 *
 * Global toast notification system - any component can fire a toast without
 * prop-drilling or managing local state.
 *
 * Toast object shape:
 *   {
 *     id:       string,            - unique key generated on creation
 *     type:     'success' | 'error' | 'warning' | 'info',
 *     title:    string | undefined, - optional bold headline
 *     message:  string,            - the actual body text
 *     duration: number,            - ms before auto-dismiss (0 = sticky)
 *   }
 *
 * Usage from any component:
 *   const { toast } = useToast();
 *   toast.success('Transaction saved!');
 *   toast.error('Something went wrong.', 'API Error');
 *   toast.warning('Approaching budget limit.');
 *   toast.info('Use the 🎤 button to dictate transactions.');
 *
 * How auto-dismiss works:
 *   Each toast gets its own setTimeout stored in a ref map.
 *   Manual dismiss clears that timer first to prevent the removal running twice.
 *   Sticky toasts (duration = 0) never get a timer.
 *
 * ToastContainer in App.jsx reads the toasts array and renders the visual stack.
 */

import { createContext, useContext, useState, useCallback, useRef } from 'react';

const ToastContext = createContext(null);

// Default auto-dismiss durations - errors stay longer since users need to read them
const DEFAULT_DURATIONS = {
  success: 4000,
  error:   6000,
  warning: 5000,
  info:    4000,
};

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  // Map of toast id → setTimeout id - kept in a ref so it doesn't trigger re-renders
  const timers = useRef({});

  // --- removeToast ----------------------------------------------------------
  const removeToast = useCallback((id) => {
    // Clear the auto-dismiss timer first - otherwise it fires after manual dismiss
    // and tries to remove a toast that's already gone
    if (timers.current[id]) {
      clearTimeout(timers.current[id]);
      delete timers.current[id];
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // --- addToast -------------------------------------------------------------
  const addToast = useCallback(({ type = 'info', message, title, duration }) => {
    // Using both Date.now() and a random suffix to avoid collisions if two
    // toasts fire in the same millisecond (happens more than you'd think in dev)
    const id               = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const resolvedDuration = duration ?? DEFAULT_DURATIONS[type] ?? 4000;

    const toast = { id, type, message, title, duration: resolvedDuration };

    setToasts((prev) => {
      const updated = [...prev, toast];
      // Cap at 5 simultaneous toasts - drop the oldest if we go over
      return updated.length > 5 ? updated.slice(updated.length - 5) : updated;
    });

    if (resolvedDuration > 0)
      timers.current[id] = setTimeout(() => removeToast(id), resolvedDuration);

    return id; // caller can use this to dismiss the toast programmatically early
  }, [removeToast]);

  // --- Convenience methods --------------------------------------------------
  // Argument order: message first, title second - title is optional in most calls
  const toast = {
    success: (message, title, duration) => addToast({ type: 'success', message, title, duration }),
    error:   (message, title, duration) => addToast({ type: 'error',   message, title, duration }),
    warning: (message, title, duration) => addToast({ type: 'warning', message, title, duration }),
    info:    (message, title, duration) => addToast({ type: 'info',    message, title, duration }),
    add:     addToast,     // raw access for custom config
    dismiss: removeToast,  // manual dismiss by id
  };

  return (
    <ToastContext.Provider value={{ toasts, toast, removeToast, addToast }}>
      {children}
    </ToastContext.Provider>
  );
};

// --- useToast hook ------------------------------------------------------------
export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context)
    throw new Error(
      'useToast() must be used inside a <ToastProvider>. ' +
      'Make sure <ToastProvider> wraps your component tree in App.jsx.'
    );
  return context;
};

export default ToastContext;