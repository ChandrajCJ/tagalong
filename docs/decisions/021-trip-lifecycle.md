# 021: Archiving and deleting trips, editing and deleting messages, unread counts

**Status:** accepted

## Decision
- **Archive is personal; delete is for everyone.** Archiving sets `trips.trip_members.archived_at` for me only: the trip moves to a collapsed "Archived" section on my list and nothing changes for anyone else. Any member can archive. "Past trips" needs no action: a trip whose end date (or start date, with no end) is before the phone's today is past. The split lives in `groupTrips` in `packages/shared`, so the phone's own date decides.
- **Only an owner deletes, with 30 days to change their mind.** `DELETE /trips/:id` sets `trips.deleted_at`. The trip vanishes for every member at once: `requireTripRole` already treats a deleted trip as not found, so every trip-scoped route 404s without each one checking. A `trip.deleted` event makes open screens show "This trip was deleted", and the gateway unsubscribes everyone (error code `deleted`). A system card ("Priya deleted the trip") is written, so a restored trip's chat says what happened.
- **Restore** (`POST /trips/:id/restore`) is for owners, within `TRIP_RESTORE_DAYS` (30). Owners see deleted trips under "Recently deleted" on their list, with the days left. Members who aren't owners get 404, so they can't learn a deleted trip still exists.
- **Purge is a daily job** (`purge-deleted-trips` on the `system` queue, 03:00 UTC). For each trip deleted over 30 days ago it removes the files first (photos, thumbnails, documents), then the trip row, which cascades; `sync.change_log` has no foreign key, so it's cleared by hand. Files first means a storage hiccup leaves the trip for tomorrow's run rather than orphaned files nobody can find.
- **Confirm by typing the trip's name.** Deleting affects everyone, so the app asks for the name (not case-sensitive) instead of a plain "Are you sure?".
- **Editing a message:** the sender only, text only (not polls or activity cards), within 24 hours (`MESSAGE_EDIT_WINDOW_MS`), so an old message can't quietly change meaning. It sets `edited_at`; the app shows "edited". A `message.updated` event carries the new text; screens take the body and `editedAt` from it and keep their own reactions.
- **Deleting a message** is a soft delete that wipes the text: `deleted_at` set, `body` and `payload` cleared in the database, not just hidden. The sender can delete their own; an owner can delete anyone's, for moderation; activity cards can't be deleted. The message keeps its place as "Message deleted", and replies quoting it say "Original message deleted". A `message.deleted` event carries `{ messageId, itemId }`.
- **Unread counts are worked out, not stored.** `unreadCounts` counts main-chat messages newer than my read marker, not mine, and not deleted, in one grouped query for all my trips. Before I've ever opened a chat, it counts from when I joined, so joining an old trip doesn't show "500 new". Activity cards about my own doing don't count. Sending a message marks everything before it as read (as before).
- **Live counts by refetching.** The trips list subscribes to every trip on it and refetches `GET /trips` shortly after a burst of `message.created`, `message.deleted`, `read.updated` or `trip.deleted`; the Chat tab's badge refetches `GET /trips/:id/unread` the same way. The app icon's badge is the total, set with `expo-notifications`.

## Limits today
- Push notifications don't move the app-icon badge while the app is closed; it updates when the trips list next loads.
- Thread messages (on plan items) can be edited and deleted through the API, but the item screen's thread has no long-press menu yet; it shows edits and deletions made elsewhere.
- No undo for deleting a message.
