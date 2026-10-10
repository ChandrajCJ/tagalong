# 014: Deploying for free, and paying back with UPI

**Status:** accepted

## Decision
- **One server, all open source.** `deploy/docker-compose.yml` runs Postgres, Redis, SeaweedFS, the API, the gateway, the worker and Caddy on a single machine (an Oracle Cloud Always Free ARM server; see `docs/DEPLOY.md`). One image (`Dockerfile`, target `server`) runs every Node process; a `migrate` container updates the database and exits before the others start.
- **Caddy gives everything HTTPS** from Let's Encrypt, across three names on one free DuckDNS domain: `app.` (the web app), `api.` (the API, with the gateway on `/ws`) and `files.` (storage). Upload and download links are signed for `files.`, and Caddy passes the Host header through unchanged, so the signatures still match.
- **Plain Postgres in production.** Development uses the PostGIS image, but nothing uses PostGIS, and that image isn't published for ARM.
- **The API refuses to start in production on development defaults**: no SMTP, a short or placeholder `JWT_SECRET`, the development storage key, or no `CORS_ORIGINS`.
- **Sign-in codes go out over SMTP** (nodemailer), so any free mailbox works; a Gmail app password is the documented route. Without `SMTP_URL` the code is logged, as before.
- **The web app is a single-page app** (`web.output: "single"`), so a link like `/invite/<token>` loads from any address. It keeps its sign-in in `localStorage` (the phone keeps it in the keychain), so a reload no longer signs people out.
- **Invites are web links once deployed** (`EXPO_PUBLIC_APP_URL`): tappable in every chat app, and they work for friends who haven't installed anything.
- **UPI instead of a payment gateway.** People add a UPI ID in Profile. On a trip in INR, the person who owes sees "Pay with UPI", which opens their UPI app through a standard `upi://pay` link (`upiPayLink`) with the payee and amount filled in. The money never touches Tagalong and there are no fees; because the app can't see whether the payment succeeded, it then asks the payer to confirm and records the payment (method "Bank or app", note "UPI"). UPI IDs are visible only to people on the same trips.

## Found while testing
- `deploy/init.sh` first loaded `.env` as a shell script, which failed on `MAIL_FROM=Tagalong <you@gmail.com>`. It now reads values without running them.
- The deploy stack was first named `tagalong`, the same Compose project as local development, so bringing it up would have recreated the development database container and shared its volume. It's `tagalong-prod` now.

## Limits today
- **Cards and net banking can't be prefilled**; that needs a paid gateway. UPI apps cover bank accounts (and RuPay credit cards where supported).
- Some UPI apps restrict or warn on payments started by another app. The UPI ID is shown, so paying by hand and tapping "Mark paid" always works.
- Invite links open the web app, not the installed Android app. Android App Links (a verified `assetlinks.json`) would fix that once the app's signing key exists.
- No free route exists for iPhone installs; iPhone friends use the web app.
