# Next: refresh ABOUT.md, then weeks 20–23 (AI)

Status: approved plan. It replaces the weeks 20–23 sections of `weeks-17-21.md`, which assumed a self-hosted model on the 24 GB Oracle server. We're on Render's free plan (512 MB, 0.1 CPU), which can't run any model. Offline (weeks 18–19 in `weeks-17-21.md`) moves to **after** week 23.

**Order:**
1. Step 0, ABOUT.md (one short session).
2. Week 20.
3. Week 21.
4. Week 22.
5. Week 23.
6. Weeks 18–19 (offline).

One week per session, each released as an API deploy plus an OTA update. Week 21 also needs a new APK.

---

## Step 0 — Bring `docs/ABOUT.md` up to date (docs only)

Sections 3 and 5 already cover the journal. The rest still describes the app before it went live. Check every claim against the code, and keep the plain, self-explaining tone.

- **§1 What it is:** add the journal and the optional budget to the paragraph. Change "runs on free and open-source software" to "runs on free services and open-source software" (see §4 for which).
- **§4 How it works:**
  - **The pieces:**
    - Production runs **one process** (`apps/api/src/all.ts`): migrations, then the API, the gateway at `/ws`, and the workers. Development runs them separately.
    - Files live in Supabase Storage in production and in SeaweedFS locally.
    - Mail goes through Brevo's HTTPS API in production and SMTP locally.
    - Push goes from Expo's push service through Firebase (FCM).
  - **New subsection "Where it runs":** a table with Render (API and web), Neon, Render Key Value, Supabase, Brevo, EAS Build and Update, Firebase, and GitHub Actions, one line each on why. Then:
    - how the free server stays awake: the self-ping every 10 min, the app waiting up to 75 s with "waking up", and the outside pinger;
    - over-the-air updates and the runtime fingerprint;
    - App Links via `assetlinks.json`;
    - iPhone friends on the web app.

    Link `DEPLOY-FREE.md` as the live setup. `DEPLOY.md` is the self-hosted Docker alternative.
  - **Outside data:**
    - weather is fetched **on the phone** (Open-Meteo rate-limits Render's shared address);
    - time zones are worked out offline (`@photostructure/tz-lookup`);
    - Overpass falls back to Photon;
    - sign-in mail comes from Brevo.
  - **How it's checked:** the real test counts, taken from `pnpm test` output on the day, plus CI on every push.
- **§5 What's done:** add one row, "Live, for free": Render, Neon, Supabase and Brevo, the Android APK with push, over-the-air updates, and the server waking itself.
- **§6 What's not done yet:**
  - **Remove** the outdated items: "Not yet live", "No installable app build", and the "untested on a device" items the APK has since covered. Only keep one if it's still untested: ask the owner.
  - **Add the free-tier limits:**
    - cold starts if the pings stop;
    - 0.5 GB of data and 1 GB of files;
    - Supabase pauses after 7 quiet days;
    - a restart empties Redis, so queued pushes are lost;
    - iPhone gets no push on the web app.
  - **Keep** UPI-only payments, no public transport, bookings by email needing the Gmail app password, and the journal limits.
- **§7 What's planned:** the new order. Week 20 is AI drafts of the plan, week 21 is catch-up, receipts and helpers, week 22 is Ask your trip and the assistant, week 23 is quality checks and the MCP server, then offline. Say plainly:
  - AI runs on Cloudflare's free allowance;
  - only the text needed is sent, with names replaced;
  - nothing changes without a tap.
- **§8 Where things are:** add `apps/api/src/all.ts`, `render.yaml`, `scripts/` (start, build-apk, ota-update, db-studio-prod) and `docs/DEPLOY-FREE.md`.
- **Also fix:** the last section of `weeks-17-21.md` still lists the Oracle "release track" as pending. Mark it done, via `DEPLOY-FREE.md`, except backups, which stay open.

---

## The AI foundation (built in week 20, used by every week after)

### Where the model runs: Cloudflare Workers AI
- **What it is:** a free account (no card) with a **daily allowance of 10,000 "neurons"**, which resets at 00:00 UTC (5:30 am in India).
  - That's roughly **100–200 chat-model answers, or thousands of embeddings**, depending on the model.
  - It's enough for a group of friends **only if we're careful**, so the budget rules below are part of the design, not an afterthought.
- **Why this one** (ADR 030):
  - no card;
  - the chat model and the embedding model come from one provider and one key;
  - Cloudflare states it doesn't train on customer data (quote the current policy in the ADR, with the date checked);
  - its open models (Llama, Qwen, Mistral families) handle drafts, summaries and Q&A.
- **The one exception to "no keyed APIs":** the owner decided this. Record it in the ADR and in `CLAUDE.md`'s rules.
- **Models are settings, not code:**
  - Cloudflare retires models (Llama 3.1 8B went in May 2026).
  - When building, pick from the current catalog:
    - one **main chat model** that does JSON output well;
    - one **small model** for classifying and short jobs;
    - one **small embedding model** (prefer 384 dimensions, which halves storage on Neon's 0.5 GB and costs fewer neurons).
  - Write the chosen ids and their neuron prices into the ADR.

### One interface: `apps/api/src/lib/llm.ts`
- **Two functions:**
  - `complete({purpose, system, messages, schema, size: 'main'|'small', maxTokens})` returns **zod-validated JSON**:
    - it uses JSON mode or JSON schema where the model supports it, and otherwise "Reply with JSON only" plus parsing;
    - on invalid output, it retries **once** with the validation error;
    - after that it fails with `ai_invalid`.
  - `embed(texts[])` returns `number[][]`, batched up to 100 texts per call.
- **Providers:**
  - `workers-ai`, for production;
  - `openai-compatible`, which covers **Ollama on the Mac for development**: Ollama speaks the same API, is free, needs no key and keeps data local. It also covers any other endpoint the owner sets;
  - `fake`, for tests: scripted outputs, including invalid JSON.
- **We use JSON output, not the model's native "tool calling"** (the assistant in week 22 too). Every model supports it, it's validated by our own zod schemas, and switching models can't break it.
- **Env:**
  - `AI_PROVIDER` = `workers-ai` | `openai-compatible` | `off`
  - `AI_BASE_URL`
  - `AI_API_KEY` (Render `sync: false`)
  - `AI_ACCOUNT_ID`
  - `AI_MAIN_MODEL`, `AI_SMALL_MODEL`, `AI_EMBED_MODEL`
  - `AI_DAILY_NEURONS` (default 9,000, to keep headroom under 10k)

  Unset or `off` means every AI button is hidden and the deterministic parts still work. `GET /ai/status` returns `{enabled, leftToday, resetsAt}` for the app.

### Spending the allowance carefully
- **Metering:**
  - Every call records an estimate (tokens in and out × the model's neuron rate, from config) in **`ai.usage`**: `day, trip_id, user_id, purpose, model, tokens_in, tokens_out, neurons, ms, ok`.
  - A Redis counter for today mirrors it, for fast checks.
- **Caps, checked before a job is queued:**
  - the global daily budget (`AI_DAILY_NEURONS`);
  - **20 AI actions per person per day**;
  - **60 per trip per day**;
  - inputs capped (300 messages for a summary, 3k tokens of context for an answer).
- **When the allowance runs out:**
  - the API answers 429 `ai_resting`;
  - the app says *"AI help is resting until 5:30 am. Everything else works as usual."* (the time in the person's own zone);
  - buttons stay visible but explain this instead of failing.
- **Cache by input hash** in Redis for 7 days. The same question on an unchanged trip costs nothing. A restart empties it, and that's fine.
- **Cheapest model first:** routing, classifying and receipt categories use the small model. Only drafts and answers use the main one.

### How jobs run
- **The queue:**
  - A BullMQ queue `ai` in the worker, **concurrency 1**: a 0.1 CPU server, and it protects the allowance.
  - Never in the request path. The API returns `{jobId}` and the app shows *"Working on it…"*.
- **When a job finishes:**
  - an `ai.ready {jobId, requesterId}` event goes to the trip, with no content, like `journal.updated`;
  - the requesting phone fetches `GET /ai/jobs/:id`, which only the requester can read.
  - Jobs and results live in `ai.jobs` and are kept 7 days.
- **Never acts on its own:** everything AI makes is a **preview** that the person applies, edits or drops. Applying goes through the existing endpoints, so versions, `change_log`, events and permissions behave exactly as for taps.

### Privacy
- **Send only what the job needs:**
  - member names become "Member 1, Member 2…", and the app maps them back;
  - emails, phone numbers, UPI IDs and booking references are stripped by pattern before sending (booking references are kept only where the answer needs them, for example "what's our PNR", and that comes from the database facts, not the model);
  - **other people's private journal entries are never sent**;
  - removed members' content is handled like everyone else's: it's trip content.
- **Switches:**
  - **Trip owner:** *Trip ⋯ → AI help* turns it off for the whole trip (on by default).
  - **Each person:** *Profile → AI help* turns it off for themselves.
  - **First use:** a one-time explainer: *"AI help sends the text it needs (never names, emails or numbers) to Cloudflare's AI to make suggestions. Nothing changes until you tap."*
- **Never stored there:** nothing is kept at Cloudflare beyond the request. Our own copies are `ai.jobs` (7 days) and `ai.usage` (numbers only, no text).

### User setup (owner, once)
1. **Sign up at cloudflare.com** with **tagalong.app.mail@gmail.com**, not a work address. Check that no card is asked for.
2. **Copy the Account ID.** Create an API token with only the **Workers AI** permission.
3. **Paste into Render** (`AI_PROVIDER=workers-ai`, `AI_ACCOUNT_ID`, `AI_API_KEY`, the model ids), the same way as the other secrets. Claude can click through the non-secret steps in the browser. The owner pastes the token.
4. **For development:** install Ollama on the Mac and `ollama pull` the model family closest to the production ones.

---

## Week 20 — Draft a plan from ideas and bookings

### The deterministic core (works with no model)
1. **Pin bookings to their days:** flights, check-in and check-out, timed tickets and tables.
2. **Group ideas by place:**
   - Take the top-voted **located** ideas that aren't in the plan yet.
   - On a **trip to several places**, each idea goes to the city whose area it's in (the same area rule as place search), and only onto that city's days.
   - Within a city, k-means on coordinates, with k = that city's free days, balanced by count (±1).
3. **Order each day** with `optimiseDay` (`packages/shared/src/route.ts`), keeping bookings at their times.
4. **Put meals at meal times** when ideas are food (OSM category), and keep nightlife after 6 pm.

This is a pure `draftPlan(…)` in shared, fully unit-tested.

### The model adds (main model, one call per draft)
- A short **title** and a one-line **note** for each day ("Old Goa churches and a riverside lunch").
- A few **moves** for obvious misfits, returned as JSON and validated against the real item and idea ids. Moves with unknown ids are dropped. The model never invents a stop.

### API
- `POST /trips/:id/ai/draft-plan {dates?}` (editor and up) → `{jobId}`. The result is `{days: [{date, title, note, stops: [{ideaId|itemId|bookingId, time?}]}]}`.
- **Applying uses existing routes:**
  - idea → plan (the existing "Add to plan");
  - the day's name and note;
  - `POST /trips/:id/days/:date/order`.

  This happens in one request per day, so a conflict is a 409 for that day only.

### Mobile
- **Where it appears:** **Draft a plan for me** on the Plan tab when there are ideas and at least one empty day. On a trip with no ideas, it suggests Explore first.
- **The preview:**
  - every proposed day on the map with its route;
  - the travel time per day;
  - **Use this day** or **Use all**;
  - **Not now**.
- **Applied stops get a small ✨ "Drafted"** tag until someone edits them.

### Tests
- **`draftPlan`:** bookings pinned; every chosen idea placed once; days balanced; cities respected; meals at meal times.
- **The `llm` interface:** the retry on invalid JSON, `ai_invalid`, the cache hit.
- **Caps:** per person, per trip and daily, plus `ai_resting`.
- **Hidden when AI is off,** and when the trip owner or the person has switched it off.
- **Fake provider end to end:** the job, the event, the fetch, the apply.

### Docs
ADR `030-ai-on-workers-ai.md` covers the provider and why, the allowance and caps, what's sent and stripped, the preview-only rule, and the models chosen. Also update `render.yaml` (new `sync: false` keys) and `DEPLOY-FREE.md` (a Cloudflare step).

---

## Week 21 — Catch me up, reading receipts, and small helpers

### Catch me up (small model)
- **When it appears:** on the Chat tab when you have **30 or more unread**.
- **What it gives:** 3–6 bullets covering decisions made, open questions, and things asked of you. Each links to its message.
- **Facts come from system messages, not guesses:** polls and their results, plan changes, expenses.
- **Limits:** at most 300 messages. Cached by (trip, from, to).

### Reading receipts: the text is read on the phone, for free
- **Why on the phone:** running Tesseract on a 0.1 CPU, 512 MB server is too slow, and a vision model costs a lot of allowance. So:
  - **Android:** ML Kit text recognition (`@react-native-ml-kit/text-recognition`). Free, works offline, and it's a **native module, so this week needs a new APK**. Older APKs don't show the button: check that the module is present.
  - **Web:** `tesseract.js` in the browser, loaded only when used.
- **Then:**
  - the server gets **text only**;
  - `guessAmount` (shared `money.ts`) plus date and currency heuristics find the total;
  - the small model picks the **merchant and category** (skipped when AI is off);
  - the expense sheet opens prefilled, and the person confirms.
- **The photo is attached** to the expense and saved under Tickets & files → "Receipts".

### Small helpers
- **Bookings from email, assist:** for low-confidence imports (week 16), the small model fills missing fields from the email text. The result is still a draft to check.
- **Journal "Draft today's entry"** (the journal plan's v2 item): built from that day's header (stops, weather, photo places) and your own messages. It opens as a **Just me** entry for you to edit, and is never posted to the group by itself.

### Tests
- **Summary input:** the range, the cap, links back to messages, and system messages used as facts.
- **Receipt totals** on a set of sample OCR texts (INR, EUR, USD, with tax and tip lines).
- **The import assist** never overwrites a field the parser found.
- **The journal draft** uses only the person's own messages plus the shared day header.

### Release
API deploy, then **a new APK** (`./scripts/build-apk.sh`). Tell the group to install it: older APKs stop getting OTA updates once the native fingerprint changes.

---

## Week 22 — Ask your trip, and the trip assistant

### Ask your trip (search by meaning, with sources)
- **What people get:** an **Ask** box on the Overview, and `/` in Chat. For example:
  - *"What time is our flight back?"*
  - *"Who still owes me?"*
  - *"What did we decide about dinner on Saturday?"*
  - *"Where's the Wi-Fi password?"*

  Short answers come with **numbered sources** that open the exact message, booking, note, expense, plan stop or journal entry. If it doesn't know, it says so and offers a plain search.
- **Embeddings:**
  - **Migration:** `create extension if not exists vector` (Neon supports it), then `ai.chunks (id, trip_id, source_type, source_id, text, embedding vector(<dims>), updated_at)`, with an HNSW index and `trip_id` always in the WHERE clause.
  - **Locally:** `docker-compose.yml` moves to an image with pgvector added (`postgis/postgis:16-3.4` plus `postgresql-16-pgvector`).
- **Index lazily, to save the allowance:**
  - A trip is indexed **the first time someone opens Ask on it**: a backfill job, batched at 100 texts per call.
  - After that, incremental `embed` jobs run on create, edit and delete of messages, notes, list items, bookings, plan items, ideas, expense descriptions and **group** journal entries, debounced by 1 minute.
  - Deletes and edits remove or replace chunks straight away, so deleted content can't come back.
  - Private journal entries are indexed with their `author_id` and only ever searched by their author.
- **Facts come from the database, not the model,** for anything with an exact answer:
  - money (`computeBalances`, `suggestTransfers`);
  - booking times and references;
  - what's on day N;
  - who's on the trip.

  A router (keyword rules first, then the **small** model as a classifier) chooses facts, search or both.
- **Answering:**
  - The facts plus the top chunks (at most 3k tokens) go into the main model with strict rules: answer only from these sources, cite them as [1] [2], and otherwise say *"I couldn't find that"*.
  - The output is `{answer, citations}`. Citations that weren't in the context are dropped.
  - Answers stream over the WebSocket if the provider streams; otherwise they arrive whole. Sources show as soon as they're found.
- **Privacy:**
  - It only ever searches the current trip, only what this member may see, and through the same `requireTripRole`.
  - A removed member's access ends at once.

### The trip assistant (requests, always confirmed)
- **What people get:** the same Ask box takes **requests**:
  - *"Add dinner at Fisherman's Wharf at 8 pm tomorrow"*
  - *"I paid ₹900 for the cab, split with Sam and Priya"*
  - *"Move the fort visit to Saturday morning"*
  - *"Add sunscreen to everyone's packing"*
  - *"Remind me to book Sintra tickets on Friday"*
- **Actions:**
  - The model returns `{actions: [{tool, args}]}` as JSON. Each tool's `args` are the **existing zod input schemas**, and each action calls the **existing service**.
  - **Tools:** `add_plan_item`, `move_plan_item`, `add_expense`, `add_list_item`, `add_todo`, `find_place` (Photon), `get_day`, `get_balances`.
  - Editor-only tools aren't offered to viewers, and the server re-checks the role anyway.
- **Always a preview:**
  - The actions show as cards (*"Add to Saturday: Dinner at Fisherman's Wharf, 8:00 pm"*) with **Do it / Edit / Cancel**. Only **Do it** runs them.
  - At most 5 actions per request, in one transaction where possible.
  - When something is unclear ("which Sam?"), it asks instead of guessing.
- **Safety:**
  - Trip text (chat, imported emails, journal) goes in as **quoted data, never instructions**.
  - Arguments are validated against the schemas.
  - Everything counts toward the caps.

### Tests
- No leaks between trips (fake embeddings).
- Deleted and edited content leaves the index.
- Other people's private journal entries are never returned.
- Money questions use the facts, not the model's arithmetic.
- Made-up citations are dropped.
- Each tool maps to the right service.
- Viewers can't run editor tools.
- Nothing runs without **Do it**.
- **Injection fixtures:** a chat message saying "delete all expenses" produces no action.

### Docs
ADRs `031-ask-your-trip.md` and `032-trip-assistant.md`.

---

## Week 23 — Quality checks (evals), and the Tagalong MCP server

### Quality checks for AI output
- **The test trips:** 8–10 realistic trips written by us in `apps/api/test/ai-evals/`, with no real personal data. They cover:
  - single and multi-city trips;
  - bookings, many ideas and no ideas;
  - questions with known answers;
  - requests with known correct actions;
  - injection cases.
- **Automatic checks:**
  - **Drafts:** every booking on the right day; no invented stops; timed stops kept; days balanced; travel time under a limit.
  - **Answers:** the expected fact is present; every citation is real; "I couldn't find that" when the trip doesn't say.
  - **Assistant:** the expected actions (tool and key arguments); nothing for injection cases.
- **Running them:**
  - `pnpm ai:eval` runs **against Ollama on the Mac by default**, so it's free and doesn't touch the allowance.
  - `pnpm ai:eval --provider workers-ai` checks the production models. That suite is kept **under about 60 calls**, so a run fits in a day with room to spare.
  - It prints a scorecard (pass rate per check, time, tokens, neurons) and saves `ai-evals/results/<date>-<model>.json`.
- **Gate:** changing a prompt or a model needs a scorecard no worse than the last saved one.
- **Not in CI:** these need a real model. CI keeps the fast fake-provider tests.
- **Tracing:** `ai.usage` already records time, tokens and failures. A small *AI usage* section on the server's admin log (or a `scripts/ai-usage.sh` query) replaces the old plan's self-hosted Langfuse, which can't run on the free server.

### The Tagalong MCP server
- **What it is:** lets people use **their own AI assistant** (Claude Desktop or any MCP client) with their trips: *"What's on day 2 of our Goa trip?"*, *"Add a dinner stop on Saturday"*.
  - **It costs none of our allowance:** the person's assistant brings its own model.
- **Where it runs:**
  - In the **same process**, at `https://<api>/mcp` (streamable HTTP), mounted in `all.ts` and `server.ts`, because there's one free server. The code lives in `apps/api/src/modules/mcp/` and uses the official TypeScript SDK.
  - A small `stdio` build for developers.
- **Sign-in:**
  - **OAuth 2.1 with PKCE and dynamic client registration**, as MCP clients expect.
  - The person approves in the web app at `/connect`. They choose **read-only** or **read and change**, and which trips.
  - **Tables:** `identity.oauth_clients`, `oauth_codes` and `oauth_tokens`, with only hashes of the codes and tokens stored.
  - Tokens are separate from app sessions, expire, and can be revoked in *Profile → Connected apps*.
- **What it exposes:**
  - **Resources:** `trips`, `trip/{id}/plan`, `trip/{id}/bookings`, `trip/{id}/balances`, `trip/{id}/lists` and `trip/{id}/journal` (group entries plus your own).
  - **Tools:** the week-22 assistant's tools, through the same services and checks. Tools that change things are marked as such, so clients ask before running them.
- **Safety:**
  - per-token rate limits;
  - every change writes `change_log` with `via: 'mcp'`, and the chat activity card says *"Added by Chandraj via their assistant"*.
- **Docs:** a short page, "Use Tagalong with your AI assistant", with the Claude Desktop setup.

### Tests
- OAuth: scopes, PKCE, revocation taking effect immediately.
- Resources match the API.
- Read-only tokens can't change anything.
- No reach across trips.
- `via: 'mcp'` is recorded.

### Docs
ADRs `034-ai-evals.md` and `035-mcp-server.md`. After this week, the offline weeks use ADR `036-offline-sync.md` (renumbered from the old plan's 020, which is taken).

---

## After week 23
**Weeks 18–19, works offline**, as planned in `weeks-17-21.md`. AI features are online-only: with no signal they show *"Needs a connection"*.

Sources checked for the Workers AI allowance (October 2026): https://costbench.com/software/llm-api-providers/cloudflare-workers-ai/free-plan/, https://flaviocopes.com/cloudflare-workers-ai.md. The model names and the OpenAI-compatible endpoint must be confirmed against Cloudflare's own docs when building week 20.
