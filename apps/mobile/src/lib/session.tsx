import { AuthTokens } from '@tagalong/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { connectTokenStore, request } from './api';
import { secureStorage } from './storage';

const KEY = 'tagalong.tokens';
const INVITE_KEY = 'tagalong.pendingInvite';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface SessionValue {
  status: Status;
  signIn: (tokens: AuthTokens) => Promise<void>;
  signOut: () => Promise<void>;
  /** An invite link opened while signed out, to return to after sign-in. */
  pendingInvite: string | null;
  setPendingInvite: (token: string | null) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

const persist = (key: string, value: string | null) => secureStorage.set(key, value);

const parseTokens = (raw: string | null): AuthTokens | null => {
  try {
    const result = raw ? AuthTokens.safeParse(JSON.parse(raw)) : null;
    return result?.success ? result.data : null;
  } catch {
    return null;
  }
};

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [pendingInvite, setPendingInviteState] = useState<string | null>(null);
  const tokens = useRef<AuthTokens | null>(null);

  const save = useCallback((next: AuthTokens | null) => {
    tokens.current = next;
    setStatus(next ? 'signedIn' : 'signedOut');
    void persist(KEY, next ? JSON.stringify(next) : null);
  }, []);

  const setPendingInvite = useCallback((token: string | null) => {
    setPendingInviteState(token);
    void persist(INVITE_KEY, token);
  }, []);

  // In a browser, several tabs share one saved session: follow the others'
  // sign-ins, refreshes and sign-outs instead of fighting over the tokens.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY) return;
      const next = parseTokens(e.newValue);
      tokens.current = next;
      setStatus(next ? 'signedIn' : 'signedOut');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    connectTokenStore({
      get: () => tokens.current,
      set: save,
      peekSaved: async () => parseTokens(await secureStorage.get(KEY)),
    });
    Promise.all([
      secureStorage.get(KEY),
      secureStorage.get(INVITE_KEY),
    ]).then(([raw, invite]) => {
      setPendingInviteState(invite);
      save(parseTokens(raw));
    });
  }, [save]);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      signIn: async (t) => save(t),
      signOut: async () => {
        await request('/auth/logout', { method: 'POST' }).catch(() => undefined);
        save(null);
      },
      pendingInvite,
      setPendingInvite,
    }),
    [status, save, pendingInvite, setPendingInvite],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export const useSession = () => {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
};
