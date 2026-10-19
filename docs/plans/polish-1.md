# Polish 1: trips, chat, media, notifications, dark mode, plan nudges

Status: approved plan. Everything stays free. Build it in four sessions, in order (A → D). Each session ends with tests green, the API deployed on Render, and the app shipped to phones.
- **OTA:** `./scripts/ota-update.sh "…"` for JavaScript-only changes.
- **APK:** `./scripts/build-apk.sh` when native modules change. Only session D needs one.

Starting point:
- Last migration: `0016_bookings_from_email`.
- `chat.messages` already has `kind`, `payload jsonb`, `reply_to_id`, `edited_at` and `deleted_at`. `chat.read_states` holds `last_read_at` per user and channel.
- Push is chat-only: `lib/jobs.ts` `notifyChat` feeds the batched `notify` queue, and `jobs/notify.ts` sends through Expo.
- `components/find-on-map-sheet.tsx` and `place-field.tsx` exist from week 14.
- Map style: OpenFreeMap `liberty`.

---

## Session A — archive and delete trips, edit and delete messages, unread counts

### A1. Archive or delete a trip
- **Archive is personal:** it hides the trip from *my* list without affecting anyone else. "Past trips" is automatic.
  - `trips.trip_members.archived_at` (nullable).
  - `POST /trips/:id/archive` and `DELETE /trips/:id/archive` (any member).
  - `GET /trips` returns `archived` and splits into **Upcoming**, **Past** (end date before today) and **Archived** (collapsed at the bottom).
  - The trip ⋯ menu gets *Archive*/*Unarchive*.
- **Delete is the owner's, for everyone,** with a grace period.
  - `trips.trips.deleted_at` is set, and the trip disappears for all members at once. A `trip.deleted` event fires, open screens leave the trip with "This trip was deleted", and a chat system card is posted.
  - The owner gets **30 days to restore**: `POST /trips/:id/restore`, shown in an "Recently deleted" row under Archived.
  - After 30 days a daily worker job **purges** it: rows go (cascade) and all its files go from storage (photos, thumbnails, documents).
  - **Confirm by typing the trip name.**
  - Editors and viewers get **Leave trip** instead (exists).
- **API safety:** every trip-scoped route must 404 for a deleted trip. Add the check to `requireTripRole` so it covers everything.
- **Tests:** archive is per-user; past/upcoming split; delete is owner-only; members get 404 after delete; restore works within 30 days; purge removes rows and storage keys (fake storage); the `trip.deleted` event fires.

### A2. Edit and delete chat messages
- `PATCH /messages/:id {body}`: sender only, text messages only (not polls, system cards or images), within **24 hours**. Sets `edited_at`; the app shows "edited".
- `DELETE /messages/:id`:
  - The sender can always delete their own. The **trip owner** can delete anyone's, for moderation.
  - It's a soft delete: `deleted_at`, body cleared, payload cleared.
  - Others see *"Message deleted"*, and replies quoting it show *"Original message deleted"*.
- **Events:** `message.updated` and `message.deleted`, applied live.
- **App:** the long-press menu gets **Edit** (opens the composer prefilled, with an "Editing message" bar) and **Delete** (with confirmation). Only the actions you're allowed are shown.
- **Tests:** sender-only edit; the 24 h window; can't edit others' or system messages; owner deletes anyone's; deleted body isn't returned; reply quote placeholder; events.

### A3. Unread counts
- **Server:** `GET /trips` adds `unreadCount` per trip: messages in the main channel after my `read_states.last_read_at`, not sent by me and not deleted. One grouped query, not N+1.
- **Server:** `GET /trips/:id/unread` returns `{chat}`, for the tab badge.
- **App:**
  - A count badge on each trip card ("3 new").
  - `tabBarBadge` on the **Chat** tab.
  - On a phone, the app-icon badge is the total (`expo-notifications` `setBadgeCountAsync`, already installed).
  - Counts update live from `message.created` and `read.updated` events. Opening chat marks it read (exists).
- **Tests:** counts exclude my own and deleted messages; reading resets; per-trip isolation.

**Ship:** migration `0017`, deploy API, OTA. No new APK.

---

## Session B — chat: photos and screenshots, @mentions, link previews

### B1. Photos and screenshots in chat
- `messages.kind = 'image'`, with `payload {mediaIds: uuid[], caption?}` holding up to 10 images per message.
- **Upload pipeline:** reuse the photo pipeline (presigned PUT, then the thumbnail worker). Chat images live in `media` with `source 'chat'`, and by default **don't** go into the trip album.
- **"Also add to the album":** a toggle per send, and "Add to album" afterwards from the message menu.
- **App:** a 📎 button in the composer offers *Photos* (library) and *Camera*, plus *Paste* on web. You see a preview strip with remove buttons before sending.
- **Display:** in the bubble, a grid of 1–4 thumbnails, "+N" beyond that. Tap opens the existing photo viewer (swipe, save, share).
- **Deleting** an image message also deletes its chat-only media from storage.
- **Tests:** the image message schema; media must belong to the same trip and to the sender; delete cascades to chat-only media; viewers can view.

### B2. @mentions
- **Composer:** typing `@` opens a member picker (filtered as you type). The chosen name is inserted as `@Priya`, and the message stores `payload.mentions: userId[]`.
- **Server:** checks the mentions are current members; others are dropped.
- **Display:** mentions are highlighted, and *your* name stands out.
- **Notifications:** mentioned people are notified **right away**, even if the trip is muted (see session C). An `@everyone`-style mention is left out to avoid noise.
- **Tests:** non-members are stripped; a mention sends an immediate push job; mention text survives edits.

### B3. Link previews
- After a text message with a URL is saved, a worker job `link-preview` fetches the first URL and stores `payload.preview {url, title, description, image, siteName}`, then publishes `message.updated`.
- **Safety (SSRF):** the fetch is the risky part.
  - `http`/`https` only.
  - Resolve DNS first and **refuse private, loopback and link-local addresses**, IPv6 included. Re-check after every redirect, with at most 3 redirects.
  - 5 s timeout, read at most 512 KB, `text/html` only.
  - No cookies, and our own User-Agent.
  - Cache by URL for 7 days in Redis.
- **App:** a compact card under the bubble (image, title, site). It's skipped for links to our own app (invites).
- **Tests:** OG/Twitter meta parsing; private IPs and redirects to them refused; timeout; size cap; non-HTML ignored; cache hit.

**Ship:** migration `0018`, deploy API, OTA. The image picker is already in the APK.

---

## Session C — notifications, and plan nudges with reminders

### C1. Notifications you can control
- **DB:** `identity.notification_prefs (user_id, trip_id null, …)`. `trip_id null` holds the defaults.
  - Toggles: `chat`, `mentions`, `plan`, `money`, `todos`, `reminders`, and `muted_until`.
- **What gets notified,** reusing the batching (`jobId` per user, trip and kind, 20 s window). Never the person who did it, and never people online in that trip (presence):

  | Kind | When | Example |
  |---|---|---|
  | chat | new messages (exists) | "Priya and Sam: 5 new messages" |
  | mentions | you're @mentioned (immediate) | "Priya mentioned you in Goa trip" |
  | plan | stops added, moved to another day, or deleted | "Sam changed Day 2: 3 updates" |
  | money | an expense includes you, or someone paid you | "Arun added Dinner, you owe ₹640" |
  | todos | a to-do is assigned to you, or yours is due tomorrow (daily job) | "Due tomorrow: Book Sintra tickets" |
  | trip | you were added, or the trip's dates or name changed | |
- **App:**
  - *Profile → Notifications* holds the defaults.
  - The trip ⋯ menu gets *Notifications*: per-trip overrides, plus **Mute for 1 day / 1 week / until I turn it back on**.
  - Tapping a push opens the right screen (chat, the day in Plan, Money, Lists).
  - **Android channels** (Chat, Mentions, Plan & money, Reminders), so users can also tune them in system settings. Channels are created from JS.
- **Tests:** every kind respects prefs, mute and presence; batching merges bursts; mentions skip mute; due-tomorrow job; deep-link payloads.

### C2. Gently get stops onto the map
- **In the Plan list,** a stop without a location gets a quiet "Add place" link. One tap opens `find-on-map-sheet` prefilled with the stop's text, and choosing a result sets `latitude`, `longitude` and `placeRef`. It's dismissible per stop (`items.place_hint_dismissed`).
- **Day header:** when ≥ 2 stops lack a place, show *"2 stops aren't on the map yet. Add places for travel times."*
- **Never nag:** there's no prompt for stops of type "other" or for notes-only items.
- **Smart guess:** if the text matches exactly one place result near the trip, offer it inline: "Is this *Fort Aguada*? Yes / Pick another".

### C3. Reminders for timed stops
- **Local notifications** scheduled on the phone (`expo-notifications`, already in the APK). They're free, and they work offline once scheduled.
- **Lead time** per user: 15 min / 30 min / 1 h / 2 h, or off. The default is 30 min, set in *Profile → Notifications*.
  - Example: "Lunch at Fisherman's Wharf in 30 min · Directions".
- **When it reschedules:** on app open, on plan events and after edits, for the next 7 days of my trips. It cancels reminders for stops that were removed or moved. Times use the **trip's time zone**.
- **Bookings with a start time** (flights, check-in) get the same reminder, with a longer default (3 h for flights).
- **Web:** no reminders, and the setting says so.
- **Tests:** a pure scheduler function (stops → wanted reminders, diffed against scheduled) with unit tests, time zones included.

**Ship:** migration `0019`, deploy API, OTA. Channels and local notifications are JS on the existing native module.

---

## Session D — video in Photos, dark mode (one new APK)

### D1. Videos in the album (and in chat, using B1's message type)
- **Limits:** up to **60 s and 50 MB** per video (Supabase's free per-file cap), so the 1 GB storage lasts. The app says so before upload, and the server enforces it on presign (`content-length-range` / size check).
- **On the phone:**
  - Pick from the library or record (`expo-image-picker` with video allowed).
  - Compress where the OS offers it (`videoQuality` / `videoExportPreset`).
  - Make a **poster frame** with `expo-video-thumbnails` *(new native module, needs the APK)*.
  - The poster uploads as the thumbnail, so the free server never has to process video (0.1 CPU).
- **Web:** pick a file and grab the poster with `<video>` plus a canvas.
- **DB:** `media.kind 'photo'|'video'` plus `duration_ms`.
- **Display:** grid tiles show a ▶ badge and the duration. The viewer plays with `expo-video` *(new native module)*, or `<video>` on web. Map pins work if the video has a location.
- **Save, download and delete** work like photos.
- **Tests:** presign rejects oversize and long videos; kind and duration are stored; poster required; delete removes both objects.

### D2. Dark mode
- **Tokens:** `theme.ts` gets `light` and `dark` palettes with the same token names, plus new ones for the hard-coded colours found in screens (`onAccent`, `onInk`, `overlay` and so on). **Replace every hard-coded hex** in components with tokens; a lint rule or grep check in CI keeps it that way.
- **Choosing a theme:** *Profile → Appearance: System / Light / Dark*, stored on the device. Styles are created once, so the app **applies a change with a quick restart** (`Updates.reloadAsync()` on phones, a reload on web). That keeps all `StyleSheet.create` code unchanged.
- **Map:** a dark map style when dark (an OpenFreeMap dark/positron variant if suitable). Photo and cover colours stay as they are.
- **Native:** `app.json` `userInterfaceStyle: "automatic"`, a dark splash and the status bar *(native config, needs the APK)*.
- **Checks:** contrast of text and accent colours on both palettes (WCAG AA), and screenshots of every tab in both.

**Ship:** migration `0020`, deploy API, **one new APK** (`./scripts/build-apk.sh`) with expo-video, expo-video-thumbnails and native dark mode. Then OTA as usual.

---

## Cross-cutting
- **Docs:**
  - ADRs: `021-trip-lifecycle.md` (archive vs delete, purge), `022-chat-media-and-previews.md` (SSRF rules), `023-notifications.md` (kinds, prefs, local reminders) and `024-dark-mode.md`.
  - Update `docs/ABOUT.md`.
- **Free-tier care:**
  - Videos and chat images count against Supabase's 1 GB.
  - Show storage use to the owner in trip settings ("312 MB of photos and videos").
  - The purge job frees space from deleted trips.
- **Out of scope:** read receipts per message, voice notes, GIF search, message search, iOS-specific work.
