# R2 Storage

## Overview

The R2 module uploads screenshot artifacts to Cloudflare R2 object storage using the S3-compatible API, managing per-repo buckets with automatic creation and a 30-day object lifecycle. Uploaded objects are publicly accessible via the Screenshot Router Worker at `screenshots.paysdoc.nl`.

## Responsibilities

- Create an S3-compatible `S3Client` pointed at the Cloudflare R2 endpoint for a given account via `createR2Client`.
- Derive canonical R2 bucket names from owner/repo pairs (`adw-{owner}-{repo}`, normalised to S3 rules, truncated to 63 characters) via `toBucketName`.
- Ensure a bucket exists before upload via `ensureBucket`: checks with `HeadBucket`, creates with `CreateBucket` (EU location), and applies a 30-day expiration lifecycle rule at creation time.
- Maintain an in-process `knownBuckets` set so that repeated `ensureBucket` calls within the same process skip the `HeadBucket` network round-trip.
- Upload a file to R2 and return the stable public URL, bucket name, and object key via `uploadToR2`.
- Build `R2Config` from environment variables (`CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) inside `uploadToR2`.

## Contracts & Invariants

- The public URL format is `https://screenshots.paysdoc.nl/{repo}/{key}` — the bucket name is not exposed in the URL.
- Bucket creation races (`BucketAlreadyExists` / `BucketAlreadyOwnedByYou`) are handled gracefully; a concurrent creation by another process is silently accepted.
- Lifecycle rule application is best-effort: failures are logged as warnings but do not abort the upload.
- `ensureBucket` only caches bucket names after the full `ensureBucket` flow succeeds; a failed creation attempt leaves the cache empty.
- Bucket name normalisation lowercases the segment, replaces non-alphanumeric non-hyphen characters with hyphens, strips leading/trailing hyphens, and collapses consecutive hyphens.
- `contentType` defaults to `image/png` when not specified in `UploadOptions`.

## Configuration

Three environment variables are required: `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. All are read at upload time via `adws/core/environment.ts`. Missing variables cause an immediate descriptive `Error` throw before any network call.

## Gotchas

- The `knownBuckets` cache is process-scoped and not shared across processes or worktrees; each new process will make at least one `HeadBucket` call per bucket.
- Buckets are created with `LocationConstraint: 'EU'` — this is hardcoded and cannot be overridden via configuration.
- The public base URL `https://screenshots.paysdoc.nl` is hardcoded in `uploadService.ts`; changing the domain requires a code change.
- The URL path is `{publicBaseUrl}/{repo}/{key}` — the `owner` segment is not included in the public URL, only in the bucket name.
