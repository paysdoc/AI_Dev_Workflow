# Feature: Cost API Worker — D1 schema, auth, and ingest endpoint

## Metadata
issueNumber: `330`
adwId: `viahyb-cost-api-worker-d1-s`
issueJson: `{"number":330,"title":"Cost API Worker: D1 schema, auth, and ingest endpoint","body":"## Parent PRD\n\n`specs/prd/d1-cost-database.md`\n\n## What to build\n\nA Cloudflare Worker at `workers/cost-api/` that accepts cost records via `POST /api/cost` and persists them to a D1 database (`adw-costs`).\n\nThis is the foundation slice: Worker scaffold, D1 schema, bearer token auth, and the ingest handler that resolves project slugs, auto-creates project rows, inserts cost records, and fans out token usage into a separate table.\n\n### Key details (see PRD for full spec):\n\n- **D1 schema**: 3 tables — `projects` (slug, name, repo_url, created_at), `cost_records` (project_id FK, workflow_id, issue_number, phase, model, provider, costs, status, retry/continuation counts, duration, timestamp, migrated flag), `token_usage` (cost_record_id FK, token_type, count)\n- **Auth**: Bearer token validated against `COST_API_TOKEN` Worker secret\n- **Ingest payload**: `{ project, name?, repo_url?, records: [...] }` — snake_case, with nested `token_usage` map per record\n- **Project auto-creation**: unknown slugs create a new project row; `name` defaults to slug if not provided\n- **Responses**: 201 `{ inserted: N }`, 401 unauthorized, 400 malformed, 500 D1 error\n- **EU jurisdiction**: D1 database created with `--jurisdiction eu`\n- **Wrangler config**: route `costs.paysdoc.nl/*`, D1 binding\n\n## Acceptance criteria\n\n- [ ] `workers/cost-api/` directory with `wrangler.toml`, `src/index.ts`, and D1 schema SQL\n- [ ] `POST /api/cost` inserts cost records and token_usage rows into D1\n- [ ] Unknown project slugs auto-create a project row (name defaults to slug)\n- [ ] Optional `name` and `repo_url` fields enrich auto-created project rows\n- [ ] Bearer token auth rejects missing/invalid tokens with 401\n- [ ] Malformed payloads return 400 with descriptive error\n- [ ] Batch inserts work (array of records in single request)\n- [ ] Vitest + Miniflare tests cover: successful insert, auth rejection, malformed payload, project auto-creation, token_usage fan-out, duplicate project slug resolution\n\n## Blocked by\n\nNone — can start immediately.\n\n## User stories addressed\n\n- User stories 2, 3, 4, 5, 6, 7, 8, 17, 19, 20, 21","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-27T09:06:59Z","comments":[],"actionableComment":null}`

## Feature Description
A Cloudflare Worker at `workers/cost-api/` that accepts cost records via `POST /api/cost` and persists them to a Cloudflare D1 database (`adw-costs`). This is the foundation slice of the D1 cost database initiative: Worker scaffold, D1 schema (3 tables: `projects`, `cost_records`, `token_usage`), bearer token auth against a Worker secret, and the ingest handler that resolves project slugs, auto-creates project rows, inserts cost records, and fans out token usage into a separate table. The Worker is routed at `costs.paysdoc.nl/*` and the D1 database uses EU jurisdiction for data residency compliance.

## User Story
As an ADW operator
I want a Worker API at costs.paysdoc.nl that accepts cost records via bearer-token-authenticated POST requests and persists them to a D1 database
So that cost data is stored centrally in a database instead of CSV files, enabling future querying and invoicing

## Problem Statement
ADW currently tracks per-phase, per-model cost data in CSV files committed to the git repository under `projects/`. This clutters the git log, creates merge conflicts, and provides no API for querying cost data. A centralized database-backed API is needed as the first step toward replacing the CSV pipeline.

## Solution Statement
Create a new Cloudflare Worker (`workers/cost-api/`) following the same repo layout pattern as `workers/screenshot-router/`. The Worker exposes a single `POST /api/cost` endpoint that validates a bearer token, parses an ingest payload containing a project slug and an array of cost records, resolves the project (auto-creating if unknown), and inserts cost records + token usage rows into D1 within a single transaction. The Worker is tested with Vitest + Miniflare for full request-to-D1 coverage.

## Relevant Files
Use these files to implement the feature:

- `specs/prd/d1-cost-database.md` — Parent PRD with full D1 schema, payload format, and response specs
- `workers/screenshot-router/` — Existing Worker pattern to follow (wrangler.toml, package.json, tsconfig.json, src/index.ts structure)
- `workers/screenshot-router/wrangler.toml` — Template for wrangler config (routes, bindings)
- `workers/screenshot-router/package.json` — Template for Worker package.json (devDependencies pattern)
- `workers/screenshot-router/tsconfig.json` — Template for Worker tsconfig
- `.github/workflows/deploy-workers.yml` — Existing deploy workflow (auto-discovers workers by `wrangler.toml`, no changes needed)
- `adws/cost/types.ts` — Existing `PhaseCostRecord`, `TokenUsageMap`, `PhaseCostStatus` types for reference on field naming
- `guidelines/coding_guidelines.md` — Coding guidelines to follow

### New Files
- `workers/cost-api/wrangler.toml` — Wrangler config with D1 binding and route
- `workers/cost-api/package.json` — Worker package dependencies (wrangler, @cloudflare/workers-types, vitest, miniflare)
- `workers/cost-api/tsconfig.json` — TypeScript config for the Worker
- `workers/cost-api/src/index.ts` — Worker entry point with fetch handler
- `workers/cost-api/src/auth.ts` — Bearer token authentication middleware
- `workers/cost-api/src/ingest.ts` — Ingest handler: payload validation, project resolution, D1 inserts
- `workers/cost-api/src/types.ts` — Env interface, ingest payload types, response types
- `workers/cost-api/src/schema.sql` — D1 schema DDL (3 tables: projects, cost_records, token_usage)
- `workers/cost-api/test/ingest.test.ts` — Vitest + Miniflare tests for the ingest endpoint

## Implementation Plan
### Phase 1: Foundation
Set up the Worker scaffold following the `workers/screenshot-router/` pattern. Create the directory structure, `wrangler.toml` with D1 binding and route config, `package.json` with dev dependencies (wrangler, @cloudflare/workers-types, vitest, miniflare), and `tsconfig.json`. Write the D1 schema SQL defining the three tables (`projects`, `cost_records`, `token_usage`) with proper constraints and indexes.

### Phase 2: Core Implementation
Implement the Worker entry point (`src/index.ts`) with method routing. Build the auth module (`src/auth.ts`) that extracts and validates the bearer token from the `Authorization` header against the `COST_API_TOKEN` secret. Build the ingest handler (`src/ingest.ts`) that validates the payload shape, resolves the project slug (SELECT or INSERT), and batch-inserts cost records and token usage rows within a D1 transaction. Define TypeScript types for the `Env` bindings, ingest payload, and response shapes.

### Phase 3: Integration
Write Vitest + Miniflare tests covering: successful batch insert (201), auth rejection (401), malformed payload (400), project auto-creation with and without optional fields, token usage fan-out, and duplicate project slug resolution. Verify the Worker builds and deploys cleanly via the existing GitHub Actions workflow (auto-discovered by `wrangler.toml`).

## Step by Step Tasks

### Step 1: Create Worker directory scaffold
- Create `workers/cost-api/` directory
- Create `workers/cost-api/package.json` following the `screenshot-router` pattern, adding vitest and miniflare as devDependencies
- Create `workers/cost-api/tsconfig.json` matching the screenshot-router config
- Create `workers/cost-api/wrangler.toml` with:
  - `name = "cost-api"`
  - `main = "src/index.ts"`
  - `compatibility_date` matching screenshot-router
  - Route: `costs.paysdoc.nl/*` on zone `paysdoc.nl`
  - D1 binding: `binding = "DB"`, `database_name = "adw-costs"`, `database_id` placeholder

### Step 2: Write D1 schema SQL
- Create `workers/cost-api/src/schema.sql` with:
  - `projects` table: `id` INTEGER PK AUTOINCREMENT, `slug` TEXT NOT NULL UNIQUE, `name` TEXT NOT NULL, `repo_url` TEXT, `created_at` TEXT NOT NULL
  - `cost_records` table: `id` INTEGER PK AUTOINCREMENT, `project_id` INTEGER NOT NULL FK → projects(id), `workflow_id` TEXT, `issue_number` INTEGER NOT NULL, `issue_description` TEXT, `phase` TEXT NOT NULL, `model` TEXT NOT NULL, `provider` TEXT NOT NULL DEFAULT 'anthropic', `computed_cost_usd` REAL NOT NULL, `reported_cost_usd` REAL, `status` TEXT, `retry_count` INTEGER DEFAULT 0, `continuation_count` INTEGER DEFAULT 0, `duration_ms` INTEGER, `timestamp` TEXT, `migrated` BOOLEAN DEFAULT FALSE
  - `token_usage` table: `id` INTEGER PK AUTOINCREMENT, `cost_record_id` INTEGER NOT NULL FK → cost_records(id), `token_type` TEXT NOT NULL, `count` INTEGER NOT NULL
  - Add index on `cost_records(project_id)` and `cost_records(workflow_id)` for query performance
  - Add index on `token_usage(cost_record_id)` for join performance

### Step 3: Define TypeScript types
- Create `workers/cost-api/src/types.ts` with:
  - `Env` interface with `DB: D1Database` and `COST_API_TOKEN: string`
  - `IngestRecord` interface matching the record shape from the PRD payload
  - `IngestPayload` interface: `project` string, optional `name`, optional `repo_url`, `records` array of `IngestRecord`
  - Response type interfaces for success (201) and error (400/401/500) responses

### Step 4: Implement bearer token auth
- Create `workers/cost-api/src/auth.ts`
- Export a function `authenticate(request: Request, env: Env): boolean` that:
  - Extracts the `Authorization` header
  - Checks for `Bearer <token>` format
  - Compares the token against `env.COST_API_TOKEN` using timing-safe comparison
  - Returns true if valid, false otherwise

### Step 5: Implement ingest handler
- Create `workers/cost-api/src/ingest.ts`
- Export an async function `handleIngest(request: Request, env: Env): Promise<Response>` that:
  - Parses the JSON body and validates required fields (`project`, `records` array with at least one record)
  - Validates each record has required fields (`issue_number`, `phase`, `model`, `computed_cost_usd`, `token_usage`)
  - Resolves the project: SELECT by slug, or INSERT if not found (using `name` defaulting to slug, and optional `repo_url`)
  - Uses a D1 batch to insert all cost records and their token usage rows
  - For each record: INSERT into `cost_records` with the resolved `project_id`, then INSERT each `token_usage` entry keyed to the cost record
  - Returns `201 { "inserted": N }` on success
  - Returns `400 { "error": "<description>" }` on validation failure
  - Wraps D1 operations in try/catch, returning `500 { "error": "<description>" }` on D1 errors

### Step 6: Implement Worker entry point
- Create `workers/cost-api/src/index.ts`
- Export default Worker with `fetch` handler that:
  - Checks auth first — returns `401 { "error": "Unauthorized" }` if invalid
  - Routes `POST /api/cost` to the ingest handler
  - Returns `404` for all other routes
  - Returns `405` for non-POST methods on `/api/cost`

### Step 7: Install dependencies and verify build
- Run `cd workers/cost-api && npm install` to install dependencies
- Run `cd workers/cost-api && npx tsc --noEmit` to verify TypeScript compiles without errors

### Step 8: Write Vitest + Miniflare tests
- Create `workers/cost-api/vitest.config.ts` configured for Miniflare/Workers environment
- Create `workers/cost-api/test/ingest.test.ts` with tests covering:
  - **Successful insert**: POST valid payload → 201 with correct `inserted` count, verify D1 rows via SELECT
  - **Auth rejection — missing token**: no Authorization header → 401
  - **Auth rejection — invalid token**: wrong bearer token → 401
  - **Malformed payload — missing project**: → 400 with descriptive error
  - **Malformed payload — empty records**: → 400 with descriptive error
  - **Malformed payload — missing required record fields**: → 400 with descriptive error
  - **Project auto-creation**: new slug auto-creates project row, name defaults to slug
  - **Project auto-creation with optional fields**: `name` and `repo_url` populate the project row
  - **Duplicate project slug resolution**: two requests with same slug use the same project_id
  - **Token usage fan-out**: verify each token type in the record creates a separate `token_usage` row
  - **Batch insert**: multiple records in single request all inserted correctly

### Step 9: Run tests and validate
- Run `cd workers/cost-api && npx vitest run` to execute all tests
- Run `cd workers/cost-api && npx tsc --noEmit` to verify type safety
- Run `bun run lint` from project root to check code quality
- Run `bun run build` from project root to verify no build errors

## Testing Strategy
### Edge Cases
- Empty `records` array → 400
- Record with empty `token_usage` map (no token types) → should still insert the cost record, just no token_usage rows
- Very large batch (hundreds of records) → should complete within D1 limits
- Missing optional fields (`workflow_id`, `issue_description`, `reported_cost_usd`, `status`, `retry_count`, `continuation_count`, `duration_ms`, `timestamp`) → should default to null/0 as per schema
- Concurrent requests with the same new project slug → both should resolve to the same project row (INSERT OR IGNORE + SELECT pattern)
- Non-JSON body → 400
- JSON body that's not an object (e.g. array, string) → 400
- `POST /api/cost` with correct auth but wrong HTTP method (GET, PUT, DELETE) → 405
- Unknown routes → 404
- `provider` field defaults to `'anthropic'` when omitted

## Acceptance Criteria
- [ ] `workers/cost-api/` directory exists with `wrangler.toml`, `src/index.ts`, and D1 schema SQL
- [ ] `POST /api/cost` inserts cost records and token_usage rows into D1
- [ ] Unknown project slugs auto-create a project row (name defaults to slug)
- [ ] Optional `name` and `repo_url` fields enrich auto-created project rows
- [ ] Bearer token auth rejects missing/invalid tokens with 401
- [ ] Malformed payloads return 400 with descriptive error
- [ ] Batch inserts work (array of records in single request)
- [ ] Vitest + Miniflare tests pass covering: successful insert, auth rejection, malformed payload, project auto-creation, token_usage fan-out, duplicate project slug resolution
- [ ] TypeScript compiles with no errors
- [ ] Code follows existing Worker patterns (screenshot-router) and coding guidelines
- [ ] GitHub Actions deploy workflow auto-discovers the new Worker (no workflow changes needed)

## Validation Commands

```bash
# Install Worker dependencies
cd workers/cost-api && npm install

# Type-check the Worker
cd workers/cost-api && npx tsc --noEmit

# Run Vitest + Miniflare tests
cd workers/cost-api && npx vitest run

# Lint from project root
bun run lint

# Build from project root
bun run build
```

## Notes
- The Worker follows the same repo layout as `workers/screenshot-router/` — own `package.json`, `wrangler.toml`, and `tsconfig.json`.
- The existing `.github/workflows/deploy-workers.yml` auto-discovers all Workers by finding `wrangler.toml` files under `workers/`, so no workflow changes are needed.
- New devDependencies needed in `workers/cost-api/package.json`: `vitest`, `@cloudflare/vitest-pool-workers` (Cloudflare's Vitest pool for Workers), `@cloudflare/workers-types`, `wrangler`.
- The `database_id` in `wrangler.toml` is a placeholder — the actual D1 database must be created manually with `npx wrangler d1 create adw-costs --jurisdiction eu` before first deploy (see PRD Infrastructure Setup section).
- D1 batch API is used for transactional inserts. Each `db.batch([...])` call runs all statements in a single transaction.
- Project auto-creation uses `INSERT OR IGNORE` + `SELECT` to handle concurrent requests for the same new slug without race conditions.
- The `migrated` column defaults to `FALSE` — the migration script (future PR) will set it to `TRUE` for historical records.
- This is PR 1 of the staged rollout. The CSV pipeline is untouched. PR 2 will wire ADW phases to POST to this Worker. PR 3 will remove the CSV pipeline.
- Coding guidelines require strict TypeScript, immutability (readonly interfaces), files under 300 lines, and functional style where possible.
