# Cost API GET Endpoints

**ADW ID:** 48ki7w-add-get-endpoints-fo
**Date:** 2026-04-02
**Specification:** specs/issue-375-adw-48ki7w-add-get-endpoints-fo-sdlc_planner-cost-api-get-endpoints.md

## Overview

Three authenticated GET endpoints were added to the `workers/cost-api` Cloudflare Worker so the paysdoc.nl marketing site can consume cost data via HTTP instead of querying D1 directly. The endpoints expose project listings, per-project cost breakdowns by model/provider, and per-issue costs with phase-level token usage. CORS support with configurable allowed origins was introduced via a new middleware module.

## What Was Built

- `GET /api/projects` — returns all projects sorted by name ASC with camelCase keys
- `GET /api/projects/:id/costs/breakdown` — returns cost aggregated by model+provider, sorted by totalCost DESC
- `GET /api/projects/:id/costs/issues` — returns per-issue costs with phases sorted in lifecycle order (plan → build → test → review → document) and per-phase token usage
- CORS middleware with configurable `ALLOWED_ORIGINS` env var (defaults to `https://paysdoc.nl`)
- OPTIONS preflight handling on all routes (no auth required)
- `itty-router` integration replacing manual `if/else` routing in `index.ts`
- Full integration test coverage for all three endpoints and CORS behaviour

## Technical Implementation

### Files Modified

- `workers/cost-api/src/index.ts`: Replaced manual routing with `itty-router`; registered all routes with auth middleware and CORS wrapping
- `workers/cost-api/src/types.ts`: Added `readonly ALLOWED_ORIGINS?: string` to `Env` interface
- `workers/cost-api/wrangler.toml`: Added `ALLOWED_ORIGINS` to documented secrets comment
- `workers/cost-api/package.json`: Added `itty-router` dependency
- `workers/cost-api/vitest.config.ts`: Added `ALLOWED_ORIGINS: 'http://localhost'` test binding

### New Files

- `workers/cost-api/src/cors.ts`: CORS middleware — `corsHeaders()`, `handleOptions()`, `withCors()`
- `workers/cost-api/src/queries.ts`: Three GET handler functions — `handleGetProjects`, `handleGetCostBreakdown`, `handleGetCostIssues`
- `workers/cost-api/test/queries.test.ts`: Integration tests for all three GET endpoints
- `workers/cost-api/test/cors.test.ts`: Integration tests for CORS behaviour

### Key Changes

- **`itty-router` integration**: `src/index.ts` now uses `Router` from `itty-router` with a `requireAuth` helper applied per-route. The `fetch` export wraps all non-OPTIONS responses with `withCors()`.
- **CORS middleware** (`src/cors.ts`): `corsHeaders()` reads `ALLOWED_ORIGINS` from env (comma-separated), checks the request `Origin` header, and only sets `Access-Control-Allow-Origin` when the origin is in the allowed list.
- **Two-query pattern for issues** (`handleGetCostIssues`): Phase costs and token usage are fetched in parallel with `Promise.all`, then merged in code, to avoid fan-out duplication when joining the two tables.
- **Phase ordering**: `PHASE_ORDER = ['plan', 'build', 'test', 'review', 'document']` constant drives `sortPhases()`; unknown phases sort last alphabetically.
- **COALESCE cost column**: All cost queries use `COALESCE(reported_cost_usd, computed_cost_usd)` for consistency with the ingest design.

## How to Use

### Authenticate

All GET endpoints require a `Bearer` token matching the `COST_API_TOKEN` Worker secret:

```
Authorization: Bearer <COST_API_TOKEN>
```

### List projects

```
GET /api/projects
```

Response:
```json
[
  { "id": 1, "slug": "paysdoc-nl", "name": "paysdoc.nl", "repoUrl": "https://github.com/paysdoc/paysdoc.nl" }
]
```

### Cost breakdown by model/provider

```
GET /api/projects/:id/costs/breakdown
```

Response:
```json
[
  { "model": "claude-sonnet-4-20250514", "provider": "anthropic", "totalCost": 12.50 }
]
```

Returns `404 { "error": "Project not found" }` for missing or non-numeric IDs.

### Per-issue costs with phase breakdown

```
GET /api/projects/:id/costs/issues
```

Response:
```json
[
  {
    "issueNumber": 6,
    "totalCost": 8.40,
    "phases": [
      {
        "phase": "plan",
        "cost": 2.10,
        "tokenUsage": [
          { "tokenType": "input", "count": 30000 },
          { "tokenType": "output", "count": 1200 }
        ]
      }
    ]
  }
]
```

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `COST_API_TOKEN` | Yes | — | Bearer token for all authenticated routes |
| `ALLOWED_ORIGINS` | No | `https://paysdoc.nl` | Comma-separated list of allowed CORS origins |

Add `ALLOWED_ORIGINS` as a Worker secret via `wrangler secret put ALLOWED_ORIGINS` or in the Cloudflare dashboard. For local development, add it to `vitest.config.ts` `miniflare.bindings`.

## Testing

```bash
cd workers/cost-api
bun install
bunx tsc --noEmit        # type-check
bun run test             # run all integration tests (ingest + queries + cors)
```

Tests use `@cloudflare/vitest-pool-workers` with a local D1 instance. Seed helpers in `test/queries.test.ts` insert project, `cost_records`, and `token_usage` rows directly via D1 for deterministic data.

## Notes

- The existing `POST /api/cost` ingest endpoint is unchanged — only routing was refactored.
- Pagination is not implemented; all results are returned in a single response.
- `repoUrl` can be `null` in the projects response if the DB row has no `repo_url`.
- Unknown lifecycle phases (not in `PHASE_ORDER`) are sorted alphabetically after the standard phases.
