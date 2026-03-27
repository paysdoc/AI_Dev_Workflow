# PRD: D1 Cost Database

## Problem Statement

ADW tracks per-phase, per-model cost data in CSV files committed to the git repository under `projects/`. This approach clutters the git log with cost commits, creates merge conflicts, loses data from old-format CSVs that are silently ignored by the total rebuild, and provides no API for querying cost data. The existing cost data lives in two incompatible CSV formats: old-format per-issue files (token counts but no phase breakdown) and new-format per-issue files (full phase/token/cost data). The old-format files are orphaned — they contribute nothing to the project total.

A database is needed to replace CSVs as the sole persistence layer for cost data, enable future invoicing functionality at paysdoc.nl, and preserve all historical cost data from both CSV formats.

## Solution

Replace the CSV cost pipeline with a Cloudflare D1 database (`adw-costs`) accessed through a Cloudflare Worker at `costs.paysdoc.nl`. ADW phases POST cost records to the Worker after each phase completes. A one-time migration script reads all existing CSV files (both formats) and uploads them to D1. After migration is confirmed, the CSV pipeline and `projects/` directory are removed.

## User Stories

1. As an ADW operator, I want cost data persisted to a database instead of CSV files, so that the git log is not cluttered with cost commits.
2. As an ADW operator, I want a Worker API at costs.paysdoc.nl that accepts cost records, so that cost data is stored centrally and independently of the git repository.
3. As an ADW operator, I want the Worker to authenticate requests via a bearer token, so that only authorized ADW instances can write cost data.
4. As an ADW operator, I want cost records to include project, workflow ID, issue number, phase, model, provider, cost, status, retry count, continuation count, duration, and timestamp, so that I have full granularity for reporting.
5. As an ADW operator, I want token usage stored separately from cost records with extensible token types, so that new token types from future providers can be added without schema changes.
6. As an ADW operator, I want a projects table that stores project metadata (slug, name, repo URL), so that cost data is organized by project with room for future invoicing fields.
7. As an ADW operator, I want the Worker to auto-create a project row when it encounters an unknown project slug, so that new projects don't require manual setup.
8. As an ADW operator, I want the ingest endpoint to accept a batch of cost records in a single request, so that both phase completion (small batches) and migration (large batches) are efficient.
9. As an ADW operator, I want all existing old-format CSV files migrated to D1 with `phase = 'unknown'` and their actual token counts preserved, so that historical cost data is not lost.
10. As an ADW operator, I want all existing new-format per-issue CSV files migrated to D1 with full phase, token, and cost data, so that recent cost data is preserved with full granularity.
11. As an ADW operator, I want `total-cost.csv` ignored during migration, so that derived data is not double-counted.
12. As an ADW operator, I want a migration script that reads CSV files locally and POSTs them to the Worker, so that the Worker does not need to know about CSV formats.
13. As an ADW operator, I want migrated records flagged with `migrated = true`, so that I can distinguish historical data from live data.
14. As an ADW operator, I want ADW phases to POST cost records to D1 after each phase completes, so that cost data is persisted in real-time.
15. As an ADW operator, I want a dual-write period where both D1 and CSV are written, so that the transition is safe and reversible.
16. As an ADW operator, I want the CSV pipeline removed after migration is confirmed, so that dead code and the `projects/` directory are cleaned up.
17. As an ADW operator, I want the D1 database restricted to EU jurisdiction, so that data residency requirements are met.
18. As an ADW operator, I want Workers deployed via GitHub Actions on push to main, so that deployment is automated and not dependent on manual CLI commands.
19. As an ADW operator, I want the Worker to return `201` with the count of inserted records on success, so that the caller can verify the operation.
20. As an ADW operator, I want the Worker to return `401` on bad or missing auth, `400` on malformed payload, and `500` on D1 errors, so that failures are diagnosable.
21. As an ADW operator, I want the optional `name` and `repo_url` fields in the ingest payload to enrich the auto-created project row, so that project metadata can be populated without a separate endpoint.

## Implementation Decisions

### D1 Schema

Three tables in the `adw-costs` database (EU jurisdiction):

**`projects`**
- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `slug` TEXT NOT NULL UNIQUE — machine identifier (e.g. `AI_Dev_Workflow`)
- `name` TEXT NOT NULL — display name, defaults to slug if not provided
- `repo_url` TEXT — optional GitHub/GitLab repo URL
- `created_at` TEXT NOT NULL — ISO 8601

**`cost_records`**
- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `project_id` INTEGER NOT NULL REFERENCES projects(id)
- `workflow_id` TEXT — adwId, null for migrated old-format records
- `issue_number` INTEGER NOT NULL
- `issue_description` TEXT
- `phase` TEXT NOT NULL — `plan`, `build`, `test`, `pr`, `review`, `document`, `scenario`, `kpi`, `install`, `step-def-gen`, or `unknown`
- `model` TEXT NOT NULL
- `provider` TEXT NOT NULL DEFAULT `anthropic`
- `computed_cost_usd` REAL NOT NULL
- `reported_cost_usd` REAL
- `status` TEXT — `success`, `partial`, `failed`
- `retry_count` INTEGER DEFAULT 0
- `continuation_count` INTEGER DEFAULT 0
- `duration_ms` INTEGER
- `timestamp` TEXT — ISO 8601
- `migrated` BOOLEAN DEFAULT FALSE

**`token_usage`**
- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `cost_record_id` INTEGER NOT NULL REFERENCES cost_records(id)
- `token_type` TEXT NOT NULL — `input`, `output`, `cache_read`, `cache_write`, or any future type
- `count` INTEGER NOT NULL

### Cost API Worker

- Lives at `workers/cost-api/` with its own `wrangler.toml`
- Route: `costs.paysdoc.nl/*`
- D1 binding to `adw-costs`
- Single endpoint: `POST /api/cost`
- Auth: Bearer token validated against `COST_API_TOKEN` Worker secret
- No query endpoints in this phase — added when the frontend is built

### Ingest Payload

```json
{
  "project": "AI_Dev_Workflow",
  "name": "AI Dev Workflow",
  "repo_url": "https://github.com/paysdoc/AI_Dev_Workflow",
  "records": [
    {
      "workflow_id": "a1b2c3d4",
      "issue_number": 245,
      "issue_description": "cost revamp orchestrator migration",
      "phase": "build",
      "model": "claude-sonnet-4-6",
      "provider": "anthropic",
      "computed_cost_usd": 7.89,
      "reported_cost_usd": 7.85,
      "status": "success",
      "retry_count": 0,
      "continuation_count": 1,
      "duration_ms": 180000,
      "timestamp": "2026-03-22T14:30:00Z",
      "token_usage": {
        "input": 500,
        "output": 25000,
        "cache_read": 1500000,
        "cache_write": 80000
      }
    }
  ]
}
```

- `project` (required): slug used to resolve or auto-create project row
- `name` (optional): display name, used only during project auto-creation, defaults to slug
- `repo_url` (optional): used only during project auto-creation
- `records` (required): array of one or more cost records
- `token_usage` (required per record): map of token type to count, fanned out into the `token_usage` table

### Responses

- `201 { "inserted": <number> }` on success
- `401 { "error": "Unauthorized" }` on bad/missing token
- `400 { "error": "<description>" }` on malformed payload
- `500 { "error": "<description>" }` on D1 errors

### Migration Script

- Located at `workers/cost-api/migrate.ts`
- Runs locally via `bunx tsx workers/cost-api/migrate.ts`
- Scans `projects/` directory for all 3 project subdirectories
- Parses old-format CSVs: extracts model, token counts, cost from rows; issue number and description from filename; sets `phase = 'unknown'`, `migrated = true`
- Parses new-format per-issue CSVs: uses existing `parseIssueCostCsv()` to get full `PhaseCostRecord[]`; sets `migrated = true`
- Skips `total-cost.csv` files (derived data)
- Batches records and POSTs to `costs.paysdoc.nl/api/cost`
- Requires `COST_API_URL` and `COST_API_TOKEN` env vars

### ADW Cost D1 Client

- New module in `adws/cost/` that provides a function to POST `PhaseCostRecord[]` to the Worker
- Transforms camelCase `PhaseCostRecord` to the snake_case ingest payload
- Uses `COST_API_URL` and `COST_API_TOKEN` env vars
- Called from phase cost commit logic

### Staged Rollout

- **PR 1**: Worker, D1 schema, ingest endpoint, migration script, GitHub Actions deploy workflow. CSV pipeline untouched.
- **PR 2**: Wire ADW phases to POST cost data to the Worker. Dual-write: D1 + CSV.
- **PR 3**: Remove CSV pipeline — delete `csvWriter.ts`, `commitQueue.ts`, `costCommitQueue.ts`, `/commit_cost` command, `projects/` directory, and all call sites.

### Infrastructure Setup (one-time, before PR 1 deploy)

```bash
# 1. Authenticate wrangler
npx wrangler login

# 2. Create D1 database in EU jurisdiction
npx wrangler d1 create adw-costs --jurisdiction eu

# 3. Deploy screenshot-router (if not yet deployed)
cd workers/screenshot-router
npx wrangler deploy
npx wrangler secret put CLOUDFLARE_ACCOUNT_ID
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
cd ../..

# 4. Deploy cost-api (after PR 1 is merged)
cd workers/cost-api
npx wrangler deploy
npx wrangler secret put COST_API_TOKEN
cd ../..

# 5. Create Cloudflare API token for GitHub Actions:
#    https://dash.cloudflare.com/profile/api-tokens
#    Permissions:
#      Account > Workers Scripts > Edit
#      Account > D1 > Edit
#      Account > Workers R2 Storage > Edit
#      Zone > DNS > Read (for paysdoc.nl)

# 6. Add to GitHub repo secrets:
#    Settings > Secrets and variables > Actions
#    Add: CLOUDFLARE_API_TOKEN

# 7. DNS (Cloudflare dashboard for paysdoc.nl):
#    Add CNAME: costs -> workers.dev (proxied)
#    Add CNAME: screenshots -> workers.dev (proxied, if not done)

# 8. Run migration (after cost-api is deployed):
COST_API_URL=https://costs.paysdoc.nl COST_API_TOKEN=<token> bunx tsx workers/cost-api/migrate.ts
```

### GitHub Actions Deploy Workflow

- Triggers on push to `main` when files change under `workers/`
- Separate jobs per Worker, each using `cloudflare/wrangler-action@v3`
- Uses `CLOUDFLARE_API_TOKEN` from repository secrets

## Testing Decisions

Good tests verify external behavior through the module's public interface, not implementation details. They should remain valid even if the internal implementation is refactored.

### Worker Ingest Handler

- Test the full request-to-D1 flow using Miniflare (Cloudflare's local Worker simulator) or Vitest with `unstable_dev`
- Verify: successful batch insert returns 201 with correct count
- Verify: missing/invalid bearer token returns 401
- Verify: malformed payloads (missing required fields, empty records array) return 400
- Verify: project auto-creation on unknown slug, with and without optional `name`/`repo_url`
- Verify: token_usage rows are created for each token type in each record
- Verify: duplicate project slugs are resolved to the same project_id

### Migration CSV Parsers

- Unit tests with Vitest
- Test old-format CSV parsing: correct extraction of model, token counts, cost, issue number/description from filename
- Test new-format CSV parsing: already partially covered by existing `parseIssueCostCsv` tests, extend for migration-specific transformations
- Test that `total-cost.csv` files are skipped
- Test batch assembly: correct grouping by project, correct payload shape

### ADW Cost D1 Client

- Unit tests with Vitest, mocking `fetch`
- Test PhaseCostRecord-to-payload transformation (camelCase to snake_case, token_usage map construction)
- Test auth header is set correctly
- Test error handling: network failure, 401, 400, 500 responses
- Prior art: existing Vitest tests in `adws/cost/__tests__/`

## Out of Scope

- Query/read endpoints on the Worker (deferred to frontend phase)
- Frontend/invoicing UI at paysdoc.nl
- Cloudflare Access for the frontend
- Invoicing fields on the projects table (client, currency, markup)
- Multi-provider cost tracking beyond Anthropic
- Real-time cost streaming/WebSocket updates
- Cost alerting or budget thresholds

## Further Notes

- The D1 database uses `--jurisdiction eu` to keep all data within the EU.
- Bearer token auth is chosen over Cloudflare Access for the Worker because Access is designed for browser-based flows. Service-to-service calls would need a Service Token anyway, which provides the same security as a bearer token with more coupling to Cloudflare. Cloudflare Access is appropriate for the future invoicing frontend where humans authenticate.
- The `projects/` directory contains data for 3 projects: `AI_Dev_Workflow`, `Millennium`, and `vestmatic`. All will be migrated.
- Old-format CSVs have a `0-` prefix in their filenames (e.g. `0-bug-52-*.csv`). The issue number is extracted from the portion after this prefix.
- The Worker follows the same repo layout pattern as `workers/screenshot-router/`.
