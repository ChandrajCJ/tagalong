# 004: A separate realtime gateway, fed by Redis pub/sub

**Status:** accepted

## Decision
- Live updates go through a **gateway process** (`apps/api/src/gateway.ts`, port 3002) that holds a WebSocket per phone. It's the same codebase as the API, started separately.
- The API publishes a `TripEvent` to Redis channel `trip:{tripId}` **after** each write commits. Every gateway instance subscribes to `trip:*` and delivers to the phones subscribed to that trip.
- A phone subscribes per trip; the gateway checks membership with `requireTripRole` first, and drops a phone from the trip when a `member.left` event names it.
- Each phone sends a client id with its API calls (`x-tagalong-client`). Events carry it, so the gateway doesn't echo a change back to the phone that made it.
- "Who's editing" is relayed and never stored. Online status lives in a Redis sorted set, `online:{tripId}`, for push notifications to use later.

## Why
- Holding many open connections is a different load from answering requests; keeping it separate lets each scale on its own.
- Redis pub/sub lets several gateway instances share the work without knowing about each other.

## Rule that keeps it correct
Events are a speed-up, not the source of truth. The phone **refetches after every reconnect**, so a missed event can never leave the screen wrong.
