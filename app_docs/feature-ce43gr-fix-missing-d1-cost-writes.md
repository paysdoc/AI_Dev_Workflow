# Fix: Missing D1 Cost Writes + Worker Observability

**ADW ID:** ce43gr-fix-missing-d1-cost
**Date:** 2026-03-30
**Specification:** specs/issue-344-adw-ce43gr-fix-missing-d1-cost-sdlc_planner-fix-d1-cost-writes.md

## Overview

Four orchestrators (`adwInit`, `adwPlan`, `adwDocument`, `adwPrReview`) were silently dropping cost data — they wrote to the local state file only and never posted to D1. This fix migrates the two simplest orchestrators to `CostTracker`/`runPhase` and adds direct `createPhaseCostRecords` + `postCostRecordsToD1` calls to the remaining two. Additionally, both Cloudflare Workers now have `[observability]` enabled so D1 write requests are visible in Worker logs.

## What Was Built

- **`adwPlan.tsx`** fully migrated to `CostTracker` + `runPhase` (install and plan phases)
- **`adwInit.tsx`** fully migrated to `CostTracker` + `runPhase`; inline agent call extracted into a local `executeInitPhase` function returning `PhaseResult`
- **`adwDocument.tsx`** augmented with direct `createPhaseCostRecords` + `postCostRecordsToD1` (fire-and-forget) after the document agent completes
- **`adwPrReview.tsx`** augmented with a `commitPhaseToD1` helper; D1 writes added after install, plan, and build phases (test phase already wrote to D1)
- **`workers/cost-api/wrangler.toml`** — `[observability] enabled = true` added
- **`workers/screenshot-router/wrangler.toml`** — `[observability] enabled = true` added

## Technical Implementation

### Files Modified

- `adws/adwPlan.tsx`: Replaced manual `persistTokenCounts`/`mergeModelUsageMaps` accumulation with `CostTracker` + `runPhase`; `handleWorkflowError` now receives tracker totals
- `adws/adwInit.tsx`: Extracted inline `/adw_init` agent call into `executeInitPhase(config): Promise<PhaseResult>`; migrated both init and PR phases to `CostTracker` + `runPhase`; added `RateLimitError` handling via `handleRateLimitPause`
- `adws/adwDocument.tsx`: Added `createPhaseCostRecords` + `void postCostRecordsToD1(...)` after agent completion; fires for both success and failure paths; uses `issueNumber: 0` (document workflows are not issue-scoped)
- `adws/adwPrReview.tsx`: Added module-level `commitPhaseToD1(config, phaseName, modelUsage)` helper; called after install, plan, and build phases; skips empty `modelUsage` maps
- `workers/cost-api/wrangler.toml`: Added `[observability]\nenabled = true` section (file was previously absent from the repo)
- `workers/screenshot-router/wrangler.toml`: Added `[observability]\nenabled = true` section

### Key Changes

- **Root cause**: The four orchestrators predated the `CostTracker`/`runPhase` abstraction in `adws/core/phaseRunner.ts`. They used `persistTokenCounts()` which only writes to a local `.json` state file, never calling `postCostRecordsToD1()`.
- **Two migration patterns**: `adwPlan` and `adwInit` gain full `CostTracker` integration (automatic D1 writes via `tracker.commit()` inside `runPhase`). `adwDocument` and `adwPrReview` cannot use `CostTracker` (no `WorkflowConfig` / different config type), so they call `createPhaseCostRecords` + `postCostRecordsToD1` directly — matching the existing pattern in `prReviewCompletion.ts`.
- **Fire-and-forget safety**: `postCostRecordsToD1` silently skips when `COST_API_URL` is unset and never throws. The `void` prefix prevents unhandled-promise warnings without blocking the orchestrator.
- **Worker observability**: Enabling `[observability]` surfaces Worker logs in the Cloudflare dashboard, making it possible to confirm whether D1 write requests arrive and what errors occur.

## How to Use

No action required. D1 cost writes now happen automatically for all four orchestrators:

1. Run any of the affected workflows as normal:
   - `bunx tsx adws/adwPlan.tsx <issueNumber>`
   - `bunx tsx adws/adwInit.tsx <issueNumber>`
   - `bunx tsx adws/adwDocument.tsx <adwId> <specPath>`
   - `bunx tsx adws/adwPrReview.tsx`
2. After the workflow completes, cost records appear in the `adw-costs` D1 database under the workflow's `adwId`.
3. Worker logs for `cost-api` are now visible in the Cloudflare dashboard under **Workers & Pages → cost-api → Logs**.

## Configuration

No new environment variables. Existing variables apply:

- `COST_API_URL` — URL of the cost-api Worker; if unset, D1 writes are silently skipped
- `COST_API_TOKEN` — Bearer token for the cost-api Worker
- `GITHUB_REPO_URL` — Used to derive the `project` field in cost records (repo name extracted via `.split('/').pop()`)

## Testing

```bash
bun run lint
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json
bun run build
```

To verify D1 writes end-to-end:
1. Set `COST_API_URL` and `COST_API_TOKEN` in `.env`
2. Run `bunx tsx adws/adwPlan.tsx <issueNumber>` against a test repo
3. Query the D1 database for records with the workflow's `adwId`

## Notes

- `durationMs: 0` is hardcoded in the new cost records for `adwDocument` and `adwPrReview` — duration tracking can be added in a future pass if needed.
- `adwPrReview` retains the existing `persistTokenCounts` calls for local state alongside the new D1 writes — both paths remain active.
- The `cost-api/wrangler.toml` file was entirely absent from the repo before this change (only the screenshot-router had one tracked). It is now committed.
