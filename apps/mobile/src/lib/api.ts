import { AuthTokens, CLIENT_ID_HEADER } from '@tagalong/shared';
import Constants from 'expo-constants';
import type { z } from 'zod';
import { CLIENT_ID } from './client-id';

/**
 * The API runs on your laptop. In development we reuse the host the phone
 * already uses to reach the Expo dev server, so no IP needs configuring.
 * Set EXPO_PUBLIC_API_URL to override (for example, a staging server).
 */
const resolveBaseUrl = () => {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return `http://${host ?? 'localhost'}:3000`;
};

export const API_URL = resolveBaseUrl();

/** The realtime gateway: same host, port 3002. Override with EXPO_PUBLIC_GATEWAY_URL. */
export const GATEWAY_URL = (() => {
  const fromEnv = process.env.EXPO_PUBLIC_GATEWAY_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return `ws://${host ?? 'localhost'}:3002`;
})();

/** The current access token, for the realtime connection. */
export const getAccessToken = () => store.get()?.accessToken ?? null;

/** Gets fresh tokens after the gateway rejects an expired one. */
export const refreshAccessToken = async () => {
  refreshing ??= refreshTokens().finally(() => {
    refreshing = null;
  });
  return refreshing;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** The full error body, e.g. `current` (the latest copy) on a 409. */
    readonly data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

interface TokenStore {
  get(): AuthTokens | null;
  set(tokens: AuthTokens | null): void;
  /** What's saved on the device right now, which another browser tab may have just refreshed. */
  peekSaved?(): Promise<AuthTokens | null>;
}

let store: TokenStore = { get: () => null, set: () => {} };

/** The session provider hands the API client its token storage. */
export const connectTokenStore = (s: TokenStore) => {
  store = s;
};

let refreshing: Promise<boolean> | null = null;

const refreshTokens = async (): Promise<boolean> => {
  const current = store.get();
  if (!current) return false;
  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: current.refreshToken }),
  }).catch(() => null);
  // No connection: keep the session and try again later, rather than signing out.
  if (!res) return false;
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      // Each refresh replaces the token. If another tab got there first, its new
      // tokens are already saved: use those instead of signing out.
      const saved = await store.peekSaved?.();
      if (saved && saved.refreshToken !== current.refreshToken) {
        store.set(saved);
        return true;
      }
      store.set(null);
    }
    return false;
  }
  store.set(AuthTokens.parse(await res.json()));
  return true;
};

interface RequestOptions<S extends z.ZodTypeAny> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  schema?: S;
  auth?: boolean;
  /** Read the answer as plain text (a calendar file) rather than JSON. */
  text?: boolean;
}

/**
 * The free server sleeps when nobody has used it for a while and takes up to
 * a minute to wake. While it does, requests fail or get 502/503/504 from
 * Render's proxy. Keep trying for a while (creates carry client ids, so a
 * repeat can't duplicate anything) and tell the app, so it can say "waking up"
 * instead of showing an error.
 */
const WAKE_WINDOW_MS = 75_000;
const WAKING_STATUSES = new Set([502, 503, 504]);
type ServerState = 'ok' | 'waking';
const serverListeners = new Set<(state: ServerState) => void>();
let serverState: ServerState = 'ok';
const setServerState = (state: ServerState) => {
  if (state === serverState) return;
  serverState = state;
  serverListeners.forEach((l) => l(state));
};
/** Follow whether the server is waking up, e.g. for a banner. Returns an unsubscribe. */
export const onServerState = (listener: (state: ServerState) => void) => {
  serverListeners.add(listener);
  listener(serverState);
  return () => {
    serverListeners.delete(listener);
  };
};

const fetchWhileWaking = async (url: string, init: RequestInit): Promise<Response> => {
  const started = Date.now();
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, init);
      if (!WAKING_STATUSES.has(res.status) || Date.now() - started > WAKE_WINDOW_MS) {
        setServerState('ok');
        return res;
      }
    } catch {
      if (Date.now() - started > WAKE_WINDOW_MS) {
        setServerState('ok');
        throw new ApiError(0, 'network', "Can't reach Tagalong right now. Check your internet connection and try again.");
      }
    }
    setServerState('waking');
    await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 8000)));
  }
};

export async function request<S extends z.ZodTypeAny>(
  path: string,
  { method = 'GET', body, schema, auth = true, text = false }: RequestOptions<S> = {},
  retried = false,
): Promise<z.output<S>> {
  const headers: Record<string, string> = { [CLIENT_ID_HEADER]: CLIENT_ID };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const token = store.get()?.accessToken;
  if (auth && token) headers.authorization = `Bearer ${token}`;

  const res = await fetchWhileWaking(`${API_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401 && auth && !retried) {
    // Several requests can fail at once; refresh only once for all of them.
    if (await refreshAccessToken()) return request(path, { method, body, schema, auth, text }, true);
  }

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    } & Record<string, unknown>;
    throw new ApiError(res.status, data.error ?? 'error', data.message ?? 'Something went wrong', data);
  }
  if (res.status === 204) return undefined as z.output<S>;
  if (text) return (await res.text()) as z.output<S>;
  const json: unknown = await res.json();
  return schema ? schema.parse(json) : (json as z.output<S>);
}
