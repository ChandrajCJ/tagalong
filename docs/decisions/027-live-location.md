# 027: Live location, ephemeral and opt-in

**Status:** accepted

## Decision
- **Positions live in Redis only.** `POST /trips/:id/location {latitude, longitude, accuracy, until}` stores the latest one as `location:<trip>:<user>`, expiring at `until`, and publishes `location.updated` to that trip's channel, so only its members' connections get it. Nothing is written to the database or the change log. `GET /trips/:id/locations` lists who's sharing, filtered to people still on the trip. `DELETE` stops sharing and publishes `location.stopped`.
- **Always someone's choice, always time-limited.** Sharing starts from the trip map's **Share my location**, for 1 hour, 4 hours or until the end of today on the person's clock (`shareUntil`). `until` can be at most a day ahead. Sharing stops on **Stop**, when the time runs out (the key expires, and the phone stops itself), or when the person leaves or is removed (the members service deletes the key and publishes the stop). While it's on, a banner sits on every screen of that trip.
- **One position per 20 seconds per person** (`location-rate:<user>`, set NX with a 20-second expiry); a faster phone gets 429 and ignores it. The phone sends one every 60 seconds or 50 metres, whichever comes later, at "balanced" accuracy.
- **Foreground first, background only if asked.** Starting asks for location while in use. Only the "Keep sharing while the app is closed" switch asks for "Allow all the time". That runs `expo-location`'s background updates as an Android foreground service, with its own notification ("Tagalong is sharing your location"), through an `expo-task-manager` task defined at the top level of `lib/live-location.ts`. If "all the time" is refused, or the build can't run the service (Expo Go), sharing carries on only while the app is open, and the sheet says so. The web uses `navigator.geolocation.watchPosition`, only while the tab is open.
- **Seeing others:** the trip map shows everyone sharing as a pin with their initial, in their colour. A pin goes faded (outlined) after 10 minutes without an update. Tapping one shows "Priya · 3 min ago" and **Directions to Priya** (Google Maps to that spot). People's pins don't change the map's framing.
- **Play policy:** permission texts say location is used only when you choose to share. Background location is asked for only after that explicit switch, and the foreground service is visible the whole time. That keeps the app within Google Play's background-location rules when it's published there.

## Limits today
- Pins show initials, not profile photos: the three map implementations draw text pins only.
- If Android kills the app, background sharing stops until it's opened again (Android doesn't restart apps for location).
- Needs the APK built after polish-2 G (new native modules); older installs and Expo Go share only while open.
