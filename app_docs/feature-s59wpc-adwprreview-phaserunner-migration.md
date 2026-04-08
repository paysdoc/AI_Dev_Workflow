# Feature: Migrate adwPrReview to phaseRunner

**ADW ID:** s59wpc-adwprreview-migrated
**Date:** 2026-04-08
**Specification:** specs/issue-398-adw-s59wpc-adwprreview-migrated-sdlc_planner-migrate-prreview-to-phaserunner.md

## Overview

Refactors `adwPrReview.tsx` to use the shared `CostTracker` + `runPhase()` infrastructure from `core/phaseRunner.ts`, replacing hand-rolled cost accumulation, rate-limit handling, and token persistence. This is the last orchestrator to be migrated, resolving four behavioural disparities between PR review and every other workflow: no top-level state transitions, no rate-limit pause/resume, bespoke D1 cost posting, and manual cost accumulation boilerplate.

## What Was Built

- `adwPrReview.tsx` rewritten to use `CostTracker` + `runPhase()` with closure-wrapper pattern for PR-specific phases
- `PRReviewWorkflowConfig` restructured to embed a `base: WorkflowConfig` field, unlocking `runPhase()` compatibility
- All three PR review phase functions (`executePRReviewPlanPhase`, `executePRReviewBuildPhase`, `executePRReviewTestPhase`) updated to return `phaseCostRecords: PhaseCostRecord[]` satisfying the `PhaseResult` contract
- Bespoke `postCostRecordsToD1` call removed from `buildPRReviewCostSection` — D1 posting now happens per-phase via `tracker.commit()` inside `runPhase`
- Manual `RateLimitError` catch block removed from `adwPrReview.tsx` — `runPhase` handles it
- BDD feature file and step definitions added for the migration (`pr_review_phaserunner_migration.feature`)

## Technical Implementation

### Files Modified

- `adws/adwPrReview.tsx`: Replaced hand-rolled cost accumulation, inline install block, and `RateLimitError` catch with `CostTracker` + `runPhase()`. Removed ~50 lines of boilerplate.
- `adws/phases/prReviewPhase.ts`: Added `base: WorkflowConfig` to `PRReviewWorkflowConfig`. Updated `initializePRReviewWorkflow` to construct and populate `base`. Added `phaseCostRecords` return to `executePRReviewPlanPhase` and `executePRReviewBuildPhase`.
- `adws/phases/prReviewCompletion.ts`: Added `phaseCostRecords` return to `executePRReviewTestPhase`. Removed `postCostRecordsToD1` import and call from `buildPRReviewCostSection`. Updated field access to use `config.base.*`.
- `features/pr_review_phaserunner_migration.feature`: New BDD feature file with acceptance scenarios.
- `features/step_definitions/adwPrReviewPhaseRunnerMigrationSteps.ts`: New step definitions for the migration feature.

### Key Changes

- **Closure-wrapper pattern**: PR-specific phases that need `PRReviewWorkflowConfig` are wrapped: `_ => executePRReviewPlanPhase(config)`. Shared phases like `executeInstallPhase` are passed directly.
- **`base: WorkflowConfig` composition**: `PRReviewWorkflowConfig` now has a `base` field containing `WorkflowConfig`, enabling `runPhase(config.base, tracker, ...)` calls. PR-specific fields (`prNumber`, `prDetails`, `unaddressedComments`, `ctx`) remain top-level.
- **Phase cost records**: Each phase now creates `PhaseCostRecord[]` via `createPhaseCostRecords(...)` and returns them. `runPhase` commits these to D1 via `tracker.commit()` after the phase completes.
- **`issueStub` construction**: `initializePRReviewWorkflow` synthesises a `GitHubIssue` stub from PR details to satisfy the `WorkflowConfig.issue` field required by `phaseRunner`.
- **Rate-limit handling**: The `pr-review-orchestrator` → `adwPrReview` mapping already existed in `deriveOrchestratorScript`, so pause/resume works automatically after the migration.

## How to Use

The PR review orchestrator is invoked the same way as before:

```sh
bunx tsx adws/adwPrReview.tsx <prNumber> [targetRepo]
```

No new configuration is required. The orchestrator now:
1. Writes top-level state on each phase transition (`install`, `pr_review_plan`, `pr_review_build`, `pr_review_test`)
2. Pauses on rate limits and exits 0 — the cron will resume from the last completed phase
3. Posts D1 cost records per-phase via the shared `phaseRunner` path

## Configuration

No new environment variables. Existing variables apply:
- `GITHUB_TOKEN` — GitHub authentication
- `COST_API_URL` / `COST_API_TOKEN` — D1 cost posting (unchanged, now via `phaseRunner`)

## Testing

Run the full test suite:

```sh
bun run test
```

The existing `adws/core/__tests__/phaseRunner.test.ts` covers `CostTracker` accumulation, `runPhase()` rate-limit handling, phase skip-on-resume, and top-level state writes. The new BDD scenarios in `features/pr_review_phaserunner_migration.feature` cover the acceptance criteria end-to-end.

## Notes

- `buildPRReviewCostSection` still creates `phaseCostRecords` locally for formatting the GitHub comment cost section (`ctx.costSection`). This is separate from the per-phase D1 posting now handled by `runPhase`.
- `completePRReviewWorkflow` is not wrapped in `runPhase` — it is a completion step (commit, push, post comment), not a cost-producing phase.
- `config.ctx` and `config.base.ctx` point to the same `PRReviewWorkflowContext` object. The closure-wrapper pattern ensures phase functions receive the full `PRReviewWorkflowConfig` with the correct `ctx` type.
- `issueNumber` in `base` is `0` when the PR has no associated issue; `createPhaseCostRecords` handles this sentinel value correctly.
