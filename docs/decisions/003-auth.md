# 003: Email codes first, short access tokens with rotating refresh tokens

**Status:** accepted

## Decision
- Start with passwordless email sign-in: a 6-digit code that expires in 10 minutes, with only its hash stored and a cap on attempts.
- On success, issue a 15-minute JWT access token and a 30-day refresh token. Only the refresh token's hash is stored in `identity.sessions`, and it rotates on every refresh, so a stolen old token stops working.
- Apple and Google sign-in come later through `identity.auth_identities` (provider + provider user id). They need developer accounts.

## Why
- It works without any third-party accounts, so the app is usable from day one.
- Sessions per device make "sign out everywhere" and device management straightforward later.

## Not done yet
- Real email delivery: codes are printed in the API log (`logMailer`).
- Rate limiting by IP address, beyond the per-email code limit.
