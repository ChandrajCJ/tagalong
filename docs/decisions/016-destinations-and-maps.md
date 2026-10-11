# 016: Real destinations, recommendations, weather and maps

**Status:** accepted

## Decision
- **Open data only, no keys.** Destination search is Photon (OpenStreetMap); recommendations come from Wikipedia's nearby search and OpenStreetMap through Overpass; weather and time zones from Open-Meteo; map tiles from OpenFreeMap. All of it goes through one connector (`apps/api/src/lib/geo.ts`) that tests replace with a fake, and that names the app in every request as the public services ask.
- **Through our API, cached.** Searches are cached for a day and limited to a minute's worth per person; recommendations for a week per area and category; forecasts for three hours, typical weather for a month. The public services see a handful of requests per trip, not one per tap.
- **A trip's place is optional.** Picking a suggestion saves its coordinates, area, country and time zone, and sets the currency (Goa → INR). Typing anything else still works, with no maps or tips; the Overview offers to put it on the map later.
- **Regions are searched on a grid.** Wikipedia searches 10 km around a point, and a state's centre is often empty countryside, so a destination wider than 0.3° is searched at nine points across it. "km from the centre" is hidden for regions, where it means nothing.
- **Recommendations are ranked by how well known they are** (a Wikipedia article, a photo, a website), merged across sources so the same place named the same way within 300 m appears once. Wikipedia articles that aren't places to visit (stations, timelines, schools, districts) are dropped by their descriptions.
- **A busy source doesn't fail the page.** Overpass is often overloaded; the next server is tried, and if none answers, the page shows what Wikipedia found and says the list may be short. Partial answers are cached for 10 minutes only.
- **Weather is a forecast up to 16 days ahead, "typical" beyond:** last year's weather on the same dates, labelled as such.
- **Explore places keep their location.** An idea added from Explore stores its coordinates, photo and source id; moving it into the plan carries the coordinates on, so it lands on the trip map. The same place can only be one idea per trip.
- **Maps are MapLibre with OpenFreeMap, everywhere it can be.** The web uses MapLibre GL (its worker is copied into `public/` on install, because browsers only run same-site workers). Phone builds use MapLibre React Native, so an Android build needs no Google key. Expo Go doesn't include MapLibre, so there the map falls back to react-native-maps.

## Found while testing
- Wikipedia sends coordinates for only 10 pages per request unless asked (`colimit`), so most places were dropped at first.
- A city and its county often come back with the same label ("Lisbon, Portugal" twice); duplicates are removed.
- Goa's geometric centre is inland near Rachol, so the first results missed every beach and Old Goa; hence the grid.
- The plan map framed its pins before the ideas had loaded, so idea pins could open off-screen; it now waits for them.

## Limits today
- **The native MapLibre map hasn't run on a device yet**: that needs a development build. Expo Go shows the react-native-maps fallback.
- No ratings or reviews (OpenStreetMap has none; Google's are paid). Small places have no photo or description.
- Places typed by hand into a plan item have no location until place search for items (step 2).
