# 028: The Android home-screen widget

**Status:** accepted

## Decision
- **`react-native-android-widget`**, configured through its Expo plugin in `app.json`, with widgets laid out in JSX (`src/widget/trip-widget.tsx`). There are two:
  - **Trip countdown (2×2):** the next trip on its cover colour, "Goa · in 4 days", or "Day 2 of 5" during it.
  - **Trip today (4×2):** during a trip, today's next timed stop ("13:00 Beach shack lunch · in 25 min") and the next booking; before it, the countdown and "4 of 18 packed".
  
  Both have light and dark versions from the app's palette.
- **The widget never calls the API.** The app saves a small snapshot (the next three trips, plus stops and bookings for any starting within two weeks) to a file on the phone when it opens, comes back to the front, or hears of plan, booking, place or packing changes. It then asks Android to redraw. The widget's task handler reads that file and works out what to say at that moment (`widgetSnapshot` in shared: which trip, before or during, "in 25 min"), so it stays right through the day. Android redraws it at most every 30 minutes (`updatePeriodMillis`), which also covers midnight within half an hour.
- **"Today" is on the trip's own clock**, or the phone's when the trip has no time zone.
- **Taps are deep links:** the widget opens `tagalong://trips/<id>`, and the next stop opens its item.
- **Loaded only where it exists.** The library throws on import without its native module, so the app checks `TurboModuleRegistry` first (`src/widget/native.ts`) and imports it lazily. Expo Go, older APKs, iPhones and the web skip it. The app's entry (`index.ts`) registers the task handler after `expo-router/entry`.
- **Signing out clears the snapshot** and redraws the widget empty.

## Limits today
- Android only; an iPhone widget would need WidgetKit and Swift.
- Changes made on another phone reach the widget the next time this phone's app syncs.
