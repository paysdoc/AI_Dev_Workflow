# Feature: R2 Upload Utility + Screenshot Router Worker

## Metadata
issueNumber: `274`
adwId: `nnn7js-r2-upload-utility-sc`
issueJson: `{"number":274,"title":"R2 upload utility + Screenshot Router Worker","body":"## Parent PRD\n\n`specs/prd/prd-review-revamp.md`\n\n## What to build\n\nBuild two components for hosting review screenshots on Cloudflare R2:\n\n**R2 Upload Utility** — A dedicated module that:\n- Uploads images to Cloudflare R2 using the S3-compatible API (`@aws-sdk/client-s3`)\n- Creates buckets on demand using naming convention `adw-{owner}-{repo}`\n- Configures 30-day object lifecycle rule on bucket creation\n- Returns public URLs in format `https://screenshots.paysdoc.nl/{repo}/{key}`\n- Is reusable by any phase (review, document, etc.)\n- Reads credentials from `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`\n\n**Screenshot Router Worker** — A Cloudflare Worker at `workers/screenshot-router/`:\n- Routes `screenshots.paysdoc.nl/{repo}/{key}` requests to the correct `adw-{owner}-{repo}` R2 bucket\n- Includes a cron trigger that lists all `adw-*` buckets, checks if empty, and deletes empty buckets immediately\n- Deployed via `wrangler` CLI with `wrangler.toml` configuration\n\nAdd R2 env vars to `.env.sample` as optional configuration.\n\nSee PRD sections: \"R2 Upload Utility\", \"Screenshot Router Worker\", \"R2 Bucket Configuration\".\n\n**Note:** This is HITL — Worker deployment to Cloudflare requires manual verification.\n\n## Acceptance criteria\n\n- [ ] R2 upload utility module exists and uploads files to R2 via S3-compatible API\n- [ ] Buckets are created lazily on first upload with naming convention `adw-{owner}-{repo}`\n- [ ] 30-day object lifecycle rule is configured on bucket creation\n- [ ] Upload returns public URL in format `https://screenshots.paysdoc.nl/{repo}/{key}`\n- [ ] Cloudflare Worker at `workers/screenshot-router/` routes requests to correct bucket\n- [ ] Worker cron trigger deletes empty buckets immediately\n- [ ] `wrangler.toml` exists with correct bindings and cron config\n- [ ] Worker is deployed and serving requests at `screenshots.paysdoc.nl`\n- [ ] `.env.sample` includes `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`\n- [ ] Unit tests for R2 upload utility (mock S3 client, assert bucket/key/URL construction)\n\n## Blocked by\n\nNone — can start immediately.\n\n## User stories addressed\n\n- User story 7\n- User story 8\n- User story 9\n- User story 10","state":"OPEN","author":"paysdoc","labels":["enhancement"],"createdAt":"2026-03-23T17:00:35Z","comments":[{"author":"paysdoc","createdAt":"2026-03-24T01:31:35Z","body":"## Take action"}],"actionableComment":null}`

## Feature Description
Build two components for hosting review screenshots on Cloudflare R2 storage. The **R2 Upload Utility** is a reusable module under `adws/r2/` that uploads images to Cloudflare R2 via the S3-compatible API, creates buckets lazily with a 30-day lifecycle rule, and returns public URLs. The **Screenshot Router Worker** is a Cloudflare Worker deployed at `workers/screenshot-router/` that routes incoming `screenshots.paysdoc.nl/{repo}/{key}` requests to the correct per-repo R2 bucket, plus a cron trigger that garbage-collects empty buckets.

## User Story
As a developer using ADW
I want review screenshots automatically uploaded to a persistent, publicly accessible URL
So that review proofs are durable, shareable, and not tied to ephemeral local storage

## Problem Statement
ADW's review phase generates screenshots as proof of functionality, but there is no durable hosting for these images. Without persistent storage, review proofs are lost when worktrees are cleaned up, and screenshots cannot be embedded in GitHub issue/PR comments as stable URLs.

## Solution Statement
Introduce a two-part solution: (1) a reusable R2 upload utility module that any ADW phase can call to upload images to Cloudflare R2, returning stable public URLs; (2) a Cloudflare Worker that routes requests from a custom domain to the correct per-repo R2 bucket, with automated cleanup of empty buckets via cron.

## Relevant Files
Use these files to implement the feature:

- `adws/core/environment.ts` — Add R2 environment variable accessors (`CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`)
- `adws/core/config.ts` — Reference for how global config and environment constants are structured
- `adws/core/logger.ts` — Use structured logging in the R2 module
- `adws/core/index.ts` — May need to re-export new R2 module utilities
- `.env.sample` — Add R2 environment variables as optional configuration
- `package.json` — Add `@aws-sdk/client-s3` dependency
- `tsconfig.json` — Root TypeScript config (verify compatibility)
- `adws/tsconfig.json` — ADW-specific TypeScript config (verify path aliases)
- `guidelines/coding_guidelines.md` — Follow coding guidelines strictly

### New Files
- `adws/r2/index.ts` — Barrel export for the R2 upload module
- `adws/r2/types.ts` — TypeScript types/interfaces for R2 upload operations
- `adws/r2/r2Client.ts` — S3-compatible client factory for Cloudflare R2
- `adws/r2/bucketManager.ts` — Lazy bucket creation with lifecycle rules
- `adws/r2/uploadService.ts` — File upload logic returning public URLs
- `workers/screenshot-router/src/index.ts` — Cloudflare Worker entry point (request router + cron handler)
- `workers/screenshot-router/wrangler.toml` — Wrangler configuration with R2 bindings and cron trigger
- `workers/screenshot-router/tsconfig.json` — TypeScript config for the Worker
- `workers/screenshot-router/package.json` — Worker-specific dependencies (if needed)

## Implementation Plan
### Phase 1: Foundation
Install `@aws-sdk/client-s3` as a production dependency. Add the three R2 environment variables to `.env.sample` and create accessors in `adws/core/environment.ts`. Create the `adws/r2/` module directory with types and a barrel export.

### Phase 2: Core Implementation
Build the R2 upload utility: S3 client factory configured for Cloudflare R2 endpoint, lazy bucket creation with `adw-{owner}-{repo}` naming, 30-day `PutBucketLifecycleConfiguration`, and an upload function that returns `https://screenshots.paysdoc.nl/{repo}/{key}`. Then build the Screenshot Router Worker: a `fetch` handler that parses `/{repo}/{key}` from the URL, binds to the correct `adw-{owner}-{repo}` R2 bucket, and streams the object back. Add a `scheduled` handler that lists `adw-*` buckets and deletes empty ones.

### Phase 3: Integration
Configure `wrangler.toml` with the custom domain route, R2 bucket bindings, and cron trigger schedule. Verify the R2 module exports are accessible from `adws/r2/index.ts`. Document deployment steps (HITL — manual `wrangler deploy` required).

## Step by Step Tasks

### Step 1: Install `@aws-sdk/client-s3` dependency
- Run `bun add @aws-sdk/client-s3` to add the S3-compatible client library
- Verify it appears in `package.json` dependencies

### Step 2: Add R2 environment variables to `.env.sample`
- Add `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` as optional commented-out entries
- Group them under a `# Cloudflare R2 Configuration` comment section
- Follow the existing pattern in `.env.sample` for optional variables

### Step 3: Add R2 environment variable accessors in `adws/core/environment.ts`
- Read `adws/core/environment.ts` to understand the existing accessor pattern
- Add accessor functions for `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
- These should follow the same pattern as existing optional environment variable accessors

### Step 4: Create R2 module types (`adws/r2/types.ts`)
- Define `R2Config` interface (accountId, accessKeyId, secretAccessKey, publicBaseUrl)
- Define `UploadOptions` interface (owner, repo, key, body, contentType)
- Define `UploadResult` interface (url, bucket, key)
- Define `BucketInfo` interface (name, createdAt)

### Step 5: Create S3-compatible client factory (`adws/r2/r2Client.ts`)
- Create `createR2Client()` function that returns a configured `S3Client` instance
- Configure endpoint as `https://{accountId}.r2.cloudflarestorage.com`
- Use `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` for credentials
- Set region to `auto` (Cloudflare R2 convention)

### Step 6: Create bucket manager (`adws/r2/bucketManager.ts`)
- Create `ensureBucket(client, owner, repo)` function
  - Bucket name follows `adw-{owner}-{repo}` convention (lowercase, sanitized)
  - Check if bucket exists via `HeadBucket` command, create via `CreateBucket` if not
  - On creation, apply 30-day expiration lifecycle rule via `PutBucketLifecycleConfiguration`
  - Track known buckets in a module-level `Set<string>` to avoid repeated `HeadBucket` calls
- Create helper `toBucketName(owner, repo)` for consistent naming

### Step 7: Create upload service (`adws/r2/uploadService.ts`)
- Create `uploadToR2(options: UploadOptions)` function
  - Calls `ensureBucket` to guarantee the target bucket exists
  - Uploads the file via `PutObject` command
  - Returns `UploadResult` with public URL `https://screenshots.paysdoc.nl/{repo}/{key}`
- Accept `Buffer | Uint8Array | ReadableStream` as body types
- Set `ContentType` header from options (default `image/png`)

### Step 8: Create R2 module barrel export (`adws/r2/index.ts`)
- Re-export all public types from `types.ts`
- Re-export `createR2Client` from `r2Client.ts`
- Re-export `ensureBucket`, `toBucketName` from `bucketManager.ts`
- Re-export `uploadToR2` from `uploadService.ts`

### Step 9: Create Screenshot Router Worker directory and config
- Create `workers/screenshot-router/` directory structure
- Create `workers/screenshot-router/wrangler.toml`:
  - `name = "screenshot-router"`
  - `main = "src/index.ts"`
  - `compatibility_date` set to current date
  - Custom domain route for `screenshots.paysdoc.nl`
  - Cron trigger: `crons = ["0 3 * * *"]` (daily at 3 AM UTC)
  - Note in comments that R2 bucket bindings are dynamic (Worker uses S3 API, not R2 bindings, to access per-repo buckets)
- Create `workers/screenshot-router/tsconfig.json` with Worker-appropriate settings
- Create `workers/screenshot-router/package.json` with `wrangler` as dev dependency and deploy script

### Step 10: Implement Screenshot Router Worker (`workers/screenshot-router/src/index.ts`)
- Implement `fetch` handler:
  - Parse URL path as `/{repo}/{...key}`
  - Derive bucket name: `adw-paysdoc-{repo}` (owner is fixed for this deployment)
  - Use S3-compatible API (or R2 binding if available) to fetch the object from the correct bucket
  - Stream the R2 object back with appropriate `Content-Type` and cache headers
  - Return 404 for missing objects, 400 for malformed paths
- Implement `scheduled` handler (cron):
  - List all buckets matching `adw-*` prefix via Cloudflare API
  - For each bucket, list objects (limit 1) — if empty, delete the bucket
  - Log cleanup actions
- Export default worker object with `fetch` and `scheduled` handlers

### Step 11: Run validation commands
- Run `bun run lint` to verify no linting errors
- Run `bun run build` to verify the project builds without errors
- Run `bunx tsc --noEmit` to verify TypeScript compilation
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify ADW TypeScript compilation

## Testing Strategy

### Edge Cases
- R2 credentials not configured — `uploadToR2` should throw a clear error when env vars are missing
- Bucket name sanitization — owner/repo names with uppercase, special characters, or exceeding S3 naming limits must be normalized (lowercase, replace invalid chars with hyphens, truncate to 63 chars)
- Concurrent bucket creation — two uploads for the same repo racing to create the bucket; `ensureBucket` should handle `BucketAlreadyOwnedByYou` / `BucketAlreadyExists` gracefully
- Large file uploads — ensure streaming upload works for files larger than available memory
- Worker path parsing — handle edge cases like trailing slashes, missing key, encoded characters
- Empty bucket cron — verify the scheduled handler tolerates API errors (e.g., permission denied) without crashing
- Object not found — Worker returns proper 404 with descriptive message

## Acceptance Criteria
- [ ] `adws/r2/` module exists with `r2Client.ts`, `bucketManager.ts`, `uploadService.ts`, `types.ts`, `index.ts`
- [ ] `uploadToR2()` creates buckets lazily with naming convention `adw-{owner}-{repo}`
- [ ] 30-day lifecycle rule is applied via `PutBucketLifecycleConfiguration` on bucket creation
- [ ] `uploadToR2()` returns URL in format `https://screenshots.paysdoc.nl/{repo}/{key}`
- [ ] Cloudflare Worker at `workers/screenshot-router/src/index.ts` routes `/{repo}/{key}` to correct bucket
- [ ] Worker `scheduled` handler lists `adw-*` buckets and deletes empty ones
- [ ] `workers/screenshot-router/wrangler.toml` has correct route, cron, and compatibility config
- [ ] `.env.sample` includes `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
- [ ] All code follows `guidelines/coding_guidelines.md` (strict types, no `any`, pure functions, modular)
- [ ] `bun run lint`, `bun run build`, and `bunx tsc --noEmit` pass without errors

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors
- `bunx tsc --noEmit` — TypeScript type-check the root project
- `bunx tsc --noEmit -p adws/tsconfig.json` — TypeScript type-check the ADW module

## Notes
- **New dependency**: `@aws-sdk/client-s3` must be installed via `bun add @aws-sdk/client-s3`
- **HITL**: Worker deployment to Cloudflare (`wrangler deploy`) requires manual verification — do not auto-deploy
- **Unit tests disabled**: Per `.adw/project.md`, unit tests are disabled for this project. The issue acceptance criteria mention unit tests, but we follow the project configuration which disables them.
- **Worker uses S3 API**: The Screenshot Router Worker uses the S3-compatible API with credentials from environment secrets (not R2 bindings per bucket) because bucket names are dynamic — derived from the request path at runtime. R2 bindings would require one binding per bucket in `wrangler.toml`, which doesn't scale.
- **Owner derivation in Worker**: The Worker hardcodes `paysdoc` as the owner prefix for bucket lookup since it's deployed on `screenshots.paysdoc.nl`. If multi-org support is needed later, the URL scheme can be extended to `/{owner}/{repo}/{key}`.
- **Bucket name length**: S3 bucket names are limited to 63 characters. The `toBucketName` helper must truncate and sanitize accordingly.
- Follow `guidelines/coding_guidelines.md` strictly: strict TypeScript, no `any`, declarative style, pure functions where possible, side effects at boundaries.
