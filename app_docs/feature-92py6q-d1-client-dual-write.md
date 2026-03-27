# D1 Client and Dual-Write Integration

**ADW ID:** 92py6q-adw-d1-client-and-du
**Date:** 2026-03-27
**Specification:** specs/issue-334-adw-92py6q-adw-d1-client-and-du-sdlc_planner-d1-client-dual-write.md

## Overview

Adds an HTTP client module (`adws/cost/d1Client.ts`) that transforms ADW's `PhaseCostRecord` arrays into the Cost API Worker's snake_case ingest payload and POSTs them to `costs.paysdoc.nl`. The phase cost commit logic now dual-writes cost data to both D1 (via the Worker) and CSV files simultaneously. When `COST_API_URL` is not set, D1 writes are silently skipped — making this safe to merge independently of infrastructure availability.

## What Was Built

- New `adws/cost/d1Client.ts` module with `postCostRecordsToD1` public function and `transformToIngestPayload` helper
- `COST_API_URL` and `COST_API_TOKEN` environment variable accessors in `adws/core/environment.ts`
- Dual-write wired into `adws/phases/phaseCostCommit.ts` — D1 runs fire-and-forget alongside CSV writes
- `.env.sample` updated with Cost API configuration section
- `README.md` updated with new environment variables

## Technical Implementation

### Files Modified

- `adws/cost/d1Client.ts` *(new)*: D1 HTTP client — `transformToIngestPayload` (pure function, camelCase → snake_case mapping) and `postCostRecordsToD1` (async, fire-and-forget, never throws)
- `adws/core/environment.ts`: Added `COST_API_URL` and `COST_API_TOKEN` constants (default to empty string)
- `adws/phases/phaseCostCommit.ts`: Wired `postCostRecordsToD1` into `commitPhaseCostData` as a `void` fire-and-forget call after the CSV write
- `adws/cost/index.ts`: Exported `postCostRecordsToD1` from the cost barrel
- `.env.sample`: Added `COST_API_URL` and `COST_API_TOKEN` in a new "Cost API Configuration" section

### Key Changes

- **Payload transformation**: `PhaseCostRecord` camelCase fields map to Worker `IngestRecord` snake_case fields. `contextResetCount` → `continuation_count` (intentional naming difference). `tokenUsage` passes through directly as `token_usage` (already snake_case keys internally).
- **Silent skip**: `postCostRecordsToD1` returns immediately with no log or error when `COST_API_URL` is falsy, or when `records` is empty.
- **Error isolation**: All fetch errors and non-2xx responses are caught and logged as warnings via `log(..., 'warn')`. The function never throws — D1 failures cannot crash the workflow.
- **Fire-and-forget**: Called with `void` in `commitPhaseCostData` so D1 latency does not block the CSV commit path.
- **Auth**: `Authorization: Bearer <COST_API_TOKEN>` header is set on every request from the `COST_API_TOKEN` env var.

## How to Use

1. Set environment variables in `.env`:
   ```
   COST_API_URL="https://costs.paysdoc.nl"
   COST_API_TOKEN="your-bearer-token"
   ```
2. Run any ADW workflow that completes a phase (e.g., build, test, review). Cost records are automatically POSTed to the D1 database after each phase completes.
3. If `COST_API_URL` is not set, the workflow runs normally and only CSV files are written — no changes in observable behavior.

## Configuration

| Variable | Required | Description |
|---|---|---|
| `COST_API_URL` | No | Base URL for the Cost API Worker (e.g., `https://costs.paysdoc.nl`). When absent, D1 writes are skipped. |
| `COST_API_TOKEN` | No | Bearer token for Cost API authentication. If empty but `COST_API_URL` is set, the request is sent with an empty token and the Worker will return 401 (logged as warning). |

## Testing

Run the validation commands to verify zero regressions:

```bash
bun run lint
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json
bun run build
```

To verify dual-write behavior manually: set `COST_API_URL` to a live `costs.paysdoc.nl` instance, run a workflow phase, and confirm the record appears in the D1 database via the Worker's query endpoint.

## Notes

- This is **PR 2 of the 3-PR staged rollout** defined in the D1 Cost Database PRD. PR 1 (Worker + D1 schema, #330) and its deployment (#331) are prerequisites. PR 3 will remove the CSV pipeline entirely.
- Unit tests are disabled for this project (`.adw/project.md`). No test files were added.
- The `issueDescription` field on the Worker's `IngestRecord` is intentionally omitted — it can be added in a future iteration.
- Re-exported env vars follow the barrel chain: `environment.ts` → `config.ts` → `core/index.ts`.
