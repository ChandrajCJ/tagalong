import { AuthTokens } from '@tagalong/shared';
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { connectTokenStore, request } from './api';

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

// Storage can fail (for example on web); the app then keeps state for this session only.
const persist = (key: string, value: string | null) =>
  (value ? SecureStore.setItemAsync(key, value) : SecureStore.deleteItemAsync(key)).catch(() => {});

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

  useEffect(() => {
    connectTokenStore({ get: () => tokens.current, set: save });
    Promise.all([
      SecureStore.getItemAsync(KEY).catch(() => null),
      SecureStore.getItemAsync(INVITE_KEY).catch(() => null),
    ]).then(([raw, invite]) => {
      let parsed: AuthTokens | null = null;
      try {
        const result = raw ? AuthTokens.safeParse(JSON.parse(raw)) : null;
        parsed = result?.success ? result.data : null;
      } catch {
        parsed = null;
      }
      setPendingInviteState(invite);
      save(parsed);
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
