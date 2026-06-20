/**
 * components/Navbar.jsx
 *
 * Top Navigation Bar — rendered on every protected page via App.jsx's ProtectedRoute.
 *
 * Features:
 * - TrackWise logo + brand name
 * - Navigation links: Dashboard, History
 * - Active link indicator (underline + colour)
 * - Dark / Light mode toggle button
 * - User avatar (initials + avatarColor)
 * - Logout button with dropdown menu
 * - Mobile-responsive hamburger menu
 *
 * Design System:
 * - Background: bg-slate-900 (nav) with border-b border-slate-800 separator
 * - Text: text-white / text-slate-400 for inactive links
 * - Accent: emerald-400 for active states and the logo mark
 * - All interactive elements include hover, focus, and transition states
 */

import { useState } from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  History,
  BarChart2,
  Target,
  Settings,
  Sun,
  Moon,
  LogOut,
  ChevronDown,
  Menu,
  X,
  Wallet,
  User,
  Sparkles, // ✦ Added Sparkles for the mobile AI button
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext'; // Phase B

// ── NavItem — reusable nav link with active state styling ─────────────────────
const NavItem = ({ to, icon: Icon, label, onClick }) => (
  <NavLink
    to={to}
    onClick={onClick}
    className={({ isActive }) =>
      [
        'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium',
        'transition-all duration-200',
        isActive
          ? 'text-emerald-400 bg-slate-800 dark:bg-slate-800'           // Active state
          : 'text-slate-400 hover:text-white hover:bg-slate-800 dark:hover:bg-slate-800', // Inactive
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

// ── UserAvatar — generates initials-based avatar ─────────────────────────────
const UserAvatar = ({ name, color = '#10b981', size = 'md' }) => {
  // Extract initials: "John Doe" → "JD", "Alice" → "A"
  const initials = name
    ? name
        .trim()
        .split(' ')
        .map((w) => w[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
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

// ── Main Navbar Component ─────────────────────────────────────────────────────
const Navbar = () => {
  const { user, logout } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const { toast } = useToast(); // Phase B
  const navigate = useNavigate();

  // State: user profile dropdown open/closed
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // State: mobile hamburger menu open/closed
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleLogout = () => {
    setIsDropdownOpen(false);
    setIsMobileMenuOpen(false);
    logout();
    toast.info('Signed out successfully.');
    navigate('/login', { replace: true });
  };

  const closeMobileMenu = () => setIsMobileMenuOpen(false);

  // ── Nav Links Config ─────────────────────────────────────────────────────────
  const navLinks = [
    { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/history',   icon: History,         label: 'History'   },
    { to: '/reports',   icon: BarChart2,        label: 'Reports'   },
    { to: '/budgets',   icon: Target,           label: 'Budgets'   },
  ];

  return (
    // Use <nav> semantic element as required by the blueprint's HTML5 spec
    <nav
      className="bg-slate-900 dark:bg-slate-950 border-b border-slate-800 dark:border-slate-800 sticky top-0 z-50 transition-colors duration-200"
      role="navigation"
      aria-label="Main navigation"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">

          {/* ── Logo & Brand ────────────────────────────────────────────── */}
          <div className="flex items-center gap-3 flex-shrink-0">
            {/* Logo mark */}
            <div className="w-9 h-9 rounded-xl bg-emerald-500 flex items-center justify-center shadow-glow-emerald">
              <Wallet size={18} className="text-white" />
            </div>

            {/* Brand name */}
            <div className="flex flex-col leading-none">
              <span className="text-white font-bold text-lg tracking-tight leading-none">
                TrackWise
              </span>
              <span className="text-emerald-500 text-[10px] font-semibold uppercase tracking-widest leading-none mt-0.5">
                Expense Tracker
              </span>
            </div>
          </div>

          {/* ── Desktop Navigation Links ────────────────────────────────── */}
          <div className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => (
              <NavItem key={link.to} {...link} />
            ))}
          </div>

          {/* ── Right Side Controls ──────────────────────────────────────── */}
          <div className="flex items-center gap-2">

            {/* Dark / Light Mode Toggle */}
            <button
              onClick={toggleTheme}
              className="btn-ghost text-slate-400 hover:text-white hover:bg-slate-800 dark:hover:bg-slate-800 transition-colors"
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              title={isDark ? 'Light mode' : 'Dark mode'}
            >
              {isDark ? (
                <Sun size={18} className="text-amber-400" />
              ) : (
                <Moon size={18} />
              )}
            </button>

            {/* User Profile Dropdown */}
            <div className="relative hidden md:block">
              <button
                onClick={() => setIsDropdownOpen((prev) => !prev)}
                className="flex items-center gap-2.5 px-2 py-1.5 rounded-xl
                           hover:bg-slate-800 dark:hover:bg-slate-800 transition-all duration-200
                           focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-slate-900"
                aria-haspopup="true"
                aria-expanded={isDropdownOpen}
              >
                <UserAvatar
                  name={user?.name}
                  color={user?.avatarColor || '#10b981'}
                  size="sm"
                />
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
                  className={`text-slate-500 dark:text-slate-400 transition-transform duration-200 ${
                    isDropdownOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {/* Dropdown Menu */}
              {isDropdownOpen && (
                <>
                  {/* Invisible overlay to close dropdown on outside click */}
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setIsDropdownOpen(false)}
                    aria-hidden="true"
                  />

                  <div
                    className="absolute right-0 top-full mt-2 w-56 z-20
                               bg-slate-800 dark:bg-slate-900 border border-slate-700 dark:border-slate-800 rounded-2xl
                               shadow-xl py-2 animate-slide-down"
                    role="menu"
                  >
                    {/* User info header */}
                    <div className="px-4 py-3 border-b border-slate-700 dark:border-slate-800">
                      <div className="flex items-center gap-3">
                        <UserAvatar
                          name={user?.name}
                          color={user?.avatarColor || '#10b981'}
                          size="md"
                        />
                        <div>
                          <p className="text-white text-sm font-semibold">
                            {user?.name}
                          </p>
                          <p className="text-slate-400 text-xs mt-0.5 truncate max-w-[140px]">
                            {user?.email}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Monthly Budget info */}
                    <div className="px-4 py-2.5 border-b border-slate-700 dark:border-slate-800">
                      <p className="text-slate-500 dark:text-slate-400 text-xs font-semibold uppercase tracking-wider mb-1">
                        Monthly Budget
                      </p>
                      <p className="text-emerald-400 font-numeric text-sm font-semibold">
                        ₹{(user?.monthlyBudget || 50000).toLocaleString('en-IN')}
                      </p>
                    </div>

                    {/* Settings link — uses React Router Link (no hard reload) */}
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

                    {/* Logout button */}
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-3 px-4 py-2.5
                                 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 dark:hover:bg-rose-500/10
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

            {/* Mobile Hamburger Toggle */}
            <button
              onClick={() => setIsMobileMenuOpen((prev) => !prev)}
              className="btn-ghost text-slate-400 hover:text-white hover:bg-slate-800 dark:hover:bg-slate-800 transition-colors md:hidden"
              aria-label={isMobileMenuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={isMobileMenuOpen}
            >
              {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
      </div>

      {/* ── Mobile Menu ────────────────────────────────────────────────────── */}
      {isMobileMenuOpen && (
        <div
          className="md:hidden border-t border-slate-800 dark:border-slate-800 bg-slate-900 dark:bg-slate-950 px-4 py-4
                     space-y-1 animate-slide-down"
          role="menu"
          aria-label="Mobile navigation"
        >
          {/* Nav links */}
          {navLinks.map((link) => (
            <NavItem
              key={link.to}
              {...link}
              onClick={closeMobileMenu}
            />
          ))}

          {/* ✦ NEW: Ask AI link for Mobile (Triggers global event to open Chatbot) */}
          <button
            onClick={() => {
              window.dispatchEvent(new Event('open-chatbot'));
              closeMobileMenu();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium
           text-slate-400 hover:text-white hover:bg-slate-800 dark:hover:bg-slate-800 transition-colors"
          >
            <Sparkles size={16} />
            Ask AI
          </button>

          {/* Settings link for Mobile */}
          <NavItem
            to="/settings"
            icon={Settings}
            label="Settings"
            onClick={closeMobileMenu}
          />

          {/* Divider */}
          <div className="border-t border-slate-800 dark:border-slate-800 my-3" />

          {/* User info */}
          <div className="flex items-center gap-3 px-3 py-2">
            <UserAvatar
              name={user?.name}
              color={user?.avatarColor || '#10b981'}
              size="sm"
            />
            <div>
              <p className="text-white text-sm font-semibold">{user?.name}</p>
              <p className="text-slate-500 dark:text-slate-400 text-xs">{user?.email}</p>
            </div>
          </div>

          {/* Logout button */}
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg
                       text-rose-400 hover:bg-slate-800 dark:hover:bg-slate-800 transition-colors duration-150
                       text-sm font-medium"
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