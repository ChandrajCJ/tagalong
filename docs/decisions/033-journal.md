# 033: The trip journal

**Status:** accepted

## Decision
- **Entries live in their own schema,** `journal`: `entries` (a note or a quote, an optional mood, up to 12 album photos and videos by id, an optional place, `visibility 'group' | 'private'`, `version`, soft delete), `reactions` (the chat's emoji set) and `comments`. Anyone on the trip can write, viewers included: it's their memory too. Only the author edits (409 with the current copy on a stale `version`); the author or a trip owner deletes, as in the chat.
- **Private means private.** Every read goes through one filter, `visibility = 'group' or author_id = me`, so a private entry doesn't exist for anyone else: 404 to read, edit or delete it, even for owners. Private entries take no reactions or comments, publish no events, never count in "Who's written today" for others, and are left out of the recap. `change_log` still records them (ids only); the offline sync in weeks 18–19 must apply the same filter.
- **Live updates without leaking content.** Group changes publish `journal.updated` with `{ date, entryId }` only; open day pages fetch the day again. A private entry publishes nothing.
- **Photos.** New photos added in an entry upload with `source 'journal'`, which counts as the album everywhere (`IN_ALBUM`), without a "Riya added 4 photos" chat card. Uploading still needs the editor role, so viewers attach photos already in the album. Entries keep `media_ids`; the day page signs links fresh for each viewer and drops any photo since deleted.
- **The day header is worked out on every read,** from the plan (stops in plan order), photos taken that day, main-chat messages that day on the trip's clock, that day's expenses (and the share per person), and promoted ideas whose item is on that day. The pure `dayHeader` picks the top photos (most hearts, then the first taken), the most-voted idea and the busiest 10 minutes of chat (at least three messages). Weather and the route come from the phone: Open-Meteo (the forecast, or the archive once the day is a week past) and the Plan map's cached `GET /days/:date/route`.
- **Quotes.** `POST /messages/:id/save-to-journal` makes a `quote` entry on the day the message was sent (trip's clock), linking back to it. A unique index on `(source_message_id, author_id)` makes saving twice return the same quote; a deleted one comes back. A quote's words can't be edited.
- **Pushes, from one hourly job** (`journal`, minute 35), each claimed in `journal.pushes_sent (trip, user, kind, day)` before it's sent, so it goes once:
  - *prompt*: from the person's chosen time (19:30, 20:30 or 21:30; 20:30 by default) on the trip's clock, during the trip, skipped if they've written that day, turned the `journal` kind off, or muted the trip. The question rotates by day number.
  - *memory*: from 10:00 on the person's own clock, for a past year's trip they're still on whose dates include today's date (`memoryFor`). The trips list shows the same as a card (`GET /me/memories?today=`), put away per day on the device.
  - *recap*: from 09:00 the morning after the trip's last day, for a week. Memories and the recap share the `memories` kind.
- **Recap caching.** `GET /trips/:id/recap` runs the pure `tripRecap` over the group-visible rows. Once the trip is over the result is kept in `journal.recaps` with a stamp (the trip's latest change-log seq plus counts of hearts, messages and reactions, and the newest entry edit) and worked out again only when the stamp moves. Photos are stored as ids and signed per viewer. Before the trip ends it's computed live and not stored.
- **"Plan the next one"** creates a trip with `copyMembersFrom`: everyone still on the old trip joins with the same role, its owners as editors. Only a member of the old trip can do it.

## Limits today
- **"Save as image"** draws the stats card as a PNG in the web app. On phones it shares the numbers as text, because capturing a view needs a native module (`react-native-view-shot`) and so a new APK.
- Distances are straight lines between stops and between the trip's places, so the recap says "about"; the day page shows the routed distance when the router answers.
- The busiest chat moment links to the chat, not the exact message: the chat can't open at a message yet.
- Lines from the plan can't be saved as quotes yet, only chat messages and polls.
- The "On this day" card and push assume the trip still has its dates; a trip whose dates were removed is never remembered.
