# Trip journal (built right after week 17, before offline)

Status: approved plan. Everything stays free. One session for v1, shipped as a migration, an API deploy and an OTA update (no new native modules). Builds on what exists:
- photos and videos with places (`media`)
- the plan with places
- multi-place weather (`tripWeather`)
- chat
- notification prefs and batching
- MapLibre maps
- trip covers
- avatars

**Goal:** turn each day of a trip into a shared memory with almost no typing, and give the group a story to look back on.

---

## 1. Daily journal pages
- **Where it lives:** no new tab. A **Journal** card on the Overview, prominent from the first day of the trip and afterwards, opens `trips/[id]/journal` (a list of days) → `journal/[date]` (one day).
- **A day page shows:**
  - The **auto-filled day header** (section 2).
  - **Everyone's shared entries,** newest last, plus **my private ones** with a 🔒.
  - **"Who's written today":** small avatars of the members who've added something, and faded ones for those who haven't. No nagging text.
- **An entry has:**
  - **text** (≤ 10k characters, links tappable)
  - an optional **mood** (😍 🙂 😴 🥵 🌧️ 🤯)
  - optional **photos and videos**, picked from the trip album or added new (new ones also go into the album, as `source 'journal'`)
  - an optional **place** (the same `PlaceField` as plan stops)
  - **visibility:** *Just me* or *The group* (default: the group)
- **Editing:** your own entries, any time. Deleting is soft, and the owner can remove others' for moderation, like chat.
- **Social:** reactions (the same emoji set as chat) and short **comments** on group entries. Both are live through the gateway (`journal.updated` events).
- **Quote board:**
  - In chat, a message's ⋯ menu gets *Save to journal*. It becomes a "quote" entry on that day, showing the original sender and linking back to the message.
  - Funny lines from the plan or polls can be saved the same way.
- **Viewers:** can write their own entries. It's their trip memory too.
- **Drafts:** a half-written entry is kept on the device until it's sent (before offline support arrives in weeks 18–19).

### Data (migration)
- `journal.entries`:
  - `id, trip_id, author_id, date, kind 'note'|'quote', body, mood null, visibility 'group'|'private'`
  - `media_ids uuid[], place_label/latitude/longitude/place_ref null, source_message_id null`
  - `version, timestamps, deleted_at`
  - Indexed `(trip_id, date)`.
- `journal.reactions (entry_id, user_id, emoji)` and `journal.comments (id, entry_id, author_id, body, created_at, deleted_at)`.
- **Private entries:** only their author can ever read them. Every query filters on `visibility = 'group' OR author_id = me`. They're excluded from "Ask your trip" (weeks 22–23) unless you're the author.

### API
- `GET /trips/:id/journal?from&to`: days, with entry counts and who wrote.
- `GET /trips/:id/journal/:date`: entries, plus the day header.
- `POST /trips/:id/journal` (client id) · `PATCH /journal/:id` (author, `version`) · `DELETE /journal/:id` (author or owner).
- Reactions and comments endpoints, mirroring chat's.
- `POST /messages/:id/save-to-journal`.
- Events published after commit, as everywhere.

## 2. The auto-filled day header (no typing)
- **The date and the day's city** ("Day 3 · Porto"), from `trip_places`.
- **Weather that day:** the forecast while it's upcoming, the **actual** weather once it's past (Open-Meteo archive, asked for on the device, like the weather card).
- **Where you went:** that day's plan stops in order, with a small **route map** (MapLibre, the same route geometry as Plan → Map), plus total distance and travel time from the cached routing.
- **The day in numbers:** photos and videos taken that day (from the album's taken-at), messages sent, money spent (sum of that day's expenses, shown per person in the trip currency).
- **Highlights:**
  - The day's **top photos:** the most favourited, else the first few.
  - The **most-voted idea** that happened that day.
  - The **busiest chat moment** (the 10 minutes with the most messages, shown as a link).

## 3. Gentle prompts
- **An evening nudge** during the trip: a push at **8:30 pm in the trip's local time**, adjustable or off under *Profile → Notifications*, as a new kind `journal`.
  - **Rotating questions:** *"Day 2 in Goa: what was the best moment?"*, *"Best thing you ate today?"*, *"Something that surprised you?"*, *"Quote of the day?"*
  - **Skipped** if you've already written that day, or if the trip is muted.
- **One-tap starters** on an empty day page: *Best part of today* (pick from today's stops or photos), *Best meal*, *Funniest moment*, *Quote of the day*. Each prefills an entry you can edit.
- **Sending:** a daily worker job sends it once per user, trip and day, via a `journal_prompts_sent` table.

## 4. "On this day" memories
- **The job:** a daily worker job finds trips whose dates match today in earlier years, for each member.
- **What it does:**
  - **A push:** *"A year ago today you were at Dudhsagar Falls 🌊"*, which opens that day's journal page.
  - **A card** on the trips list ("1 year ago: Goa with the gang"), dismissible.
- **Control:** respects notification prefs, with its own toggle *Memories* (on by default). It's never sent for deleted trips, or trips you've left.

## 5. End-of-trip recap
- **When it's ready:** the morning after a trip ends, a push says *"Your Goa recap is ready ✨"*, and the Overview shows a **Recap** card from then on.
- **The recap screen:** `trips/[id]/recap`, a scrollable story:
  1. **Cover:** the trip photo or colour, name, dates, avatars.
  2. **Stats:** days, places visited, distance travelled, photos and videos, messages, the most-used emoji, the top 3 most-liked photos, each person's total spend and the biggest shared expense.
  3. **Day by day:** a map that follows the route as you scroll, with each day's top photos, a few journal snippets (group entries only), weather and city.
  4. **Ending:** a group photo grid and *"Plan the next one"*, which copies members into a new trip.
- **Sharing:** members only. Opening the recap in the web app needs sign-in; a public share link is out of scope for v1. A **"Save as image"** option renders the stats card as a PNG for WhatsApp.
- **Stats** are computed by a pure `tripRecap(…)` in shared and cached server-side once the trip is over (refreshed if anything changes).

## Tests
- **Pure:** `dayHeader(…)` (stops, distance, spend per person, highlights) and `tripRecap(…)` (every stat, multi-city, no photos, no expenses). Prompt selection and "already wrote today".
- **API:**
  - Private entries are invisible to others (including via the day header and recap).
  - Editing and deleting permissions; viewers can write.
  - Save-to-journal links back.
  - Reactions and comments.
  - Events.
- **Jobs:** the evening prompt is sent once, in the trip's local time, skipped when you've written or muted it. "On this day" matches only past years and members.

## Later (v2, not in this session)
- **PDF photo-book export:** a cover and one spread per day, made on the server.
- **Postcards:** a photo plus one line turned into a shareable image.
- **AI help** (with weeks 20–23): *"Draft today's entry"* from the plan, photos and chat, for you to edit; caption suggestions; a written trip summary in the recap.
- **Steps and distance walked** from the phone's health data (needs a native module, so it comes with an APK).
- **A public recap link** that the owner can turn on.

## Docs
- ADR `033-journal.md` covers private vs group entries, the auto header, prompts and recap caching.
- Update `docs/ABOUT.md`.
