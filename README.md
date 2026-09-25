# Tagalong

A shared space where groups plan, travel, pay for and remember trips together.
Mobile-first (Expo), with a TypeScript backend.

Design canvas: https://claude.ai/artifact/QvbZKYGYkiFyCYEnDs3bf7

## What's here

| Path | What it is |
|---|---|
| `apps/mobile` | Expo + Expo Router app (iOS and Android) |
| `apps/api` | Fastify API: auth, trips, health |
| `apps/worker` | BullMQ background worker |
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
pnpm infra:up                 # Postgres (PostGIS) and Redis
pnpm db:migrate
pnpm --filter @tagalong/db db:migrate:test
pnpm db:seed                  # demo@tagalong.app with a Lisbon trip
```

## Day to day

```bash
pnpm dev:backend              # API on :3000 and the worker
pnpm --filter @tagalong/mobile dev   # Expo; scan the QR code with your phone
```

Sign in on the phone with any email (try `demo@tagalong.app`). The 6-digit code is
printed in the API log, since email sending isn't wired up yet.

```bash
pnpm lint && pnpm typecheck && pnpm test
curl localhost:3000/health
```

## Troubleshooting

- **The phone can't reach the API.** The phone and laptop must be on the same Wi-Fi.
  The app uses the same host as the Expo dev server; to override it, set
  `EXPO_PUBLIC_API_URL=http://<your-laptop-ip>:3000` in `apps/mobile/.env`.
- **`pnpm infra:up` fails.** Start Docker Desktop or Rancher Desktop first.
- **Redis is on port 6380**, so it doesn't clash with a Redis you may already run locally.

## Conventions

- Every trip route checks membership with `requireTripRole` (`apps/api/src/lib/access.ts`).
  Non-members get a 404.
- Ids are UUIDv7 and can be generated on the client, so retries and offline creation are safe.
- Trip changes write to `sync.change_log` in the same transaction.
- Schema changes go through migrations (`pnpm db:generate`), never by hand.
