# Skip Scenario Writer and Plan Validation on Resume

**ADW ID:** 1vil1v-skip-scenario-writer
**Date:** 2026-03-21
**Specification:** specs/issue-254-adw-1vil1v-skip-scenario-writer-sdlc_planner-skip-scenario-writer-on-resume.md

## Overview

When a user posts a `## Take action` comment to resume a workflow that has already progressed past the planning phase, the scenario writer and plan validation phases previously reran unnecessarily. This feature registers `plan_validating` in the recovery system and adds guards to both phases so they skip cleanly on resume, returning zero-cost results instead of re-executing.

## What Was Built

- Registration of `plan_validating` in `STAGE_ORDER` and `STAGE_HEADER_MAP` so the recovery system can detect it as a completed stage
- Recovery guard in `executeScenarioPhase` that skips execution when resuming past `plan_validating`
- Recovery guard in `executePlanValidationPhase` that skips execution when resuming past `plan_validating`
- `phaseCostRecords` added to the `executeScenarioPhase` return type (cost module integration)

## Technical Implementation

### Files Modified

- `adws/core/workflowCommentParsing.ts`: Added `'plan_validating'` to `STAGE_ORDER` between `'plan_committing'` and `'implementing'`; added `':mag: Validating Plan-Scenario Alignment': 'plan_validating'` to `STAGE_HEADER_MAP`
- `adws/phases/scenarioPhase.ts`: Added `shouldExecuteStage('plan_validating', recoveryState)` guard; updated return type to include `phaseCostRecords`; added phase cost record generation on success
- `adws/phases/planValidationPhase.ts`: Added `shouldExecuteStage('plan_validating', recoveryState)` guard with early return of zero-cost result

### Key Changes

- **Stage registration**: `plan_validating` was already a valid `WorkflowStage` type but was invisible to the recovery system. Adding it to `STAGE_ORDER` and `STAGE_HEADER_MAP` makes `shouldExecuteStage()` able to detect it as completed.
- **Guard threshold**: The cutoff is `plan_validating` (not `plan_created`). Both scenario writing and plan validation run in `Promise.all` — `plan_validating` is the first stage posted *after* that `Promise.all` resolves, making it a reliable indicator that both phases completed.
- **Phase-internal guards**: Skip logic lives inside the phase functions, not the orchestrators. All three orchestrators (`adwSdlc.tsx`, `adwPlanBuildTestReview.tsx`, `adwPlanBuildReview.tsx`) inherit the behavior for free without modification.
- **Failed scenario writer stays skipped**: If the scenario writer failed on the first run but `plan_validating` was posted, it is not retried on resume.
- **Cost module integration**: `executeScenarioPhase` now returns `phaseCostRecords` and records phase cost data on success, aligning it with the cost revamp conventions.

## How to Use

This feature is automatic — no user action is required.

1. When a workflow reaches the `plan_validating` stage, a `:mag: Validating Plan-Scenario Alignment` comment is posted to the issue.
2. If the workflow is later resumed via `## Take action`, the recovery system detects `plan_validating` as the last completed stage.
3. Both `executeScenarioPhase` and `executePlanValidationPhase` check `shouldExecuteStage('plan_validating', recoveryState)` at the top of their function bodies.
4. If recovery is at or past `plan_validating`, both phases log a skip message and return immediately with `{ costUsd: 0, modelUsage: emptyModelUsageMap(), ... }`.
5. The orchestrator's `Promise.all` resolves instantly for both phases, and the workflow continues from the implementing stage.

## Configuration

No configuration required. The skip behavior is fully automatic based on the recovery state detected from GitHub issue comments.

## Testing

BDD scenarios are in `features/skip_scenario_writer_on_resume.feature` (tagged `@adw-254 @regression`). They verify:

- `STAGE_ORDER` includes `plan_validating` in the correct position
- `STAGE_HEADER_MAP` maps the correct header text to `plan_validating`
- Both phase files destructure `recoveryState`, call `shouldExecuteStage`, log a skip message, and return zero-cost results
- Both phase files import `shouldExecuteStage` from `'../core'`
- TypeScript type-check passes with no errors

Run with: `bunx cucumber-js --tags @adw-254`

## Notes

- Fresh runs (no recovery) are unaffected: `shouldExecuteStage` returns `true` when `recoveryState.canResume` is `false`.
- Resuming before `plan_validating` (e.g., last stage is `plan_committing`) also reruns both phases, erring on the side of completeness.
- The intermediate validation sub-stages (`plan_resolving`, `plan_resolved`, `plan_validation_failed`) remain untracked in `STAGE_ORDER` — they are loop-internal or error terminals and do not need recovery detection.
