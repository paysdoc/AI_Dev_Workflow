# Cost API Worker — D1 Schema and Ingest Endpoint

**ADW ID:** viahyb-cost-api-worker-d1-s
**Date:** 2026-03-27
**Specification:** specs/issue-330-adw-viahyb-cost-api-worker-d1-s-sdlc_planner-cost-api-worker-d1-ingest.md

## Overview

A new Cloudflare Worker (`workers/cost-api/`) that accepts cost records via `POST /api/cost` and persists them to a D1 database (`adw-costs`). This is the foundation slice of the centralized cost database initiative, replacing the git-committed CSV pipeline with a proper database-backed API routed at `costs.paysdoc.nl`.

## What Was Built

- **Worker scaffold** (`workers/cost-api/`) with `wrangler.toml`, `package.json`, `tsconfig.json`, and `vitest.config.ts`
- **D1 schema** (`src/schema.sql`) defining three tables: `projects`, `cost_records`, `token_usage`
- **Bearer token auth** (`src/auth.ts`) with timing-safe comparison against the `COST_API_TOKEN` Worker secret
- **Ingest handler** (`src/ingest.ts`) with payload validation, project auto-creation, and D1 batch inserts
- **Worker entry point** (`src/index.ts`) routing `POST /api/cost` with 401/404/405 guards
- **TypeScript types** (`src/types.ts`) — `Env`, `IngestPayload`, `IngestRecord`, response interfaces
- **Vitest + Miniflare test suite** (`test/ingest.test.ts`) with 360 lines covering all acceptance criteria

## Technical Implementation

### Files Modified

- `workers/cost-api/wrangler.toml`: Worker config — name `cost-api`, route `costs.paysdoc.nl/*`, D1 binding `DB` → `adw-costs`
- `workers/cost-api/src/schema.sql`: DDL for `projects` (slug/name/repo_url), `cost_records` (15 columns with FK to projects), `token_usage` (FK to cost_records), plus 3 indexes
- `workers/cost-api/src/migrations/0001_initial.sql`: Migration file for Wrangler D1 migrations
- `workers/cost-api/src/types.ts`: `Env` interface with `DB: D1Database` + `COST_API_TOKEN`; `IngestRecord` and `IngestPayload` with readonly fields; `SuccessResponse` / `ErrorResponse`
- `workers/cost-api/src/auth.ts`: `authenticate(request, env)` — extracts `Bearer <token>`, compares via `timingSafeEqual` (byte-level XOR loop)
- `workers/cost-api/src/ingest.ts`: `handleIngest` — validates payload, calls `resolveProject` (INSERT OR IGNORE + SELECT), `insertCostRecords` (D1 batch with RETURNING id), `insertTokenUsage` (D1 batch)
- `workers/cost-api/src/index.ts`: Fetch handler — auth check → route `/api/cost` POST → ingest; 405 for wrong method; 404 otherwise
- `workers/cost-api/test/ingest.test.ts`: Full Miniflare integration tests using `cloudflare:test` and `applyD1Migrations`
- `workers/cost-api/vitest.config.ts`: Configured for `@cloudflare/vitest-pool-workers` with D1 migration path
- `workers/cost-api/package.json` / `tsconfig.json`: Worker-local deps; `@cloudflare/vitest-pool-workers`, `wrangler`, `@cloudflare/workers-types`

### Key Changes

- **Project auto-creation** uses `INSERT OR IGNORE` + `SELECT` to safely handle concurrent requests for the same new project slug without race conditions.
- **D1 batch API** is used for cost record inserts (with `RETURNING id`) and token usage fan-out, keeping related writes in a single round-trip.
- **Token usage fan-out**: each key in the `token_usage` map of a record produces one row in the `token_usage` table, keyed by `cost_record_id`.
- **Auth is global**: all routes require a valid bearer token — the auth check runs before any routing logic.
- **Provider defaults to `'anthropic'`** when omitted from a record payload; all other optional fields default to `null` or `0`.

## How to Use

### Sending a cost record

```bash
curl -X POST https://costs.paysdoc.nl/api/cost \
  -H "Authorization: Bearer $COST_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "project": "my-repo",
    "name": "My Repo",
    "repo_url": "https://github.com/org/my-repo",
    "records": [
      {
        "issue_number": 42,
        "workflow_id": "abc123",
        "phase": "build",
        "model": "claude-sonnet-4-6",
        "computed_cost_usd": 0.0312,
        "token_usage": { "input": 1200, "output": 450, "cache_read": 3000 }
      }
    ]
  }'
# → 201 { "inserted": 1 }
```

### Batch insert

Include multiple objects in the `records` array — all are inserted in a single request.

### Running tests

```bash
cd workers/cost-api
npm install
npx vitest run
```

## Configuration

| Item | Details |
|---|---|
| Worker name | `cost-api` |
| Route | `costs.paysdoc.nl/*` on zone `paysdoc.nl` |
| D1 binding | `DB` → `adw-costs` (EU jurisdiction) |
| Worker secret | `COST_API_TOKEN` — set via `wrangler secret put COST_API_TOKEN` |
| D1 database ID | Placeholder `00000000-…` in `wrangler.toml` — replace after running `npx wrangler d1 create adw-costs --jurisdiction eu` |

The existing `.github/workflows/deploy-workers.yml` auto-discovers this Worker by finding its `wrangler.toml` — no workflow changes are needed.

## Testing

The test suite at `workers/cost-api/test/ingest.test.ts` uses Vitest + Miniflare (`@cloudflare/vitest-pool-workers`) and covers:

- Auth rejection (missing header, wrong token, missing `Bearer` prefix)
- Payload validation (missing `project`, empty `records`, invalid record fields)
- Successful single and batch inserts → 201 with correct `inserted` count
- Project auto-creation (name defaults to slug, optional `name`/`repo_url` fields)
- Duplicate project slug resolution (same `project_id` reused)
- Token usage fan-out (one `token_usage` row per map entry)
- Route/method guards (404 for unknown path, 405 for GET on `/api/cost`)

## Notes

- This is **PR 1 of a 3-PR staged rollout**. The CSV pipeline in `adws/cost/` is untouched. PR 2 will wire ADW phases to POST to this Worker; PR 3 will remove the CSV pipeline.
- The `migrated` column on `cost_records` defaults to `FALSE` — a future migration script will back-fill historical CSV records and set it to `TRUE`.
- D1 `batch()` provides transaction-like behaviour: if token usage inserts fail, cost records may already be committed. A future improvement could use a single batch for both steps.
