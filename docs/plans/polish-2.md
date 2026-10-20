# Polish 2: several destinations, calendar, whole-day directions, live location, reminders, avatars, widget

Status: approved plan. Everything stays free.

Sessions at a glance:
- **E:** trips with several destinations · open a whole day in Google Maps. Server + OTA.
- **F:** calendar export · countdown and packing reminders · avatars and profile photos. Server + OTA.
- **G:** live location sharing · Android home-screen widget. **One new APK**, because both need native modules.

Starting point:
- Last migration `0020_videos`.
- A trip has **one** destination on `trips.trips`: `destination`, `place_id`, `latitude`, `longitude`, `bounds`, `country_code`, `timezone`.
- `identity.users.avatar_key` exists but is unused.
- Push prefs and kinds, batching, local reminders (`expo-notifications`) and the realtime gateway all exist from polish-1.
- `lib/directions.ts` opens one place in Google/Apple Maps.

---

## Session E

### E1. Trips with several destinations (Lisbon → Porto → Madrid)
- **DB (migration `0021`):** `trips.trip_places`:
  - `id, trip_id, position (fractional), destination label, place_id, latitude, longitude, bounds, country_code, timezone, start_date null, end_date null, version, timestamps`.
  - **Backfill:** one row per existing trip, from its current destination columns.
  - **Kept in sync:** `trips.trips` keeps its destination fields as a **summary**, maintained by the service: the label "Lisbon → Porto → Madrid", the first place's timezone and country, and bounds as the union. Old clients and every existing query keep working.
- **Which place a day belongs to:** `placeForDate(places, date)`, pure and in shared.
  - The place whose date range contains the day.
  - Otherwise the nearest earlier place.
  - With no dates set, the first place.
  - **Travel days** (one place ends the day another starts) belong to both, shown as "Lisbon → Porto".
- **API:**
  - `GET/POST/PATCH/DELETE /trips/:id/places`: editors and owners. A trip needs at least one place. Reorder with `position`. Dates must sit inside the trip's dates and must not overlap except on travel days; 400 with a clear message otherwise.
  - Events `place.upserted` and `place.deleted`.
- **What follows the day's place:**
  - **Weather:** each day uses that day's place.
  - **Explore:** a place switcher at the top (chips: Lisbon · Porto · Madrid).
  - **Place search:** for stops and ideas, results are biased to the place of the stop's day (or the selected Explore place).
  - **Plan:** day pills show a small city label when the trip has several places. The map frames everything, or just the filtered day's city.
  - **Time zones:** times for a day's stops use that place's timezone, which matters for Lisbon → Madrid (+1 h). Reminders follow the same.
- **App:**
  - *New trip*: "Add another stop on this trip" under the destination, with optional dates per city.
  - *Edit trip*: a reorderable list of places.
  - *Overview*: "Lisbon (Oct 22–24) → Porto (24–26) → Madrid (26–29)".
- **Not in this session:** travel legs between cities (trains and flights). Those stay bookings, but a booking can be linked to a place change later.
- **Tests:**
  - `placeForDate` cases: dates, gaps, travel days, no dates.
  - CRUD permissions; the at-least-one rule; overlap validation.
  - The summary fields stay in sync.
  - Weather and Explore use the right place, with the fake geo recording calls.

### E2. Open a whole day in Google Maps
- **What it does:** the day header in Plan gets *"Open day in Google Maps"*. It opens Google Maps with every located stop of that day, **in plan order**, as one route, using the day's travel mode (walk, drive or cycle).
- **URL:** `https://www.google.com/maps/dir/?api=1&origin=…&destination=…&waypoints=a|b|c&travelmode=walking`. Places are given as `lat,lng` (with the name as a query when there's a `placeRef`).
- **Google's limit:** at most **9 waypoints** per link. Longer days split into parts: *"Open part 1 (stops 1–10) · part 2 (10–14)"*.
- **Where it works:** Google Maps on iPhone too, and in a browser. Apple Maps can't take multi-stop links, so iPhone always uses Google, and says so.
- **Gaps:** stops without a location are skipped, with a note ("2 stops aren't on the map").
- **Tests:** a pure `dayRouteLinks(stops, mode)`: order, splitting, skipping, encoding.

**Ship:** migration `0021`, deploy API, OTA.

---

## Session F

### F1. Export to calendar
- **A personal calendar feed,** so Google or Apple Calendar can *subscribe* and stay in sync:
  - `GET /calendar/<token>.ics` (no sign-in; the token is the key).
  - **Contents:** across all *my* trips:
    - every **timed plan stop** (an event with start and end in its place's timezone, location, notes and a link back to the app);
    - every **booking** (flights, stays as check-in/check-out events, trains, tickets);
    - each **trip** as an all-day span.
  - Untimed stops are left out unless the person turns on *"Include stops without a time as all-day items"*.
- **Feed token:**
  - **DB:** `identity.calendar_feeds (user_id, token_hash, created_at, last_fetched_at)`. 32 random bytes, only the SHA-256 is stored, like invites. Creating a new one revokes the old.
  - **App:** *Profile → Calendar*:
    - **Add to Google Calendar:** opens Google's "add by URL" page with the feed.
    - **Add to Apple / other calendar:** a `webcal://` link.
    - **Copy link.**
    - **Stop sharing / new link.**
  - A warning says *"Anyone with this link can see your trip plans."*
- **One-off download:** the trip ⋯ menu gets *"Download calendar (.ics)"* for just that trip.
- **Format:** RFC 5545 with `VTIMEZONE` blocks, stable `UID`s (`item-<id>@tagalong`) so updates replace events, `SEQUENCE` from `version`, folded lines and escaped text. A small writer in shared, with no dependency needed.
- **Tests:** ICS output (time zones, all-day, escaping, folding, stable UIDs); revoked or unknown tokens give 404; the feed holds only my trips; removed members drop out.

### F2. Countdown and packing reminders
- **Countdown everywhere:**
  - The trips list and Overview already show "In 4 days".
  - Add a **"Get ready" progress line**: *"4 of 18 packed · 2 to-dos open"*, counting my own ticks on "everyone" items plus shared items that are still open.
- **Push reminders,** a new kind `countdown` in the notification prefs, on by default:
  - **7 days before:** *"A week to Goa! 2 to-dos still open."* Sent only if anything is open.
  - **3 days before:** *"3 days to go · 14 items to pack."*
  - **Day before, 7 pm local:** *"Tomorrow: Goa 🌴 · weather 31°/24°, rain likely · 4 items to pack."*
  - **Morning of:** *"Today's the day! First up: Flight 6E 2134 at 10:40."* From the first booking or timed stop.
  - Sent by a daily worker job, at the user's local hour (`identity.users.timezone`), respecting prefs and per-trip mute. Each reminder is sent once per trip (`countdown_sent` table, keyed by trip, user and stage).
- **Tap → opens** Lists (packing) or Overview.
- **Tests:** stage selection by days left; the user's local time; skipped when nothing is open; sent once; mute and prefs respected; time zones.

### F3. Avatars and profile photos
- **Choosing a photo:** *Profile → Photo*. Upload or take one, **crop square on the device**, 512 px, compressed. Or *Remove*.
  - **Storage:** `avatars/<userId>/<random>.jpg`. `users.avatar_key` points at the current one, and the old one is deleted on change.
- **Who can see it:** only people who share a trip with you, plus yourself.
  - **Delivery:** `GET /users/:id/avatar` checks that, then redirects to a signed URL valid for 1 hour, with a stable cache key, so `expo-image` caches it and avatars don't reload on every screen.
  - `TripMember`, chat senders and so on carry `avatarVersion`, so a changed photo refreshes.
- **Where it shows:** a shared `<Avatar user>` component used everywhere initials are today: members, chat, message info, trip header travellers, poll voters, expense payers, map pins (live location, G1).
  - **Fallback:** initials in their colour, as now.
- **Tests:** a non-co-member gets 404; replacing deletes the old object; the content type is validated (jpeg, png, webp); size cap of 2 MB.

**Ship:** migration `0022`, deploy API, OTA.

---

## Session G (one new APK)

### G1. Live location sharing, opt-in for a few hours
- **Starting:** *Share my location* on the trip map, for **1 hour / 4 hours / until the end of today**. Each person chooses; there's nothing automatic.
  - A persistent banner (*"Sharing your location with Goa trip · 2 h left · Stop"*) is on every screen of that trip while it's on.
  - **Stop any time:** it also stops when the time runs out or you leave the trip.
- **On the phone:** `expo-location` + `expo-task-manager` *(new native modules)*.
  - **Background updates** run as an Android **foreground service** with its own notification ("Tagalong is sharing your location"), as Android requires.
  - **Battery-friendly:** an update every 60 s or every 50 m, whichever comes later, at "balanced" accuracy.
  - **Permissions:** foreground location first. "Allow all the time" is asked only if the person wants sharing to continue while the app is closed. Otherwise it shares only while the app is open.
- **Web:** `navigator.geolocation.watchPosition`, only while the tab is open, and the page says so.
- **Server: ephemeral by design.**
  - `POST /trips/:id/location {lat, lng, accuracy, until}` stores the position in **Redis only**, as `location:<trip>:<user>` with a TTL equal to the time left. It is **never written to the database**.
  - Publishes `location.updated` through the gateway to members of that trip only.
  - `DELETE` to stop, which also publishes.
  - **Rate limit:** 1 per 20 s per user.
- **Seeing others:** on the trip map, avatar pins for everyone currently sharing, with *"Priya · 3 min ago"* and a faded pin once the position is older than 10 minutes. *"Directions to Priya"* opens Google Maps to their position.
- **Plan wording and Play policy:**
  - The permission text explains why.
  - Background location is used only after an explicit opt-in.
  - That keeps the app eligible for Google Play's background-location rules later.
- **Tests:**
  - Positions expire.
  - Only members can read them, and they're never in the database.
  - Leaving the trip stops sharing.
  - The rate limit.
  - Events reach the right trip only.

### G2. Android home-screen widget
- **Library:** `react-native-android-widget`, which has an Expo config plugin, and the widget is laid out in JS/JSX *(new native module)*.
- **Two sizes:**
  - **Small (2×2):** the next trip's countdown, e.g. *"Goa · in 4 days"* with its cover colour or photo.
  - **Medium (4×2):** during a trip, **today's next stop** (time, name, *"in 25 min"*) and the next booking. Before a trip, the countdown and *"4 of 18 packed"*.
- **Data:**
  - The app writes a small snapshot (next trip, today's stops, packing counts) to the widget's storage whenever it syncs or the plan changes.
  - The widget refreshes from that snapshot every 30 min (Android's minimum) and at midnight. It never calls the API itself.
- **Taps:** the widget opens the app on the trip, or on the stop.
- **Tests:** a pure `widgetSnapshot(trips, now)` function: next-trip choice, during vs before a trip, timezone edges.

**Ship:** migration `0023` (if needed), deploy API, **new APK** (`./scripts/build-apk.sh`) with expo-location, expo-task-manager and react-native-android-widget. Then OTA as usual.

---

## Cross-cutting
- **ADRs:** `025-multi-destination-trips.md` (summary columns, `placeForDate`), `026-calendar-feeds.md` (token as key, revocation), `027-live-location.md` (ephemeral in Redis, opt-in and expiry, background rules) and `028-widget.md`.
- **Docs:** update `docs/ABOUT.md` (features and walkthrough).
- **Privacy:** live location and calendar feeds are the two features that expose personal data outside the app's screens. Both are opt-in, time-limited or revocable, and named in *Profile → Privacy*.
