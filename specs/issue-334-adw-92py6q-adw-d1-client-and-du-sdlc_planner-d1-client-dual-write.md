# Feature: D1 Client and Dual-Write Integration

## Metadata
issueNumber: `334`
adwId: `92py6q-adw-d1-client-and-du`
issueJson: `{"number":334,"title":"ADW D1 client and dual-write integration","body":"## Parent PRD\n\n`specs/prd/d1-cost-database.md`\n\n## What to build\n\nAn HTTP client module in `adws/cost/` that transforms `PhaseCostRecord` arrays into the Worker's ingest payload and POSTs them to `costs.paysdoc.nl`. Wire this client into the existing phase cost commit logic so that cost data is written to both D1 and CSV (dual-write).\n\n### Key details:\n\n- New module in `adws/cost/` with a function that accepts `PhaseCostRecord[]`, project slug, and optional project metadata\n- Transforms camelCase `PhaseCostRecord` to the snake_case ingest payload (see PRD for payload shape)\n- Uses `COST_API_URL` and `COST_API_TOKEN` env vars\n- **Important**: D1 writes are skipped entirely when `COST_API_URL` is not configured. This makes the code safe to merge independently, but this issue is blocked by #331 because dual-write should only be activated after the infrastructure is live.\n- Wire into `phaseCostCommit.ts` (or equivalent) alongside existing CSV writes\n- D1 write failures should log a warning but not crash the workflow\n\n## Acceptance criteria\n\n- [ ] New D1 client module in `adws/cost/` with clean public interface\n- [ ] PhaseCostRecord to ingest payload transformation is correct (camelCase to snake_case, token_usage map)\n- [ ] Auth header set correctly from `COST_API_TOKEN`\n- [ ] D1 writes skipped when `COST_API_URL` is not set (no errors, no warnings)\n- [ ] D1 write failures log a warning but do not crash the workflow\n- [ ] Phase cost commit logic writes to both D1 and CSV\n- [ ] Unit tests with mocked fetch: payload shape, auth header, error handling, skip behavior\n- [ ] `COST_API_URL` and `COST_API_TOKEN` added to `.env.sample`\n\n## Blocked by\n\n- Blocked by #330, #331\n\n## User stories addressed\n\n- User stories 1, 14, 15","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-27T09:08:18Z","comments":[],"actionableComment":null}`

## Feature Description
An HTTP client module in `adws/cost/` that transforms `PhaseCostRecord` arrays into the Cost API Worker's ingest payload (snake_case) and POSTs them to `costs.paysdoc.nl`. This client is wired into the existing `phaseCostCommit.ts` logic so that cost data is written to both D1 (via the Worker) and CSV (existing pipeline) simultaneously. When `COST_API_URL` is not configured, D1 writes are silently skipped, making the code safe to merge independently of infrastructure deployment. D1 write failures log a warning but never crash the workflow.

## User Story
As an ADW operator
I want cost data written to the D1 database alongside existing CSV files after each phase completes
So that cost data is persisted centrally and independently of the git repository, enabling future querying and invoicing without cluttering the git log

## Problem Statement
ADW currently persists cost data only to CSV files committed to git. The Cost API Worker at `costs.paysdoc.nl` (issue #330) and its deployment (issue #331) provide a D1-backed database, but ADW phases do not yet POST cost records to it. A client module is needed to bridge ADW's `PhaseCostRecord` format to the Worker's ingest payload, and the phase cost commit logic must be extended to dual-write to both D1 and CSV.

## Solution Statement
Create a new `adws/cost/d1Client.ts` module that:
1. Accepts `PhaseCostRecord[]`, a project slug, and optional project metadata (name, repo URL)
2. Transforms camelCase `PhaseCostRecord` fields to the snake_case `IngestPayload` format expected by the Worker
3. POSTs the payload to `COST_API_URL/api/cost` with a `Bearer COST_API_TOKEN` auth header
4. Returns silently (no error, no warning) when `COST_API_URL` is not set
5. Catches all errors and logs a warning without throwing, so D1 failures never crash the workflow

Then wire this into `adws/phases/phaseCostCommit.ts` so that `commitPhaseCostData` calls the D1 client alongside the existing CSV write path.

## Relevant Files
Use these files to implement the feature:

- `adws/cost/types.ts` — Contains `PhaseCostRecord` interface and `TokenUsageMap` type that will be transformed to the ingest payload
- `adws/cost/index.ts` — Barrel exports for the cost module; new D1 client exports will be added here
- `adws/phases/phaseCostCommit.ts` — Phase cost commit logic where dual-write will be wired (calls CSV write + D1 write)
- `adws/core/environment.ts` — Environment variable accessors; `COST_API_URL` and `COST_API_TOKEN` will be added here
- `adws/core/config.ts` — Re-exports from environment.ts for backward compatibility; new env vars re-exported here
- `adws/core/index.ts` — Core barrel exports; new env vars re-exported here
- `workers/cost-api/src/types.ts` — `IngestRecord` and `IngestPayload` interfaces defining the Worker's expected payload shape (reference only, not modified)
- `specs/prd/d1-cost-database.md` — PRD with ingest payload specification and D1 schema
- `app_docs/feature-viahyb-cost-api-worker-d1-s-cost-api-worker.md` — Documentation for the Cost API Worker
- `.env.sample` — Environment variable template; `COST_API_URL` and `COST_API_TOKEN` will be added
- `guidelines/coding_guidelines.md` — Coding guidelines to follow

### New Files
- `adws/cost/d1Client.ts` — D1 HTTP client module with `postCostRecordsToD1` function and `transformToIngestPayload` helper

## Implementation Plan
### Phase 1: Foundation
Add `COST_API_URL` and `COST_API_TOKEN` environment variable accessors to `adws/core/environment.ts` and re-export them through the barrel chain (`config.ts` -> `core/index.ts`). Add these variables to `.env.sample` with documentation.

### Phase 2: Core Implementation
Create `adws/cost/d1Client.ts` with:
- A `transformToIngestPayload` function that converts `PhaseCostRecord[]` plus project metadata into the Worker's `IngestPayload` shape (camelCase to snake_case mapping)
- A `postCostRecordsToD1` function that:
  - Returns immediately (no log, no error) when `COST_API_URL` is not set
  - Constructs the payload using `transformToIngestPayload`
  - POSTs to `${COST_API_URL}/api/cost` with `Authorization: Bearer ${COST_API_TOKEN}` header
  - Catches all errors and logs a warning via the existing `log()` utility
  - Never throws

Export the public function from `adws/cost/index.ts`.

### Phase 3: Integration
Wire `postCostRecordsToD1` into `adws/phases/phaseCostCommit.ts` so it runs alongside the existing CSV write in `commitPhaseCostData`. The D1 write is fire-and-forget — it runs concurrently with the CSV path but its failure does not affect the CSV write. The project slug is derived from `repoName` (already available in `PhaseCostCommitOptions`). The repo URL is derived from `GITHUB_REPO_URL` env var (already available in process.env).

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1: Add environment variable accessors
- In `adws/core/environment.ts`, add two new exported constants:
  - `COST_API_URL`: reads `process.env.COST_API_URL`, defaults to empty string `''`
  - `COST_API_TOKEN`: reads `process.env.COST_API_TOKEN`, defaults to empty string `''`
- In `adws/core/config.ts`, re-export `COST_API_URL` and `COST_API_TOKEN` from `environment.ts`
- In `adws/core/index.ts`, verify these are re-exported through the barrel (check if `config.ts` is already re-exported from index)

### Step 2: Add env vars to `.env.sample`
- Add `COST_API_URL` and `COST_API_TOKEN` to `.env.sample` in a new "Cost API" section, commented out with descriptive comments matching the existing style:
  ```
  # Cost API Configuration (required only for D1 cost database writes)
  # COST_API_URL="https://costs.paysdoc.nl"
  # COST_API_TOKEN="your-cost-api-bearer-token"
  ```

### Step 3: Create the D1 client module
- Create `adws/cost/d1Client.ts` with the following:
  - Import `COST_API_URL` and `COST_API_TOKEN` from `../core/environment`
  - Import `log` from `../core`
  - Import `PhaseCostRecord` type from `./types`
  - Define an `IngestPayloadOptions` interface with fields: `project` (string), `name` (optional string), `repoUrl` (optional string), `records` (readonly PhaseCostRecord[])
  - Implement `transformToIngestPayload(options: IngestPayloadOptions)` that maps each `PhaseCostRecord` to the Worker's snake_case `IngestRecord` shape:
    - `workflowId` -> `workflow_id`
    - `issueNumber` -> `issue_number`
    - `phase` -> `phase` (unchanged)
    - `model` -> `model` (unchanged)
    - `provider` -> `provider` (unchanged)
    - `tokenUsage` -> `token_usage` (already a `Record<string, number>` so pass through directly)
    - `computedCostUsd` -> `computed_cost_usd`
    - `reportedCostUsd` -> `reported_cost_usd`
    - `status` -> `status`
    - `retryCount` -> `retry_count`
    - `contextResetCount` -> `continuation_count`
    - `durationMs` -> `duration_ms`
    - `timestamp` -> `timestamp` (unchanged)
  - Return the full payload object: `{ project, name, repo_url, records }`
  - Implement `postCostRecordsToD1(options: IngestPayloadOptions): Promise<void>` that:
    - Returns immediately if `COST_API_URL` is falsy (no log, no error)
    - Calls `transformToIngestPayload` to build the payload
    - Calls `fetch` with `POST` method, `Content-Type: application/json`, `Authorization: Bearer ${COST_API_TOKEN}`, and JSON-stringified body
    - On non-2xx response, logs a warning with the status and response body
    - On any error (network, JSON parse, etc.), catches and logs a warning
    - Never throws

### Step 4: Export D1 client from cost barrel
- In `adws/cost/index.ts`, add export for `postCostRecordsToD1` from `./d1Client.ts`

### Step 5: Wire D1 client into phase cost commit logic
- In `adws/phases/phaseCostCommit.ts`:
  - Import `postCostRecordsToD1` from `../cost/d1Client`
  - In the `commitPhaseCostData` function, after the existing CSV write logic (inside the try block), add a call to `postCostRecordsToD1` with:
    - `project`: use the `repoName` parameter (already available)
    - `repoUrl`: use `process.env.GITHUB_REPO_URL` (optional, may be undefined)
    - `records`: use the `newRecords` parameter
  - The D1 call should be fire-and-forget: use `postCostRecordsToD1(...).catch(() => {})` or place it within its own try-catch so CSV commit is not affected by D1 failures
  - Do NOT await the D1 call in a way that blocks the CSV write path. Both can run concurrently

### Step 6: Update README.md env var documentation
- In `README.md`, add `COST_API_URL` and `COST_API_TOKEN` to the environment variables list with appropriate descriptions, following the existing format:
  - `COST_API_URL` - (Optional) Cost API Worker URL for D1 cost database writes (e.g., `https://costs.paysdoc.nl`)
  - `COST_API_TOKEN` - (Optional) Bearer token for Cost API authentication

### Step 7: Run validation commands
- Run linter, type check, and build to validate the implementation has zero regressions

## Testing Strategy
### Edge Cases
- `COST_API_URL` is not set: D1 write is silently skipped, CSV write proceeds normally
- `COST_API_URL` is set but `COST_API_TOKEN` is empty: fetch proceeds with empty bearer token, Worker returns 401, warning is logged, workflow continues
- `COST_API_URL` is set but unreachable (network error): fetch throws, warning is logged, workflow continues
- Worker returns 400 (malformed payload): warning is logged with response details, workflow continues
- Worker returns 500 (D1 error): warning is logged, workflow continues
- Empty `newRecords` array: `postCostRecordsToD1` should return early (no HTTP request made)
- `PhaseCostRecord` with `reportedCostUsd: undefined`: mapped to omitted field in payload (Worker defaults to null)
- `PhaseCostRecord` with `contextResetCount` maps to `continuation_count` in payload
- `tokenUsage` map with zero-count entries: passed through to Worker (Worker handles correctly)

## Acceptance Criteria
- [ ] New `adws/cost/d1Client.ts` module exists with `postCostRecordsToD1` as the public interface
- [ ] `PhaseCostRecord` -> ingest payload transformation correctly maps camelCase to snake_case, including `tokenUsage` -> `token_usage` passthrough
- [ ] `Authorization: Bearer <token>` header is set from `COST_API_TOKEN` env var
- [ ] D1 writes are silently skipped when `COST_API_URL` is not set (no errors, no warnings, no HTTP requests)
- [ ] D1 write failures (network errors, non-2xx responses) log a warning but do not crash the workflow
- [ ] `commitPhaseCostData` in `phaseCostCommit.ts` calls the D1 client alongside existing CSV writes
- [ ] CSV write path is not blocked or affected by D1 write failures
- [ ] `COST_API_URL` and `COST_API_TOKEN` added to `.env.sample` and `README.md`
- [ ] `bun run lint`, `bunx tsc --noEmit`, and `bunx tsc --noEmit -p adws/tsconfig.json` pass with zero errors

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Root-level type check
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific type check
- `bun run build` — Build the application to verify no build errors

## Notes
- **Unit tests are disabled** per `.adw/project.md` (`## Unit Tests: disabled`). No unit test tasks are included.
- The `contextResetCount` field on `PhaseCostRecord` maps to `continuation_count` in the Worker's `IngestRecord`. This naming difference is intentional — the PRD uses `continuation_count` for the D1 schema, while ADW internally tracks this as `contextResetCount` (build phase context resets).
- The `tokenUsage` field on `PhaseCostRecord` is already a `Record<string, number>` with snake_case keys (`input`, `output`, `cache_read`, `cache_write`), so it passes through directly to `token_usage` in the ingest payload without any key transformation.
- The `issueDescription` field is not present on `PhaseCostRecord`. The Worker's `IngestRecord` supports it as an optional field (`issue_description`), but we omit it in this implementation. It can be added later if needed.
- This is **PR 2 of the 3-PR staged rollout** defined in the PRD. PR 1 (Worker + D1 schema, #330) and deployment (#331) are prerequisites. PR 3 will remove the CSV pipeline entirely.
- Follow `guidelines/coding_guidelines.md`: use `readonly` on interface fields, prefer pure functions, keep files under 300 lines, use meaningful error messages.
