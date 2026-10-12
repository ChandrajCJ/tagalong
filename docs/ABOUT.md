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
2. Tap **Profile** (top right of your trips) to set the name friends see and,
   optionally, your **UPI ID** so people can pay you back in one tap.

### Starting a trip
3. On **Your trips**, tap **New trip**. Start typing the destination: real
   places are suggested as you type ("Goa, India", "Lisbon, Portugal"). Pick
   one, and the trip gets weather, a map and things to do, and its currency
   switches to the local one (still changeable).
4. Add dates (optional, and changeable later), a name (optional) and a cover
   colour. Tap **Create trip**.

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
   days"), an **Explore** card, and a list of everything you can do here.
   **Edit** changes the trip's name, dates, destination or cover.

### Finding things to do: Explore
9. **Explore Goa** lists places worth going to, by category: top sights, food
   and drink, nature and beaches, museums and culture, nightlife, shopping.
   Each has a photo and description where available, **Directions** and a
   link to read more. Tap **Add to Ideas** to put it to the group.

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
    an estimated cost and notes. Hold and drag to reorder. Everyone sees
    changes live, sees "Sam is editing" on an item someone has open, and gets
    a clear message instead of silently overwriting each other.
13. **Where** suggests real places around the destination as you type, with
    the trip's own ideas first; picking one puts the item on the map (a small
    pin on its row). Older items get **Find on map** on their own screen.
14. Between two stops on the map, the list shows the travel time and
    distance ("🚶 12 min · 900 m"), and the day shows its total, with a
    Walk / Drive / Cycle switch remembered on each phone. **Shortest order**
    suggests a quicker order for the day, keeping the first stop and anything
    at a set time in place, and shows the time saved before anyone applies it.
15. Switch Plan to **Map** to see every stop with a location as pins coloured
    by day, plus ideas still being considered. Pick a day to see its route.
    Tap a pin for directions.
16. Tap a plan item for its details: **Directions** (Google Maps on Android,
    a choice of Apple or Google Maps on iPhone), its bookings, the photos
    taken during it, and a small discussion just about that item.

### Bookings, tickets and files
17. On a plan item, **Add booking** records a flight, stay, train, ticket, car
    or restaurant table. Only the essentials are asked (who it's with, the
    confirmation code, date and time, one key detail); the rest is under
    **More details**. The confirmation code copies with a tap, times show in
    the local time zone, and stays and restaurants get Directions.
18. **Tickets & files** (from the Overview) keeps boarding passes, PDFs and
    screenshots for everyone. Each file can be renamed and moved to the right
    category from its **⋯** menu.

### Talking: Chat
19. A group chat with reactions, "Priya is typing…", "Seen by 3" and
    replies. Hold any message to **reply**, react, **add it to the plan**,
    **add it as an expense**, or copy it.
20. Activity cards appear automatically ("Sam joined", "Priya added a
    flight", "Alex added Dinner · ₹1,800", "Palolem added to the plan from
    the poll"), so the chat doubles as a record of what happened.
21. In the installed app, push notifications arrive bundled ("Priya and Sam
    sent 5 messages") and skip anyone who has the app open.

### Photos
22. **Photos** is one album for the whole group. Add many at once; each keeps
    when (and, where the phone allows, where) it was taken. Browse by day, on
    a map, or by the group's favourites (hearts). **Select** several to
    download them to your phone or delete them; a photo shows on a plan item
    automatically if it was taken during it.

### Money
23. **Money**: tap **Add expense**. Say what it was, the amount in any
    currency (today's exchange rate fills in, and can be changed to match
    your bank), who paid, and how to split it: equally, by exact amounts, by
    percent, or by shares (a couple counts as 2). Everyone's share shows as
    you type, and the split always adds up to the cent.
24. The top says "You're owed ₹900" or "You owe ₹450". **Settle up** suggests
    the fewest payments that square everyone. On a rupee trip, **Pay with
    UPI** opens Google Pay, PhonePe, Paytm or a bank app with the amount
    filled in; afterwards, confirm and it's recorded. Otherwise **Mark as
    paid** records cash or a transfer. Expenses can also start from a plan
    item, a booking or a chat message, and everything exports as a CSV.

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
- 82 tests for the shared logic and 203 for the API, all run on every change.
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
- **Invite links open the web app,** not the installed app, until Android App
  Links are set up after the first real build.
- **iPhone installs** need Apple's paid developer account; until then iPhone
  friends use the web app.
- **No in-app card or net-banking payments:** those need a paid payment
  gateway. UPI covers bank accounts.
- **No public-transport times:** there's no free, key-less source that covers
  India. Travel times are walking, driving or cycling.

## 7. What's planned

In the order we intend to build it:

1. **Checklists and notes:** packing lists and to-dos (shared, or one tick
   each), notes on the trip and each day.
2. **A budget:** spending tracked against what the group planned to spend.
3. **Works offline:** the whole trip saved on the phone, so it works with no
   signal, catching up when back online.
4. **Bookings from email:** forward a confirmation and the flight or hotel is
   added automatically.
5. **AI:** draft a day-by-day plan from the group's ideas and bookings,
   summarise long chats, and read amounts from receipt photos.

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
