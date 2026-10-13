# Weeks 14–16: smarter places, checklists and notes, bookings from email

Status: approved — defaults below are decided (Overview card, Walk under 3 km else Drive, viewers tick their own packing). Everything here is free with no API keys.

## Week 14 — Smarter places for the plan

### 14.1 Real places on plan items
- **API:** `GET /places/search` gains `scope=place` (default stays `destination`). In place scope Photon is called without the city/region `layer` filter, biased to the trip's location (`lat`, `lon`, `location_bias_scale`), and limited to the trip's bounds widened by ~30 km. Same 1-day cache and 60/min limit.
- `PlaceResult` gains `address` (street, area) so a pick shows "Time Out Market · Av. 24 de Julho, Lisbon".
- **Mobile:** a shared `PlaceField` (built from `destination-field.tsx`) replaces the plain "Where" text box in `item-sheet.tsx` and the address box for stays in `booking-sheet.tsx`.
  - Picking a suggestion sets `placeName`, `latitude`, `longitude` and `placeRef`.
  - Typing without picking still works (no coordinates, as today).
  - Ideas already on the map appear first in the suggestions ("From Ideas").
- **Existing items without coordinates:** the item screen shows "Find on map", which opens the same search prefilled with the place name.
- Plan list rows with a location get a small pin icon. Rows without one say nothing, so there's no nagging.

### 14.2 Travel time between stops
- **Source:** the FOSSGIS OSRM servers at `routing.openstreetmap.de` (`routed-foot`, `routed-car`, `routed-bike`). They're free, need no key and are fair-use; we send a proper User-Agent and cache hard. The base URL lives in env, so we can self-host OSRM on the Oracle box later if needed.
- **API:** `GET /trips/:id/days/:date/route?mode=foot|car|bike` (viewer and up).
  - One OSRM `/route` call covers the day's located stops in plan order.
  - Returns `legs[] {fromId, toId, distanceM, durationS}`, `totalDistanceM`, `totalDurationS`, the `geometry` (GeoJSON line) and `estimated: boolean`.
  - Cached in Redis by mode plus the rounded coordinate list for 30 days. A changed order is a different key, so no invalidation is needed.
  - **Fallback:** when OSRM is down or slow (5 s timeout), use straight-line distance × 1.3 at a typical speed per mode, with `estimated: true`. The UI then says "about".
- **Mobile Plan list:** between two located stops, a thin connector line reads "🚶 12 min · 900 m". Unlocated stops break the chain, and the connector says nothing.
  - The day header shows totals plus a mode chip (Walk / Drive / Cycle).
  - The mode is remembered per device and day. The default is Walk when the day's stops span under 3 km, otherwise Drive.
- **Mobile Plan map:** when one day is filtered, draw the route line in that day's colour. MapLibre uses a line layer; the Expo Go fallback uses `Polyline`.

### 14.3 Route optimiser ("Shortest order")
- **Pure solver in `packages/shared/src/route.ts`:** `optimiseDay(stops, matrix)`, fully unit-tested.
  - **Fixed points:** the first stop, any stop with a start time, and any stop without coordinates stay in their place. The stops between two fixed points are reordered, with both ends fixed. That way "Breakfast at the hotel" and "Dinner 8 pm" never move.
  - Each segment is solved exactly (Held–Karp) for ≤ 10 stops, else nearest-neighbour plus 2-opt.
- **API:**
  - `GET /trips/:id/days/:date/optimise?mode=` returns the suggested order, the time saved and `estimated`. It uses an OSRM `/table` matrix, with the same cache and fallback as above.
  - `POST /trips/:id/days/:date/order {itemIds, versions}` (editor) rewrites positions in **one transaction**. It returns 409 with the current items if anyone changed the day meanwhile. It writes one `change_log` entry per moved item and publishes one `day.reordered` event.
- **Mobile:** a "Shortest order" button in the day header, shown to editors when the day has ≥ 3 movable located stops.
  - Tapping it opens a preview with the before and after order and "Saves about 25 min".
  - **Apply** saves it; **Keep mine** closes.
  - If there's nothing to gain (< 2 min) it says so instead.

### Tests (week 14)
- **Shared:** solver correctness against brute force on random small cases, fixed points never moving, segment splitting, and the 2-opt path for large days.
- **API:**
  - Place-scope search params (fake geo).
  - Route legs, and the cache hit on a second call.
  - The fallback when OSRM fails, with `estimated: true`.
  - Optimise response.
  - The order endpoint: happy path, a stale version (409), viewer (403), an item from another day or trip (400), and one event published.

## Week 15 — Checklists and notes

### 15.1 Checklists (packing and to-dos)
- **DB (new `lists` schema, migration 0015):**
  - `lists.lists`: `id, trip_id, title, kind 'packing'|'todo', position, version, timestamps, deleted_at`.
  - `lists.list_items`: `id, list_id, trip_id, text, scope 'shared'|'everyone', assignee_id null, due_date null, item_id null` (link to a plan item), plus `done_by, done_at, position, version, timestamps, deleted_at`.
  - `lists.list_item_checks`: `(list_item_id, user_id)` primary key, `checked_at`, for "everyone" items.
- **Two kinds of entry:**
  - **Shared** ("First-aid kit", "Book Sintra tickets"): one tick for the group, with an optional "Sam's bringing it" assignee.
  - **Everyone** ("Passport", "Charger"): each person ticks their own. The row shows "3 of 5 packed", and tapping it shows who hasn't.
- **Starter suggestions (no AI):** a packing template in `packages/shared/src/lists.ts`, picked from the trip's weather (rain → umbrella, under 10 °C → warm layers) and recommendation categories (beach → swimwear). Offered once on an empty packing list as "Start with suggestions", and the person picks what to keep.
- **API:** CRUD for lists and items (client ids, version checks, `change_log`, events `list.upserted`, `list.deleted`, `list_item.upserted`, `list_item.deleted`). Also:
  - `POST /list-items/:id/check` and `DELETE /list-items/:id/check`: your own tick on an "everyone" item.
  - `POST /list-items/:id/done`: the shared tick.
  - Viewers can tick their own "everyone" items (it's their own packing) but can't add or edit entries.
- **Mobile:** `trips/[id]/lists.tsx` with a Packing / To-dos switch.
  - Rows tick on tap. Long-press opens the ⋯ menu (Edit, Assign, Due date, Delete).
  - Optimistic updates, and live via the realtime gateway.
  - The plan item screen gets "Add a to-do for this", which links the to-do to the item.

### 15.2 Notes
- **Day notes:** finally use `itinerary.trip_days`.
  - `PUT /trips/:id/days/:date {title?, notes?, version?}` creates the row on first write.
  - `GET /trips/:id/items` also returns `days[]`.
  - The Plan tab shows the day's title and note under the day pills ("Sintra day — 9:10 train from Rossio"), tap to edit.
- **Trip notes:** a `lists.notes` table with `id, trip_id, title, body (plain text, ≤ 20k chars), pinned, updated_by, version, timestamps, deleted_at`. For several notes like "Emergency numbers", "Wi-Fi codes", "Useful phrases".
  - **Conflicts:** a version check. On 409 the editor shows "Sam changed this note" with their text and yours side by side, and **Use theirs** / **Keep mine** buttons. No live co-editing.
- **Mobile:** a Notes section on the same `lists.tsx` screen (a third switch option: Packing · To-dos · Notes), or `notes/[noteId].tsx` for the editor. Links in notes are tappable.

### Where it lives
- **No new tab** (six is already the most that fits).
- The Overview gets a **"Get ready"** card: "Packing 12/30 · 2 to-dos left · 3 notes", opening `lists.tsx`.
- Plan items show a ☑ badge when they have open to-dos.

### Tests (week 15)
- Migration up.
- List and item CRUD, idempotent creates, a stale version (409), viewer writes (403) but viewer self-ticks allowed.
- "Everyone" counts, a removed member's ticks not counted, and the template picker (shared unit tests).
- Day-note upsert and its 409, and note CRUD with its 409.
- Events published after commit.

## Week 16 — Bookings from email

Free, no paid parser. Imports never become bookings on their own: everything lands as a **draft to review**, so a wrong guess or a spoofed email can't change a trip.

### 16.1 The parser (`apps/api/src/lib/booking-import/`, pure functions, heavily unit-tested)
- **Structured data first:** schema.org JSON-LD and microdata that airlines and hotels embed in emails (`FlightReservation`, `LodgingReservation`, `TrainReservation`, `BusReservation`→train, `EventReservation`→ticket, `RentalCarReservation`→car, `FoodEstablishmentReservation`→restaurant). Maps straight onto `CreateBookingInput` (type, provider, reference, startsAt/endsAt with offsets, timezone, details).
- **Text heuristics second**, on the plain text of the email and of PDF attachments (text extracted with `unpdf`, pure JS):
  - Type detection by keywords.
  - Confirmation code / PNR (incl. 10-digit Indian rail PNR).
  - Flight numbers (`6E 2134`, `AI-865`) with IATA pairs (`BOM → GOI`).
  - Train number (5 digits), coach and berth.
  - Hotel check-in/out dates and address.
  - Dates and times in common Indian/UK/US formats.
  - Totals (`₹4,520`, `INR 4520.00`).
- Each candidate gets `confidence: 'high' | 'medium' | 'low'` plus a list of the fields it found. Multiple bookings per email are supported (return flights).
- **Fixtures:** realistic sample emails and PDFs written by us (IndiGo-style, IRCTC-style, Booking.com-style JSON-LD, Airbnb-style text, restaurant), never real personal data.

### 16.2 Drafts
- **DB (migration):** `itinerary.booking_imports`: `id, trip_id, source 'email'|'paste'|'document', created_by null, from_address, subject, received_at, status 'pending'|'added'|'dismissed', candidates jsonb, document_id null, message_id unique null, timestamps`.
- **API:**
  - `GET /trips/:id/imports` (editor+, pending first).
  - `POST /trips/:id/imports {text?, documentId?}`: paste the email text, or point at an uploaded PDF in Docs. It parses synchronously and returns the import.
  - `POST /imports/:id/add {candidateIndex, booking: CreateBookingInput}`: creates the booking via the existing service. The client sends the (possibly edited) fields. Marks the import `added` once all its candidates are handled.
  - `POST /imports/:id/dismiss`.
  - Events `import.created` and `import.updated`. A chat system card: "Found a flight in Sam's email — review it in Bookings."

### 16.3 Forwarding by email (works once a free Gmail inbox is set up)
- **One dedicated Gmail inbox** with plus-addressing: each trip gets an inbox code (random, rotatable by the owner), so the address is `tagalong.inbox+<code>@gmail.com`.
- **Env:** `IMPORT_IMAP_URL` (`imaps://user:app-password@imap.gmail.com:993`) and `IMPORT_ADDRESS`. If unset, the app hides forwarding and explains paste/upload instead.
- **Worker:** a repeatable BullMQ job every 2 min.
  - Fetches unseen mail with `imapflow` and parses it with `mailparser`.
  - Finds the trip from the `+code` in To/Delivered-To.
  - Accepts only if the From address is the email of a current trip member with editor+ role **and** `Authentication-Results` shows DKIM or SPF pass for that domain. Anything else is ignored and logged.
  - PDF attachments are saved to Docs (category "Tickets") and linked as `document_id`.
  - Dedupes by Message-ID, then marks the mail seen.
- **Mobile:**
  - Bookings area gets **"Add from email"**: shows the trip's forwarding address with Copy (when configured), a "Paste the email" box, and "Read a ticket from Docs".
  - A "Found in email" review list: each candidate is an editable card prefilled in the booking sheet's fields, with **Add** and **Not this**.
  - The Docs ⋯ menu gets "Find booking in this".
- **DEPLOY.md:** steps for the inbox (new Gmail, 2-step on, app password, IMAP on) — the same kind of free setup as SMTP.

### Tests (week 16)
- **Parser fixtures:** every type, return flights → 2 candidates, JSON-LD wins over text, garbage → no candidates, timezones/offsets right.
- **Import routes:** paste, document, add with edits, dismiss, viewer 403.
- **Worker:** with a fake mailbox — accepted sender, non-member ignored, failed DKIM/SPF ignored, unknown code ignored, duplicate Message-ID ignored, attachment saved to Docs.

## Cross-cutting
- ADRs: `017-routing-and-optimiser.md` (OSRM, fallback, fixed points), `018-lists-and-notes.md` (shared vs everyone, version-checked notes), `019-bookings-from-email.md` (drafts only, sender + DKIM/SPF check, IMAP polling).
- Update `docs/ABOUT.md` sections 3, 5, 6, 7 and the user walkthrough.
- Env: `ROUTING_URL` (default `https://routing.openstreetmap.de`).
- Verify each week with lint, per-package `tsc`, the targeted API tests, then the full suite once.
- Browser check only for the new screens: the place picker, travel connectors, the optimiser preview, the lists screen. Then a phone check in Expo Go.

## Not in scope
- The budget.
- Auto-adding imported bookings without review; paid parsing APIs or AI extraction.
- Offline.
- Live co-editing of notes.
- Public-transport times: there's no free, key-less source covering India.
- Reminders and notifications for due to-dos.
