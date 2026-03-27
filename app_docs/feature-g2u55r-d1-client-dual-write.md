# D1 Client and Dual-Write Integration

**ADW ID:** g2u55r-adw-d1-client-and-du
**Date:** 2026-03-27
**Specification:** specs/issue-334-adw-92py6q-adw-d1-client-and-du-sdlc_planner-d1-client-dual-write.md

## Overview

Adds an HTTP client module (`adws/cost/d1Client.ts`) that transforms ADW's `PhaseCostRecord` arrays into the Cost API Worker's snake_case ingest payload and POSTs them to `costs.paysdoc.nl`. The client is wired into `phaseCostCommit.ts` so cost data is written to both D1 (via the Worker) and CSV simultaneously. When `COST_API_URL` is not configured, D1 writes are silently skipped — making the code safe to merge independently of infrastructure readiness.

## What Was Built

- `adws/cost/d1Client.ts` — New D1 HTTP client module with `postCostRecordsToD1` and `transformToIngestPayload`
- `COST_API_URL` and `COST_API_TOKEN` environment variable accessors added to `adws/core/environment.ts`
- Re-exports threaded through `adws/core/config.ts` and the barrel chain
- Dual-write wired into `adws/phases/phaseCostCommit.ts` alongside existing CSV writes
- `COST_API_URL` and `COST_API_TOKEN` added to `.env.sample` and `README.md`

## Technical Implementation

### Files Modified

- `adws/cost/d1Client.ts`: New module — `transformToIngestPayload` (pure camelCase→snake_case mapper) and `postCostRecordsToD1` (fire-and-forget HTTP POST, never throws)
- `adws/cost/index.ts`: Added `postCostRecordsToD1` export from `./d1Client.ts`
- `adws/phases/phaseCostCommit.ts`: Wired `postCostRecordsToD1` call inside `commitPhaseCostData` using `void` (fire-and-forget, concurrent with CSV path)
- `adws/core/environment.ts`: Added `COST_API_URL` and `COST_API_TOKEN` env var constants
- `adws/core/config.ts`: Re-exported `COST_API_URL` and `COST_API_TOKEN` from `environment.ts`
- `.env.sample`: Added commented-out `COST_API_URL` and `COST_API_TOKEN` entries under a "Cost API Configuration" section

### Key Changes

- **Silent skip**: `postCostRecordsToD1` returns immediately (no log, no error) when `COST_API_URL` is falsy or `records` is empty — zero impact on deployments without the Cost API configured
- **camelCase → snake_case mapping**: `contextResetCount` → `continuation_count`, `computedCostUsd` → `computed_cost_usd`, etc. `tokenUsage` passes through directly (already has snake_case keys)
- **Fire-and-forget**: Called with `void` in `phaseCostCommit.ts` — D1 failures cannot block or affect the CSV write path
- **Warning-only errors**: Non-2xx HTTP responses and network errors both log a `warn`-level message via `log()` and return — workflow never crashes
- **Auth header**: `Authorization: Bearer ${COST_API_TOKEN}` set from env var; if token is empty the request proceeds and the Worker returns 401 (warning logged)

## How to Use

1. Copy `.env.sample` to `.env` if you haven't already
2. Set `COST_API_URL="https://costs.paysdoc.nl"` in your `.env`
3. Set `COST_API_TOKEN="<bearer-token>"` in your `.env` (obtain from the Cloudflare Worker secret)
4. Run ADW as normal — cost data will now be posted to D1 after each phase alongside the existing CSV commits

If `COST_API_URL` is not set, behavior is unchanged from before this feature.

## Configuration

| Variable | Required | Description |
|---|---|---|
| `COST_API_URL` | No | Cost API Worker base URL (e.g. `https://costs.paysdoc.nl`). Omit to disable D1 writes. |
| `COST_API_TOKEN` | No | Bearer token for Cost API authentication. Required when `COST_API_URL` is set. |

## Testing

- Unit tests are disabled for this project (see `.adw/project.md`)
- Validate manually by running `bun run lint`, `bunx tsc --noEmit`, and `bunx tsc --noEmit -p adws/tsconfig.json`
- Integration: set `COST_API_URL` and `COST_API_TOKEN` in `.env`, trigger a workflow phase, then query `costs.paysdoc.nl` to verify the record was inserted

## Notes

- This is **PR 2 of 3** in the D1 cost database rollout. PR 1 (#330) deployed the Cost API Worker and D1 schema; PR 3 will remove the CSV pipeline entirely.
- `contextResetCount` on `PhaseCostRecord` maps to `continuation_count` in the Worker's `IngestRecord` — the naming difference is intentional (ADW internal term vs. PRD schema term).
- The `issueDescription` field is omitted from the ingest payload; it can be added in a future iteration.
- The `COST_API_URL` guard makes this code safe to merge before infrastructure is live (blocked by #331).
