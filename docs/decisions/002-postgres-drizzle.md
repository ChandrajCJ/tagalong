# 002: Postgres with Drizzle, one schema per module

**Status:** accepted

## Decision
Use PostgreSQL (with PostGIS, and pgvector later) as the system of record, accessed through Drizzle ORM. Each backend module owns a Postgres schema (`identity`, `trips`, `sync`, and later `chat`, `media`, `expenses`...).

## Why
- The data is relational: trips, members, itinerary items, chat, expenses and photos all link together, and money needs transactions.
- Drizzle keeps queries close to SQL, generates plain SQL migrations, and handles PostGIS and pgvector without fighting the ORM.
- Per-module schemas keep boundaries visible, which leaves a path to split a module out later.

## Conventions
UUIDv7 ids that the client can generate, `created_at`/`updated_at`/`deleted_at`, a `version` column for conflict checks, `trip_id` on every trip-owned row, and money stored as integer minor units.
