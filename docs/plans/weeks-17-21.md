# Weeks 17–23: budget, offline, AI — plus the release track

Status: approved plan. Week 17 is done. AI (weeks 20–23) is re-planned in `weeks-20-23-ai.md`. Everything stays free.

Order now: 17 budget (done) → journal (done) → ABOUT.md refresh → 20–23 AI (`weeks-20-23-ai.md`) → 18–19 offline.

---

## Week 17 — Budget (optional)

Done (ADR 029). The tables live in the `expenses` Postgres schema with the rest of the money; expenses already had `booking_id` and `item_id`, and "Add as expense" already linked them.

### Optional by design
- **A trip doesn't need a budget.** With none set, nothing about budgets shows anywhere except one quiet **"Add a budget (optional)"** link on the Money tab. There are no prompts, cards, alerts or pace warnings, and expenses and settle-up work exactly as today.
- **Setting one is optional at every step:**
  - *New trip* and *Edit trip* get a collapsed **"Budget (optional)"** row: a total, Group or Each person, that's it. Leaving it empty creates no budget row.
  - The Money tab's sheet adds category limits for those who want them.
  - **Every part is optional on its own:** a total with no categories, categories with no total, or neither.
- **Removing it** (*Remove budget*) deletes the row and its alerts. The trip goes back to showing nothing about budgets.
- **Who sees what:** viewers see the budget if one exists. Only editors and owners can add, change or remove it.
- **API:** `budget` is `null` in `GET /trips/:id/money` when none is set, and `CreateTripInput` / `UpdateTripInput` accept an optional `budget` object.
- **Tests:** no-budget trips return `null` and produce no alerts, events or Overview line; create with and without a budget; remove resets alerts.

### What people get (once a budget is set)
- On the Money tab, a **budget card**: "₹18,400 of ₹25,000 spent · ₹6,600 left · about ₹1,320 a day for the 5 days left".
- **Per-category bars** (food, transport, stay, activity, shopping, other), each with an optional limit.
- **Planned vs spent:** cost estimates on plan items and bookings that aren't expenses yet show as a lighter "planned" segment, so the group sees what's already committed.
- **Pace warning** once the trip has started: "At this pace you'll go about ₹4,000 over."
- **Group or per-person budget:** "₹5,000 each" shows each person their own share of spending against it.
- **Chat cards** at 80% and 100% of the budget, posted once each.

### Data (migration)
- `money.budgets`: `trip_id` (primary key), `mode 'group'|'per_person'`, `total_minor` (null = categories only), `categories jsonb {food?: minor, …}`, `version`, `updated_by`, timestamps. Amounts are in the trip currency. The currency is already locked once expenses exist.
- **No double counting:** `money.expenses` gains `booking_id null` and `item_id null`. The booking card gets "Add as expense", which prefills the expense sheet and links it. Planned = items and bookings with a cost and no linked expense.
- `money.budget_alerts`: `(trip_id, threshold)` primary key, so each alert is sent once. It resets if the budget is raised past it.

### Logic (pure, in `packages/shared/src/money.ts` or `budget.ts`, unit-tested)
- `budgetSummary(budget, expenses, planned, trip, today, me)`: spent, planned, left, per-category, per-day allowance, pace projection (only after day 1 of the trip), my share in per-person mode.
- Uses the existing `convertMinor`, so foreign-currency expenses count at their frozen rate.

### API
- `GET /trips/:id/money` also returns `budget` and `planned`.
- `PUT /trips/:id/budget {mode, totalMinor, categories, version?}` (editor+). 409 on a stale version.
- `DELETE /trips/:id/budget`.
- `POST /expenses` and `PATCH /expenses` accept `bookingId` and `itemId` (same trip, checked).
- Events `budget.updated`. The alert check runs after each expense write.

### Mobile
- Budget card at the top of Money, **only when a budget exists**. Otherwise just the small "Add a budget (optional)" link. A budget sheet with a Group / Each-person switch, an optional total and optional category limits.
- Booking card and plan item screen get "Add as expense".
- Overview "Get ready" card shows "Budget: ₹6,600 left" **only when a budget exists**.

### Tests
- **Summary math:** mixed currencies, planned excluded once linked, per-person shares, pace before and after the trip starts, no budget at all.
- **Budget routes:** CRUD, 409, viewer 403.
- **Alerts:** fire once, re-arm after a raise.
- **Expense links:** another trip's booking → 400.

---

## Weeks 18–19 — Works offline (Android/iOS; the web stays online-only)

Goal: open the app with no signal and still see and change the whole trip — plan, bookings and tickets, lists, notes, ideas, money, recent chat — and catch up automatically when back online. ADR 005 (versions) and `sync.change_log` were built for this.

### Week 18 — Sync foundation and offline reading
- **API:**
  - `GET /trips/:id/snapshot`: every entity the app shows, plus `seq` (the latest change_log seq).
  - `GET /trips/:id/changes?after=<seq>&limit=500`: change_log rows after `seq`, with the current row for each upsert (deduped per entity, latest wins) and ids for deletes, plus `nextSeq` and `hasMore`.
  - Viewer+. A removed member gets 404, and the client then wipes that trip.
- **Fill gaps first:** check that every write path logs `change_log` (items, ideas, votes, polls, bookings, documents, photos, expenses, settlements, lists, notes, budget, members, trip). Add any that are missing, with a test per entity that a write appears in `/changes`.
- **Mobile local store:** `expo-sqlite` (works in Expo Go).
  - One table `entities(trip_id, type, id, json, version, updated_at)` with indexes on `(trip_id, type)`, plus `sync_state(trip_id, seq)`.
  - A small repository layer, `lib/local/`, with `useLocal(tripId, type, filter)` hooks that re-render on change.
- **Moving screens over:** move screens one by one from `request()` reads to the local store.
  - On open: show local data at once, then pull `/changes`.
  - Realtime events trigger a pull, instead of a refetch per screen.
  - Removes the "refetch after reconnect" special cases.
- **Offline banner:** using `@react-native-community/netinfo`, "You're offline — showing what's saved on this phone".
- **Files:**
  - Tickets and booking documents for the next 14 days are downloaded to `FileSystem` cache automatically.
  - Any document can be marked "Keep offline".
  - Photos show cached thumbnails.

### Week 19 — Offline changes, conflicts and catch-up
- **Outbox:** table `outbox(id, trip_id, method, path, body, base_version, created_at, attempts, status)`.
  - Every mutation is applied locally at once (optimistic, as today) and queued.
  - Replayed in order when online. Client UUIDv7 ids make creates idempotent, so replays are safe.
  - Exponential backoff. A row needing attention shows "Couldn't save — tap to retry or discard".
- **Conflicts:** on 409, the server copy wins locally, and the person sees a toast and a "Changes that clashed" list: "Sam changed 'Dinner at Ramiro' while you were offline — showing theirs. Re-apply mine?"
  - Text fields (notes, titles) show both versions, like the week 15 note editor.
  - Ticks and votes simply re-apply, because they're per-person.
- **Chat offline:** messages queue with a clock icon and send on reconnect, keeping their client id and original order.
- **Photos taken offline:** uploads queue and resume, using the existing upload flow, once online and preferably on Wi-Fi (setting).
- **Money offline:** expenses queue. The balances banner says "Includes 2 expenses not synced yet".
- **Not offline:** Explore, weather, routing and place search show their last cached answer with "From when you were last online", or a friendly message.

### Tests
- **API:** snapshot and changes pagination, deletes, dedupe, access removal, and every entity type logged.
- **Mobile pure logic** (outbox ordering, replay with idempotent ids, conflict resolution) as vitest unit tests in `apps/mobile/src/lib/local/` with a fake transport.
- **Manual device script in the ADR:** airplane mode → add item, tick packing, send chat, add expense → reconnect → all synced. Two phones editing the same item offline → conflict shown.

### Docs
ADR `036-offline-sync.md` (snapshot + change feed, outbox, server-wins with re-apply, web online-only).

---

## Weeks 20–23 — AI (moved)

Re-planned in `weeks-20-23-ai.md`: the model runs on Cloudflare Workers AI's free allowance instead of a self-hosted Ollama, because the live server (Render free, 512 MB) can't run one. They're built **before** offline.

---

## Release track — done

Live via `DEPLOY-FREE.md` (Render, Neon, Supabase, Brevo), the APK with push, App Links and over-the-air updates. The Oracle route in `DEPLOY.md` stays as the self-hosted alternative. Still open: **backups** (a weekly `pg_dump` job, step 10 of `DEPLOY-FREE.md`).

---

## Small chores (do whenever touching nearby code)

- **`scripts/start.sh`:** export `S3_PUBLIC_ENDPOINT=http://<current LAN IP>:8333` before starting. Process env beats `--env-file`, so photo and file links survive Wi-Fi changes without editing `.env`.
- **`apps/api/test/storage.integration.test.ts`:** don't depend on `S3_PUBLIC_ENDPOINT` being reachable (use the internal endpoint in tests), so the suite doesn't fail when the laptop's IP changes.
- **Expo:** update patch versions (`npx expo install --check`; expo 57.0.27 → 57.0.28) and re-run the checks.
- **Docs:** keep `docs/ABOUT.md` sections 5–7 current after each week.
