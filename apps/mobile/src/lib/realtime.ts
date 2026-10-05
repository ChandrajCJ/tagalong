import { ServerMessage, type ClientMessage } from '@tagalong/shared';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { GATEWAY_URL, getAccessToken, refreshAccessToken } from './api';
import { CLIENT_ID } from './client-id';

/** What a screen hears about its trip. `reconnected` means: refetch, you may have missed things. */
export type TripMessage = ServerMessage | { kind: 'reconnected' };
type Listener = (message: TripMessage) => void;

const MAX_BACKOFF_MS = 30_000;

/** Which trip a server message is about, so it reaches only that trip's screens. */
const tripOf = (m: ServerMessage): string | undefined => {
  switch (m.kind) {
    case 'event':
      return m.event.tripId;
    case 'presence':
      return m.presence.tripId;
    case 'typing':
      return m.typing.tripId;
    case 'subscribed':
      return m.tripId;
    case 'error':
      return m.tripId;
    case 'ready':
      return undefined;
  }
};

/**
 * One WebSocket for the whole app. It reconnects with backoff, re-subscribes
 * to the trips that are on screen, and tells them to refetch after a gap.
 */
class RealtimeClient {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private running = false;
  private everConnected = false;
  private backoff = 1000;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private appState = AppState.addEventListener('change', (state) => {
    // Coming back to the app: reconnect now instead of waiting out the backoff.
    if (state === 'active' && this.running && !this.isOpen()) this.reconnectNow();
  });

  start() {
    if (this.running) return;
    this.running = true;
    this.connect();
  }

  stop() {
    this.running = false;
    this.everConnected = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.ws?.close();
    this.ws = null;
  }

  subscribe(tripId: string, listener: Listener) {
    let set = this.listeners.get(tripId);
    if (!set) {
      this.listeners.set(tripId, (set = new Set()));
      this.send({ op: 'subscribe', tripId });
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(tripId);
        this.send({ op: 'unsubscribe', tripId });
      }
    };
  }

  send(message: ClientMessage) {
    if (this.isOpen()) this.ws!.send(JSON.stringify(message));
  }

  private isOpen() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private connect() {
    const token = getAccessToken();
    if (!token) return this.scheduleRetry();

    const query = `token=${encodeURIComponent(token)}&clientId=${CLIENT_ID}`;
    const ws = new WebSocket(`${GATEWAY_URL}/ws?${query}`);
    this.ws = ws;

    ws.onopen = () => {
      this.backoff = 1000;
      for (const tripId of this.listeners.keys()) this.send({ op: 'subscribe', tripId });
      if (this.everConnected) this.broadcast({ kind: 'reconnected' });
      this.everConnected = true;
    };

    ws.onmessage = (e) => {
      let parsed: ServerMessage;
      try {
        parsed = ServerMessage.parse(JSON.parse(String(e.data)));
      } catch {
        return;
      }
      const tripId = tripOf(parsed);
      if (tripId) this.listeners.get(tripId)?.forEach((l) => l(parsed));
    };

    ws.onclose = async (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (!this.running) return;
      // 4401: our access token expired. Refresh it, then try again.
      if (e.code === 4401) await refreshAccessToken().catch(() => false);
      this.scheduleRetry();
    };
  }

  private broadcast(message: TripMessage) {
    for (const set of this.listeners.values()) set.forEach((l) => l(message));
  }

  private scheduleRetry() {
    if (!this.running) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.connect(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
  }

  private reconnectNow() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.backoff = 1000;
    this.connect();
  }
}

export const realtime = new RealtimeClient();

/** Calls `handler` for every live update about this trip while the screen is mounted. */
export function useTripRealtime(tripId: string | undefined, handler: Listener) {
  const latest = useRef(handler);
  latest.current = handler;

  useEffect(() => {
    if (!tripId) return;
    return realtime.subscribe(tripId, (m) => latest.current(m));
  }, [tripId]);
}
