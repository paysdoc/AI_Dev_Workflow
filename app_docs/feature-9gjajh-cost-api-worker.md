# Cost API Worker

## Overview

The Cost API Worker is a Cloudflare Worker that exposes authenticated HTTP endpoints for ingesting and querying per-phase LLM cost data stored in a Cloudflare D1 database. It is the durable persistence layer for the cost tracking pipeline, replacing the legacy CSV approach.

## Responsibilities

- Route HTTP requests via `itty-router`: `POST /api/cost` for ingestion, `GET /api/projects` for project listing, `GET /api/projects/:id/costs/breakdown` for model+provider aggregation, `GET /api/projects/:id/costs/issues` for per-issue phase breakdowns with token usage.
- Authenticate every non-OPTIONS request via `Authorization: Bearer <token>` against the `COST_API_TOKEN` Worker secret using constant-time comparison.
- Handle CORS preflight (`OPTIONS *`) without authentication; attach CORS headers to all other responses via `withCors`.
- Validate ingest payloads: require `project` (string), `records` (non-empty array), and per-record fields `issue_number`, `phase`, `model`, `computed_cost_usd`, and `token_usage` (map of string to number).
- Auto-create projects by slug on first ingest using `INSERT OR IGNORE` + `SELECT` to handle concurrent requests safely.
- Batch-insert cost records and their token usage rows into D1 using `db.batch()`.
- Serve cost breakdowns aggregated by model+provider (sorted by total cost DESC) and per-issue phase summaries using two parallel D1 queries to avoid fan-out duplication from the cost_records/token_usage join.
- Sort phases in lifecycle order (`plan`, `build`, `test`, `review`, `document`; unknown phases sort last alphabetically).

## Contracts & Invariants

- `COST_API_TOKEN` comparison is timing-safe (constant-time XOR loop); length mismatch returns `false` immediately without leaking token length via timing.
- Project resolution is idempotent: concurrent ingests for the same slug produce a single project row.
- `reported_cost_usd` is optional; when absent, queries fall back to `computed_cost_usd` via `COALESCE`.
- `provider` defaults to `'anthropic'` when absent from the ingest record.
- Token usage rows (`token_usage` table) use a cost-record foreign key (`cost_record_id`); they are inserted in the same `db.batch()` call as the cost records to maintain consistency within the D1 transaction.
- A 405 response is returned for non-POST methods on `/api/cost` (after auth check); all unmatched routes return 404.

## Configuration

Worker secrets required: `COST_API_TOKEN`, and `ALLOWED_ORIGINS` (optional, for CORS origin restriction). D1 database binding: `DB`. Configured via `workers/cost-api/wrangler.toml`. Deployed as a Cloudflare Worker via `wrangler deploy`.

## Gotchas

- The `/api/cost` route rejects all methods except POST via a catch-all `router.all('/api/cost', ...)` that must appear after the POST route; itty-router matches routes in registration order.
- `handleGetCostIssues` uses two separate D1 queries (phase costs and token usage) to avoid the N×M row explosion that results from joining them; callers should not expect a single joined response.
- `ALLOWED_ORIGINS` is an optional env binding; the CORS handler must handle its absence gracefully.
- D1 batch statements are constructed synchronously and executed in a single round-trip; errors in any statement cause the batch to fail atomically.
- The `migrated` field on `IngestRecord` marks records ingested via the historical CSV migration script; it has no effect on queries.
