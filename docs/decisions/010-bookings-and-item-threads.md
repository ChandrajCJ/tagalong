# 010: Bookings are their own record; a plan item gets its own thread

**Status:** accepted

## Decision
- A **booking** (`documents.bookings`) is separate from a plan item. It may point at one (`item_id`) and at the confirmation file (`document_id`), but owns neither, and both links are nullable: a booking can exist before anyone has put it on a day, and most plan items never have one.
- Shared fields are columns (type, provider, confirmation code, times, cost). What differs by type — a flight's seats and terminal, a restaurant's party size — lives in a **`details` JSON column**, checked on every write by a **strict per-type zod schema** (`BOOKING_DETAILS` in `@tagalong/shared`). Unknown fields are refused, and changing the type re-checks the details against the new type.
- Links are checked server-side: a booking may only point at a plan item and a ready document **from its own trip**.
- **Times are real instants plus a timezone** (`starts_at timestamptz`, `timezone text`), unlike plan items, which store a local date and a wall-clock time. A flight leaves at a precise moment; "lunch at 13:00" doesn't need one. The app converts between wall-clock time and instants with `toInstant` / `wallClock` in `@tagalong/shared`, written without a date library and tested across zones, half-hour offsets and both daylight-saving changes.
- **"Next up"** (`GET /trips/:id/next-up`) is the soonest booking that hasn't started. A booking whose plan item was deleted is still shown, but without a link to a screen that no longer exists.
- Every plan item can have a **thread**: a `chat.channels` row of kind `item`, created on first use. A partial unique index (`channels_one_thread_per_item`) means two people opening it at once can't create two. Messages carry `itemId`, so the main chat ignores thread messages and thread read receipts, both when loading and when they arrive live. Thread messages don't send pushes.

## Why
- Most of what a trip needs from a booking is the same handful of fields, and the rest is genuinely different per type. One JSON column with a strict schema per type is less wrong than six mostly-empty columns, and safer than an unchecked blob.
- Keeping bookings and items independent means neither has to be created first, and every later feature (costs, the calendar, reminders) can work with bookings directly.
- A side conversation about one restaurant drowns the main chat. Giving it a home next to the restaurant keeps both readable.

## Two fixes that came with this
- **Moving a plan item to another day without a position** now puts it at the end of that day, on the server. Before, only the plan screen did this, so any other client (such as the new detail screen) would have left the item with its old day's key, landing it anywhere on the new day or tying with an item already there.
- **The mobile app is now linted.** The root ESLint config had ignored `apps/mobile/**` since the first week, so the app had never been checked; it now runs with `react-hooks/rules-of-hooks` and `exhaustive-deps`.

## Limits today
- New bookings use the phone's timezone. Booking a Lisbon dinner from London stores London time; there's no picker for another zone yet.
- No calendar export, no live flight status, no reading confirmation emails.
