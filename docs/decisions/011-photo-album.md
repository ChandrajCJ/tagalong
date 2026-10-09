# 011: The shared photo album

**Status:** accepted

## Decision
- Photos live in their own schema (`media.photos`) and reuse the **direct-to-storage upload** from ADR 009: the phone gets a signed link, sends the bytes straight to storage, then confirms; the API checks the object arrived before anyone else sees it.
- **Every photo leaves the phone as a JPEG of at most 2560 px** on its long edge (`expo-image-manipulator`). The server only accepts JPEG, PNG and WebP, enforced by both the input schema and a database check.
- **When and where come from the photo's EXIF**, read on the phone before conversion (re-encoding drops it). The parser (`parseExif` in `@tagalong/shared`) handles iOS's nested dictionaries, Android's flat keys and degree-minute-second strings, rejects a camera's all-zero date and the "0,0" no-fix location, and returns nothing rather than something wrong.
- **The time taken is stored without a timezone** (`timestamp`, read as a string): the clock as it read where the photo was taken. That's what the camera records, and it's what grouping by day should use: a sunset at 18:30 in Lisbon belongs to that Lisbon evening wherever it's viewed from. This is deliberately the opposite of bookings (ADR 010), which are real instants.
- **Thumbnails are made by the worker** on a separate `media` queue (concurrency 2, three attempts with backoff), as 480 px WebP, after applying the camera's orientation tag. A deleted or already-done photo is skipped.
- **Signed links are never broadcast.** A `photo.upserted` event carries only the id; each phone fetches its own copy. The grid caches images by **photo id** (`expo-image` `cacheKey`), because the signed URL changes every time it's fetched and would otherwise defeat the cache.
- **One chat card per upload batch**, guaranteed by a **unique index** on a system message's `batchId`, not by a lock or a check-then-insert.

## Why
- **HEIC.** iPhones shoot HEIC, and the server's image library (sharp's prebuilt libvips) can't read it: tested with a real HEVC file, which failed to decode while JPEG worked. Without converting on the phone, every iPhone photo would silently have had no thumbnail.
- **Data.** A phone photo is 3–8 MB; 2560 px is sharp on any screen and roughly five times smaller, which matters on a trip's mobile data.
- **The batch card.** The first version used a transaction-scoped advisory lock and a test that fired two requests at once. Removing the lock, the test still passed: the requests never actually overlapped, so it proved nothing. A unique index makes a second card impossible whatever the timing, and a plain sequential test now fails without it (checked by dropping the index).

## Found while testing in the browser
- **The viewer could delete the wrong photo.** It tracked the current photo with a swipe's end event, which browsers don't fire, so after paging to photo 4 the viewer still believed it was on photo 1, and Delete would have aimed there. A list visibility callback didn't fire either. It now reads the scroll position from the plain scroll event, which every platform fires.
- A related trap for anyone testing this: with the browser pane hidden, the page draws no frames and **no scroll events are dispatched at all**, so a scroll-driven feature looks broken when it isn't. Dispatch the event yourself, as the browser would.

## Limits today
- No map view yet (week 9), no favourites, no videos.
- Photos picked on the web have no EXIF, so they land under "No date".
- Signed links last ten minutes; the album refetches when you come back to it after most of that has passed.
