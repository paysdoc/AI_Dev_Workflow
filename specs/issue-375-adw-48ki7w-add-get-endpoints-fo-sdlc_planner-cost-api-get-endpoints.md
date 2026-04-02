# Feature: Add GET endpoints for cost data (projects, breakdown, issues)

## Metadata
issueNumber: `375`
adwId: `48ki7w-add-get-endpoints-fo`
issueJson: `{"number":375,"title":"Add GET endpoints for cost data (projects, breakdown, issues)","body":"## Context\n\nThe paysdoc.nl marketing site currently queries cost data directly from a local D1 database. This data is owned by the cost-api worker (`workers/cost-api/`). The marketing site needs to consume cost data via HTTP from this worker instead.\n\n## Requirements\n\nImplement three authenticated GET endpoints on the cost-api worker:\n\n### `GET /api/projects`\n\nReturns all projects, sorted by name ASC.\n\n```json\n[\n  { \"id\": 1, \"slug\": \"paysdoc-nl\", \"name\": \"paysdoc.nl\", \"repoUrl\": \"https://github.com/paysdoc/paysdoc.nl\" }\n]\n```\n\n### `GET /api/projects/:id/costs/breakdown`\n\nReturns cost aggregated by model and provider for a given project, sorted by totalCost DESC.\n\n```json\n[\n  { \"model\": \"claude-sonnet-4-20250514\", \"provider\": \"anthropic\", \"totalCost\": 12.50 },\n  { \"model\": \"gpt-4o\", \"provider\": \"openai\", \"totalCost\": 3.20 }\n]\n```\n\n### `GET /api/projects/:id/costs/issues`\n\nReturns per-issue cost with per-phase token usage breakdown, sorted by issueNumber ASC, phases in workflow lifecycle order (plan → build → test → review → document).\n\n```json\n[\n  {\n    \"issueNumber\": 6,\n    \"totalCost\": 8.40,\n    \"phases\": [\n      {\n        \"phase\": \"plan\",\n        \"cost\": 2.10,\n        \"tokenUsage\": [\n          { \"tokenType\": \"input\", \"count\": 30000 },\n          { \"tokenType\": \"output\", \"count\": 1200 }\n        ]\n      },\n      {\n        \"phase\": \"build\",\n        \"cost\": 6.30,\n        \"tokenUsage\": [\n          { \"tokenType\": \"input\", \"count\": 22000 },\n          { \"tokenType\": \"output\", \"count\": 1900 }\n        ]\n      }\n    ]\n  }\n]\n```\n\n## Design decisions\n\n| # | Decision | Resolution |\n|---|----------|------------|\n| 1 | Auth secret | Reuse existing `COST_API_TOKEN` |\n| 2 | Nullability | API reflects DB reality — `issueNumber`, `model`, `provider` are never null |\n| 3 | Token aggregation | Per issue, per phase (not per model) |\n| 4 | Cost column | `COALESCE(reported_cost_usd, computed_cost_usd)` everywhere |\n| 5 | CORS | Enabled on all routes; custom middleware reading `ALLOWED_ORIGINS` from env |\n| 6 | CORS origins | Configurable `ALLOWED_ORIGINS` env var (comma-separated), defaults to `https://paysdoc.nl` |\n| 7 | Response casing | camelCase in API responses, mapped from snake_case DB columns |\n| 8 | Pagination | None |\n| 9 | Invalid project ID | Return `404 { \"error\": \"Project not found\" }` |\n| 10 | Route prefix | All endpoints under `/api` |\n| 11 | Router | `itty-router` |\n| 12 | Handler structure | Single `src/queries.ts` for all three read handlers |\n| 13 | Tests | Integration tests with local D1 via `@cloudflare/vitest-pool-workers`, same approach as existing ingest tests |\n| 14 | Sort orders | Projects by name ASC, breakdown by totalCost DESC, issues by issueNumber ASC, phases in lifecycle order |\n\n## Env changes\n\n- Add optional `ALLOWED_ORIGINS` to `Env` type (string, comma-separated origins)\n- Add `ALLOWED_ORIGINS` to `wrangler.toml` comments as a documented secret\n\n## Implementation notes\n\n- The `Env` type in `src/types.ts` needs `ALLOWED_ORIGINS?: string`\n- CORS middleware wraps all routes, reads origins from env at request time\n- Phase sort uses a fixed ordering constant: `['plan', 'build', 'test', 'review', 'document']`\n- `itty-router` handles path param extraction for `:id`\n- Existing `POST /api/cost` endpoint must continue working unchanged","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-02T14:08:58Z","comments":[],"actionableComment":null}`

## Feature Description
Add three authenticated GET endpoints to the cost-api Cloudflare Worker so the paysdoc.nl marketing site can consume cost data via HTTP instead of querying D1 directly. The endpoints expose project listings, per-project cost breakdowns by model/provider, and per-issue cost with phase-level token usage. All routes require bearer token auth (existing `COST_API_TOKEN`), return camelCase JSON, and include CORS headers for cross-origin consumption.

## User Story
As the paysdoc.nl marketing site
I want to fetch cost data from authenticated HTTP endpoints on the cost-api worker
So that I can display project costs, model breakdowns, and per-issue spending without direct D1 access

## Problem Statement
The marketing site currently queries cost data directly from a local D1 database. This couples the frontend to the database and bypasses the cost-api worker that owns this data. The worker only exposes a POST ingest endpoint today — there are no read endpoints.

## Solution Statement
Add three GET endpoints (`/api/projects`, `/api/projects/:id/costs/breakdown`, `/api/projects/:id/costs/issues`) to the existing cost-api worker. Introduce `itty-router` for path-param extraction and route matching, add CORS middleware with configurable origins, and create a `src/queries.ts` module containing all three read handlers. The existing `POST /api/cost` ingest endpoint continues working unchanged.

## Relevant Files
Use these files to implement the feature:

- `workers/cost-api/src/index.ts` — Worker entry point; will be refactored from manual routing to use `itty-router`, registering existing POST and new GET routes
- `workers/cost-api/src/types.ts` — `Env` interface; needs `ALLOWED_ORIGINS?: string` added
- `workers/cost-api/src/auth.ts` — Bearer token auth; unchanged but imported by the new router setup
- `workers/cost-api/src/ingest.ts` — Existing POST handler; unchanged, re-registered on the router
- `workers/cost-api/src/schema.sql` — DB schema reference for writing queries (read-only reference)
- `workers/cost-api/src/migrations/0001_initial.sql` — Migration reference (read-only reference)
- `workers/cost-api/wrangler.toml` — Worker config; add `ALLOWED_ORIGINS` to documented secrets comment
- `workers/cost-api/package.json` — Add `itty-router` dependency
- `workers/cost-api/vitest.config.ts` — Test config; add `ALLOWED_ORIGINS` binding for tests
- `workers/cost-api/test/ingest.test.ts` — Existing test file; reference for test patterns and helpers
- `guidelines/coding_guidelines.md` — Coding standards to follow

### New Files
- `workers/cost-api/src/queries.ts` — Three GET handler functions: `handleGetProjects`, `handleGetCostBreakdown`, `handleGetCostIssues`
- `workers/cost-api/src/cors.ts` — CORS middleware function reading `ALLOWED_ORIGINS` from env
- `workers/cost-api/test/queries.test.ts` — Integration tests for all three GET endpoints
- `workers/cost-api/test/cors.test.ts` — Integration tests for CORS behaviour

## Implementation Plan
### Phase 1: Foundation
Install `itty-router` as a dependency. Add `ALLOWED_ORIGINS?: string` to the `Env` interface. Create the CORS middleware that reads allowed origins from env (defaulting to `https://paysdoc.nl`) and attaches `Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, and `Access-Control-Allow-Headers` headers. Handle `OPTIONS` preflight requests.

### Phase 2: Core Implementation
Create `src/queries.ts` with three handler functions:
1. **`handleGetProjects`** — Queries all rows from `projects` ordered by `name ASC`, maps to camelCase response.
2. **`handleGetCostBreakdown`** — Validates project exists (404 if not), queries `cost_records` grouped by `model` and `provider` with `SUM(COALESCE(reported_cost_usd, computed_cost_usd))` as `totalCost`, ordered by `totalCost DESC`.
3. **`handleGetCostIssues`** — Validates project exists (404 if not), queries cost records joined with token_usage, aggregated per issue per phase. Sorts issues by `issue_number ASC`, phases in lifecycle order (`plan → build → test → review → document`). Returns nested JSON with `phases[].tokenUsage[]`.

### Phase 3: Integration
Refactor `src/index.ts` to use `itty-router`: register the existing POST route, the three new GET routes, and wrap all routes with auth and CORS middleware. Add `ALLOWED_ORIGINS` to `vitest.config.ts` test bindings and `wrangler.toml` documented secrets. Write comprehensive integration tests following the existing `test/ingest.test.ts` patterns.

## Step by Step Tasks

### Step 1: Install `itty-router` dependency
- Run `cd workers/cost-api && bun add itty-router` to add the router library
- Verify it appears in `package.json` dependencies

### Step 2: Update `Env` type and `wrangler.toml`
- In `workers/cost-api/src/types.ts`, add `readonly ALLOWED_ORIGINS?: string;` to the `Env` interface
- In `workers/cost-api/wrangler.toml`, add `#   ALLOWED_ORIGINS` to the documented secrets comment block

### Step 3: Create CORS middleware (`src/cors.ts`)
- Create `workers/cost-api/src/cors.ts`
- Export a `corsHeaders(request: Request, env: Env): HeadersInit` function that:
  - Reads `ALLOWED_ORIGINS` from env (comma-separated string), defaults to `https://paysdoc.nl`
  - Checks request `Origin` header against the allowed list
  - Returns appropriate CORS headers (`Access-Control-Allow-Origin`, `Access-Control-Allow-Methods: GET, POST, OPTIONS`, `Access-Control-Allow-Headers: Authorization, Content-Type`)
- Export a `handleOptions(request: Request, env: Env): Response` function for preflight requests
- Export a `withCors(response: Response, request: Request, env: Env): Response` helper that clones a response with CORS headers added

### Step 4: Create query handlers (`src/queries.ts`)
- Create `workers/cost-api/src/queries.ts`
- Define `PHASE_ORDER` constant: `['plan', 'build', 'test', 'review', 'document']`
- Implement `handleGetProjects(env: Env): Promise<Response>`:
  - Query: `SELECT id, slug, name, repo_url FROM projects ORDER BY name ASC`
  - Map rows to camelCase: `{ id, slug, name, repoUrl }`
  - Return `Response.json(mapped)`
- Implement `handleGetCostBreakdown(projectId: string, env: Env): Promise<Response>`:
  - Parse `projectId` as integer; return 404 if NaN
  - Check project exists: `SELECT id FROM projects WHERE id = ?`; return 404 `{ "error": "Project not found" }` if not
  - Query: `SELECT model, provider, SUM(COALESCE(reported_cost_usd, computed_cost_usd)) AS total_cost FROM cost_records WHERE project_id = ? GROUP BY model, provider ORDER BY total_cost DESC`
  - Map rows to camelCase: `{ model, provider, totalCost }`
  - Return `Response.json(mapped)`
- Implement `handleGetCostIssues(projectId: string, env: Env): Promise<Response>`:
  - Parse `projectId` as integer; return 404 if NaN
  - Check project exists; return 404 if not
  - Query cost records: `SELECT issue_number, phase, COALESCE(reported_cost_usd, computed_cost_usd) AS cost FROM cost_records WHERE project_id = ? ORDER BY issue_number ASC`
  - For each cost record, query token usage: `SELECT tu.token_type, SUM(tu.count) AS count FROM token_usage tu JOIN cost_records cr ON tu.cost_record_id = cr.id WHERE cr.project_id = ? AND cr.issue_number = ? AND cr.phase = ? GROUP BY tu.token_type`
  - Or use a single efficient query joining cost_records and token_usage, then aggregate in code
  - Group by issue_number, then by phase; sum costs per phase; sort phases by `PHASE_ORDER`
  - Map to camelCase nested structure: `{ issueNumber, totalCost, phases: [{ phase, cost, tokenUsage: [{ tokenType, count }] }] }`
  - Return `Response.json(mapped)`

### Step 5: Refactor `src/index.ts` to use `itty-router`
- Import `AutoRouter` or `Router` from `itty-router`
- Import `authenticate` from `./auth.ts`
- Import `handleIngest` from `./ingest.ts`
- Import the three query handlers from `./queries.ts`
- Import CORS helpers from `./cors.ts`
- Set up the router with routes:
  - `OPTIONS *` → preflight handler
  - `POST /api/cost` → auth check → `handleIngest`
  - `GET /api/projects` → auth check → `handleGetProjects`
  - `GET /api/projects/:id/costs/breakdown` → auth check → `handleGetCostBreakdown`
  - `GET /api/projects/:id/costs/issues` → auth check → `handleGetCostIssues`
  - `ALL *` → 404 fallback
- Wrap all non-OPTIONS responses with CORS headers using `withCors`
- Ensure existing POST `/api/cost` behaviour is preserved (same auth, same response codes)

### Step 6: Update `vitest.config.ts` for test bindings
- Add `ALLOWED_ORIGINS: 'http://localhost'` to the `miniflare.bindings` object so tests can exercise CORS logic

### Step 7: Write integration tests for CORS (`test/cors.test.ts`)
- Follow patterns from `test/ingest.test.ts` (same imports, `applySchema`, `beforeEach`)
- Test CORS headers present on GET responses
- Test `OPTIONS` preflight returns correct headers and 204
- Test disallowed origin does not get `Access-Control-Allow-Origin`
- Test CORS headers present on POST responses (regression)

### Step 8: Write integration tests for GET endpoints (`test/queries.test.ts`)
- Follow patterns from `test/ingest.test.ts`
- Create a shared helper that seeds project + cost_records + token_usage via direct D1 inserts (not via the POST endpoint) for deterministic test data
- **GET /api/projects tests:**
  - Returns empty array when no projects exist
  - Returns projects sorted by name ASC
  - Response uses camelCase keys (`repoUrl` not `repo_url`)
  - Requires auth (401 without token)
- **GET /api/projects/:id/costs/breakdown tests:**
  - Returns 404 for non-existent project ID
  - Returns 404 for non-numeric project ID
  - Returns breakdown grouped by model+provider, sorted by totalCost DESC
  - Uses `COALESCE(reported_cost_usd, computed_cost_usd)` — prefers reported when present
  - Returns empty array for project with no cost records
- **GET /api/projects/:id/costs/issues tests:**
  - Returns 404 for non-existent project ID
  - Returns issues sorted by issueNumber ASC
  - Phases sorted in lifecycle order (plan, build, test, review, document)
  - Token usage aggregated per phase correctly
  - `totalCost` is sum of all phase costs for the issue
  - Returns empty array for project with no cost records

### Step 9: Run validation commands
- Run all validation commands listed below to verify zero regressions and full correctness

## Testing Strategy
### Unit Tests
Unit tests are enabled for this project. However, all tests for this feature are integration tests using `@cloudflare/vitest-pool-workers` with local D1 (same approach as existing `test/ingest.test.ts`). This is appropriate because the handlers are thin layers over D1 queries — mocking D1 would defeat the purpose. The integration tests cover:
- Auth enforcement on all new routes
- CORS header presence and correctness
- SQL query correctness (sorting, aggregation, COALESCE)
- camelCase response mapping
- 404 handling for invalid/missing project IDs
- Empty state responses

### Edge Cases
- Project with no cost records returns empty arrays for breakdown and issues endpoints
- Non-numeric project ID in URL returns 404
- Project ID that doesn't exist returns 404 with `{ "error": "Project not found" }`
- `COALESCE` picks `reported_cost_usd` when non-null, falls back to `computed_cost_usd`
- Phases not in the standard lifecycle order (e.g. custom phases) sort after the known phases
- Multiple cost records for same issue+phase aggregate correctly
- `ALLOWED_ORIGINS` not set defaults to `https://paysdoc.nl`
- Request from disallowed origin receives no `Access-Control-Allow-Origin` header
- OPTIONS preflight request is handled without auth

## Acceptance Criteria
- `GET /api/projects` returns all projects sorted by name ASC with camelCase keys
- `GET /api/projects/:id/costs/breakdown` returns model/provider aggregates sorted by totalCost DESC
- `GET /api/projects/:id/costs/issues` returns per-issue costs with phase-ordered token breakdowns
- All three endpoints require bearer token auth (401 without it)
- Invalid or missing project IDs return `404 { "error": "Project not found" }`
- CORS headers are present on all responses with configurable `ALLOWED_ORIGINS`
- OPTIONS preflight requests return 204 with correct CORS headers (no auth required)
- Existing `POST /api/cost` endpoint continues working unchanged
- All integration tests pass with zero regressions
- Cost values use `COALESCE(reported_cost_usd, computed_cost_usd)`

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `cd workers/cost-api && bun install` — Install dependencies including new `itty-router`
- `cd workers/cost-api && bunx tsc --noEmit` — Type-check all source and test files
- `cd workers/cost-api && bun run test` — Run all integration tests (existing ingest + new queries + CORS)

## Notes
- **New dependency**: `itty-router` must be installed via `cd workers/cost-api && bun add itty-router` before implementation begins
- The queries in `handleGetCostIssues` involve joining `cost_records` with `token_usage` and aggregating in two dimensions (per-issue and per-phase). Consider doing the aggregation in two queries or a single query with in-code grouping for clarity. A single query approach with `GROUP BY issue_number, phase, token_type` followed by code-level nesting is likely the cleanest approach.
- Phase ordering uses a fixed constant array. Phases not in the array (if any exist in the data) should be appended at the end in alphabetical order.
- The `itty-router` integration replaces the manual `if/else` routing in `index.ts`. The router's `fetch` export is compatible with the Cloudflare Workers `export default { fetch }` pattern.
