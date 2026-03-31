# Fix: Rate Limit Pause/Resume for Plan Orchestrator

**ADW ID:** 2sqt1r-error
**Date:** 2026-03-31
**Specification:** specs/issue-367-adw-2sqt1r-error-sdlc_planner-fix-rate-limit-plan-phase.md

## Overview

`adwPlan.tsx` was the only orchestrator that called phase functions directly instead of routing them through `runPhase()`. This caused rate limit errors (HTTP 429, overloaded/529) to propagate to `handleWorkflowError()` (exit 1) instead of `handleRateLimitPause()` (exit 0), preventing the pause queue scanner from picking up and retrying plan workflows. This fix aligns `adwPlan.tsx` with the `CostTracker` + `runPhase()` pattern used by every other orchestrator.

## What Was Built

- Refactored `adwPlan.tsx` to use `CostTracker` + `runPhase()` for both install and plan phases
- Added `'plan-orchestrator'` and `'chore-orchestrator'` mappings to `deriveOrchestratorScript()` in `workflowCompletion.ts`
- Added `RateLimitError` catch handler to `runPhasesParallel()` in `phaseRunner.ts`
- Added unit tests for `CostTracker` and `runPhase()` in `adws/core/__tests__/phaseRunner.test.ts`
- Added unit tests for structured JSONL rate-limit detection in `adws/core/__tests__/claudeStreamParser.test.ts`

## Technical Implementation

### Files Modified

- `adws/adwPlan.tsx`: Replaced manual phase calls + cost accumulation with `CostTracker` + `runPhase()`. Removed `persistTokenCounts` and `mergeModelUsageMaps` imports. Added `tracker.totalCostUsd` / `tracker.totalModelUsage` to both `completeWorkflow()` and `handleWorkflowError()` calls.
- `adws/phases/workflowCompletion.ts`: Added `'plan-orchestrator': 'adwPlan'` and `'chore-orchestrator': 'adwChore'` to `deriveOrchestratorScript()` nameMap — without these, a paused plan workflow would resume using `adwSdlc.tsx` (the fallback) instead of the correct script.
- `adws/core/phaseRunner.ts`: Wrapped `runPhasesParallel()` body in a try/catch that intercepts `RateLimitError` and calls `handleRateLimitPause()`, matching the existing behavior in `runPhase()`.
- `adws/core/__tests__/phaseRunner.test.ts`: New test file covering `CostTracker` accumulation and `runPhase()` rate-limit routing (mocks `handleRateLimitPause` to prevent process exit during tests).
- `adws/core/__tests__/claudeStreamParser.test.ts`: New test file covering structured JSONL detection for `rate_limit_event`, `overloaded_error`, `server_error`, and compaction events.

### Key Changes

- **Root cause fixed**: `adwPlan.tsx` now calls `runPhase()` which catches `RateLimitError` and delegates to `handleRateLimitPause()` (exit 0) instead of falling through to `handleWorkflowError()` (exit 1).
- **Cost tracking unified**: Manual `persistTokenCounts()` + `mergeModelUsageMaps()` boilerplate replaced by `CostTracker`, which handles accumulation and persistence automatically on each phase completion.
- **Resume script mapping fixed**: `deriveOrchestratorScript()` now correctly maps `'plan-orchestrator'` → `'adwPlan'` and `'chore-orchestrator'` → `'adwChore'`, preventing incorrect resume-script selection from the pause queue.
- **Parallel phase rate limit handling**: `runPhasesParallel()` now mirrors `runPhase()`'s `RateLimitError` catch, ensuring parallel phase runners also pause gracefully.
- **Cost survives failures**: `handleWorkflowError()` now receives `tracker.totalCostUsd` and `tracker.totalModelUsage`, so accumulated cost data is preserved even when a non-rate-limit error terminates the workflow.

## How to Use

The fix is transparent — no API or configuration changes are required.

1. Run a plan workflow as usual: `bunx tsx adws/adwPlan.tsx <issueNumber>`
2. If a rate limit is hit during the install or plan phase, the workflow will now exit 0 and enqueue itself in the pause queue.
3. The pause queue scanner will automatically resume the workflow using `adwPlan.tsx` (not `adwSdlc.tsx`) once the rate limit window passes.
4. A "paused" comment is posted to the GitHub issue; an "error" comment is no longer posted for rate limit events.

## Configuration

No new configuration required. Rate limit pause behavior is controlled by the existing pause queue scanner and `PAUSE_QUEUE_*` environment variables (unchanged).

## Testing

```bash
bun run test                          # Run all unit tests including new phaseRunner and claudeStreamParser tests
bunx tsc --noEmit -p adws/tsconfig.json  # Type-check adws module
bun run lint                          # Lint check
```

The new `adws/core/__tests__/phaseRunner.test.ts` file directly tests:
- `CostTracker` zero-initialization, cost accumulation, and model usage merging
- `runPhase()` calling `handleRateLimitPause()` on `RateLimitError` (mocked to prevent `process.exit`)
- `runPhase()` re-throwing non-`RateLimitError` errors to the caller

## Notes

- `handleRateLimitPause()` calls `process.exit(0)`, so `runPhase()` never actually re-throws for rate limit errors — the process ends cleanly. The `throw err` after `handleRateLimitPause()` in `runPhase()` is unreachable dead code for `RateLimitError` but correctly re-throws all other error types.
- All other orchestrators (`adwPlanBuild.tsx`, `adwChore.tsx`, `adwSdlc.tsx`, etc.) already used the correct `CostTracker` + `runPhase()` pattern — this fix brings `adwPlan.tsx` into alignment.
- See `app_docs/feature-chpy1a-generic-pipeline-runner-pause-resume.md` for full context on rate limit pause/resume mechanics.
