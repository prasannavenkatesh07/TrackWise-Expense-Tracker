/**
 * main.jsx - React app entry point
 *
 * First file Vite executes when the browser loads the app.
 * Mounts <App /> into the #root div defined in index.html.
 *
 * React 18's createRoot() unlocks Concurrent Mode - things like automatic
 * batching of state updates and the useTransition hook. The old ReactDOM.render()
 * is deprecated so this is the correct way to do it now.
 *
 * StrictMode:
 *   Double-invokes effects and state initialisers in development to surface
 *   bugs early (like a useEffect that doesn't clean up properly).
 *   Has zero effect on production builds - nothing is actually run twice in prod.
 *   It's the reason the keyframe injection helper in ToastContainer.jsx uses
 *   an `injected` flag - without it, StrictMode would add the <style> tag twice.
 *
 * Global error listeners (dev only):
 *   React's ErrorBoundary catches errors during rendering, but it can't catch
 *   async errors or unhandled promise rejections. The two window listeners below
 *   fill that gap and log them to the console so nothing fails silently
 *   during development or a demo.
 *
 * MERN Data Flow starting point:
 *   index.html → main.jsx → App.jsx → ThemeProvider → BrowserRouter
 *   → AuthProvider (restores JWT session) → routes → pages → API calls
 */

import { StrictMode }   from 'react';
import { createRoot }   from 'react-dom/client';
import { GoogleOAuthProvider } from '@react-oauth/google';

// Global styles: Tailwind directives, CSS variables, and component classes
import './index.css';
import App from './App.jsx';

// --- Dev-only async error logging --------------------------------------------
// These catch the errors React's ErrorBoundary can't - async callbacks and
// forgotten .catch() calls. Wrapped in DEV guard so they never ship to prod.
if (import.meta.env.DEV) {
  // Catches errors thrown outside the React render cycle (e.g. in vanilla JS
  // setTimeout callbacks or window event listeners)
  window.addEventListener('error', (event) => {
    console.error(
      '[TrackWise] Uncaught global error:',
      event.message,
      '\nSource:', event.filename,
      '\nLine:',   event.lineno
    );
  });

  // Catches unhandled Promise rejections - the most common source of silent
  // failures when you forget to await something or omit a .catch()
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[TrackWise] Unhandled Promise rejection:', event.reason);
  });
}

// --- Mount --------------------------------------------------------------------
const rootElement = document.getElementById('root');

// Defensive guard - gives a clear error message if index.html is misconfigured
// instead of a cryptic "Cannot read properties of null" crash
if (!rootElement) {
  throw new Error(
    '[TrackWise] Could not find #root element in index.html. ' +
    'Make sure <div id="root"></div> exists in the <body>.'
  );
}

createRoot(rootElement).render(
  <StrictMode>
    {/* GoogleOAuthProvider must wrap the entire app so the Google Sign-In
        button in LoginPage and RegisterPage can read the client ID */}
    <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID}>
      <App />
    </GoogleOAuthProvider>
  </StrictMode>
);