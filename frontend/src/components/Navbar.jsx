/**
 * components/Navbar.jsx
 *
 * Top navigation bar - rendered on every protected page via the ProtectedRoute wrapper in App.jsx.
 *
 * Features:
 *   - Logo + brand name
 *   - Desktop nav links with active underline/colour indicator
 *   - Dark/light mode toggle
 *   - User avatar (initials + avatarColor from the DB)
 *   - Profile dropdown: budget display, Settings link, Sign out
 *   - Mobile hamburger menu with the same nav links + an "Ask AI" button
 *     that fires a global window event to open the Chatbot widget
 *
 * The "Ask AI" mobile button dispatches a custom window event ('open-chatbot')
 * instead of lifting state - cleaner than threading a callback through the layout
 * just for one button.
 */

import { useState } from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, History, BarChart2, Target,
  Settings, Sun, Moon, LogOut, ChevronDown,
  Menu, X, Wallet, Sparkles,
} from 'lucide-react';
import { useAuth }  from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';

// --- NavItem ------------------------------------------------------------------
// Reusable nav link - React Router's NavLink gives us isActive for free
// so we don't have to manually compare the current path
const NavItem = ({ to, icon: Icon, label, onClick }) => (
  <NavLink
    to={to}
    onClick={onClick}
    className={({ isActive }) =>
      [
        'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium',
        'transition-all duration-200',
        isActive
          ? 'text-emerald-400 bg-slate-800 dark:bg-slate-800'
          : 'text-slate-400 hover:text-white hover:bg-slate-800 dark:hover:bg-slate-800',
      ].join(' ')
    }
  >
    {({ isActive }) => (
      <>
        <Icon size={16} className={isActive ? 'text-emerald-400' : ''} />
        <span>{label}</span>
      </>
    )}
  </NavLink>
);

// --- UserAvatar ---------------------------------------------------------------
// Generates a coloured circle with the user's initials.
// "John Doe" → "JD", "Alice" → "A"
const UserAvatar = ({ name, color = '#10b981', size = 'md' }) => {
  const initials = name
    ? name.trim().split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
    : '?';

  const sizeClasses = {
    sm: 'w-7 h-7 text-xs',
    md: 'w-9 h-9 text-sm',
    lg: 'w-11 h-11 text-base',
  };

  return (
    <div
      className={`${sizeClasses[size]} rounded-xl flex items-center justify-center font-bold text-white flex-shrink-0 select-none`}
      style={{ backgroundColor: color }}
      aria-label={`Avatar for ${name}`}
    >
      {initials}
    </div>
  );
};

// --- Main Navbar component ----------------------------------------------------
const Navbar = () => {
  const { user, logout }      = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const { toast }             = useToast();
  const navigate              = useNavigate();

  const [isDropdownOpen,   setIsDropdownOpen]   = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleLogout = () => {
    setIsDropdownOpen(false);
    setIsMobileMenuOpen(false);
    logout();
    toast.info('Signed out successfully.');
    navigate('/login', { replace: true });
  };

  const closeMobileMenu = () => setIsMobileMenuOpen(false);

  const navLinks = [
    { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/history',   icon: History,         label: 'History'   },
    { to: '/reports',   icon: BarChart2,        label: 'Reports'   },
    { to: '/budgets',   icon: Target,           label: 'Budgets'   },
  ];

  return (
    <nav
      className="bg-slate-900 dark:bg-slate-950 border-b border-slate-800 sticky top-0 z-50 transition-colors duration-200"
      role="navigation"
      aria-label="Main navigation"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">

          {/* Logo + brand */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="w-9 h-9 rounded-xl bg-emerald-500 flex items-center justify-center shadow-glow-emerald">
              <Wallet size={18} className="text-white" />
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-white font-bold text-lg tracking-tight leading-none">TrackWise</span>
              <span className="text-emerald-500 text-[10px] font-semibold uppercase tracking-widest leading-none mt-0.5">
                Expense Tracker
              </span>
            </div>
          </div>

          {/* Desktop nav links */}
          <div className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => <NavItem key={link.to} {...link} />)}
          </div>

          {/* Right-side controls */}
          <div className="flex items-center gap-2">

            {/* Dark/light toggle */}
            <button
              onClick={toggleTheme}
              className="btn-ghost text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              title={isDark ? 'Light mode' : 'Dark mode'}
            >
              {isDark
                ? <Sun  size={18} className="text-amber-400" />
                : <Moon size={18} />
              }
            </button>

            {/* User profile dropdown (desktop only) */}
            <div className="relative hidden md:block">
              <button
                onClick={() => setIsDropdownOpen((prev) => !prev)}
                className="flex items-center gap-2.5 px-2 py-1.5 rounded-xl
                           hover:bg-slate-800 transition-all duration-200
                           focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-slate-900"
                aria-haspopup="true"
                aria-expanded={isDropdownOpen}
              >
                <UserAvatar name={user?.name} color={user?.avatarColor || '#10b981'} size="sm" />
                <div className="flex flex-col items-start leading-none">
                  <span className="text-white text-sm font-semibold truncate max-w-[120px]">
                    {user?.name || 'User'}
                  </span>
                  <span className="text-slate-500 dark:text-slate-400 text-xs truncate max-w-[120px]">
                    {user?.email || ''}
                  </span>
                </div>
                <ChevronDown
                  size={14}
                  className={`text-slate-500 transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {isDropdownOpen && (
                <>
                  {/* Invisible overlay - clicking anywhere outside closes the dropdown */}
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setIsDropdownOpen(false)}
                    aria-hidden="true"
                  />

                  <div
                    className="absolute right-0 top-full mt-2 w-56 z-20
                               bg-slate-800 dark:bg-slate-900 border border-slate-700 dark:border-slate-800
                               rounded-2xl shadow-xl py-2 animate-slide-down"
                    role="menu"
                  >
                    {/* User info header */}
                    <div className="px-4 py-3 border-b border-slate-700 dark:border-slate-800">
                      <div className="flex items-center gap-3">
                        <UserAvatar name={user?.name} color={user?.avatarColor || '#10b981'} size="md" />
                        <div>
                          <p className="text-white text-sm font-semibold">{user?.name}</p>
                          <p className="text-slate-400 text-xs mt-0.5 truncate max-w-[140px]">{user?.email}</p>
                        </div>
                      </div>
                    </div>

                    {/* Monthly budget display */}
                    <div className="px-4 py-2.5 border-b border-slate-700 dark:border-slate-800">
                      <p className="text-slate-500 dark:text-slate-400 text-xs font-semibold uppercase tracking-wider mb-1">
                        Monthly Budget
                      </p>
                      <p className="text-emerald-400 font-numeric text-sm font-semibold">
                        ₹{(user?.monthlyBudget || 50000).toLocaleString('en-IN')}
                      </p>
                    </div>

                    {/* Settings - React Router Link, no hard reload */}
                    <Link
                      to="/settings"
                      className="w-full flex items-center gap-3 px-4 py-2.5
                                 text-slate-300 hover:text-white hover:bg-slate-700 dark:hover:bg-slate-800
                                 transition-colors duration-150 text-sm"
                      role="menuitem"
                      onClick={() => setIsDropdownOpen(false)}
                    >
                      <Settings size={15} className="text-slate-400" />
                      Settings
                    </Link>

                    {/* Sign out */}
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-3 px-4 py-2.5
                                 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10
                                 transition-colors duration-150 text-sm rounded-b-2xl"
                      role="menuitem"
                    >
                      <LogOut size={15} />
                      Sign out
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Hamburger toggle (mobile only) */}
            <button
              onClick={() => setIsMobileMenuOpen((prev) => !prev)}
              className="btn-ghost text-slate-400 hover:text-white hover:bg-slate-800 transition-colors md:hidden"
              aria-label={isMobileMenuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={isMobileMenuOpen}
            >
              {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
      </div>

      {/* -- Mobile menu -------------------------------------------------------- */}
      {isMobileMenuOpen && (
        <div
          className="md:hidden border-t border-slate-800 bg-slate-900 dark:bg-slate-950 px-4 py-4 space-y-1 animate-slide-down"
          role="menu"
          aria-label="Mobile navigation"
        >
          {navLinks.map((link) => (
            <NavItem key={link.to} {...link} onClick={closeMobileMenu} />
          ))}

          {/* Ask AI button - fires the global event that Chatbot.jsx listens for */}
          <button
            onClick={() => {
              window.dispatchEvent(new Event('open-chatbot'));
              closeMobileMenu();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium
                       text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <Sparkles size={16} />
            Ask AI
          </button>

          <NavItem to="/settings" icon={Settings} label="Settings" onClick={closeMobileMenu} />

          <div className="border-t border-slate-800 my-3" />

          {/* User info row */}
          <div className="flex items-center gap-3 px-3 py-2">
            <UserAvatar name={user?.name} color={user?.avatarColor || '#10b981'} size="sm" />
            <div>
              <p className="text-white text-sm font-semibold">{user?.name}</p>
              <p className="text-slate-500 dark:text-slate-400 text-xs">{user?.email}</p>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg
                       text-rose-400 hover:bg-slate-800 transition-colors duration-150 text-sm font-medium"
          >
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      )}
    </nav>
  );
};

export default Navbar;