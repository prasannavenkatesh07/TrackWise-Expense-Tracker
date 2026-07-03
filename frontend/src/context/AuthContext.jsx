/**
 * context/AuthContext.jsx
 *
 * Global auth state for the entire app.
 *
 * Exposes via useAuth():
 *   user            - logged-in user object (or null)
 *   token           - the raw JWT string (or null)
 *   isLoading       - true while we're verifying a stored token on page load
 *   isAuthenticated - shorthand boolean derived from !!user
 *   login()         - called after a successful /api/auth/login response
 *   loginWithGoogle() - handles Google OAuth ID token → our own JWT
 *   logout()        - wipes auth state
 *   updateUser()    - patches local user state without a round trip to /me
 *
 * Session persistence:
 *   The JWT is stored in localStorage under 'expenseToken'.
 *   On every page load, AuthContext reads it and calls GET /api/auth/me
 *   to confirm the token is still valid before letting the user through.
 *   If the request fails (expired/tampered token), everything is cleared.
 *
 * Axios integration:
 *   Setting axios.defaults.headers.common['Authorization'] here means
 *   every future axios call automatically includes the Bearer token -
 *   no manual headers needed in any component or controller.
 */

import { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);

// In production VITE_API_BASE_URL points to the deployed backend.
// In development, leaving it blank lets Vite's proxy handle /api/* → localhost:5000.
axios.defaults.baseURL = import.meta.env.VITE_API_BASE_URL || '';

export const AuthProvider = ({ children }) => {
  const [user,      setUser]      = useState(null);
  const [token,     setToken]     = useState(() => localStorage.getItem('expenseToken') || null);
  const [isLoading, setIsLoading] = useState(true); // true until the /me check completes

  // --- Sync the axios header whenever the token changes ----------------------
  // This covers login, logout, and the initial restore-from-localStorage case
  const setAxiosAuthHeader = (jwt) => {
    if (jwt) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${jwt}`;
    } else {
      delete axios.defaults.headers.common['Authorization'];
    }
  };

  // --- On mount: restore session from localStorage ---------------------------
  // Can't just trust whatever's in localStorage - the token might be expired.
  // Hitting /api/auth/me confirms the backend still accepts it.
  useEffect(() => {
    const restoreSession = async () => {
      const storedToken = localStorage.getItem('expenseToken');

      if (!storedToken) {
        setIsLoading(false);
        return;
      }

      setAxiosAuthHeader(storedToken);

      try {
        const { data } = await axios.get('/api/auth/me');
        if (data.success) {
          setUser(data.user);
          setToken(storedToken);
        } else {
          // Backend rejected the token for some reason - start fresh
          clearAuth();
        }
      } catch (error) {
        // Most likely a 401 (expired/invalid token) - clear everything
        console.warn('Session restore failed:', error?.response?.data?.message || error.message);
        clearAuth();
      } finally {
        setIsLoading(false);
      }
    };

    restoreSession();
  }, []); // runs once on mount - empty deps is intentional here

  // --- clearAuth ------------------------------------------------------------
  // Central place to wipe all auth state - used by logout() and the restore failure path
  const clearAuth = () => {
    localStorage.removeItem('expenseToken');
    setAxiosAuthHeader(null);
    setUser(null);
    setToken(null);
  };

  // --- login ----------------------------------------------------------------
  // Called by LoginPage after a successful POST /api/auth/login response
  const login = (jwt, userData) => {
    localStorage.setItem('expenseToken', jwt);
    setAxiosAuthHeader(jwt);
    setToken(jwt);
    setUser(userData);
  };

  // --- loginWithGoogle ------------------------------------------------------
  // Sends the raw Google ID token to our backend, which verifies it and returns
  // our own app JWT. Then uses the same storage path as regular login.
  const loginWithGoogle = async (credentialToken) => {
    const { data } = await axios.post('/api/auth/google-login', { token: credentialToken });
    const { token: appToken, user: userData } = data;
    localStorage.setItem('expenseToken', appToken);
    setAxiosAuthHeader(appToken);
    setToken(appToken);
    setUser(userData);
  };

  // --- logout ---------------------------------------------------------------
  // Navigation back to /login is handled by the caller (Navbar) or by
  // ProtectedRoute watching the user state drop to null
  const logout = () => {
    clearAuth();
  };

  // --- updateUser -----------------------------------------------------------
  // Merges partial updates into local user state - used after budget changes
  // so the Navbar shows the new monthlyBudget without a full /me re-fetch
  const updateUser = (updates) => {
    setUser((prev) => ({ ...prev, ...updates }));
  };

  return (
    <AuthContext.Provider value={{
      user,
      token,
      isLoading,
      login,
      loginWithGoogle,
      logout,
      updateUser,
      isAuthenticated: !!user,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

// --- useAuth hook -------------------------------------------------------------
// Throws a clear error if used outside AuthProvider - saved me debugging time
// more than once when I accidentally used it in a component outside the tree
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context)
    throw new Error('useAuth() must be used inside an <AuthProvider>. Check your component tree.');
  return context;
};

export default AuthContext;