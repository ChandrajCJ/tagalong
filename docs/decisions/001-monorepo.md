# 001: One TypeScript monorepo

**Status:** accepted

## Decision
Keep the mobile app, API, worker and shared code in one pnpm workspace, with Turborepo for tasks.

## Why
- The app and the API share request/response schemas (`@tagalong/shared`), so a contract change breaks the typecheck on both sides at once.
- One install, one CI pipeline, and one place to search.

## Trade-offs
- The mobile app's toolchain (Expo, Metro) is heavier than the backend's, so CI is slower than two separate repos would be.
