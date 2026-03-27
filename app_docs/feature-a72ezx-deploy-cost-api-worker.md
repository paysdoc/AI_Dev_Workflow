# Deploy cost-api Worker to Cloudflare

**ADW ID:** a72ezx-deploy-cost-api-work
**Date:** 2026-03-27
**Specification:** specs/issue-331-adw-a7d21i-deploy-cost-api-work-sdlc_planner-deploy-cost-api-worker.md

## Overview

One-time HITL infrastructure setup that deploys the `cost-api` Cloudflare Worker to production. This chore created the `adw-costs` D1 database (EU jurisdiction), configured DNS, set the `COST_API_TOKEN` secret, and wired up a GitHub Actions CI workflow to auto-deploy all Workers on push to `main`.

## What Was Built

- `workers/cost-api/wrangler.toml` — Updated with the real D1 `database_id` (`188080b5-92a6-4b70-97c4-1b6ce1e9cfb0`) and `migrations_dir` for automatic schema migration on deploy
- `.github/workflows/deploy-workers.yml` — CI workflow with per-worker jobs (`deploy-screenshot-router`, `deploy-cost-api`), each gated by `dorny/paths-filter@v3` change detection, deploying via `cloudflare/wrangler-action@v3` on push to `main` when `workers/**` changes
- `adw-costs` D1 database — Created in EU jurisdiction via `wrangler d1 create adw-costs --jurisdiction eu`
- DNS CNAME `costs.paysdoc.nl` — Proxied through Cloudflare, routing to the Worker
- `COST_API_TOKEN` secret — Set on the deployed Worker via `wrangler secret put`

## Technical Implementation

### Files Modified

- `workers/cost-api/wrangler.toml`: Replaced placeholder `database_id` (`00000000-...`) with real UUID `188080b5-92a6-4b70-97c4-1b6ce1e9cfb0`; added `migrations_dir = "src/migrations"`
- `.github/workflows/deploy-workers.yml`: Rewritten — per-worker job workflow triggered on push to `main` with `paths: workers/**`

### Key Changes

- The D1 binding in `wrangler.toml` now references the live EU-jurisdiction database, enabling `workers/cost-api/src/migrations/0001_initial.sql` to be applied automatically by `wrangler deploy`
- The CI workflow uses a `changes` job with `dorny/paths-filter@v3` to detect which worker directories changed, then runs `deploy-screenshot-router` and `deploy-cost-api` jobs conditionally — each job only runs when its own directory has changes
- Deployment requires two GitHub secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
- Bearer token authentication (`COST_API_TOKEN`) is enforced by the Worker; the secret was set via `wrangler secret put` and is never stored in source

## How to Use

**Calling the API (authenticated):**
```bash
curl -X POST https://costs.paysdoc.nl/api/cost \
  -H "Authorization: Bearer <COST_API_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"project":"my-project","records":[...]}'
# Expected: 201 Created
```

**Unauthenticated requests return 401:**
```bash
curl -X POST https://costs.paysdoc.nl/api/cost \
  -H "Content-Type: application/json" \
  -d '{"project":"test","records":[]}'
# Expected: 401 Unauthorized
```

**Re-deploying manually:**
```bash
cd workers/cost-api && npm install && npx wrangler deploy
```

## Configuration

| Item | Value |
|------|-------|
| Worker name | `cost-api` |
| Route | `costs.paysdoc.nl/*` |
| Zone | `paysdoc.nl` |
| D1 database | `adw-costs` (EU jurisdiction) |
| D1 database_id | `188080b5-92a6-4b70-97c4-1b6ce1e9cfb0` |
| Secret | `COST_API_TOKEN` (set via `wrangler secret put`) |
| GitHub secrets required | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |

## Testing

```bash
# Worker unit tests (vitest + miniflare)
cd workers/cost-api && npm test

# Smoke test authenticated endpoint
curl -s -o /dev/null -w "%{http_code}" -X POST https://costs.paysdoc.nl/api/cost \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"project":"test","records":[]}'
# Expect: 201

# Smoke test unauthenticated
curl -s -o /dev/null -w "%{http_code}" -X POST https://costs.paysdoc.nl/api/cost \
  -H "Content-Type: application/json" \
  -d '{"project":"test","records":[]}'
# Expect: 401
```

## Notes

- The `screenshot-router` Worker was already deployed (2026-03-25) and was not touched by this chore
- Future Workers require a new explicit job in `deploy-workers.yml` and a corresponding filter in the `changes` job
- Next steps: issue #333 (CSV migration to D1) and ADW phase wiring to post cost data to this endpoint
