# Tagalong: everything about the app

This is the one document to read to understand Tagalong: what it is, why it
exists, how someone uses it, how it's built, what's done, and what's next.
For setting it up on a server, see [DEPLOY.md](DEPLOY.md). For the reasoning
behind individual design choices, see [decisions/](decisions).

---

## 1. What it is, in one paragraph

Tagalong is a group trip app. One person creates a trip, shares a link, and
everyone going joins. From then on the group plans together in one place:
a shared day-by-day plan, a board of ideas everyone votes on, a group chat
with polls, everyone's tickets and bookings, one shared photo album, and the
money: who paid what and who owes whom, settled with a tap of UPI. It runs on
Android, iPhone and the web, updates live for everyone, and every part of it
runs on free and open-source software.

## 2. The problem it solves

A group trip today is spread across half a dozen apps:

- **Planning** happens in a WhatsApp group that scrolls away, plus a
  spreadsheet one person maintains and nobody else opens.
- **Decisions** ("which beach on Saturday?") get lost in chat, or are made by
  whoever replies loudest.
- **Tickets and bookings** sit in one person's email. On the day, everyone
  asks them for the hotel address or the flight time.
- **Photos** end up on everyone's phone separately. Weeks later someone asks
  "can you send me the photos?", and the good ones never get shared.
- **Money** is a mess of "I'll pay you back later", a Splitwise someone forgot
  to update, and awkward reminders.
- **Finding things to do** means a separate search on Google, TripAdvisor and
  blogs, then pasting links into the chat.

Tagalong puts all of that in one shared space that belongs to the trip, not
to one person. Everyone sees the same plan, the same files, the same photos
and the same balances, the moment anything changes.

**Who it's for:** friends, families and small groups (roughly 2–20 people)
travelling together, especially where one person usually ends up doing all
the organising.

## 3. How someone uses it, start to finish

This is the app from a traveller's point of view.

### Getting in
1. Open the app and tap **Continue with email**. Type your email; a 6-digit
   code arrives; type it in. There are no passwords.
2. Tap **Profile** (top right of your trips) to set the name friends see, a
   **photo** (cropped square on the phone; only people on your trips see it)
   and, optionally, your **UPI ID** so people can pay you back in one tap.
   **Calendar** there makes a private link that Google or Apple Calendar
   subscribes to: every trip, timed stop and booking appears in your own
   calendar and keeps up with changes. Anyone with the link can see your
   plans, so it's off until you turn it on, and **Stop sharing** ends it.

### Starting a trip
3. On **Your trips**, tap **New trip**. Start typing the destination: real
   places are suggested as you type ("Goa, India", "Lisbon, Portugal"). Pick
   one, and the trip gets weather, a map and things to do, and its currency
   switches to the local one (still changeable). Going to more than one
   place? **Add another stop on this trip** (Lisbon → Porto → Madrid), each
   with the days you're there if you know them.
4. Add dates (optional, and changeable later), a name (optional) and a cover
   colour, or a cover photo. A **Budget (optional)** row, closed unless
   tapped, takes a total for the group or each person. Tap **Create trip**.

### Bringing friends in
5. Tap **Invite**. Make an **editor** link for people who'll help plan, and a
   **viewer** link for people who just want to follow along. Send each to the
   right people. Links can be single-use and expire after 7 days.
6. A friend taps the link, sees "Priya invited you to Goa", and taps **Join**.
   If they're new, they sign in first and land straight back on the invite.
7. **People** lists everyone. The owner can switch people between editor and
   viewer, or remove them; anyone can leave.

### The trip's home: Overview
8. The Overview shows a countdown, who's coming, **the weather** for the trip
   days (a forecast up to two weeks out, "typical weather" from last year
   beyond that), the **next booking** ("Flight 6E 2134 · Thu 08:15 · in 2
   days"), an **Explore** card, a **Get ready** card ("4 of 18 packed · 2
   to-dos open · 3 notes"), and a list of everything you can do here.
   On a trip to several places it reads "Lisbon (Oct 22–24) → Porto (24–26)
   → Madrid (26–29)", and each day's weather is at that day's place.
   **Edit** changes the trip's name, dates, places or cover: a colour,
   or a photo you upload, pick from the album, or the destination's photo
   from Wikipedia. Places can be added, re-dated, moved up or down, and
   removed (a trip keeps at least one).
   The **⋯** button archives the trip (it moves to "Archived" on your list,
   for you only), and lets an owner **delete** it for everyone (type its name
   to confirm; it can be restored from "Recently deleted" for 30 days) or
   anyone else **leave** it. The ⋯ menu also has **Download calendar
   (.ics)** for this one trip. **Your trips** splits into upcoming, past and
   archived, and each card says how many chat messages are new and, before
   the trip, how ready you are ("4 of 18 packed · 2 to-dos open").

### Finding things to do: Explore
9. **Explore Goa** lists places worth going to, by category: top sights, food
   and drink, nature and beaches, museums and culture, nightlife, shopping.
   Each has a photo and description where available, **Directions** and a
   link to read more. Tap **Add to Ideas** to put it to the group. A trip to
   several places has a switch at the top (Lisbon · Porto · Madrid).

### Deciding together: Ideas and polls
10. **Ideas** is everything the group is considering. Anyone suggests, and
    everyone (viewers too) votes yes or no; the most popular rise to the top.
    Tap **Add to plan** on an idea to put it on a day; **Take out of plan**
    undoes it.
11. In Chat, tap **Poll** to ask a question ("Which beach on Saturday?").
    Everyone votes. Any option with votes (or any option once voting ends)
    has **+ Plan**, which puts it on a day.

### Planning the days: Plan
12. **Plan** has a page per trip day (and "No day yet" for undecided things).
    Add activities, meals, transport, stays and flights with times, a place,
    an estimated cost and notes. Give a day a name and a note ("Sintra day —
   9:10 train from Rossio") just under the day pills. Hold and drag to reorder. Everyone sees
    changes live, sees "Sam is editing" on an item someone has open, and gets
    a clear message instead of silently overwriting each other.
    On a trip to several places, each day pill says its city, a travel day
    says both ("Lisbon → Porto"), and a day's times are on its place's
    clock, so reminders in Madrid fire an hour after Lisbon's.
13. **Where** suggests real places around the day's place as you type, with
    the trip's own ideas first; picking one puts the item on the map (a small
    pin on its row). Older items get **Find on map** on their own screen.
14. Between two stops on the map, the list shows the travel time and
    distance ("🚶 12 min · 900 m"), and the day shows its total, with a
    Walk / Drive / Cycle switch remembered on each phone. **Shortest order**
    suggests a quicker order for the day, keeping the first stop and anything
    at a set time in place, and shows the time saved before anyone applies it.
    **Open day in Google Maps** opens every stop on the map as one route, in
    plan order, walking, driving or cycling as chosen. Google takes 11 stops
    per link, so a longer day opens in parts; on iPhone it opens Google Maps,
    since Apple Maps can't take several stops.
15. Switch Plan to **Map** to see every stop with a location as pins coloured
    by day, plus ideas still being considered. Pick a day to see its route,
    framed on that day's city. **Share my location** there lets the group
    see where you are for an hour, four hours or the rest of today (only
    while the app is open, unless you choose to keep sharing while it's
    closed); a banner shows while it's on, with **Stop**. Everyone sharing
    appears as a pin ("Priya · 3 min ago") with directions to them.
    Tap a pin for directions.
16. Tap a plan item for its details: **Directions** (Google Maps on Android,
    a choice of Apple or Google Maps on iPhone), its bookings, the photos
    taken during it, and a small discussion just about that item.

### Getting ready: packing, to-dos and notes
17. **Get ready** (from the Overview) has three parts. **Packing**: tap
   **Start with suggestions** for a starter list picked from the weather and
   the places on the trip (rain → umbrella, beaches → swimwear), and untick
   what you don't need. "Each person" lines (passport, charger) are ticked by
   everyone for themselves and show "3 of 5"; tap that to see who hasn't.
   "One for the group" lines (first-aid kit) get one tick and can say who's
   bringing it.
18. **To-dos** ("Book Sintra tickets") can be given to someone and a due date;
   hold a line for those options. On a plan item, **Add a to-do for this**
   links one to it, and the plan shows a ☑ count until it's done. Viewers can
   tick their own packing but not change the lists.
19. **Notes** keep things everyone should find: emergency numbers, Wi-Fi
   codes, useful phrases. Links and phone numbers can be tapped. If two
   people edit the same note, the second sees both versions side by side and
   picks which to keep.

### Bookings, tickets and files
20. On a plan item, **Add booking** records a flight, stay, train, ticket, car
    or restaurant table. Only the essentials are asked (who it's with, the
    confirmation code, date and time, one key detail); the rest is under
    **More details**. The confirmation code copies with a tap, times show in
    the local time zone, and stays and restaurants get Directions.
21. **Tickets & files** (from the Overview) keeps boarding passes, PDFs and
    screenshots for everyone. Each file can be renamed and moved to the right
    category from its **⋯** menu.
22. **Bookings from email** (at the top of Tickets & files): forward a
   confirmation to the trip's own address, paste the email, or pick a ticket
   PDF ("Find booking in this" in a file's ⋯ menu). Flights, trains, stays,
   tables, cars and event tickets found in it wait there, with a note in chat
   for forwarded ones. **Check and add** opens the booking form already filled
   in, and also puts it in the plan on its day; **Not this** skips it.
   Nothing is added by itself. A return trip shows up as two flights.

### Talking: Chat
23. A group chat with reactions, "Priya is typing…", ticks (✓ sent, ✓✓
    delivered, green ✓✓ read by everyone, with **Info** for who) and
    replies. Send **photos and screenshots** (📎; they stay out of the album
    unless you add them), **@mention** someone (they're told straight away),
    and links show a preview card. Hold any message to **reply**, react, **add it to the plan**,
    **add it as an expense**, copy it, **edit** it (your own, for a day) or
    **delete** it (your own; owners can delete anyone's). The Chat tab and the
    app icon show how many messages you haven't read.
24. Activity cards appear automatically ("Sam joined", "Priya added a
    flight", "Alex added Dinner · ₹1,800", "Palolem added to the plan from
    the poll"), so the chat doubles as a record of what happened.
25. In the installed app, push notifications arrive bundled ("Priya and Sam
    sent 5 messages") and skip anyone who has the app open. Besides chat,
    they cover @mentions, plan changes, money you're part of, to-dos,
    trip changes and a **countdown** ("A week to Goa! 2 to-dos still open",
    then three days out, the evening before with the weather, and "Today's
    the day! First up: …" that morning, each at a sensible hour where you are). **Profile → Notifications** switches each kind and sets
    reminders before timed stops ("Lunch in 30 min"); each trip's ⋯ menu can
    mute it for a day, a week or until turned back on.

### Photos
26. **Photos** is one album for the whole group. Add many at once; each keeps
    when (and, where the phone allows, where) it was taken. Browse by day, on
    a map, or by the group's favourites (hearts). **Select** several to
    download them to your phone or delete them; a photo shows on a plan item
    automatically if it was taken during it. **Videos** up to a minute go in
    the album (or a chat) too, and play in the viewer.

### Money
27. **Money**: tap **Add expense**. Say what it was, the amount in any
    currency (today's exchange rate fills in, and can be changed to match
    your bank), who paid, and how to split it: equally, by exact amounts, by
    percent, or by shares (a couple counts as 2). Everyone's share shows as
    you type, and the split always adds up to the cent.
28. The top says "You're owed ₹900" or "You owe ₹450". **Settle up** suggests
    the fewest payments that square everyone. On a rupee trip, **Pay with
    UPI** opens Google Pay, PhonePe, Paytm or a bank app with the amount
    filled in; afterwards, confirm and it's recorded. Otherwise **Mark as
    paid** records cash or a transfer. Expenses can also start from a plan
    item, a booking or a chat message, and everything exports as a CSV.
29. A budget is optional, and most trips skip it: then the only sign of it
    is a small **Add a budget (optional)** link. Once set (a total, limits
    for some categories, or both; for the group or each person), a card on
    Money reads "₹18,400 of ₹25,000 spent · ₹6,600 left · about ₹1,320 a
    day for the 5 days left", with a lighter "planned" part for plan costs
    and bookings not paid yet, bars per category, and from day 2 of the trip
    "At this pace you'll go about ₹4,000 over." The chat gets a card at 80%
    and at 100%, once each, and the Overview's Get ready card adds "Budget:
    ₹6,600 left".

### Remembering it: the journal
30. From the first day of the trip, the Overview leads with **Journal · Day
    3**, opening today's page. Each day's page fills itself in with no
    typing: "Day 3 · Porto", the weather (the forecast ahead, what it really
    was afterwards), the day's stops on a small map with the distance and
    time between them, the day in numbers (photos, messages, money spent and
    what it came to each) and highlights: the most-loved photos, the
    most-voted idea that happened, and the busiest moment in the chat.
31. **Write** adds an entry: some words, a mood if you like (😍 🙂 😴 🥵 🌧️
    🤯), photos and videos from the album (or new ones, which join the album
    too), a place, and who sees it: **The group** or **Just me** (🔒, which
    nobody else ever sees, owners included). An empty day offers starters
    like "Best meal" and "Quote of the day". A half-written entry is kept on
    the phone until it's sent. Everyone, viewers too, can write; the group
    reacts and comments on shared entries, live.
32. In the chat, a message's menu has **Save to journal**: it becomes a quote
    on the day it was said, with who said it. Small avatars show who has
    written that day, without nagging.
33. During the trip an evening push asks one question ("Day 2 in Goa: what
    was the best moment?", then "Best thing you ate today?"…) at 8:30 pm on
    the trip's clock, unless you've already written; the time can be changed
    or turned off in **Profile → Notifications**. A year later, "A year ago
    today you were at Dudhsagar Falls" comes as a push and a card on Your
    trips.
34. The morning after the trip ends, "Your Goa recap is ready ✨": the trip's
    story, for members only. Days, places, distance, photos, messages, the
    most-used emoji, the most-loved photos, each person's share of the
    spending and the biggest shared cost; then day by day with a map that
    follows along, each day's best photos, a few lines from the group's
    entries and the weather; and **Plan the next one**, which starts a new
    trip with the same people. The numbers can be saved as an image (web) or
    shared as text (phone).

## 4. How it works

### The pieces

| Part | What it does | Built with |
|---|---|---|
| **Phone and web app** (`apps/mobile`) | Every screen above, one codebase for Android, iPhone and the browser | Expo SDK 57, React Native, Expo Router |
| **API** (`apps/api`) | Accounts, trips, plan, chat, money, photos, places; checks every permission | Node, Fastify, Drizzle ORM |
| **Live updates** (`apps/api`, gateway) | Pushes every change to everyone viewing the trip within a second | WebSockets, Redis pub/sub |
| **Worker** (`apps/worker`) | Background jobs: push notifications, photo thumbnails | BullMQ on Redis, sharp |
| **Shared code** (`packages/shared`) | The data shapes both sides agree on, and logic that must match exactly on phone and server (money splits, balances, map helpers) | TypeScript, zod |
| **Database** (`packages/db`) | Everything stored, with migrations | PostgreSQL |
| **Files** | Photos, documents | SeaweedFS (S3-compatible) |

### Outside data (all free, no keys)
- **Destination and place search:** Photon (OpenStreetMap).
- **Travel times and routes:** OSRM on the FOSSGIS servers (OpenStreetMap),
  with a straight-line estimate when they don't answer.
- **Things to do:** Wikipedia's nearby search and OpenStreetMap (Overpass).
- **Weather and time zones:** Open-Meteo.
- **Map tiles:** OpenFreeMap; maps drawn by MapLibre.
- **Exchange rates:** Frankfurter (European Central Bank rates).
- **Sign-in emails:** any SMTP mailbox (a Gmail app password works).
- **Bookings by email:** one Gmail inbox read over IMAP (optional); PDFs are
  read with `unpdf`, emails with `mailparser`.
- **Push notifications:** Expo's push service.

All outside data goes through the API, which caches it (rates for a day,
places for a week, routes for a month, weather for hours), so the free services see very few
requests.

### Principles it's built on
- **Everyone sees the same thing, live.** Every change is saved, then
  broadcast to everyone on the trip. If two people edit the same thing,
  the second gets the latest version and a clear message; nothing is
  silently lost.
- **Taps are safe to retry.** Things created on the phone get their id there,
  so a retry on a bad connection can never create a duplicate.
- **Money is exact.** Amounts are stored as whole cents, never decimals;
  every split adds up exactly; balances are worked out fresh every time,
  never stored, so they can't drift.
- **Permissions are checked on the server, every time.** Owners, editors and
  viewers; someone not on a trip can't even tell it exists.
- **Free and open.** Every service it depends on is free and open source or
  open data, and the whole backend runs on one free server.

### How it's checked
- 96 tests for the shared logic and 251 for the API, all run on every change.
- New screens are tried in a browser with two people signed in at once, and
  then on a real phone.

## 5. What's done

| Phase | What it added |
|---|---|
| Foundations | Email sign-in, trips, the calendar date picker, CI |
| Invites and people | Invite links (editor or viewer, single-use, expiry, turn off), people and roles |
| Live plan | Day-by-day plan, drag to reorder, live updates, "is editing", conflict handling |
| Chat and push | Group chat, reactions, typing, "Seen by", activity cards, bundled push notifications |
| Ideas and polls | Ideas board with votes, add to plan; polls in chat |
| Tickets and bookings | Files for the group; bookings on plan items; "Next up" |
| Photos | Shared album by day, uploads with time and place, favourites, map, photos on plan items |
| Money | Expenses in any currency, four ways to split, balances, fewest payments to settle, CSV |
| Deploying for free | One-server setup (Docker, HTTPS), real sign-in emails, production safety checks, guide |
| Paying back | UPI payment links; profile with UPI ID |
| Self-explaining app | A full pass over every screen; replies; directions; editable trips; poll results into the plan; select, download and delete photos; rename files |
| Destinations | Real places on trip creation, weather, Explore with recommendations |
| Maps | The trip on a map (pins by day, ideas), real maps on the web |
| Smarter places | Real places on plan items and stays, travel time between stops, routes on the map, "Shortest order" |
| Getting ready | Packing lists (shared or each person) with starter suggestions, to-dos linked to plan items, trip and day notes |
| Bookings from email | Forward, paste or read a ticket PDF; bookings found wait for review, then go in as a booking and a plan item |
| Polish 1, part A | Archive trips; owners delete and restore them (purged after 30 days); edit and delete chat messages; unread counts on trips, the Chat tab and the app icon |
| Polish 1, part B | Photos and screenshots in chat, @mentions, link previews, delivered and read ticks with an Info sheet and a read-receipts setting, trip cover photos |
| Polish 1, part C | Notifications you control (six kinds, per-trip mute), reminders before timed stops, gentle "add a place" hints in the plan, places for ideas, Explore food and nightlife that load |
| Polish 1, part D | Videos in the album and chat, dark mode (Profile → Appearance), invite links that open the installed app, the new app icon |
| Polish 2, part E | Trips to several places (each day's weather, Explore, place search, map and clock follow its place), a whole day opened in Google Maps |
| Polish 2, part F | A calendar link Google or Apple Calendar subscribes to, a trip's .ics download, countdown pushes before a trip, profile photos |
| Polish 2, part G | Live location sharing for a few hours (never saved), the Android home-screen widget (countdown, today's next stop) |
| Budget (optional) | A total and/or category limits for the group or each person, planned vs spent, pace warning, chat cards at 80% and 100%, a line on the Overview |
| Trip journal | A page a day that fills itself in (weather, route, numbers, highlights), group and private entries with photos, moods and places, reactions and comments, quotes saved from chat, an evening prompt, "On this day" memories, the end-of-trip recap |

## 6. What's not done yet

Known gaps in what exists today:

- **Not yet live on a server.** The setup and guide are ready; it needs the
  free accounts (Oracle server, DuckDNS name, Gmail app password) created by
  a person. See [DEPLOY.md](DEPLOY.md).
- **No installable app build yet.** It runs in Expo Go for testing; an Android
  APK needs an Expo account and one build command.
- **Untested on a device:** the MapLibre map and its route line in a real
  build (Expo Go shows a fallback map), saving photos to the gallery, Apple Maps, and paying through
  a real UPI app.
- **Photo locations on Android** only arrive in a real build, where the app
  can ask for the "photo locations" permission; Expo Go can't.
- **Invite links open the installed app** only with the APK from Polish 1
  part D onwards, once the web app is deployed with its `assetlinks.json`.
- **Live location in the background and the home-screen widget** need the
  APK from Polish 2 part G onwards; older installs share only while open and
  have no widget. Location pins show initials, not profile photos.
- **iPhone installs** need Apple's paid developer account; until then iPhone
  friends use the web app.
- **No in-app card or net-banking payments:** those need a paid payment
  gateway. UPI covers bank accounts.
- **Forwarding emails isn't switched on yet:** it needs the free Gmail inbox
  from DEPLOY.md. Until then, paste the email or read a ticket PDF instead.
  Screenshots of tickets can't be read (no OCR).
- **The recap's "Save as image" works in the web app only.** On phones it
  shares the numbers as text until an APK adds a screen-capture module.
- **Viewers can't add new photos to a journal entry,** only ones already in
  the album, because uploading to the album needs the editor role.
- **No public-transport times:** there's no free, key-less source that covers
  India. Travel times are walking, driving or cycling.

## 7. What's planned

In the order we intend to build it:

1. **Works offline:** the whole trip saved on the phone, so it works with no
   signal, catching up when back online.
2. **AI, self-hosted and free:** draft a day-by-day plan from the group's
   ideas and bookings, summarise long chats, and read amounts from receipt
   photos.

Considered but not planned, because they aren't free to run: live flight
status, hotel price comparison, and Google's ratings and reviews.

## 8. Where things are

```
apps/
  mobile/   the app: screens in src/app, pieces in src/components, logic in src/lib
  api/      the API and live-updates gateway: one folder per area in src/modules
  worker/   background jobs
packages/
  shared/   data shapes and shared logic (money, places, weather, dates)
  db/       database tables and migrations
deploy/     the one-server production setup
docs/
  ABOUT.md       this file
  DEPLOY.md      free deployment, step by step
  decisions/     why things are the way they are, one note per decision
```

To run it on a laptop: start the database, Redis and storage with
`pnpm infra:up`, then `pnpm dev:backend` for the API, gateway and worker, and
`pnpm --filter @tagalong/mobile dev` for the app (scan the QR code with Expo
Go). `pnpm test` runs every test.
