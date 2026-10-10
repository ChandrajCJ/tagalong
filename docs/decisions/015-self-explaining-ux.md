# 015: A self-explaining app, and the features that came with it

**Status:** accepted

## Decision
- **No hidden gestures without a visible way in.** Every long-press now has a visible twin or a hint: files have a "⋯" menu (Open, Rename, Change category, Remove); payments have an Undo button; photos have a Select button; the Plan says "Hold and drag to change the order"; chat shows a one-time tip ("Hold any message to reply, react…") until it's been used.
- **Every screen says what it's for.** Empty states explain the feature and the first step; the Overview lists each area with a one-line purpose; the add buttons say what they add ("Add to plan", "Add idea", "Add expense").
- **One vocabulary.** Roles are described by one shared text (`lib/roles.ts`) on every screen; "Anytime" became "No day yet"; "square" became "settled up"; "Mark as paid" everywhere; polls "End voting".
- **Viewers are told why there's no Add button**, instead of seeing instructions they can't follow.
- **Failures are said out loud.** Actions that used to roll back silently now show what went wrong.

## Features added alongside
- **Trips can be edited** (`PATCH /trips/:id`, editors): name, destination, dates, cover, and the currency until the first expense (every expense is stored converted into it). Every open screen follows a `trip.updated` event.
- **Replies in chat.** A reply carries a short preview of what it answers (`replyTo`), which must be in the same conversation.
- **Directions** from plan items and bookings with an address: Google Maps (Android), or a choice of Apple or Google Maps (iPhone), with the destination filled in and the trip's city added when the place name doesn't say where.
- **Shorter booking forms**: the essentials first (who it's with, confirmation code, date and time, one key detail); the rest under "More details".
- **Photos**: select several, then download (to the gallery, or as downloads on the web) or delete; Save in the viewer.
- **Photo locations on Android.** Android blanks a photo's GPS for apps without the "access media location" permission. The app now declares it (`expo-media-library` plugin, `isAccessMediaLocationEnabled`) and asks for it. Expo Go doesn't declare that permission, so locations only arrive in a real build; uploads without a place now say so, with an explanation.

## Found while testing
- With two browser tabs open, each refresh of the sign-in rotated the token the other tab still held, so one tab's next refresh was refused and it signed out. A refused refresh now first checks whether another tab already saved newer tokens, and tabs follow each other's sign-ins and sign-outs.
- A refresh that failed for lack of a connection signed people out. It now keeps the session and tries again later.
