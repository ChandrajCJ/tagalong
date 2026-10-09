# Tagalong

A shared space where groups plan, travel, pay for and remember trips together.
Mobile-first (Expo), with a TypeScript backend.

Design canvas: https://claude.ai/artifact/QvbZKYGYkiFyCYEnDs3bf7

## What's here

| Path | What it is |
|---|---|
| `apps/mobile` | Expo + Expo Router app (iOS and Android) |
| `apps/api` | Fastify API (auth, trips, invites, plan, ideas, chat, documents, bookings, photos) and the realtime gateway (`src/gateway.ts`) |
| `apps/worker` | BullMQ background worker: push notifications and photo thumbnails |
| `packages/shared` | zod schemas and types used by the app and the API |
| `packages/db` | Drizzle schema, migrations and seed data |
| `docs/decisions` | Architecture decision records |

## First-time setup

You need Node 22 (`nvm use`), Docker Desktop or Rancher Desktop running, and Expo Go on your phone.

```bash
nvm use
corepack enable pnpm
pnpm install
cp .env.example .env          # then set JWT_SECRET (openssl rand -hex 32)
pnpm infra:up                 # Postgres (PostGIS), Redis and object storage
pnpm db:migrate
pnpm --filter @tagalong/db db:migrate:test
pnpm db:seed                  # demo@tagalong.app with a Lisbon trip
```

## Day to day

```bash
pnpm dev:backend              # API on :3000, realtime gateway on :3002, and the worker
pnpm --filter @tagalong/mobile dev   # Expo; scan the QR code with your phone
```

**Ideas and polls:** the Ideas tab is the group's "maybe" list — anyone adds one,
everyone votes (viewers included), and an editor moves it into the plan with
**Add to plan**. In the chat, the chart button next to the composer asks the group
a question; results update live as people tap.

**Docs:** the Docs tab holds tickets and booking confirmations. Files go straight
from the phone to object storage and are served back through links that expire,
so nothing in the bucket is public. Local storage is SeaweedFS on port 8333
(`pnpm infra:up` starts it); the bucket is created on first API start.

**Bookings:** tap any plan item to open its detail screen: its bookings (flight,
stay, train, tickets, car, table) with confirmation codes you can copy, the
attached confirmation file, and a discussion thread that stays out of the main
chat. The trip overview shows the next booking under **Next up**.

**Photos:** the Photos tab is the shared album. Pick any number of photos; each
is converted to JPEG (iPhones shoot HEIC, which the server can't read), resized
to 2560 px, and dated and placed from its EXIF. The worker makes the thumbnails,
so it must be running (`pnpm dev:backend` starts it). The album is grouped by the
day each photo was taken, as the clock read where it was taken.

**Testing live updates with two people:** sign in on your phone as one user and in a
second place as another (a second phone, or sign out and use an invite link). Both
open the same trip's Plan tab; changes appear on the other side within a second.

Sign in on the phone with any email (try `demo@tagalong.app`). The 6-digit code is
printed in the API log, since email sending isn't wired up yet.

```bash
pnpm lint && pnpm typecheck && pnpm test
curl localhost:3000/health
```

## Push notifications (optional)

Chat pushes are built in, but a phone can only get a push token once the app has an
Expo project id. One-time setup, with a free Expo account:

```bash
cd apps/mobile && npx eas-cli@latest init
```

That adds `extra.eas.projectId` to `app.json`. Then:

- **iPhone:** works in Expo Go. Allow notifications when asked (after you're on a trip).
- **Android:** Expo Go can't receive pushes; it needs a development build
  (`npx eas-cli@latest build --profile development --platform android`).

Pushes go to people who aren't looking at the app, about 20 seconds after the first
unread message, as one summary. The worker logs each decision (`Chat notification`).

## Troubleshooting

- **The phone can't reach the API.** The phone and laptop must be on the same Wi-Fi.
  The app uses the same host as the Expo dev server; to override it, set
  `EXPO_PUBLIC_API_URL=http://<your-laptop-ip>:3000` in `apps/mobile/.env`.
- **`pnpm infra:up` fails.** Start Docker Desktop or Rancher Desktop first.
- **Redis is on port 6380**, so it doesn't clash with a Redis you may already run locally.
- **Uploads fail.** Check storage is up (`docker compose ps storage`). An unsigned
  request to `localhost:8333` answering 403 is correct, not a fault.
- **Live updates don't arrive.** Check `curl localhost:3002/health` shows the gateway, and
  that nothing blocks port 3002. Override the address with `EXPO_PUBLIC_GATEWAY_URL`.
  The app refetches the plan whenever it reconnects, so nothing is lost meanwhile.

## Conventions

- Every trip route checks membership with `requireTripRole` (`apps/api/src/lib/access.ts`).
  Non-members get a 404.
- Ids are UUIDv7 and can be generated on the client, so retries and offline creation are safe.
- Trip changes write to `sync.change_log` in the same transaction.
- Schema changes go through migrations (`pnpm db:generate`), never by hand.
- Writes that only express an opinion (voting on an idea or a poll) are open to
  viewers; anything that changes the trip needs `editor`.
