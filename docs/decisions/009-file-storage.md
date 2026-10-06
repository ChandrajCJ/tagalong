# 009: Files go straight to object storage, never through the API

**Status:** accepted

## Decision
- Files live in **S3-compatible object storage**, run locally as **SeaweedFS** (`docker-compose`, port 8333). The code talks plain S3, so Cloudflare R2 or AWS S3 works later with only environment changes.
- Uploading is **two steps and direct**:
  1. `POST /trips/:id/documents` records a `pending` row and returns a **signed upload link** (10 minutes).
  2. The phone **PUTs the bytes straight to storage**, then `POST /documents/:id/complete`, where the API confirms the object exists, records its real size, flips it to `ready`, writes the change log and posts the activity card.
- Downloads are the same in reverse: `GET /documents/:id/url` returns a **short-lived signed link**. Nothing in the bucket is publicly readable.
- Limits enforced server-side: **25 MB** and an allow-list of content types (PDF, JPEG, PNG, HEIC, WebP, plain text).
- `Storage` is an interface. Tests use an in-memory fake; one integration test runs against real SeaweedFS and skips itself when storage isn't running.

## Why
- The API never holds a large file in memory, so a slow phone on hotel wifi can't tie up a request worker.
- A failed upload leaves a `pending` row rather than a document pointing at nothing. Pending rows are visible only to the person uploading, so a retry has something to attach to and nobody else sees a broken entry.
- Signed links mean access control stays in our database (`requireTripRole`) while the bytes are served by storage.

## Why not MinIO
MinIO's public images are no longer pullable (`401` from quay.io). SeaweedFS and Garage were both tested; SeaweedFS won on being a single container with one flag.

## The trap, written down so nobody loses a day to it
The AWS SDK v3 now sends a CRC32 checksum header by default. SeaweedFS rejects it with **`BadDigest`**, and because the header is part of a presigned URL's signature, the upload fails before it starts. The client sets `requestChecksumCalculation: 'WHEN_REQUIRED'` (and the response equivalent). This is the single reason the storage client isn't three lines long.

The compose healthcheck reads the **master status port (9333)**, not the S3 port: an unsigned request to 8333 correctly answers 403, which a naive healthcheck reads as "down".

## Limits today
- No thumbnails yet, so the list shows a type icon. Image and PDF previews come with the photo album, which reuses this whole pipeline.
- No virus scanning, and no per-trip storage quota.
