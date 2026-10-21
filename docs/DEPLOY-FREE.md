# Deploying Tagalong for free, with no credit card

Oracle's Always Free tier needs a card it accepts. This guide uses services whose free tiers, as of October 2026, sign up **without a card**. Free tiers change, so each step says what to check.

**What's already done in the code:**
- `apps/api/src/all.ts` runs the API, the live updates (`/ws`) and the background jobs in one process, and runs migrations first.
- `pnpm --filter @tagalong/api build` bundles it into `apps/api/dist/all.js`.
- Brevo sends email over HTTPS.
- Neon's connection pooler works.
- `render.yaml` describes every service.
- Both Render build commands were tested in a clean copy of the repo with `NODE_ENV=production`. The built server started, migrated, ran the workers and answered `/health` in about 140 MB of memory. The web build baked in the live addresses.

There are two routes. **Route 1 is ready to follow.** Route 2 still needs code (see its section).

---

## Route 1 — free cloud services

### The pieces, and why each one

| Part of Tagalong | Service (free tier) | Why this one |
|---|---|---|
| Web app | **Render Static Site** | Free, never sleeps, serves `/invite/…` links via a rewrite to `index.html`. |
| API + live updates + jobs | **Render Web Service** (512 MB, 0.1 CPU, 750 h/month) | Free with no card, and runs a long-lived Node server with WebSockets. 750 hours covers **one** service all month, which is why everything runs in one process. |
| Database | **Neon Postgres** (0.5 GB, doesn't expire) | Render's free Postgres is deleted after 30 days. |
| Redis | **Render Key Value** (free, in memory) | No per-command limit, which BullMQ's polling needs. It's emptied on restart, which is fine because nothing permanent lives there. |
| Photos and files | **Supabase Storage** (1 GB, S3 API) | Supports presigned PUT uploads, which the app uses. Use Backblaze B2 (10 GB) instead if its signup doesn't ask for a card. |
| Sign-in emails | **Brevo** (300/day) | Render's free plan **blocks SMTP**, so Gmail SMTP can't work there. Brevo sends over HTTPS. |
| Bookings by email | A Gmail inbox over IMAP (port 993) | Only the SMTP ports are blocked, so reading mail over IMAP works. Optional. |
| Keep awake | **UptimeRobot**, pinging every 5 min | A free Render service sleeps after 15 idle minutes and takes about a minute to wake. |
| Android app | **EAS Build** (free Expo account) | Builds the APK in the cloud. |
| Push notifications | **Firebase** (Spark plan, free) | Android push goes through Google's FCM. |

**Limits:**
- About 0.5 GB of data and 1 GB of files.
- Photo processing is slow (0.1 CPU).
- Brevo's free emails carry its logo and may land in spam the first time.
- Supabase pauses a project after 7 days with nothing happening. Unpause it in its dashboard.

### Who does what
- **You:** create each account and sign in. Accept terms. Copy secrets (passwords, keys, connection strings) **into Render yourself**. They pass through your hands, not Claude's.
- **Claude, in the browser:** can click through the non-secret setup with you: dashboards, buckets, settings, the Render Blueprint, UptimeRobot, checking the deploy. It tells you which value to paste where.

### Step 1 — Neon (database)
1. Sign up at neon.tech with GitHub. **Check:** no card asked.
2. Create a project named `tagalong` in **AWS Asia Pacific (Singapore)**. **Why:** it's next to Render's Singapore region, so queries are fast.
3. On the dashboard, open **Connect** and copy **two** connection strings:
   - **Pooled** (host contains `-pooler`) → becomes `DATABASE_URL`.
   - **Direct** (connection pooling off) → becomes `DATABASE_DIRECT_URL`.

   **Why two:** the app uses the pooled one to handle many short connections. Migrations need the direct one, because they hold a lock for the whole session.

   Both end in `?sslmode=require`. Keep that.

### Step 2 — Supabase Storage (photos and files)
1. Sign up at supabase.com with GitHub and create a project in **Southeast Asia (Singapore)**. Save the database password it shows somewhere safe (unused, but required).
2. **Storage → New bucket:** name `tagalong`, **private**. **Why private:** every photo is fetched through a short-lived signed link, so nothing is public.
3. **Storage → Settings → S3 Connection:** note the **Endpoint** (`https://<ref>.storage.supabase.co/storage/v1/s3`) and **Region**. Create an **access key** and copy the key ID and secret.
   - `S3_ENDPOINT` and `S3_PUBLIC_ENDPOINT` = that endpoint (both the same).
   - `S3_REGION` = that region.
   - `S3_ACCESS_KEY` and `S3_SECRET_KEY` = the key pair.

### Step 3 — Brevo (sign-in emails)
1. Create a new Gmail for the app, e.g. `tagalong.app.mail@gmail.com`. **Why:** it keeps app mail out of your personal inbox, and the same address can receive forwarded bookings.
2. Sign up at brevo.com (free plan). **Check:** no card asked.
3. **Senders & IP → Senders → Add a sender** with that Gmail, then click the link Brevo emails to it.
4. **SMTP & API → API keys → Generate** → becomes `BREVO_API_KEY`.
   - `MAIL_FROM` = `Tagalong <tagalong.app.mail@gmail.com>`. It must be the verified sender, or Brevo refuses.

### Step 4 — Gmail inbox for bookings by email (optional, skip to start)
Use the same Gmail:
1. **Google Account → Security → 2-Step Verification:** turn it on. Then create an **App password**.
2. **Gmail → Settings → Forwarding and POP/IMAP:** check that IMAP is on.
3. Set:
   - `IMPORT_ADDRESS` = `tagalong.app.mail@gmail.com`
   - `IMPORT_IMAP_URL` = `imaps://tagalong.app.mail%40gmail.com:APP-PASSWORD-WITHOUT-SPACES@imap.gmail.com:993` (`%40` is `@`, escaped)

   Leave both empty to keep the feature off. The app then offers paste/upload only.

### Step 5 — Render (everything else, from `render.yaml`)
1. Sign up at render.com with GitHub. **Check:** no card asked.
2. **New → Blueprint**, connect the `ChandrajCJ/tagalong` repo, branch `main`. Render reads `render.yaml` and lists three services: `tagalong-api`, `tagalong` and `tagalong-redis`.
   - **If a name is taken:** edit the names and addresses in `render.yaml` (and `apps/mobile/eas.json`), push, and retry.
3. Render asks for each `sync: false` value. Paste the values from steps 1–4. `JWT_SECRET` is generated by Render, and `REDIS_URL` is wired to the Key Value instance automatically.
4. **Apply.** The first deploy takes about 5–10 minutes.
5. **Check:** `https://tagalong-api-9twu.onrender.com/health` → `{"status":"ok","db":"ok","redis":"ok"}`. **Why:** it proves the database is reachable, the migrations ran and Redis works.
   - **If it fails:** open the service's **Logs**. Most problems are a mistyped setting, and the server prints exactly which one.

### Step 6 — Smoke test (in a browser)
1. Open `https://tagalong-u4wh.onrender.com`, sign in with your email, and check the code arrives (look in spam).
2. Create a trip, pick a destination, upload a photo.
3. In a private window, sign in as a second email, open an invite link, join, and chat both ways. **Why:** it checks live updates over `wss://…/ws`.

### Step 7 — UptimeRobot (keep awake and get alerts)
Sign up at uptimerobot.com (free). Add an **HTTP(s) monitor** for `https://tagalong-api-9twu.onrender.com/health` every **5 minutes**. **Why:** the ping counts as traffic, so the server never sleeps, and you get an email if it goes down.

**Also built in:** while it's awake, the API pings its own `/health` every 10 minutes (`apps/api/src/lib/keep-awake.ts`, using Render's `RENDER_EXTERNAL_URL`), so it never reaches Render's 15 idle minutes. The outside pinger is still worth having: it wakes the server after a Render restart. The GitHub Actions job (`keep-awake.yml`) is only a fallback, because GitHub runs free scheduled jobs late, in practice every few hours.

### Step 8 — Android APK and push
1. **Firebase:**
   - At console.firebase.google.com (Spark, free), create a project and add an **Android app** with package `com.chandrajcj.tagalong`.
   - Download `google-services.json` into `apps/mobile/`, and add `"googleServicesFile": "./google-services.json"` under `android` in `apps/mobile/app.json`.
2. **Expo:**
   - Sign up at expo.dev, then from `apps/mobile` run `npx eas-cli login` and `npx eas-cli init`. This links the project and writes its id into `app.json`.
3. **Push credentials:**
   - In Firebase, go to **Project settings → Service accounts → Generate new private key**.
   - Then run `npx eas-cli credentials` → Android → **Google Service Account → FCM V1** and upload that key.
   - **Why:** without it, Expo can't hand notifications to Google, and no push arrives.
4. **Build:** `npx eas-cli build -p android --profile preview`. `eas.json` already points at the Render addresses.
5. Install the APK and test on the phone:
   - maps
   - photo locations
   - Save to gallery
   - Pay with UPI
   - a push notification (from a second account's chat message while the app is closed)

### Updating the Android app
- **Most changes (screens, wording, fixes):** `./scripts/ota-update.sh "What changed"`. Installed APKs download it the next time they open and switch on the launch after, or straight away from the "new version ready" banner. Free (EAS Update, up to 1,000 monthly users).
- **Native changes (new native module, permission, icon, Firebase):** `./scripts/build-apk.sh`, then install the new APK over the old one. Same signing key, so it upgrades in place and keeps everyone signed in. Build numbers go up automatically.
- Each update carries the app's native "fingerprint", so an update never reaches an APK that can't run it.

### Step 9 — iPhone friends
They open `https://tagalong-u4wh.onrender.com` in Safari → Share → **Add to Home Screen**. **Why:** installing a real iPhone app needs Apple's paid account. The web app has everything except push.

### Step 10 — Backups (later)
A weekly GitHub Actions job running `pg_dump` against `DATABASE_DIRECT_URL` and keeping the file as a private artifact. **Why:** free tiers have no backups, and Neon's restore window is 6 hours. Not built yet; ask for it.

### What stays rough
- **Cold starts:** if UptimeRobot misses pings, the first request takes about a minute.
- **Restarts:** a restart empties Redis, so caches rebuild and queued push notifications are dropped. Nothing permanent is lost.
- **Upgrading:** Render's paid plan is about $7/month, or move to Route 2.

---

## Route 2 — a spare computer at home (needs code first)

**Why choose it:** it's the full Docker setup in `deploy/`, with nothing sleeping, no storage caps and Gmail SMTP. It needs an always-on machine: an old laptop, a desktop, or a Raspberry Pi 4/5. Not your work laptop.

**Public HTTPS address:** Tailscale **Funnel** (free) gives a fixed `https://<machine>.<tailnet>.ts.net`, even behind carrier NAT, which many Indian home connections use.

**Not built yet:** Funnel gives one hostname and only ports 443, 8443 and 10000. The Caddyfile has to route by path:
- `/api` to the API;
- `/ws` to the gateway;
- `/` to the web app;
- files served on 8443, so signed links keep their exact path.

The app's addresses need the same change. Ask for "implement Route 2 path routing" before using this route.
