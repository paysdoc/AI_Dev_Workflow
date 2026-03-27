# Feature: D1 Client and Dual-Write Integration

## Metadata
issueNumber: `334`
adwId: `g2u55r-adw-d1-client-and-du`
issueJson: `{"number":334,"title":"ADW D1 client and dual-write integration","body":"## Parent PRD\n\n`specs/prd/d1-cost-database.md`\n\n## What to build\n\nAn HTTP client module in `adws/cost/` that transforms `PhaseCostRecord` arrays into the Worker's ingest payload and POSTs them to `costs.paysdoc.nl`. Wire this client into the existing phase cost commit logic so that cost data is written to both D1 and CSV (dual-write).\n\n### Key details:\n\n- New module in `adws/cost/` with a function that accepts `PhaseCostRecord[]`, project slug, and optional project metadata\n- Transforms camelCase `PhaseCostRecord` to the snake_case ingest payload (see PRD for payload shape)\n- Uses `COST_API_URL` and `COST_API_TOKEN` env vars\n- **Important**: D1 writes are skipped entirely when `COST_API_URL` is not configured. This makes the code safe to merge independently, but this issue is blocked by #331 because dual-write should only be activated after the infrastructure is live.\n- Wire into `phaseCostCommit.ts` (or equivalent) alongside existing CSV writes\n- D1 write failures should log a warning but not crash the workflow\n\n## Acceptance criteria\n\n- [ ] New D1 client module in `adws/cost/` with clean public interface\n- [ ] PhaseCostRecord → ingest payload transformation is correct (camelCase to snake_case, token_usage map)\n- [ ] Auth header set correctly from `COST_API_TOKEN`\n- [ ] D1 writes skipped when `COST_API_URL` is not set (no errors, no warnings)\n- [ ] D1 write failures log a warning but do not crash the workflow\n- [ ] Phase cost commit logic writes to both D1 and CSV\n- [ ] Unit tests with mocked fetch: payload shape, auth header, error handling, skip behavior\n- [ ] `COST_API_URL` and `COST_API_TOKEN` added to `.env.sample`\n\n## Blocked by\n\n- Blocked by #330, #331\n\n## User stories addressed\n\n- User stories 1, 14, 15","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-27T09:08:18Z","comments":[],"actionableComment":null}`

## Feature Description
An HTTP client module in `adws/cost/` that transforms `PhaseCostRecord` arrays into the Cost API Worker's snake_case ingest payload and POSTs them to `costs.paysdoc.nl`. The client is wired into the existing `phaseCostCommit.ts` so that cost data is written to both D1 (via the Worker) and CSV (existing pipeline) — a dual-write strategy that makes the transition safe and reversible. When `COST_API_URL` is not configured, D1 writes are silently skipped, making this safe to merge before the infrastructure is live.

## User Story
As an ADW operator
I want cost data written to both the D1 database and CSV files after each phase completes
So that the transition from CSV to D1 is safe, reversible, and the git log clutter can eventually be eliminated

## Problem Statement
ADW currently persists cost data only to CSV files committed to git. The D1 cost database and ingest Worker (issues #330, #331) provide a centralized persistence layer, but there is no client-side code to POST cost records to the Worker. The phase cost commit logic needs to be extended to also write to D1 alongside CSV, with graceful degradation when the Worker is unavailable.

## Solution Statement
Create a new `adws/cost/d1Client.ts` module that:
1. Transforms `PhaseCostRecord[]` into the Worker's `IngestPayload` format (camelCase to snake_case)
2. POSTs the payload to `COST_API_URL/api/cost` with `Bearer COST_API_TOKEN` auth
3. Returns silently when `COST_API_URL` is not configured (no errors, no warnings)
4. Logs a warning on failure but never throws, so workflow execution is unaffected

Wire this client into `phaseCostCommit.ts` so it fires alongside the existing CSV write path. Add `COST_API_URL` and `COST_API_TOKEN` to `.env.sample` and `environment.ts`.

## Relevant Files
Use these files to implement the feature:

- `specs/prd/d1-cost-database.md` — Parent PRD defining the ingest payload shape, D1 schema, and rollout plan
- `adws/cost/types.ts` — `PhaseCostRecord`, `TokenUsageMap`, and related type definitions; source types for the transformation
- `adws/cost/index.ts` — Barrel exports for the cost module; must re-export the new D1 client function
- `adws/phases/phaseCostCommit.ts` — `commitPhaseCostData()` and `commitPhasesCostData()` where the D1 write will be wired alongside CSV writes
- `adws/core/environment.ts` — Environment variable accessors; add `COST_API_URL` and `COST_API_TOKEN` here
- `workers/cost-api/src/types.ts` — `IngestPayload` and `IngestRecord` interfaces defining the target payload shape
- `.env.sample` — Add `COST_API_URL` and `COST_API_TOKEN` entries
- `guidelines/coding_guidelines.md` — Coding conventions to follow
- `app_docs/feature-viahyb-cost-api-worker-d1-s-cost-api-worker.md` — Documentation on the Cost API Worker implementation

### New Files
- `adws/cost/d1Client.ts` — D1 HTTP client module: payload transformation + POST logic

## Implementation Plan
### Phase 1: Foundation
Add `COST_API_URL` and `COST_API_TOKEN` environment variable accessors to `adws/core/environment.ts` following the existing pattern (exported constants from `process.env`). Add corresponding entries to `.env.sample` with descriptive comments. Update `README.md` environment variable documentation.

### Phase 2: Core Implementation
Create `adws/cost/d1Client.ts` with:
- A `transformToIngestPayload()` function that maps `PhaseCostRecord[]` to the Worker's `IngestPayload` format, converting camelCase fields to snake_case and mapping `contextResetCount` to `continuation_count`
- A `postCostRecordsToD1()` function that:
  - Returns immediately (no-op) when `COST_API_URL` is empty/unset — no log, no error
  - Constructs the `IngestPayload` with project slug, optional name/repo_url
  - POSTs to `{COST_API_URL}/api/cost` with `Authorization: Bearer {COST_API_TOKEN}`
  - On success (201), returns silently
  - On any error (network failure, non-2xx response), logs a warning via `log()` and returns without throwing
- Export the public function from `adws/cost/index.ts`

### Phase 3: Integration
Wire `postCostRecordsToD1()` into `commitPhaseCostData()` in `adws/phases/phaseCostCommit.ts`. The D1 POST fires concurrently with the CSV write (both inside the same try-catch). The D1 write has its own internal error handling, so a D1 failure does not affect CSV writes. Pass `repoName` as the project slug.

## Step by Step Tasks

### Step 1: Add environment variables to `.env.sample`
- Add `COST_API_URL` and `COST_API_TOKEN` as optional entries in `.env.sample` under a new "Cost API" section
- Include descriptive comments explaining their purpose

### Step 2: Add environment variable accessors to `environment.ts`
- Add `COST_API_URL` and `COST_API_TOKEN` exported constants to `adws/core/environment.ts` following the existing pattern (e.g., `export const COST_API_URL = process.env.COST_API_URL || '';`)
- Place them in a new "Cost API" subsection alongside the existing provider secret accessors

### Step 3: Update `README.md` environment variables section
- Add `COST_API_URL` and `COST_API_TOKEN` to the environment variable documentation in `README.md`

### Step 4: Create `adws/cost/d1Client.ts`
- Create the D1 client module with two functions:
  - `transformToIngestPayload(records, projectSlug, options?)` — pure function that transforms `PhaseCostRecord[]` into `IngestPayload`:
    - Maps `workflowId` → `workflow_id`
    - Maps `issueNumber` → `issue_number`
    - Maps `phase`, `model`, `provider` as-is
    - Maps `computedCostUsd` → `computed_cost_usd`
    - Maps `reportedCostUsd` → `reported_cost_usd`
    - Maps `status` as-is
    - Maps `retryCount` → `retry_count`
    - Maps `contextResetCount` → `continuation_count`
    - Maps `durationMs` → `duration_ms`
    - Maps `timestamp` as-is
    - Maps `tokenUsage` → `token_usage` (already snake_case keys, pass through)
    - Sets `project` to `projectSlug`
    - Optionally sets `name` and `repo_url` from options
  - `postCostRecordsToD1(records, projectSlug, options?)` — async function:
    - Import `COST_API_URL` and `COST_API_TOKEN` from `environment.ts`
    - If `COST_API_URL` is empty, return immediately (no log, no error)
    - Call `transformToIngestPayload()` to build the payload
    - `fetch()` POST to `${COST_API_URL}/api/cost` with JSON body and `Authorization: Bearer ${COST_API_TOKEN}` header
    - If response is not ok, log a warning with status and response body
    - Wrap entire operation in try-catch; on any error, log warning via `log()` and return
- Follow coding guidelines: readonly interfaces, pure transformation, side effects isolated to the POST function

### Step 5: Export D1 client from cost barrel
- Add `postCostRecordsToD1` export to `adws/cost/index.ts`

### Step 6: Wire D1 client into `phaseCostCommit.ts`
- Import `postCostRecordsToD1` in `adws/phases/phaseCostCommit.ts`
- In `commitPhaseCostData()`, call `postCostRecordsToD1(newRecords, repoName)` alongside the existing CSV write
- The D1 call should be fire-and-forget (awaited but wrapped in its own error handling internally), so it does not block or fail the CSV path
- Place the D1 call before the CSV write so both execute regardless of the other's outcome

### Step 7: Run validation commands
- Run `bun run lint` to verify no lint errors
- Run `bun run build` to verify no build errors
- Run `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` to verify type checking passes

## Testing Strategy
### Edge Cases
- `COST_API_URL` is empty string or undefined → D1 write skipped silently, no log output
- `COST_API_TOKEN` is empty but `COST_API_URL` is set → POST fires with empty bearer token (Worker returns 401, client logs warning)
- `newRecords` is empty array → `commitPhaseCostData` returns early before reaching D1 client (existing guard)
- Network timeout or DNS failure → fetch throws, caught by try-catch, warning logged
- Worker returns 400 (malformed payload) → warning logged with status and body
- Worker returns 500 (D1 error) → warning logged with status and body
- Worker returns 201 → success, no extra logging
- `reportedCostUsd` is undefined on a PhaseCostRecord → mapped to `undefined` in payload (JSON serializes as absent key, Worker defaults to `null`)
- `tokenUsage` map is empty → valid payload, Worker inserts zero token_usage rows

## Acceptance Criteria
- [ ] New `adws/cost/d1Client.ts` module exists with `postCostRecordsToD1` and `transformToIngestPayload` functions
- [ ] `PhaseCostRecord` → `IngestPayload` transformation correctly maps camelCase to snake_case fields
- [ ] `tokenUsage` map is passed through as `token_usage` (keys are already snake_case)
- [ ] `contextResetCount` maps to `continuation_count` per PRD schema
- [ ] `Authorization: Bearer {COST_API_TOKEN}` header is set on POST requests
- [ ] D1 writes are completely skipped (no fetch, no log) when `COST_API_URL` is not set
- [ ] D1 write failures log a warning via `log()` but do not throw or crash the workflow
- [ ] `commitPhaseCostData()` calls the D1 client alongside existing CSV writes
- [ ] `COST_API_URL` and `COST_API_TOKEN` added to `.env.sample` with descriptive comments
- [ ] `COST_API_URL` and `COST_API_TOKEN` added to `adws/core/environment.ts`
- [ ] TypeScript compiles without errors (`bunx tsc --noEmit`)
- [ ] Lint passes (`bun run lint`)

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors
- `bunx tsc --noEmit` — Type check root project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check adws directory

## Notes
- Unit tests are disabled for ADW per `.adw/project.md`. The issue's acceptance criterion for unit tests is noted but deferred to BDD scenario coverage. The `adws/cost/__tests__/` directory contains pre-existing Vitest tests from the cost module's initial implementation but new test tasks are not part of this plan per project configuration.
- This is PR 2 in the staged rollout (see PRD). PR 1 (#330, #331) deploys the Worker infrastructure. This code is safe to merge before infrastructure is live because the D1 path is a no-op when `COST_API_URL` is unset.
- The `transformToIngestPayload` function is exported separately from the POST function to support future use cases (e.g., migration script, debugging) and to keep the transformation pure and testable.
- No new libraries are needed — the implementation uses the built-in `fetch` API.
- `issue_description` is not available in `PhaseCostRecord` and is omitted from the transformation. The Worker treats it as optional (`null`).
- Follow `guidelines/coding_guidelines.md`: readonly interfaces, pure functions for transformation, side effects isolated to the POST boundary, immutable data flow.
