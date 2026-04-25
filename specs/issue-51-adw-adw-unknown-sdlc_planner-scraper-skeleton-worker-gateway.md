# Feature: Scraper Skeleton + Worker Gateway

## Metadata
issueNumber: `51`
adwId: `adw-unknown`
issueJson: `{}`

## Feature Description
This feature delivers the end-to-end tracer bullet for the website scraper subsystem. It stands up all contracts, state machine semantics, cache logic, identity/auth, and storage topology so that every later implementation slice plugs into a working skeleton. The scraper does not use Playwright yet — it returns a hardcoded stub manifest for any URL. The goal is correctness of plumbing, not richness of output.

The feature spans three deployment units: a new Fly.io app (`vestmatic-scraper`) that hosts the scraper HTTP service with an in-process serial job queue; a Cloudflare Worker gateway that exposes `POST /scrape` and `GET /scrape/:id` and reads R2 directly once manifests are ready; and frontend wiring that debounces URL input, shows a spinner during pending, and gates the Generate button on scrape status.

## User Story
As a user of the vestmatic application
I want to type a URL and have the system kick off a scrape in the background
So that the Generate button becomes available once the scrape has produced a manifest, with progress visible throughout

## Problem Statement
There is no scraper subsystem yet. The vestmatic worker has no `/scrape` endpoint, no scrapeId concept, no KV-backed deduplication, no R2 storage layout, and the frontend has no scrape-status awareness. Without this skeleton, every later Playwright slice would have to introduce all of these simultaneously, making integration risky and hard to test incrementally.

## Solution Statement
Introduce a minimal but complete scraper skeleton: URL canonicalisation shared between worker and scraper; KV deduplication using `putIfAbsent` with a `pending → ready` state machine and 180 s stuck-pending reclaim; a stub scraper Fly app that claims a scrapeId and writes a valid schema-v1 manifest to R2; worker routes that proxy to the scraper and read R2 directly; and frontend changes that react to pending/ready/failed status in real time.

## Relevant Files

- `workers/vestmatic-worker/src/index.ts` — add `POST /scrape` and `GET /scrape/:id` routes to the Cloudflare Worker
- `workers/vestmatic-worker/src/scrapeRoutes.ts` — **new file**: route handlers forwarding to the scraper and reading R2
- `workers/vestmatic-worker/src/canonicalise.ts` — **new file**: URL canonicaliser (shared pure function)
- `workers/vestmatic-worker/wrangler.toml` — add KV namespace binding (`SCRAPE_KV`) and R2 bucket binding (`SCRAPE_R2`)
- `workers/vestmatic-worker/src/types/scrape.ts` — **new file**: `ScrapeManifest`, `PageEntry`, `StylesheetEntry`, `FaviconEntry`, `VisualAssetCandidate`, `NavLink`, `ScrapeError`, `ScrapeResult` discriminated union types
- `scraper/src/index.ts` — **new file**: Fly app HTTP entrypoint (Hono or plain Node http), in-process serial queue, shared-secret auth middleware
- `scraper/src/jobQueue.ts` — **new file**: in-process serial job queue with enqueue/dequeue
- `scraper/src/scrapeJob.ts` — **new file**: stub scrape handler — claims KV entry, writes manifest to R2, transitions state to `ready`
- `scraper/src/kvState.ts` — **new file**: KV state machine helpers (`putIfAbsent`, `transitionState`, `isStuckPending`, `reclaim`)
- `scraper/src/manifest.ts` — **new file**: builds and serialises the stub schema-v1 manifest
- `scraper/fly.toml` — **new file**: Fly app config (`vestmatic-scraper`, `shared-cpu-4x`, 2 GB, `min_machines_running=1`, `auto_stop_machines=false`, `hard_limit=5`)
- `scraper/package.json` — **new file**: scraper app dependencies
- `scraper/tsconfig.json` — **new file**: TypeScript config for the scraper app
- `src/components/UrlInput.tsx` (or equivalent frontend component) — add debounced scrape kickoff (800 ms), spinner state, Generate button gate
- `src/hooks/useScrapeStatus.ts` — **new file**: React hook polling `GET /scrape/:id` and exposing `{status, scrapeId, manifest}`
- `workers/vestmatic-worker/src/r2Layout.ts` — **new file**: R2 key builders (`manifestKey`, `pageKey`, `assetKey`)

### New Files
- `workers/vestmatic-worker/src/scrapeRoutes.ts`
- `workers/vestmatic-worker/src/canonicalise.ts`
- `workers/vestmatic-worker/src/types/scrape.ts`
- `workers/vestmatic-worker/src/r2Layout.ts`
- `scraper/` — entire new Fly app directory
- `src/hooks/useScrapeStatus.ts`

## Implementation Plan

### Phase 1: Foundation — shared types, canonicaliser, R2 layout
Define the TypeScript types and pure utility functions that every other piece depends on. These have no runtime dependencies and can be validated with Vitest alone.

### Phase 2: Core Implementation — KV state machine, scraper Fly app, worker routes
Wire up the stateful components: KV `putIfAbsent` deduplication, stub scrape job, manifest write to R2, and the worker `POST /scrape` / `GET /scrape/:id` gateway. All Cucumber BDD scenarios run against this layer.

### Phase 3: Integration — frontend wiring and Fly deploy config
Connect the frontend to the worker gateway (debounced URL input, spinner, Generate gate) and write the Fly configuration so the app can be deployed.

## Step by Step Tasks

### Step 1: Define shared TypeScript types

In `workers/vestmatic-worker/src/types/scrape.ts`:
- Define `PageEntry`, `StylesheetEntry`, `FaviconEntry`, `VisualAssetCandidate`, `NavLink`, `ScrapeError` interfaces
- Define `ScrapeManifest` with `schemaVersion: 1`, `strategy: "playwright-baseline"`, `scrapeId: string`, `canonicalUrl: string`, `pages: PageEntry[]`, `stylesheets: StylesheetEntry[]`, `favicons: FaviconEntry[]`, `visualAssets: VisualAssetCandidate[]`, `navLinks: NavLink[]`, `errors: ScrapeError[]`
- Define discriminated `ScrapeResult` union: `{ status: 'ready', manifest: ScrapeManifest } | { status: 'pending', scrapeId: string } | { status: 'failed', scrapeId: string, error: string } | { status: 'not-found' }`

### Step 2: Implement the URL canonicaliser

In `workers/vestmatic-worker/src/canonicalise.ts`:
- Export a pure `canonicalise(rawUrl: string): string` function
- Strip `www.` prefix, force `https:`, collapse path to `/`, strip `utm_*`/`fbclid`/`gclid`/`ref` query params, drop fragment
- Export `urlHash(canonical: string): string` — SHA-256 hex of the canonical URL (use `crypto.subtle` for Workers compatibility)

### Step 3: Write Vitest unit tests for the canonicaliser

In `workers/vestmatic-worker/src/__tests__/canonicalise.test.ts`:
- Test `www.` stripping, `http` → `https` coercion, path collapsing, UTM/fbclid/gclid/ref stripping, fragment dropping
- Test idempotency: `canonicalise(canonicalise(url)) === canonicalise(url)`
- Test `urlHash` returns stable 64-char hex strings

### Step 4: Define R2 key builders

In `workers/vestmatic-worker/src/r2Layout.ts`:
- Export `manifestKey(scrapeId: string): string` → `scrape/${scrapeId}/manifest.json`
- Export `pageKey(scrapeId: string, n: number): string` → `scrape/${scrapeId}/pages/${n}.html`
- Export `assetKey(scrapeId: string, key: string): string` → `scrape/${scrapeId}/assets/${key}`

### Step 5: Implement KV state machine helpers in the scraper app

In `scraper/src/kvState.ts`:
- Types: `KvEntry = { scrapeId: string; status: 'pending' | 'ready' | 'failed'; claimedAt: number; schemaVersion: number }`
- Export `putIfAbsent(kv: KVNamespace, key: string, entry: KvEntry, ttlSeconds: number): Promise<{ claimed: boolean; existing: KvEntry | null }>`
  - Use `kv.put(key, JSON.stringify(entry), { expiresTtl: ttlSeconds, ...})` with a conditional check (get-then-put pattern with `expirationTtl`)
- Export `transitionState(kv: KVNamespace, key: string, to: 'ready' | 'failed', ttlSeconds: number): Promise<void>`
- Export `isStuckPending(entry: KvEntry, thresholdMs: number): boolean` — `Date.now() - entry.claimedAt > thresholdMs`
- KV key format: `scrape-lookup:<urlHash>:v<schemaVersion>`

### Step 6: Implement the stub manifest builder

In `scraper/src/manifest.ts`:
- Export `buildStubManifest(scrapeId: string, canonicalUrl: string): ScrapeManifest`
- Returns a valid schema-v1 manifest with `pages: [{ url: canonicalUrl, title: 'Stub', bodyText: '' }]`, empty `stylesheets`, `favicons`, `visualAssets`, `navLinks`, `errors`
- Import types from a shared path (symlink or copied types)

### Step 7: Implement the scrape job handler

In `scraper/src/scrapeJob.ts`:
- Export `async function runScrapeJob(params: { scrapeId: string; canonicalUrl: string; urlHash: string; kv: KVNamespace; r2: R2Bucket; schemaVersion: number }): Promise<void>`
- Build stub manifest using `buildStubManifest`
- Write to R2: `r2.put(manifestKey(scrapeId), JSON.stringify(manifest), { httpMetadata: { contentType: 'application/json' } })`
- Transition KV state to `ready` with 30-day TTL (2592000 s)
- On any error: transition KV state to `failed` with 1-hour TTL (3600 s), rethrow

### Step 8: Implement the in-process serial job queue

In `scraper/src/jobQueue.ts`:
- Export a `JobQueue` class with `enqueue(job: () => Promise<void>): void` and a private sequential runner
- Uses a single `Promise` chain internally — each job runs after the previous completes; no concurrency
- Export a singleton `jobQueue` instance

### Step 9: Implement the Fly app HTTP entrypoint

In `scraper/src/index.ts`:
- Use `Hono` (or minimal Node `http` server) to expose `POST /scrape` and `GET /scrape/:id`
- Shared-secret Bearer auth middleware: compare `Authorization: Bearer <token>` against `SCRAPER_SHARED_SECRET` env var; return 401 on mismatch
- `POST /scrape` handler:
  - Parse body: `{ url: string; refresh?: boolean; overrideRobots?: boolean }`
  - Canonicalise URL, compute `urlHash`
  - Build KV key: `scrape-lookup:${urlHash}:v1`
  - Call `putIfAbsent`; if existing entry is stuck-pending (>180 s), treat as failed and allow reclaim
  - If `refresh: true` and existing entry is `pending`, return `409 { code: 'scrape-in-progress' }`
  - If `refresh: true` and existing entry is `ready`/`failed`, delete KV entry and reclaim
  - If claimed: enqueue `runScrapeJob`, return `202 { scrapeId, status: 'pending' }`
  - If not claimed: return existing `scrapeId` and `status`
- `GET /scrape/:id` handler:
  - Scan KV for an entry matching `scrapeId` (or maintain a reverse index `scrape-by-id:<scrapeId>`)
  - If `ready`: return manifest from R2 (read and parse `manifestKey(scrapeId)`)
  - If `pending`: return `{ status: 'pending', scrapeId }`
  - If `failed`: return `{ status: 'failed', scrapeId }`
  - If not found: return `404 { status: 'not-found' }`
- Listen on `PORT` env var (default 8080)

### Step 10: Write Fly app configuration

In `scraper/fly.toml`:
- App name: `vestmatic-scraper`
- `[[vm]]`: `size = "shared-cpu-4x"`, `memory = "2gb"`
- `[http_service]`: `min_machines_running = 1`, `auto_stop_machines = false`
- `[[http_service.concurrency]]`: `hard_limit = 5`, `type = "requests"`
- Internal port 8080

In `scraper/package.json`:
- Dependencies: `hono`, TypeScript dev deps, Bun/Node runtime
- Scripts: `start`, `build`, `typecheck`

### Step 11: Implement worker route handlers

In `workers/vestmatic-worker/src/scrapeRoutes.ts`:
- Export `handlePostScrape(request: Request, env: Env): Promise<Response>`
  - Read `SCRAPER_SHARED_SECRET` from env
  - Forward `POST` to the scraper with `Authorization: Bearer ${SCRAPER_SHARED_SECRET}`
  - Return scraper response body to caller
- Export `handleGetScrape(scrapeId: string, env: Env): Promise<Response>`
  - Check R2 for `manifestKey(scrapeId)` — if present, parse and return `{ status: 'ready', manifest }`
  - Otherwise proxy to scraper `GET /scrape/${scrapeId}` with auth header
  - If scraper returns `not-found`, pass through `404`

### Step 12: Wire routes into the Cloudflare Worker

In `workers/vestmatic-worker/src/index.ts`:
- Add `case 'POST /scrape': return handlePostScrape(request, env)`
- Add `case 'GET /scrape/:id': return handleGetScrape(scrapeId, env)` (extract `:id` from URL)
- Add rate-limit env var check stubs (`SCRAPE_RATE_LIMIT_RPM`, `SCRAPE_RATE_LIMIT_BURST`) — accept but do not enforce (values enforced in slice 9)

### Step 13: Update `wrangler.toml`

In `workers/vestmatic-worker/wrangler.toml`:
- Add KV namespace binding: `[[kv_namespaces]] binding = "SCRAPE_KV" id = "<kv-namespace-id>"`
- Add R2 bucket binding: `[[r2_buckets]] binding = "SCRAPE_R2" bucket_name = "vestmatic-scrapes"`
- Add env vars: `SCRAPER_URL`, `SCRAPER_SHARED_SECRET` (reference from wrangler secrets)
- Document the R2 lifecycle rule (delete objects older than 30 days) in a comment; verify rule via Cloudflare console after deploy

### Step 14: Update the `Env` type

In `workers/vestmatic-worker/src/types/env.d.ts` (or equivalent):
- Add `SCRAPE_KV: KVNamespace`, `SCRAPE_R2: R2Bucket`, `SCRAPER_URL: string`, `SCRAPER_SHARED_SECRET: string`

### Step 15: Implement the `useScrapeStatus` React hook

In `src/hooks/useScrapeStatus.ts`:
- Accept `scrapeId: string | null`
- Poll `GET /scrape/:id` every 2 s while status is `pending`; stop on `ready` or `failed`
- Return `{ status: 'idle' | 'pending' | 'ready' | 'failed' | 'not-found'; manifest: ScrapeManifest | null; error: string | null }`

### Step 16: Wire frontend URL input to scrape kickoff

In the URL input component (e.g. `src/components/UrlInput.tsx`):
- Debounce URL changes by 800 ms
- On debounce fire: call `POST /scrape` with the current URL value; store returned `scrapeId` in component state
- Pass `scrapeId` to `useScrapeStatus`; show a spinner while `status === 'pending'`
- Disable the Generate button while `status === 'pending'`; re-enable on `ready` or `failed`

### Step 17: Write BDD Cucumber scenarios for the scraper state machine

In `features/scraper_state_machine.feature`:
- Tag all scenarios `@adw-51-scraper-skeleton @regression`
- Scenario: happy path — POST /scrape returns `202` with `scrapeId` and `status: pending`; subsequent GET returns `ready` with manifest
- Scenario: pending → ready transition — after job completes, GET /scrape/:id returns `status: ready`
- Scenario: 404 on unknown scrapeId — GET /scrape/:unknownId returns `404 { status: 'not-found' }`
- Scenario: 409 on refresh-while-pending — second POST with `refresh: true` on a pending scrape returns `409 scrape-in-progress`
- Scenario: KV putIfAbsent deduplication — two concurrent POSTs for the same canonical URL return the same `scrapeId`
- Scenario: stuck-pending reclaim — a pending entry older than 180 s is treated as failed by the next caller

### Step 18: Generate step definitions for new BDD scenarios

Run the `/generate_step_definitions` slash command to produce step definitions in `features/step_definitions/scraperStateMachineSteps.ts` covering all scenarios in step 17.

### Step 19: Run all validation commands

Execute all commands listed in the Validation Commands section below and confirm zero regressions.

## Testing Strategy

### Unit Tests
- `workers/vestmatic-worker/src/__tests__/canonicalise.test.ts` — pure function; test all canonicalisation rules, idempotency, and `urlHash` stability
- `workers/vestmatic-worker/src/__tests__/r2Layout.test.ts` — test all key builder functions return expected path strings
- `scraper/src/__tests__/kvState.test.ts` — test `isStuckPending` threshold logic; mock KVNamespace for `putIfAbsent` and `transitionState`
- `scraper/src/__tests__/manifest.test.ts` — test `buildStubManifest` returns schema-v1 compliant manifest with correct `scrapeId` and `canonicalUrl`

### Edge Cases
- Two concurrent `POST /scrape` calls for the same URL must produce only one KV claim and the same `scrapeId`
- A `POST /scrape` with `refresh: true` on a `pending` entry must return `409`, not overwrite the KV entry
- A pending entry older than 180 s must be reclaimed and a new scrapeId issued
- A failed scrape must expire from KV after 1 hour (TTL enforcement)
- A `GET /scrape/:id` on an unknown ID must return `404 { status: 'not-found' }`, not a 500
- `POST /scrape` without the correct `Authorization: Bearer` header must return `401`
- `overrideRobots` body field must be accepted without error (but is a no-op in this slice)
- Manifest written to R2 must be parseable as `ScrapeManifest` TypeScript type

## Acceptance Criteria
- [ ] `vestmatic-scraper` Fly app configuration exists (`fly.toml`) and accepts authenticated `POST /scrape` and `GET /scrape/:id` requests
- [ ] `POST /scrape` on the worker returns a `scrapeId` and `status`; `GET /scrape/:id` returns the current status
- [ ] Worker reads the stub manifest directly from R2 once `status` is `ready`
- [ ] Two concurrent `POST /scrape` calls for the same canonical URL share one `scrapeId` (KV dedup)
- [ ] A pending KV entry older than 180 s is treated as failed by the next caller (stuck-pending reclaim)
- [ ] Refresh on a pending scrape returns `409 scrape-in-progress`
- [ ] Frontend shows spinner during `pending`, disables Generate until `ready` or `failed`, kicks off scrape 800 ms after user stops typing
- [ ] Manifest JSON validates against TypeScript types; stub emits a schema-v1 manifest
- [ ] R2 lifecycle rule (delete objects older than 30 days) is documented in `wrangler.toml` comments
- [ ] Vitest suite for URL canonicaliser passes with zero failures
- [ ] All Cucumber scenarios tagged `@adw-51-scraper-skeleton` pass

## Validation Commands

```bash
# Type check worker
bunx tsc --noEmit -p workers/vestmatic-worker/tsconfig.json

# Type check scraper app
bunx tsc --noEmit -p scraper/tsconfig.json

# Vitest unit tests
bun run test:unit

# Lint
bun run lint

# Build worker
bun run build

# BDD regression scenarios (ADW repo)
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"

# New scenarios for this issue
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-51-scraper-skeleton"
```

## Notes
- The scraper Fly app does not yet use Playwright — it emits a hardcoded stub manifest. Do not introduce Playwright in this slice.
- `overrideRobots` is accepted in the request body but is a no-op until slice 2.
- The R2 lifecycle rule (delete objects older than 30 days) must be verified manually in the Cloudflare dashboard after the bucket is created; it cannot be expressed in `wrangler.toml` directly and should be documented in a comment.
- `schemaVersion` must appear in both the KV key (`scrape-lookup:<urlHash>:v1`) and in the manifest JSON (`"schemaVersion": 1`) to enable future migrations without invalidating existing cache entries.
- `strategy` must be hardcoded to `"playwright-baseline"` from day one even though Playwright is not used yet, to avoid a schema migration when Playwright is introduced.
- Rate-limit env vars (`SCRAPE_RATE_LIMIT_RPM`, `SCRAPE_RATE_LIMIT_BURST`) should be read and accepted in the worker routes but enforcement is deferred to slice 9.
- Keep all new source files under 300 lines (modularity guideline). Split further if needed.
- Follow strict TypeScript (`noImplicitAny`, `strict: true`) — no `any` types.
- The URL canonicaliser must be a pure function with no side effects; it is a prime candidate for exhaustive unit testing.
- The `putIfAbsent` implementation must handle the Cloudflare KV consistency model (eventual consistency for reads); using a short-TTL get-then-put is acceptable for this slice since Fly concurrency is hard-limited to 5.
- Conditional docs: `app_docs/feature-nnn7jr-r2-upload-screenshot-router.md` may be relevant when configuring R2 bindings and bucket lifecycle.
- Adhere to ADW coding guidelines in `guidelines/coding_guidelines.md`: clarity, modularity (≤300 lines/file), immutability, type safety, purity, security by default.
