# 022: Photos, mentions and link previews in chat; delivered and read; trip covers

**Status:** accepted

## Decision
- **Chat photos are album photos with a different `source`.** `media.photos.source` is `album`, `chat` or `cover`. Chat photos use the same upload (signed PUT, confirm, thumbnail worker) and are left out of the album, the item photo strip and the "added photos" card. A message with photos has `kind = 'image'`, `payload.mediaIds` (up to 10) and its caption in `body`, so pushes and previews read it like text. "Also add to the album" uploads them as `album`; **Add to album** later flips `chat` to `album`. Only your own finished photos from the same trip can be sent. Deleting the message deletes its chat-only photos and their files; album ones stay.
- **@mentions** are stored as `payload.mentions`, filtered to current members (never the sender). Each mentioned person gets an immediate push job (`mention` on the `notify` queue), separate from the 20-second chat summary. Mentions get through a muted trip, but not to someone looking at the trip right now (ADR 023). An edit keeps the mentions unless it sends new ones, and only newly mentioned people are pushed again. There's no `@everyone`.
- **Link previews are fetched by the worker, carefully.** The `preview` queue reads the first link in a text message and stores `payload.preview {url, title, description, image, siteName}` from Open Graph, then Twitter tags, then `<title>`. The fetch (`lib/link-preview.ts`):
  - http/https only, no credentials in the URL, our own User-Agent, no cookies;
  - every connection's address is checked **at connect time** through a custom `lookup`, so DNS can't answer one thing when checked and another when dialled; literal IPs (including `[::1]` and `2130706433`) are checked up front, because Node dials them without a lookup;
  - private, loopback, link-local, CGNAT, multicast and reserved ranges are refused, IPv6 and IPv4-mapped included;
  - at most 3 redirects, each checked again; 5 s for the whole request; `text/html` only; at most 512 KB read;
  - results cached in Redis by URL for 7 days (a page without a preview for an hour).
  
  Links to the app's own hosts (the web app in `CORS_ORIGINS`) get no card, and the app also hides cards for `/invite/` links. The card's picture is loaded by the phone from the site itself.
- **Ticks.** `chat.read_states` gains `last_delivered_at` (and `last_read_at` may be null, for "received but never opened"). Phones say what they've received with `POST /trips/:id/delivered {upTo}`, at most every 2 s per trip, from live `message.created` events and after fetching messages. Reading counts as delivered. Both markers only move forward; `delivery.updated` and `read.updated` carry them. A message is ✓ sent, ✓✓ delivered once every member who was on the trip when it was sent (by `joined_at`, and still on it) has it, and ✓✓ in the accent colour once they've all read it. **Info** on your own message lists Read by, Delivered to and Not delivered yet.
- **Read receipts can be turned off** (Profile → Privacy, `users.read_receipts`). Off works both ways, as on WhatsApp: others see only that it arrived, and you see nobody's reads. The server hides read times in message pages, events and Info; delivery ticks stay. Someone with receipts off counts once delivered, so a message can still turn fully read.
- **Trip covers are photos too.** `trips.cover_media_id` points at a photo of the trip: one uploaded as a cover (cropped to 16:9 and at most 1,600 px wide on the phone), one picked from the album, or the destination's lead image from Wikipedia. That image is downloaded by the server through the same guarded fetch, only from `upload.wikimedia.org`, and stored as a cover photo with its credit in `trips.cover_credit`, shown small on the cover. Editors and owners change it; replacing or removing a cover deletes a cover-only photo but never an album one. A deleted album photo just leaves the colour. The colour stays as the fallback and the tint behind the photo, under a dark gradient so the title reads.

## Limits today
- A plan item's thread shows photos and edits sent elsewhere but has no 📎 of its own.
- No pasting into the phone apps' composer; paste works in the browser.
- Delivery is only acknowledged while the app is running; a push alone doesn't count as delivered.
