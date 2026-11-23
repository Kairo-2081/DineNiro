import React from 'react';
import { api, UNAUTHORIZED_EVENT } from '../lib/api';
import type { Session } from '../types';

interface AuthContextValue {
  session: Session | null;
  isLoading: boolean;
  /** Store the session a sign-in or application returned. */
  setSession: (session: Session) => void;
  /** Reload the account and memberships, e.g. after a status change. */
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSessionState] = React.useState<Session | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    try {
      setSessionState(await api.currentSession());
    } catch (error) {
      console.error('Could not restore the session:', error);
      setSessionState(null);
    }
  }, []);

  const logout = React.useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Already signed out on the server; clear the local state anyway.
    }
    setSessionState(null);
  }, []);

  React.useEffect(() => {
    void refresh().finally(() => setIsLoading(false));
  }, [refresh]);

  React.useEffect(() => {
    const onUnauthorized = () => setSessionState(null);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const value = React.useMemo(
    () => ({ session, isLoading, setSession: setSessionState, refresh, logout }),
    [session, isLoading, refresh, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = React.useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
