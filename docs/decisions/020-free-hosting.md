# 020: Free hosting without a card: one process on Render

**Status:** accepted

## Context
Oracle's Always Free VM (ADR 014) needs a card it accepts, and ours was refused. Hosts that are free with no card give little:
- Render's free web service: one process, 512 MB, sleeps after 15 idle minutes, **no outgoing SMTP**, and no free background workers.
- Render's free Postgres is deleted after 30 days.
- Upstash's free Redis caps commands, which BullMQ's polling would use up.

## Decision
- **One process** (`apps/api/src/all.ts`): migrations, then the API with the realtime gateway mounted at `/ws` (`registerGateway`), then the BullMQ workers (`startWorkers`, shared with `apps/worker`). Development and the Docker setup still run three processes. The code is the same, only the wiring differs.
- **Bundled with esbuild** (`apps/api/build.mjs`) into `dist/all.js`, so the small server doesn't compile TypeScript at start. It uses about 140 MB.
- **Neon** for Postgres, through its pooler: prepared statements are off on pooled URLs. Migrations use the direct URL (`DATABASE_DIRECT_URL`) under an advisory lock.
- **Render Key Value** for Redis, with `noeviction` so jobs are never evicted. Cache writes, rate limits and presence ignore Redis write errors, so a full Redis slows nothing down and breaks nothing.
- **Brevo's HTTPS API** for sign-in emails (`BREVO_API_KEY`), chosen over SMTP when set.
- **Supabase Storage** (S3 API) for files. No code change, only settings.
- **`render.yaml`** holds the whole setup. Secrets are entered in Render, never committed.

## Consequences
- Free and card-less, but with cold starts unless pinged (UptimeRobot), about 0.5 GB of data and 1 GB of files, and slow thumbnails.
- A restart empties Redis, which drops queued pushes and caches. Nothing permanent lives there.
- The Docker route (ADR 014) still works unchanged for a machine of our own.
