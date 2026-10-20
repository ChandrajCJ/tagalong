# 025: Trips to several places, and a whole day in Google Maps

**Status:** accepted

## Decision
- **Places are their own table, `trips.trip_places`** (migration `0021`): a destination label, the picked place (`place_id`, coordinates, bounds, country), its time zone, optional `start_date`/`end_date`, a fractional `position` and a `version`. Every trip has at least one; the migration gave each existing trip one, copied from its destination.
- **The trip keeps its destination columns as a summary**, rewritten by the service in the same transaction as any place change (`tripSummary` in shared): "Lisbon → Porto → Madrid", the first place's spot, time zone and country (the first one on the map, when the first isn't), and bounds covering every place. Older phones, the cover suggestion, inbox imports, due-date reminders and every other query keep working unchanged. A place change bumps the trip's version and publishes `trip.updated` besides `place.upserted`/`place.deleted`, so older phones refresh too.
- **An older phone's destination edit changes the first place.** Their edit screen sends the destination on every save, so only a changed destination or a newly picked location touches it.
- **Which place a day belongs to is one pure function, `placeForDate`:** the place whose dates contain the day; otherwise the nearest earlier one (gaps stay with where you were); otherwise, and with no dates, the first. A day one place ends and the next begins is a **travel day** and belongs to both ("Lisbon → Porto"); the arrival counts for the weather. Everything that depends on a place goes through it: weather stretches (`placeSegments`, then one Open-Meteo call per stretch, on the phone and the API alike), place search (`date` or `place` on `/places/search`), Explore (`place`), the plan's day labels and map framing, directions, and a stop's clock (`timezoneForStop`: on a travel day a stop on the map uses the nearer place, otherwise the arrival).
- **Dates are checked on the server, in words.** Each place's days must sit inside the trip's, and two places may only share a travel day. Shrinking the trip's dates past a place's is refused the same way ("Change the places' dates first"), rather than moving anyone's dates silently. The trip row is locked while places change, so the at-least-one rule and the overlap check can't be raced.
- **"Open day in Google Maps" uses coordinates for every stop**, in plan order, with the day's travel mode (`dayRouteLinks`). A name as the query would let Google pick a same-named place in another city; coordinates can't be wrong. Google takes nine waypoints per link (eleven stops), so a longer day splits into parts that meet at a shared stop. iPhone also opens Google, since Apple Maps links take one destination.

## Limits today
- Travel between places (trains, flights) stays as bookings; a booking isn't yet tied to the place change it makes.
- To-do due reminders and email imports use the trip's first time zone.
- Reordering places is up and down buttons, not drag.
