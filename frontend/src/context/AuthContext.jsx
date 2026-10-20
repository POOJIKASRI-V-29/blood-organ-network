import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi, tokenStore } from '../services/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadSession = useCallback(async () => {
    if (!tokenStore.get()) { setUser(null); setLoading(false); return; }
    try {
      setUser(await authApi.me());
    } catch {
      tokenStore.clear();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSession(); }, [loadSession]);

  // The axios interceptor fires this when a request comes back 401.
  useEffect(() => {
    const onUnauthorised = () => setUser(null);
    window.addEventListener('bon:unauthorised', onUnauthorised);
    return () => window.removeEventListener('bon:unauthorised', onUnauthorised);
  }, []);

  const login = useCallback(async (email, password) => {
    const result = await authApi.login({ email, password });
    tokenStore.set(result.token);
    setUser(await authApi.me());
    return result.user;
  }, []);

  const register = useCallback(async (payload) => {
    const result = await authApi.register(payload);
    tokenStore.set(result.token);
    setUser(await authApi.me());
    return result.user;
  }, []);

  const logout = useCallback(async () => {
    try { await authApi.logout(); } catch { /* the token may already be gone */ }
    tokenStore.clear();
    setUser(null);
  }, []);

  const value = useMemo(() => ({
    user, loading, login, register, logout,
    refresh: loadSession,
    isAuthenticated: Boolean(user),
    role: user?.role ?? null,
    hasRole: (...roles) => Boolean(user && roles.includes(user.role)),
  }), [user, loading, login, register, logout, loadSession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
}
