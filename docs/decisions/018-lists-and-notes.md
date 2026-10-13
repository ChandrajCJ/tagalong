# 018: Checklists and notes

**Status:** accepted

## Decision
- **Two kinds of line on a checklist.** A **shared** line ("First-aid kit", "Book Sintra tickets") has one tick for the group and an optional person on it ("Sam's bringing it"). An **each person** line ("Passport", "Charger") is ticked by everyone for themselves, in `lists.list_item_checks`; the row shows "3 of 5" and opens to say who hasn't. Packing defaults to each person, to-dos to shared.
- **Viewers tick their own packing.** Ticking an each-person line only says something about yourself, so viewers can; adding, editing, and the group's tick on a shared line need an editor.
- **Ticks don't change a line's version.** A tick never makes someone else's edit of the text conflict. Ticks still write `change_log` and announce the line.
- **Only people still on the trip count**, on both sides: someone who left neither adds a tick nor is waited for. Their ticks stay in the table, so they count again if they rejoin.
- **A line can go straight onto "the packing list".** The app sends the kind, not a list id, for the first line; the server makes the list under an advisory lock, so two people adding the first line at once share one list. More lists of a kind can be made by name.
- **Starter packing list, no AI:** fixed rules over the trip's weather (rain, cold, snow, heat) and words from its places, ideas and plan (beach, hike, temple). Offered once, on an empty packing list; everything starts ticked and the person unticks what they don't want.
- **Notes are plain text with a version check, not live co-editing.** A save on an old version gets the other copy back; the editor shows theirs and yours side by side with **Use theirs** and **Keep mine** (which saves yours on top of theirs). Links and phone numbers in notes are tappable. 20,000 characters at most, enforced in the database too.
- **Day notes finally use `itinerary.trip_days`.** The first write makes the row; later writes send the version. They come with the plan (`GET /trips/:id/items` returns `days`) and change live (`day.upserted`).
- **No new tab.** Packing, to-dos and notes share one "Get ready" screen, reached from a card on the Overview ("Packing 12/30 · 2 to-dos left · 3 notes"). To-dos can link to a plan item; the item shows them, and the plan shows a ☑ count for open ones.

## Limits today
- No reminders or notifications for due to-dos.
- No reordering lines by dragging yet; new lines go at the end.
- Notes have no formatting beyond line breaks.
