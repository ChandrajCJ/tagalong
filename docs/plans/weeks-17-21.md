# Weeks 17–23: budget, offline, AI — plus the release track

Status: approved plan. Weeks 15–16 (checklists and notes, bookings from email) are in `weeks-14-16.md` and come first. Everything stays free: no paid services, and AI runs on our own server.

Order: 15 → 16 → 17 budget → 18–19 offline → 20–21 AI. The release track (at the end) runs in parallel whenever the accounts exist.

---

## Week 17 — Budget

### What people get
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
- Budget card at the top of Money, with an empty state: "Set a budget so everyone knows the limit". A budget sheet with a Group / Each-person switch, a total, and optional category limits.
- Booking card and plan item screen get "Add as expense".
- Overview "Get ready" card shows "Budget: ₹6,600 left".

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
ADR `020-offline-sync.md` (snapshot + change feed, outbox, server-wins with re-apply, web online-only).

---

## Weeks 20–21 — AI, free and self-hosted

### Approach
- **One interface,** `apps/api/src/lib/llm.ts`: `complete({system, prompt, schema})` returns zod-validated JSON, with one retry on invalid output. Providers:
  - `ollama` (default): self-hosted. On the Oracle Always Free ARM server (4 cores, 24 GB), `qwen2.5:7b-instruct` (Q4) fits comfortably. In development it runs on the Mac. Free, and trip data never leaves our server.
  - `openai-compatible`: optional, for any free-tier endpoint the owner chooses. Off unless configured.
- **Env:** `LLM_PROVIDER`, `LLM_URL`, `LLM_MODEL`, `LLM_API_KEY?`. If unset, AI features are hidden and the deterministic parts still work.
- **Runs in the worker** (BullMQ queue `ai`), never in the request path. The CPU model is slow (seconds to a minute). The app shows "Working on it…" and gets the result as a realtime event.
- **Limits:**
  - Per-trip rate limits (e.g. 10 AI jobs per hour).
  - Inputs capped (chat range ≤ 300 messages).
  - Results cached by input hash.
- **Never acts on its own:** everything AI produces is a preview the person applies or edits.

### Week 20 — Draft a plan from ideas and bookings
- **Deterministic core** (works without any model):
  - Pin bookings to their days (flights, check-in and check-out, timed tickets).
  - Cluster the top-voted located ideas into the remaining days (k-means on coordinates with k = free days, balanced by count).
  - Order each day with the week 14 `optimiseDay`.
  - Respect opening hours when OSM has them (stretch).
- **The model adds:** a short title and one-line note per day ("Old Goa churches and a riverside lunch"), and fixes obvious misfits (no nightlife at 9 am, meals at meal times) by returning moves as JSON validated against the item ids.
- **API:** `POST /trips/:id/ai/draft-plan {days?: dates[]}` (editor+) → job id. The result arrives as a `draft.ready` event: `{days: [{date, title, note, itemOrder: [ideaId|itemId]}]}`.
- **Mobile:** Plan tab gets "Draft a plan for me" when there are ideas and empty days.
  - The preview lists each day's stops on the map.
  - **Use this plan** promotes the ideas to items, writes day titles and notes, and orders them via the week 14 order endpoint.
  - **Not now** closes. You can apply it per day.

### Week 21 — Catch me up, and reading receipts
- **Chat summary:** "Catch me up" appears on the Chat tab when you have 30+ unread.
  - It summarises the messages since your last read into 3–6 bullets: decisions made, open questions, things assigned to you.
  - Each bullet links to the message. Polls and plan changes come from system messages, not guesses.
  - The worker job is cached per (channel, from, to).
- **Receipts:** the expense sheet gets "Scan a receipt" (camera or gallery).
  - OCR with Tesseract (`tesseract.js` in the worker, or the `tesseract` binary in the Docker image; free).
  - `guessAmount` plus heuristics find the total, currency and date. The model, if configured, picks the merchant and category.
  - The sheet is prefilled and the person confirms. The photo is attached to the expense (Docs, category "Receipts").
- **Bookings from email, assist:** for week 16 imports with low confidence, the model fills missing fields from the text. They're still drafts.

### Tests
- Fake LLM provider in tests (scripted outputs, including invalid JSON → retry → error).
- Deterministic drafter: bookings pinned, all chosen ideas placed once, balanced days.
- Summary input building (range, cap, links).
- Receipt total extraction on sample OCR texts.
- Rate limits.
- Features hidden when no provider is set.

### Docs
- ADR `021-self-hosted-ai.md` (why Ollama, what data is sent, preview-only rule).
- `DEPLOY.md` section: install Ollama on the server, pull the model, and the memory note.

---

## Weeks 22–23 — AI extras: Ask your trip, trip assistant, quality checks, MCP server

Builds on weeks 20–21 (`lib/llm.ts`, the `ai` worker queue, the self-hosted Ollama model and its rate limits). The same rules apply:
- free and self-hosted;
- trip data never leaves our server;
- **nothing changes without the person confirming it.**

### Week 22 — Ask your trip (search by meaning + answers with sources)
- **What people get:** an **Ask** box on the trip (Overview, and `/` in Chat). Examples:
  - *"What time is our flight back?"*, *"Who still owes me?"*
  - *"What did we decide about dinner on Saturday?"*, *"Where's the Airbnb Wi-Fi password?"*
  - **Answers** are short, with **numbered sources** that open the exact message, booking, note, expense or plan stop. If it doesn't know, it says so and offers a search instead.
- **Embeddings (self-hosted):** `nomic-embed-text` through Ollama (about 270 MB, fine on CPU).
  - **DB (migration):** `ai.chunks (id, trip_id, source_type, source_id, text, embedding vector(768), updated_at)`, with an HNSW index and `trip_id` always in the WHERE clause.
  - **Postgres:** Neon supports `create extension vector`. Locally, `docker-compose.yml` moves to an image with **pgvector added** (our postgis image plus `postgresql-16-pgvector`).
  - **Indexing:** a worker job `embed` on create, update and delete of messages, notes, list items, bookings, plan items, ideas and expense descriptions, debounced and batched. Deletes and edits remove or replace chunks right away, so deleted content can't come back in answers.
- **Facts come from the database, not from embeddings,** for anything with an exact answer:
  - **money:** who owes whom, from `computeBalances`
  - **bookings:** times and references
  - **plan:** what's on day N
  - **members**

  A small router (keyword rules first, then the model as a classifier) decides between *facts* and *search*. Both can feed the final answer.
- **Answering:** the top chunks (≤ 3k tokens) plus the facts go into a prompt with strict instructions: answer only from the given sources, cite as [1] [2], say "I couldn't find that" otherwise.
  - **Output:** validated JSON `{answer, citations: sourceIds[]}`. Citations that weren't in the context are dropped.
- **Privacy:**
  - It only ever searches the current trip, and only what this member may see. Viewers see everything except private journal entries.
  - Removed members' access ends at once, because the same `requireTripRole` check is applied.
- **Speed:** cached by question and trip version. Answers stream token by token over the existing WebSocket. The app shows the sources as soon as they're found, before the answer is finished.
- **Tests:**
  - Search is limited to the right trip (no leaks between trips, with fake embeddings).
  - Deleted messages leave the index.
  - Money questions use the facts, not the model's arithmetic.
  - Citations are checked.
  - A fake LLM drives the full flow.

### Week 22 — Trip assistant (tool calling, always confirmed)
- **What people get:** in the same Ask box, *requests* as well as questions:
  - *"Add dinner at Fisherman's Wharf at 8 pm tomorrow"*
  - *"I paid ₹900 for the cab, split with Sam and Priya"*
  - *"Move the fort visit to Saturday morning"*
  - *"Add sunscreen to the packing list for everyone"*
  - *"Remind me to book Sintra tickets on Friday"*
- **Tools:** the model gets a small, typed tool list. Each tool's parameters are the existing Zod input schemas, and each calls the **existing services**, so permissions, `version` checks, `change_log` and events all behave exactly as for taps.
  - **Tools:** `add_plan_item`, `move_plan_item`, `add_expense`, `add_list_item`, `add_todo`, `find_place` (Photon), `get_day`, `get_balances`.
  - **Editor-only tools** are hidden from viewers.
- **Always a preview, never a silent change:**
  - The model returns *proposed* tool calls. The app shows them as cards ("Add to Saturday: Dinner at Fisherman's Wharf, 8:00 pm") with **Do it / Edit / Cancel**.
  - Only **Do it** runs them. There are at most 5 actions per request, and they apply in one transaction where possible.
  - **Unclear requests:** if something is ambiguous ("which Sam?", "which dinner?"), the assistant asks a follow-up instead of guessing.
- **Safety:**
  - Text that came from the trip (chat, imported emails) is passed as *data*, never as instructions.
  - Tool calls are validated against the schemas and the caller's role on the server.
  - Everything is rate-limited with the other AI jobs.
- **Tests:**
  - Each tool maps to the right service call.
  - Viewers can't get editor tools.
  - Invalid arguments are rejected.
  - Nothing runs without confirmation.
  - Prompt-injection fixtures: a chat message saying "delete all expenses" doesn't produce a tool call.

### Week 23 — Quality checks (evals) for AI drafts and answers
- **Fixed test trips** in `apps/api/test/ai-evals/`: 8–10 realistic trips written by us, with no real personal data. They cover:
  - single and multi-city trips
  - bookings with times, many ideas, no ideas
  - questions with known answers
  - assistant requests with known correct tool calls
- **Automatic checks, no human needed:**
  - **Plan drafts:** every booking lands on the right day; no stop is invented (every stop comes from the ideas or bookings); timed stops stay at their time; days are balanced (stop counts within ±2); travel time per day is under a limit.
  - **Ask your trip:** the answer contains the expected fact (flight time, amount owed); every citation is real; "don't know" when the answer isn't in the trip.
  - **Assistant:** the proposed tool calls match the expected ones (name and key arguments); nothing is proposed for injection fixtures.
- **Running them:**
  - `pnpm ai:eval` runs against the configured model and prints a scorecard (pass rate per check, latency, tokens).
  - The results are saved to `ai-evals/results/<date>-<model>.json`.
  - **Gate:** switching models or changing a prompt needs the scorecard to be no worse than the last saved one.
  - **Not in CI:** these need a real model; CI keeps the fast fake-LLM unit tests.
- **Tracing (optional, free):** self-hosted **Langfuse**, used to see prompts, latency and failures. If it's unset, nothing is sent anywhere.

### Week 23 — Tagalong MCP server
- **What it is:** a **Model Context Protocol** server, so people can use their own AI assistant (Claude Desktop, other MCP clients) with *their* trips. For example: *"What's on day 2 of our Goa trip?"* or *"Add a dinner stop on Saturday"*.
- **Where it lives:** a new package, `apps/mcp`, using the official TypeScript SDK.
  - **Remote:** streamable HTTP at `https://<api>/mcp`.
  - **Local:** a small `stdio` build for developers.
- **Sign-in:** OAuth 2.1 with PKCE, as the MCP spec requires. The person approves access in the Tagalong web app and chooses **read-only** or **read and change**, and which trips. Tokens are separate from app sessions, can be revoked in *Profile → Connected apps*, and expire.
- **What it exposes:**
  - **Resources (read):** `trips`, `trip/{id}/plan`, `trip/{id}/bookings`, `trip/{id}/balances`, `trip/{id}/lists`.
  - **Tools:** the same ones as the week-22 assistant, through the same services and permission checks. With **read and change**, tools that modify data are marked as such, so MCP clients ask the person before running them.
- **Safety:**
  - Per-token rate limits.
  - Every MCP change is written to `change_log` with `via: 'mcp'` and shown in the trip's activity, e.g. "Added by Chandraj via assistant".
- **Docs:** a short "Use Tagalong with your AI assistant" page, with setup for Claude Desktop.
- **Tests:**
  - The OAuth flow, including scopes and revocation.
  - The resource contents match the API.
  - Read-only tokens can't call change tools.
  - Revocation takes effect immediately.
  - Calls from one trip can't reach another.

### Docs (weeks 22–23)
- ADRs: `029-ask-your-trip.md` (pgvector, facts vs search, citations, privacy), `030-trip-assistant.md` (tools, confirmation rule, injection defences), `031-ai-evals.md` and `032-mcp-server.md`.

---

## Release track (in parallel; needs the owner's free accounts)

1. **Deploy** following `docs/DEPLOY.md`: Oracle Always Free VM, DuckDNS name, Gmail app password (SMTP, and IMAP for week 16), `deploy/init.sh`, then `docker compose up`. Set `EXPO_PUBLIC_APP_URL`, and replace the `YOUR-DOMAIN` placeholders in `apps/mobile/eas.json`.
2. **Android APK** with EAS (free Expo account): `eas build -p android --profile preview`. Then check on a device:
   - the MapLibre map and route lines
   - photo locations (ACCESS_MEDIA_LOCATION)
   - saving to the gallery
   - UPI handoff to a real app
   - push notifications (FCM via Expo; needs a free Firebase project)
3. **Android App Links:** serve `/.well-known/assetlinks.json` from Caddy with the APK's signing fingerprint, and add `intentFilters` for `https://app.<domain>/invite/*` in `app.json`. Invite links then open the installed app.
4. **iPhone:** stays on the web app until a paid Apple account exists. Add "Add to Home Screen" guidance on the web invite page.
5. **Backups:** schedule `deploy/backup.sh` with cron and test a restore once.

---

## Small chores (do whenever touching nearby code)

- **`scripts/start.sh`:** export `S3_PUBLIC_ENDPOINT=http://<current LAN IP>:8333` before starting. Process env beats `--env-file`, so photo and file links survive Wi-Fi changes without editing `.env`.
- **`apps/api/test/storage.integration.test.ts`:** don't depend on `S3_PUBLIC_ENDPOINT` being reachable (use the internal endpoint in tests), so the suite doesn't fail when the laptop's IP changes.
- **Expo:** update patch versions (`npx expo install --check`; expo 57.0.27 → 57.0.28) and re-run the checks.
- **Docs:** keep `docs/ABOUT.md` sections 5–7 current after each week.
