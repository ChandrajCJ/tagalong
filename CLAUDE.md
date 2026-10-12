# Tagalong

Group trip planner: plan, chat, photos, money, explore. Full overview in `docs/ABOUT.md`, decisions in `docs/decisions/` (ADRs 001–016), deployment in `docs/DEPLOY.md`. Read only the part you need.

## Rules
- Commit as `Chandraj1710 <chandraj1710@gmail.com>`. Never use the work email.
- Commit and push with `--no-verify`. Remote: `https://ChandrajCJ@github.com/ChandrajCJ/tagalong.git`.
- Never commit `.env`.
- Free and open source only — no paid services or keyed APIs.
- Don't touch the portfolio repo.

## Layout
- pnpm + Turborepo. `apps/api` (Fastify; `src/server.ts` API :3000, `src/gateway.ts` WebSocket :3002), `apps/worker` (BullMQ), `apps/mobile` (Expo SDK 57, Expo Router, also builds the web app), `packages/db` (Drizzle schema + `migrations/`), `packages/shared` (zod schemas, money, geo helpers).
- API modules: `apps/api/src/modules/<name>/{routes,service}.ts`. Access checks via `requireTripRole` in `lib/access.ts`.
- Mobile trip screens: `apps/mobile/src/app/(app)/trips/[id]/` (tabs under `(tabs)`).

## Conventions
- Client-generated UUIDv7 ids (`newId()`) make creates idempotent.
- Updates carry `version`; mismatch → 409 with the current copy.
- Write `change_log` in the same transaction; publish the realtime event after commit.
- Money in integer minor units; splits via `allocate` (largest remainder).
- Geo: Photon, Wikipedia, Overpass, Open-Meteo, OpenFreeMap tiles. Maps: MapLibre (web + builds), react-native-maps fallback in Expo Go.
- Match surrounding style; keep user-facing copy plain and self-explaining.

## Running
- Node 22 (`.nvmrc`; pnpm is installed under 22.14); the shell's default Node 18 fails. `pnpm start` starts infra, migrates, and runs API, gateway, worker and Expo; `pnpm infra:down` stops Docker.
- Infra: `pnpm infra:up` (Postgres 5432, Redis 6380, SeaweedFS S3 8333).
- Backend: `pnpm dev:backend` (API, gateway, worker). Mobile/web: Expo on 8081 (preview config `tagalong-expo`). Laptop LAN IP for the phone has been `10.10.1.5`.
- Migrations: `pnpm db:generate`, `pnpm db:migrate`.

## Checking work (keep output small)
- Typecheck per package with `npx tsc --noEmit -p tsconfig.json` (turbo's cache can hide errors).
- Tests: `pnpm --filter @tagalong/api test -- <file>` for the area you changed; full suite only before committing. Never run two vitest runs at once (shared test DB). Pipe long output through `tail`.
- Browser checks only for visual changes; prefer `read_page`/`get_page_text` over screenshots.
