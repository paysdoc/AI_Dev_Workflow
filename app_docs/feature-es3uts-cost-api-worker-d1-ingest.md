# Cost API Worker — D1 Schema & Ingest Endpoint

**ADW ID:** es3uts-cost-api-worker-d1-s
**Date:** 2026-03-27
**Specification:** specs/issue-330-adw-viahyb-cost-api-worker-d1-s-sdlc_planner-cost-api-worker-d1-ingest.md

## Overview

A new Cloudflare Worker at `workers/cost-api/` that accepts cost records via `POST /api/cost` and persists them to a Cloudflare D1 database (`adw-costs`). This is the foundation slice of the D1 cost database initiative — replacing CSV-based cost tracking with a centralized, queryable database. The Worker is routed at `costs.paysdoc.nl/*` and the D1 database uses EU jurisdiction for data residency compliance.

## What Was Built

- **Worker scaffold** at `workers/cost-api/` following the same layout as `workers/screenshot-router/`
- **D1 schema** with 3 tables: `projects`, `cost_records`, `token_usage`
- **Bearer token authentication** middleware with timing-safe comparison against `COST_API_TOKEN` Worker secret
- **Ingest handler** that resolves project slugs (auto-creating unknown projects), batch-inserts cost records, and fans out token usage into a separate table
- **Vitest + Miniflare test suite** covering auth, validation, project auto-creation, token usage fan-out, batch inserts, and routing

## Technical Implementation

### Files Modified

- `workers/cost-api/wrangler.toml` — Worker config: name `cost-api`, route `costs.paysdoc.nl/*`, D1 binding `DB → adw-costs`
- `workers/cost-api/package.json` — devDependencies: `wrangler`, `@cloudflare/workers-types`, `@cloudflare/vitest-pool-workers`, `vitest`
- `workers/cost-api/tsconfig.json` — TypeScript config for the Worker
- `workers/cost-api/src/schema.sql` — DDL for `projects`, `cost_records`, `token_usage` tables with indexes
- `workers/cost-api/src/migrations/0001_initial.sql` — Wrangler migration file (same DDL)
- `workers/cost-api/src/types.ts` — `Env`, `IngestRecord`, `IngestPayload`, `SuccessResponse`, `ErrorResponse` interfaces
- `workers/cost-api/src/auth.ts` — `authenticate()` with custom `timingSafeEqual` implementation
- `workers/cost-api/src/ingest.ts` — Payload validation, project resolution, D1 batch inserts
- `workers/cost-api/src/index.ts` — Worker entry point: auth gate → route dispatch
- `workers/cost-api/vitest.config.ts` — Vitest config using `@cloudflare/vitest-pool-workers`
- `workers/cost-api/test/ingest.test.ts` — 25+ test cases across auth, validation, insert, fan-out, batch, routing

### Key Changes

- **D1 schema**: `projects` (slug/name/repo_url), `cost_records` (all cost fields with FK to projects), `token_usage` (cost_record_id FK, token_type, count). Indexes on `cost_records(project_id)`, `cost_records(workflow_id)`, `token_usage(cost_record_id)`.
- **Project auto-creation**: Uses `INSERT OR IGNORE` + `SELECT` pattern to safely handle concurrent requests for the same new slug without race conditions.
- **D1 batch API**: Cost records are inserted via `db.batch([...stmts])` (each with `RETURNING id`), then token usage rows are inserted in a second batch keyed to the returned IDs.
- **Auth**: Timing-safe comparison implemented manually since the Workers runtime doesn't expose `crypto.subtle.timingSafeEqual` for string comparison.
- **Routing**: Auth is checked before routing — all routes (including 404/405) require a valid bearer token.

## How to Use

### Deploy the Worker

```bash
# 1. Create the D1 database (one-time, EU jurisdiction)
npx wrangler d1 create adw-costs --jurisdiction eu

# 2. Update database_id in workers/cost-api/wrangler.toml with the returned UUID

# 3. Apply the D1 schema
npx wrangler d1 migrations apply adw-costs --remote

# 4. Set the auth secret
cd workers/cost-api && npx wrangler secret put COST_API_TOKEN

# 5. Deploy
cd workers/cost-api && npm run deploy
```

### Ingest Cost Records

```bash
curl -X POST https://costs.paysdoc.nl/api/cost \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "project": "AI_Dev_Workflow",
    "name": "AI Dev Workflow",
    "repo_url": "https://github.com/paysdoc/AI_Dev_Workflow",
    "records": [
      {
        "issue_number": 330,
        "phase": "build",
        "model": "claude-sonnet-4-6",
        "computed_cost_usd": 1.23,
        "token_usage": { "input": 1000, "output": 500, "cache_read": 8000 }
      }
    ]
  }'
# → 201 { "inserted": 1 }
```

## Configuration

| Setting | How to configure |
|---|---|
| `COST_API_TOKEN` | `wrangler secret put COST_API_TOKEN` in `workers/cost-api/` |
| `database_id` | Update placeholder UUID in `workers/cost-api/wrangler.toml` after D1 create |
| Route | `costs.paysdoc.nl/*` on zone `paysdoc.nl` (in `wrangler.toml`) |

## Testing

```bash
cd workers/cost-api

# Install dependencies
npm install

# Run all Vitest + Miniflare tests
npm test

# Type-check
npx tsc --noEmit
```

The test suite uses `@cloudflare/vitest-pool-workers` which runs tests inside a real Workers runtime (Miniflare). Schema migrations are applied via `applyD1Migrations` before each test.

## Notes

- **PR 1 of 3**: The CSV pipeline (`adws/cost/`) is untouched. PR 2 will wire ADW phases to POST to this Worker. PR 3 will remove the CSV pipeline.
- **GitHub Actions**: The existing `.github/workflows/deploy-workers.yml` auto-discovers Workers by `wrangler.toml` — no workflow changes needed.
- **`migrated` column**: Defaults to `FALSE`. A future migration script will set it to `TRUE` for historical records ingested from existing CSVs.
- **Provider default**: `provider` defaults to `'anthropic'` in the schema and is applied at the application layer when omitted from the payload.
