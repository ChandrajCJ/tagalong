# 012: The photo map, favourites, and photos on plan items

**Status:** accepted

## Decision
- **Places are computed, not stored.** `clusterPlaces` (`@tagalong/shared`) groups photos taken within 250 m of each other, greedily and in time order, so a place's id stays the same as photos are added. The map opens framed around every place (`regionAround`), never tighter than a neighbourhood. Both are plain functions with tests; a pin is just their output.
- **Two map components with one set of props.** `photo-map.tsx` uses `react-native-maps` on phones; `photo-map.web.tsx` lists the same places, each with a link to a maps app, because the map component doesn't run in a browser. Metro picks the `.web.tsx` file when bundling for the web, so the native map is never bundled there.
- **Custom pins stop redrawing once their photo loads** (`tracksViewChanges`). Until then they must keep redrawing or Android shows blank pins; after, redrawing every pin each frame makes the map crawl.
- **Favourites are one row per person per photo** (`media.photo_favourites`), open to viewers like votes and reactions. A `photo.favourited` event carries the new count and who changed it, so every album updates the count and only the person who tapped sees their own heart change.
- **A plan item's photos are the ones taken during it.** Both sides are wall-clock times where things happened (an item's date and times, a photo's EXIF time), so they compare directly. `photoWindow` (`@tagalong/shared`) runs from the start to the last minute of the end, assumes three hours with no end, runs past midnight when the end is before the start, and claims nothing for an item with no start time rather than every photo of its day.

## Also changed
- **The plan accepts an evening that runs past midnight.** The item sheet used to reject an end before the start ("Ends before it starts"), so "Fado 22:00–01:00" couldn't be entered at all. It now reads it as the next day and says so ("Ends the next day", and "until 01:00 (next day)" on the plan).

## Found while testing
- The places list first nested its "Open in maps" link inside the card's button, the same mistake as the booking card in ADR 010. Caught before commit; the two are siblings now.
- A plan item once saved with the wrong end time during a browser test. Reproducing step by step showed the picker was fine and the test helper had clicked the wrong "Done"; with exact taps the times saved correctly on both create and edit.

## Limits today
- **The native map hasn't been run.** This machine has no iOS simulator or Android emulator, so pins, framing and tapping a pin are untested on a device. The logic behind them is tested; the rendering isn't.
- No place names: that needs a geocoding service. Places are shown by their photos and dates.
- Clustering doesn't change with zoom.
