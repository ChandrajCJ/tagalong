import { AuthTokens } from '@tagalong/shared';
import Constants from 'expo-constants';
import type { z } from 'zod';

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

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface TokenStore {
  get(): AuthTokens | null;
  set(tokens: AuthTokens | null): void;
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
  if (!res?.ok) {
    store.set(null);
    return false;
  }
  store.set(AuthTokens.parse(await res.json()));
  return true;
};

interface RequestOptions<S extends z.ZodTypeAny> {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  schema?: S;
  auth?: boolean;
}

export async function request<S extends z.ZodTypeAny>(
  path: string,
  { method = 'GET', body, schema, auth = true }: RequestOptions<S> = {},
  retried = false,
): Promise<z.output<S>> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const token = store.get()?.accessToken;
  if (auth && token) headers.authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', `Can't reach the server at ${API_URL}. Is the API running?`);
  }

  if (res.status === 401 && auth && !retried) {
    // Several requests can fail at once; refresh only once for all of them.
    refreshing ??= refreshTokens().finally(() => {
      refreshing = null;
    });
    if (await refreshing) return request(path, { method, body, schema, auth }, true);
  }

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new ApiError(res.status, data.error ?? 'error', data.message ?? 'Something went wrong');
  }
  if (res.status === 204) return undefined as z.output<S>;
  const json: unknown = await res.json();
  return schema ? schema.parse(json) : (json as z.output<S>);
}
