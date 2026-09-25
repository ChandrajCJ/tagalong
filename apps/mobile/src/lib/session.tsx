import { AuthTokens } from '@tagalong/shared';
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { connectTokenStore, request } from './api';

const KEY = 'tagalong.tokens';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface SessionValue {
  status: Status;
  signIn: (tokens: AuthTokens) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const tokens = useRef<AuthTokens | null>(null);

  const save = useCallback((next: AuthTokens | null) => {
    tokens.current = next;
    setStatus(next ? 'signedIn' : 'signedOut');
    // If storage fails (for example on web), stay signed in for this session only.
    const write = next
      ? SecureStore.setItemAsync(KEY, JSON.stringify(next))
      : SecureStore.deleteItemAsync(KEY);
    write.catch(() => {});
  }, []);

  useEffect(() => {
    connectTokenStore({ get: () => tokens.current, set: save });
    SecureStore.getItemAsync(KEY)
      .then((raw) => {
        const parsed = raw ? AuthTokens.safeParse(JSON.parse(raw)) : null;
        save(parsed?.success ? parsed.data : null);
      })
      .catch(() => save(null));
  }, [save]);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      signIn: async (t) => save(t),
      signOut: async () => {
        await request('/auth/logout', { method: 'POST' }).catch(() => undefined);
        save(null);
      },
    }),
    [status, save],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export const useSession = () => {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
};
