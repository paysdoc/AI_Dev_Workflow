# Feature: Rate Limiting + Observability (Logs, Timing Headers, Manifest Stats)

## Metadata
issueNumber: `59`
adwId: `adw-unknown`
issueJson: `{}`

## Feature Description
This feature adds three-layer observability and layered rate limiting to the website scraper subsystem, building on the skeleton established in issue #51. Rate limiting protects Fly compute and future proxy budget from abuse via a Cloudflare edge rule (burst) and a Worker KV daily counter. Observability spans: structured JSON log envelopes emitted by the Fly scraper to stdout, timing response headers on the Worker's `/scrape` endpoints, and enriched manifest stats fields so individual scrapes are fully traceable and aggregate behaviour is queryable. All layers are parallel with the other subsystem slices (#2–#8) since this is plumbing on top of the skeleton.

## User Story
As a platform operator
I want layered rate limits on the scrape endpoint and structured observability across every scrape event
So that I can protect infrastructure from abuse, trace individual scrapes end-to-end, and query aggregate behaviour from the Fly log dashboard

## Problem Statement
The scraper skeleton (#51) has no protection against high-volume callers and no structured logging or timing instrumentation. Without rate limiting, a single IP can exhaust Fly compute or proxy budget. Without a fixed event taxonomy in logs and consistent timing headers on API responses, it is impossible to trace failures, measure latency percentiles, or understand what the scraper did for a given request.

## Solution Statement
Add a Cloudflare edge burst rule (env-var configurable) and a Worker KV daily counter with rolling 24h window and 48h TTL. Return `429` with `retryAfter` on limit breach. Emit structured JSON log envelopes from the scraper for every significant event using a fixed taxonomy keyed by `scrapeId`. Add `X-Scrape-*` timing headers to Worker `/scrape` responses and `X-Theme-Source` to `/generate`. Extend `ScrapeManifest` with a `stats` object and per-page `scrapedAt` timestamps.

## Relevant Files

- `workers/vestmatic-worker/src/index.ts` — add rate-limit middleware wiring and new response headers to existing `/scrape` and `/generate` route handlers
- `workers/vestmatic-worker/src/scrapeRoutes.ts` — add `X-Scrape-Status`, `X-Scrape-Cache`, `X-Scrape-Age-Ms`, `X-Scrape-Fetch-Ms` headers to responses; call rate limiter before forwarding
- `workers/vestmatic-worker/src/rateLimiter.ts` — **new file**: Worker KV daily counter logic (`checkAndIncrement`, `getDailyKey`, `retryAfterSeconds`)
- `workers/vestmatic-worker/wrangler.toml` — add `SCRAPE_BURST_LIMIT` and `SCRAPE_DAILY_LIMIT` env var declarations; KV binding already present from #51
- `workers/vestmatic-worker/src/types/scrape.ts` — extend `ScrapeManifest` with `stats` (`pagesDiscovered`, `pagesScraped`, `pagesFailed`, `totalBytes`, `wallClockMs`) and per-page `scrapedAt`; add `strategy` field
- `scraper/src/logger.ts` — **new file**: structured JSON log emitter with fixed event taxonomy; exports `emitEvent(event: ScrapeEvent)`
- `scraper/src/scrapeJob.ts` — instrument with all required log events at correct lifecycle points
- `scraper/src/manifest.ts` — populate `stats` and `scrapedAt` fields when building the manifest

### New Files
- `workers/vestmatic-worker/src/rateLimiter.ts`
- `scraper/src/logger.ts`
- `features/rate_limiter.feature`
- `features/event_emission.feature`
- `features/timing_headers.feature`
- `features/step_definitions/rateLimiterSteps.ts`
- `features/step_definitions/eventEmissionSteps.ts`
- `features/step_definitions/timingHeaderSteps.ts`

## Implementation Plan

### Phase 1: Foundation
Define the rate limiter module, the logger module with fixed event taxonomy types, and the manifest stats type extensions. These are the shared contracts that all subsequent steps depend on.

### Phase 2: Core Implementation
Wire the rate limiter into the Worker gateway (KV daily counter + 429 responses). Instrument the scraper job with the full log event taxonomy. Populate manifest `stats` and per-page `scrapedAt`. Add timing headers to Worker responses.

### Phase 3: Integration
Write Cucumber BDD scenarios and step definitions covering: rate limiter burst/daily/rollover/429-retryAfter, event taxonomy emission order, and timing header presence. Validate all acceptance criteria.

## Step by Step Tasks

### Step 1: Extend ScrapeManifest types with stats and scrapedAt

In `workers/vestmatic-worker/src/types/scrape.ts`:
- Add `ManifestStats` interface: `{ pagesDiscovered: number; pagesScraped: number; pagesFailed: number; totalBytes: number; wallClockMs: number }`
- Add `stats: ManifestStats` field to `ScrapeManifest`
- Add `strategy: string` field to `ScrapeManifest` (default `"playwright-baseline"`)
- Add `scrapedAt: string` (ISO timestamp) to `PageEntry`

### Step 2: Implement the Worker KV rate limiter module

Create `workers/vestmatic-worker/src/rateLimiter.ts`:
- Export `getDailyKey(ip: string, date: string): string` — returns `rate:<ip>:<yyyymmdd>`
- Export `checkAndIncrement(kv: KVNamespace, ip: string, dailyLimit: number): Promise<{ allowed: boolean; retryAfter?: number }>` — atomically reads, increments, writes counter with 48h TTL; returns `{ allowed: false, retryAfter: 86400 - secondsIntoDay }` when limit exceeded
- Accepts `dailyLimit` from env var at call site (no hardcoding)

### Step 3: Wire rate limiting into the Worker gateway

In `workers/vestmatic-worker/src/scrapeRoutes.ts` (and `index.ts` as needed):
- Before forwarding `POST /scrape`, call `checkAndIncrement` with `env.SCRAPE_DAILY_LIMIT` (default 100)
- On limit exceeded, return `Response` with status `429` and JSON body `{ error: 'rate-limited', retryAfter: <seconds> }`
- Document Cloudflare edge rule for burst limit in `wrangler.toml` comments referencing `SCRAPE_BURST_LIMIT` env var (default 20)
- Add `SCRAPE_BURST_LIMIT` and `SCRAPE_DAILY_LIMIT` to `wrangler.toml` `[vars]` section with defaults

### Step 4: Add timing headers to Worker scrape and generate responses

In `workers/vestmatic-worker/src/scrapeRoutes.ts`:
- On `POST /scrape` and `GET /scrape/:id` responses, append:
  - `X-Scrape-Status`: `pending | ready | failed | not-found`
  - `X-Scrape-Cache`: `hit | miss | pending-shared`
  - `X-Scrape-Age-Ms`: milliseconds since manifest was written (from KV metadata or manifest timestamp)
  - `X-Scrape-Fetch-Ms`: milliseconds taken by the upstream Fly fetch (or R2 read)
- On `/generate` response, append `X-Theme-Source`: `scrape | defaults | skipped`
- Preserve existing `X-Generate-Total-Ms` header

### Step 5: Implement the scraper logger module

Create `scraper/src/logger.ts`:
- Define `ScrapeEventType` union: `'scrape-start' | 'scrape-complete' | 'scrape-failed' | 'page-fetched' | 'page-failed' | 'page-truncated' | 'robots-check' | 'robots-override' | 'robots-disallow' | 'asset-captured' | 'asset-skipped' | 'cache-hit' | 'cache-miss' | 'cache-pending-shared' | 'stealth-challenge' | 'layer-escalation'`
- Define `ScrapeLogEnvelope` interface: `{ scrapeId: string; ts: string; event: ScrapeEventType; [key: string]: unknown }`
- Export `emitEvent(envelope: ScrapeLogEnvelope): void` — calls `console.log(JSON.stringify(envelope))`

### Step 6: Instrument scrapeJob.ts with the full event taxonomy

In `scraper/src/scrapeJob.ts`:
- Emit `scrape-start` at job entry with `{ scrapeId, url }`
- Emit `cache-hit` / `cache-miss` / `cache-pending-shared` based on KV state check result
- Emit `robots-check` before fetching, `robots-disallow` / `robots-override` as appropriate
- Emit `page-fetched` / `page-failed` / `page-truncated` per page
- Emit `asset-captured` / `asset-skipped` (with `reason` field) per asset
- Emit `stealth-challenge` when bot-detection page is detected
- Emit `scrape-complete` with `{ scrapeId, pagesScraped, wallClockMs }` on success
- Emit `scrape-failed` with `{ scrapeId, error }` on failure
- Every envelope must include `scrapeId` and `ts` (ISO)

### Step 7: Populate manifest stats in manifest.ts

In `scraper/src/manifest.ts`:
- Track `pagesDiscovered`, `pagesScraped`, `pagesFailed`, `totalBytes`, `wallClockMs` during job execution
- Set `manifest.stats` from tracked values
- Set `manifest.strategy = "playwright-baseline"`
- Set `page.scrapedAt` to ISO timestamp for each page entry

### Step 8: Write unit tests for the rate limiter module

In `workers/vestmatic-worker/src/__tests__/rateLimiter.test.ts`:
- Test `getDailyKey` returns correct key format for known inputs
- Test `checkAndIncrement` allows requests below the daily limit
- Test `checkAndIncrement` blocks the (N+1)th request and returns correct `retryAfter`
- Test window rollover (different date key) resets the counter
- Use a mock KV object (in-memory Map) to simulate KV reads/writes

### Step 9: Write BDD feature: rate limiter scenarios

Create `features/rate_limiter.feature` with tag `@adw-59`:
- Scenario: requests below daily limit are allowed
- Scenario: request at daily limit boundary is blocked with 429 and `retryAfter`
- Scenario: rollover into a new day resets the counter
- Scenario: `429` response body contains `{ error: 'rate-limited', retryAfter: <number> }`

### Step 10: Write step definitions for rate limiter

Create `features/step_definitions/rateLimiterSteps.ts`:
- Implement steps using an in-memory mock KV asserting on response status and `retryAfter` field

### Step 11: Write BDD feature: event emission scenarios

Create `features/event_emission.feature` with tag `@adw-59`:
- Scenario: successful scrape emits `scrape-start`, `cache-miss`, `page-fetched`, `asset-captured`, `scrape-complete` in order
- Scenario: failed scrape emits `scrape-start`, `scrape-failed`
- Scenario: every emitted event carries `scrapeId` and `ts`

### Step 12: Write step definitions for event emission

Create `features/step_definitions/eventEmissionSteps.ts`:
- Capture stdout JSON lines from a mock scrape job run
- Assert presence and ordering of event types
- Assert every envelope has `scrapeId` and `ts` fields

### Step 13: Write BDD feature: timing header presence

Create `features/timing_headers.feature` with tag `@adw-59`:
- Scenario: `POST /scrape` response includes `X-Scrape-Status`, `X-Scrape-Cache`, `X-Scrape-Age-Ms`, `X-Scrape-Fetch-Ms` with plausible values
- Scenario: `/generate` response includes `X-Theme-Source`

### Step 14: Write step definitions for timing headers

Create `features/step_definitions/timingHeaderSteps.ts`:
- Use mock Worker handler with in-memory KV/R2 stubs
- Assert header presence and that numeric headers are non-negative integers

### Step 15: Run validation commands

Execute all validation commands to confirm zero regressions.

## Testing Strategy

### Unit Tests
- `workers/vestmatic-worker/src/__tests__/rateLimiter.test.ts`: getDailyKey format, checkAndIncrement allow/block/rollover, 429 retryAfter value
- `scraper/src/__tests__/logger.test.ts`: emitEvent writes valid JSON to stdout, envelope has required fields

### Edge Cases
- Rate counter exactly at limit (N allowed, N+1 blocked)
- Rollover at midnight boundary: new date key starts from 0
- `retryAfter` is always a positive integer (not 0 or negative)
- Scrape job that fails partway: `stats.pagesFailed` reflects partial work
- `scrape-start` always emitted even when cache hit is detected immediately after
- `X-Scrape-Age-Ms` when manifest was just written (0 ms edge case)

## Acceptance Criteria
- Cloudflare edge rule configured enforcing `SCRAPE_BURST_LIMIT` (default 20) per IP per minute; env var referenced in `wrangler.toml`
- Worker KV daily counter enforces `SCRAPE_DAILY_LIMIT` (default 100) per IP per rolling 24h window; rollover tested in unit tests and BDD
- Both limits configurable via env vars; no hardcoded numbers in application code
- `429` responses include `{ error: 'rate-limited', retryAfter: <seconds> }` JSON body
- Worker response headers (`X-Scrape-Status`, `X-Scrape-Cache`, `X-Scrape-Age-Ms`, `X-Scrape-Fetch-Ms`) present and correct on `/scrape` endpoints
- `X-Theme-Source` header present on `/generate` responses; existing `X-Generate-Total-Ms` preserved
- Scraper emits all event types in the fixed taxonomy at the correct lifecycle points; every event has `scrapeId` and `ts`
- Manifest `stats` populated for successful, partial, and failed scrapes; `strategy` and per-page `scrapedAt` present
- Rate limiter BDD scenarios (`@adw-59`) all pass with mocked KV
- Event-emission BDD scenarios all pass
- Timing header BDD scenarios all pass
- `bun run lint`, `bunx tsc --noEmit`, `bun run test:unit`, and `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-59"` all exit 0

## Validation Commands

```bash
bun run lint
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json
bun run test:unit
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-59"
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

## Notes
- Cloudflare burst rule is **not code** — it is configured in the Cloudflare dashboard referencing the `SCRAPE_BURST_LIMIT` env var name for documentation purposes. The `wrangler.toml` should include a comment explaining this.
- The KV daily counter uses a `rate:<ip>:<yyyymmdd>` key with 48h TTL so the key safely covers two calendar days around the midnight rollover boundary.
- `layer-escalation` event is reserved for Layer 2 (Playwright) and should be emitted as a no-op stub in the skeleton scraper if needed to satisfy taxonomy completeness.
- Blocked by issue #51 (scraper skeleton + worker gateway must exist before this can be wired in).
- All rate limiter logic must be testable with a plain in-memory Map as a KV mock — no Workers-specific runtime needed for unit tests.
