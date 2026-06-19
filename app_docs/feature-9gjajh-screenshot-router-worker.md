# Screenshot Router Worker

## Overview

The Screenshot Router Worker is a Cloudflare Worker deployed at `screenshots.paysdoc.nl` that serves screenshot artifacts stored in per-repo Cloudflare R2 buckets. It also runs a daily scheduled job to garbage-collect empty `adw-*` R2 buckets.

## Responsibilities

- Route `GET screenshots.paysdoc.nl/{repo}/{...key}` requests by deriving the correct R2 bucket name from the `{repo}` path segment and fetching the object via the S3-compatible API.
- Stream R2 object bodies back to clients with the object's `Content-Type` and a one-day `Cache-Control` header.
- Return `400` for malformed paths (missing `repo` or `key`), `404` for missing objects or buckets.
- On the daily cron trigger (`0 3 * * *`), list all `adw-*` R2 buckets, check each for emptiness (`ListObjectsV2` with `MaxKeys: 1`), and delete empty ones.
- Build the S3 client at request time from Worker secrets injected via environment bindings.

## Contracts & Invariants

- Bucket names are derived from the request path as `adw-paysdoc-{repo}` (hardcoded owner `paysdoc`), normalised to lowercase with hyphens, truncated to 63 characters — exactly mirroring the `toBucketName` function in `adws/r2/bucketManager.ts`.
- `NoSuchKey` and `NoSuchBucket` errors (and HTTP 404 from the S3 metadata field) are mapped to a `404` response; all other errors are re-thrown and result in a Worker error response.
- Per-bucket errors in the scheduled GC handler are caught and logged individually so that one failing bucket does not abort the cleanup of others.
- The Worker uses smart placement mode (`placement.mode = "smart"`) for EU co-location.
- R2 credentials are accessed dynamically via Worker secrets rather than static R2 bindings, allowing the Worker to route to any number of dynamically-created buckets.

## Configuration

Three Worker secrets are required (set via `wrangler secret put`): `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. Route binding: `screenshots.paysdoc.nl/*` on zone `paysdoc.nl`. Cron trigger: `0 3 * * *`. Configured in `workers/screenshot-router/wrangler.toml`.

## Gotchas

- The owner is hardcoded as `paysdoc` in the Worker source; requests for repos under a different owner are not supported without a code change.
- The GC scheduled handler only deletes buckets it can see via `ListBucketsCommand`; buckets for which the R2 credentials lack list permission are silently skipped.
- Path parsing requires exactly `/{repo}/{key}` — paths with no key component (e.g., `/{repo}/`) return `400`, not a bucket listing.
- The Worker streams R2 body responses using either a `ReadableStream` directly or by calling `transformToWebStream()` on the body object, depending on the S3 SDK version response shape.
