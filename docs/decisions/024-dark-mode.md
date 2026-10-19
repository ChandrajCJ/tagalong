# 024: Video, dark mode, App Links and the app icon

**Status:** accepted

## Decision
- **Videos are photos with `kind = 'video'`** (`media.photos.kind`, `duration_ms`), at most a minute and 50 MB, so the free 1 GB of storage lasts. The phone checks both before uploading, and the API refuses longer or bigger ones on presign. The phone makes the poster frame (`expo-video-thumbnails`; a `<video>` and a canvas on the web) and uploads it next to the video. That poster is the thumbnail, so the free server never decodes video, and a video isn't marked ready without it. Videos play with `expo-video` (its web build too), work in chat through the same media ids as photos, and save, download and delete like photos. Picking uses Android's system photo picker and recording uses the system camera, so the app still blocks `READ_MEDIA_VIDEO` and `RECORD_AUDIO`.
- **Two palettes, one set of names.** `src/palette.ts` holds `light` and `dark` with the same tokens. Besides the existing ones there are:
  - `onFill`: text on any filled colour (accent, ink, coral). White in light; near-black in dark, where those fills turn light.
  - `onPhoto`: always white, for anything over photos, covers, maps and the viewer.
  - `onCover`: fixed dark ink for text on a trip's cover colour, which doesn't change.
  - `overlay`, `faint`, `divider`, `track` and the rest, for colours that used to be hard-coded.
  
  Dark mode's accent is a lighter green, so it reads as link text on near-black.
- **Chosen at start, applied with a restart.** Profile → Appearance (Like my phone / Light / Dark) is stored on the device (`tagalong.appearance`) and read synchronously in `theme.ts` before any styles are made. Every `StyleSheet.create` stays as it was. Changing it reloads the app's code (`Updates.reloadAsync`, or the page on the web). `Appearance.setColorScheme` makes native pieces follow. The status bar, the screens' background, the map (OpenFreeMap `dark`) and the splash (a dark variant) follow too. Photo and cover colours don't change.
- **Kept honest by checks in `pnpm lint`:** `scripts/check-colors.mjs` fails on any hex colour outside the palette and theme. `scripts/check-contrast.mjs` checks the key pairs in both palettes, plus text on every cover colour, against WCAG AA. Screenshots of each tab in both looks were reviewed (they caught a trips-list crash and unreadable cover titles in dark).
- **Invite links open the installed app** through Android App Links. The web app serves `/.well-known/assetlinks.json` (from `apps/mobile/public/`) with the package and the signing key's SHA-256. The fingerprint was read from the last APK's v2 signature block and matches the one EAS shows. `render.yaml` serves that file before the catch-all rewrite, as JSON. `app.json` has an `autoVerify` intent filter for `https://tagalong-u4wh.onrender.com/invite`. Without the app installed, the link still opens the website.
- **The icon is concept A, generated.** `scripts/make-icons.mjs` (`pnpm make:icons`) draws every asset from one set of shapes:
  - the square icon;
  - the adaptive foreground, scaled so the pins sit inside the central safe circle, plus its cream background;
  - the themed (monochrome) silhouette, with the holes and the gap between the pins cut out;
  - the cream-on-green splash and its dark variant;
  - the favicon.
  
  Each pin has a cream ring so they separate when small, and the trail is 18% ink, dropped below launcher size. The refined drawing is kept as `assets/brand/icon.svg`. The template images, and the iOS Icon Composer file, are gone.

## Limits today
- A video picked on the web is checked for length by loading it; very large files take a moment.
- Changing the look restarts the app; following the phone's own setting live would mean making styles per render.
- App Links need the new APK, and Render to sync the Blueprint (for the assetlinks header and rule). Verify with `adb shell pm get-app-links com.chandrajcj.tagalong`.
