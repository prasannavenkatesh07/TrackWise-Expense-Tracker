/** @type {import('tailwindcss').Config} */
export default {
  // --- Dark mode strategy --------------------------------------------------
  // 'class' means Tailwind activates dark: variants when a `dark` class
  // is present on <html>. ThemeContext.jsx adds/removes that class whenever
  // the user clicks the toggle in the Navbar.
  // The alternative ('media') would just follow the OS setting with no toggle -
  // that doesn't work for a product where users should be able to pick.
  darkMode: "class",

  // --- Content paths -------------------------------------------------------
  // Tailwind scans these files at build time to tree-shake any utility class
  // that isn't actually used - keeps the production CSS bundle small
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],

  theme: {
    extend: {
      // --- Custom fonts ---------------------------------------------------
      // Sora: geometric sans-serif - confident, modern, works well at both
      //       display sizes (stat cards) and body sizes (table rows)
      // JetBrains Mono: for currency amounts and numeric columns -
      //       tabular-nums keeps digits the same width so they line up in tables
      // Both are loaded via Google Fonts in index.html
      fontFamily: {
        sans: ["Sora", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },

      // --- Extended colour palette ----------------------------------------
      // These extend (not replace) Tailwind's default palette
      colors: {
        // Deep navy for the navbar - richer than default slate-900
        navy: {
          DEFAULT: "#0f172a",
          light: "#1e293b",
          subtle: "#334155",
        },
        // Emerald accent - the main brand colour used on buttons, badges, charts
        accent: {
          DEFAULT: "#10b981", // emerald-500
          light: "#d1fae5", // emerald-100
          dark: "#059669", // emerald-600
        },
        // Page background tokens - used in the CSS variables in index.css
        canvas: {
          light: "#f8fafc", // slate-50
          dark: "#0f172a", // slate-900
        },
      },

      // --- Shadows --------------------------------------------------------
      // Layered shadows give cards depth without looking harsh -
      // the two-layer approach (tight + diffuse) mimics how real shadows work
      boxShadow: {
        card: "0 1px 3px 0 rgb(0 0 0 / 0.06), 0 4px 16px -2px rgb(0 0 0 / 0.08)",
        "card-hover":
          "0 4px 6px -1px rgb(0 0 0 / 0.08), 0 12px 32px -4px rgb(0 0 0 / 0.12)",
        "glow-emerald": "0 0 24px -4px rgb(16 185 129 / 0.35)", // for the logo mark in Navbar
      },

      // --- Border radius ---------------------------------------------------
      // Larger radius values for the card and button shapes - default xl (0.75rem)
      // felt too sharp for the soft FinTech aesthetic
      borderRadius: {
        xl: "1rem",
        "2xl": "1.25rem",
        "3xl": "1.5rem",
      },

      // --- Keyframes ------------------------------------------------------
      keyframes: {
        // Used by alert banners and dropdown menus
        "slide-down": {
          "0%": { opacity: "0", transform: "translateY(-8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        // Page route transitions
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        // Budget progress bar fill - reads --progress-width CSS variable
        // because Tailwind JIT can't generate dynamic arbitrary widths at runtime
        "progress-fill": {
          "0%": { width: "0%" },
          "100%": { width: "var(--progress-width)" },
        },
        // Gentle pulse for loading text and status indicators
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.7" },
        },
        // Skeleton loading shimmer sweep
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },

      animation: {
        "slide-down": "slide-down 0.25s ease-out",
        "fade-in": "fade-in 0.3s ease-out",
        "progress-fill": "progress-fill 0.6s ease-out forwards",
        "pulse-soft": "pulse-soft 2s ease-in-out infinite",
        shimmer: "shimmer 1.8s linear infinite",
      },

      // --- Misc ------------------------------------------------------------
      transitionDuration: {
        400: "400ms",
      },

      // TODO: clean up spacing tokens - 18 and 88 were added early on
      // and I'm not sure they're still used anywhere
      spacing: {
        18: "4.5rem",
        88: "22rem",
      },
    },
  },

  plugins: [],
};
