/**
 * context/ThemeContext.jsx
 *
 * Dark/light mode toggle - persisted to localStorage so it survives refreshes.
 *
 * Strategy: Tailwind's `darkMode: 'class'` means dark mode activates when
 * a `dark` class is present on the <html> element. This context manages that
 * class addition/removal programmatically via a button in the Navbar.
 *
 * The CSS custom properties in index.css (--chart-text, --bg-card, etc.) also
 * react to the .dark selector, so Chart.js and other non-Tailwind styles
 * stay in sync automatically.
 *
 * On first load with no stored preference, it checks the OS-level
 * prefers-color-scheme setting so the app doesn't blindly force light mode
 * on users who've set their system to dark.
 *
 * Usage:
 *   const { isDark, toggleTheme } = useTheme();
 */

import { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext(null);

export const ThemeProvider = ({ children }) => {
  // Initialise from localStorage, falling back to the system preference
  const [isDark, setIsDark] = useState(() => {
    const stored = localStorage.getItem('expenseTheme');
    if (stored) return stored === 'dark';
    // No stored preference - respect whatever the OS is set to
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  // Add/remove `dark` on <html> whenever isDark changes, and persist the choice
  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('expenseTheme', isDark ? 'dark' : 'light');
  }, [isDark]);

  const toggleTheme = () => setIsDark((prev) => !prev);

  return (
    <ThemeContext.Provider value={{ isDark, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context)
    throw new Error('useTheme() must be used inside a <ThemeProvider>.');
  return context;
};

export default ThemeContext;