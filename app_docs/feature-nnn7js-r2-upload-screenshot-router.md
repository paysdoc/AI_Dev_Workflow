# R2 Upload Utility + Screenshot Router Worker

**ADW ID:** nnn7js-r2-upload-utility-sc
**Date:** 2026-03-24
**Specification:** specs/issue-274-adw-nnn7js-r2-upload-utility-sc-sdlc_planner-r2-upload-screenshot-router.md

## Overview

This feature introduces durable screenshot hosting for ADW review proofs. A reusable `adws/r2/` module uploads images to Cloudflare R2 via the S3-compatible API, returning stable public URLs. A Cloudflare Worker at `workers/screenshot-router/` routes `screenshots.paysdoc.nl/{repo}/{key}` requests to the correct per-repo R2 bucket, with an automated daily cron that garbage-collects empty buckets.

## What Was Built

- **`adws/r2/` module** — reusable R2 upload utility callable from any ADW phase
- **Lazy bucket creation** — buckets are created on first upload with naming convention `adw-{owner}-{repo}`
- **30-day lifecycle rule** — applied automatically at bucket creation via `PutBucketLifecycleConfiguration`
- **Public URL generation** — uploads return `https://screenshots.paysdoc.nl/{repo}/{key}`
- **Screenshot Router Worker** — Cloudflare Worker routing `/{repo}/{key}` to the correct R2 bucket via S3 API
- **Cron cleanup handler** — daily at 03:00 UTC, lists `adw-*` buckets and deletes empty ones
- **R2 env var accessors** — `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` added to `adws/core/environment.ts`
- **`.env.sample` update** — R2 variables documented as optional configuration

## Technical Implementation

### Files Modified

- `adws/core/environment.ts`: Added accessors for `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
- `adws/core/config.ts`: Minor update (likely re-exports or constant additions)
- `.env.sample`: Added R2 environment variables under `# Cloudflare R2 Configuration`
- `package.json`: Added `@aws-sdk/client-s3` dependency
- `tsconfig.json`: Verified TypeScript compatibility

### New Files

- `adws/r2/types.ts`: `R2Config`, `UploadOptions`, `UploadResult`, `BucketInfo` interfaces
- `adws/r2/r2Client.ts`: `createR2Client(config)` — pure factory returning an `S3Client` pointed at `https://{accountId}.r2.cloudflarestorage.com` with region `auto`
- `adws/r2/bucketManager.ts`: `ensureBucket(client, owner, repo)` with in-process `Set<string>` cache; `toBucketName(owner, repo)` with S3 name sanitisation (lowercase, hyphens, 63-char limit)
- `adws/r2/uploadService.ts`: `uploadToR2(options)` — orchestrates `ensureBucket` + `PutObject`, returns `UploadResult`
- `adws/r2/index.ts`: Barrel export for all public R2 symbols
- `workers/screenshot-router/src/index.ts`: Cloudflare Worker with `fetch` handler (parse `/{repo}/{key}`, proxy to R2) and `scheduled` handler (empty-bucket cleanup)
- `workers/screenshot-router/wrangler.toml`: Route `screenshots.paysdoc.nl/*`, cron `0 3 * * *`, Worker secrets documented
- `workers/screenshot-router/tsconfig.json`: TypeScript config for the Worker
- `workers/screenshot-router/package.json`: Worker dependencies

### Key Changes

- **Dynamic bucket routing via S3 API**: The Worker does not use static R2 bindings (which would require one binding per repo in `wrangler.toml`). Instead, it derives the bucket name from the URL path at runtime and queries R2 via `@aws-sdk/client-s3` with credentials injected as Worker secrets.
- **Concurrent creation safety**: `ensureBucket` handles `BucketAlreadyExists` / `BucketAlreadyOwnedByYou` errors gracefully, so parallel uploads to a new repo do not fail.
- **Lifecycle rule best-effort**: If `PutBucketLifecycleConfiguration` fails after bucket creation, the error is logged as a warning but the upload is not aborted.
- **Owner is hardcoded in the Worker** (`paysdoc`) since the Worker serves `screenshots.paysdoc.nl` — a single-org deployment.
- **Cron error isolation**: Per-bucket errors during the scheduled cleanup handler are caught and logged individually so one inaccessible bucket does not abort the entire cleanup run.

## How to Use

### Uploading a screenshot from an ADW phase

```typescript
import { uploadToR2 } from '../r2/index.ts';

const result = await uploadToR2({
  owner: 'my-org',
  repo: 'my-repo',
  key: `review/${adwId}/screenshot.png`,
  body: imageBuffer,           // Buffer | Uint8Array | ReadableStream
  contentType: 'image/png',   // optional, defaults to image/png
});

console.log(result.url);
// https://screenshots.paysdoc.nl/my-repo/review/<adwId>/screenshot.png
```

### Deploying the Screenshot Router Worker (HITL)

1. `cd workers/screenshot-router`
2. `bun install` (or `npm install`)
3. Set required secrets:
   ```sh
   wrangler secret put CLOUDFLARE_ACCOUNT_ID
   wrangler secret put R2_ACCESS_KEY_ID
   wrangler secret put R2_SECRET_ACCESS_KEY
   ```
4. `wrangler deploy`
5. Verify `https://screenshots.paysdoc.nl/<repo>/<key>` is serving

## Configuration

| Variable | Required | Description |
|---|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Yes (for uploads) | Cloudflare account ID for R2 endpoint |
| `R2_ACCESS_KEY_ID` | Yes (for uploads) | R2 API token access key |
| `R2_SECRET_ACCESS_KEY` | Yes (for uploads) | R2 API token secret key |

Copy from `.env.sample` and populate in `.env`. For the Worker, set these as Wrangler secrets (not environment variables).

## Testing

The R2 module has no unit tests (unit tests are disabled for this project per `.adw/project.md`). BDD scenarios are defined in `features/r2_upload_screenshot_router.feature` with step definitions in `features/step_definitions/r2UploadScreenshotRouterSteps.ts`.

Run BDD scenarios:
```sh
bunx cucumber-js --tags @adw-274
```

## Notes

- **HITL deployment**: `wrangler deploy` requires manual verification — the Worker is not auto-deployed by ADW.
- **Bucket naming**: Names are limited to 63 characters; `toBucketName` sanitises owner/repo to lowercase with hyphens and truncates accordingly.
- **30-day expiry**: All uploaded objects expire automatically after 30 days via the S3 lifecycle rule — screenshots are ephemeral review artifacts, not permanent storage.
- **Multi-org**: If multi-org support is needed, the URL scheme can be extended to `/{owner}/{repo}/{key}` and the Worker updated to derive the owner from the path instead of the hardcoded constant.
