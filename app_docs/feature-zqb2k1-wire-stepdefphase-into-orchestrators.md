# Wire stepDefPhase into Orchestrators

**ADW ID:** zqb2k1-wire-stepdefphase-in
**Date:** 2026-04-08
**Specification:** specs/issue-397-adw-zqb2k1-wire-stepdefphase-in-sdlc_planner-wire-stepdef-into-orchestrators.md

## Overview

`executeStepDefPhase` was fully implemented in `adws/phases/stepDefPhase.ts` but never called by any orchestrator — making it dead code. This feature wires it into all five orchestrators that run build+test workflows so BDD step definitions are generated after code is built and before any test phase consumes them. This is a prerequisite for slice 6 (scenario test phase).

## What Was Built

- `executeStepDefPhase` wired into `adwSdlc.tsx` between build and test phases
- `executeStepDefPhase` wired into `adwPlanBuildTest.tsx` between build and test phases
- `executeStepDefPhase` wired into `adwPlanBuildTestReview.tsx` between build and test phases
- `executeStepDefPhase` wired into `adwChore.tsx` between build and test phases
- `executeStepDefPhase` wired into `adwPrReview.tsx` between build and test phases using an inline adapter pattern
- Phase tracked in the top-level state ledger via `phaseName: 'stepDef'` for skip-on-resume support
- New BDD feature file and step definitions for end-to-end validation of this wiring

## Technical Implementation

### Files Modified

- `adws/adwSdlc.tsx`: Added `executeStepDefPhase` import and `runPhase` call with `'stepDef'` phase name
- `adws/adwPlanBuildTest.tsx`: Added `executeStepDefPhase` import and `runPhase` call with `'stepDef'` phase name
- `adws/adwPlanBuildTestReview.tsx`: Added `executeStepDefPhase` import and `runPhase` call with `'stepDef'` phase name
- `adws/adwChore.tsx`: Added `executeStepDefPhase` import and `runPhase` call with `'stepDef'` phase name
- `adws/adwPrReview.tsx`: Added inline step-def execution with a `WorkflowConfig` adapter (non-fatal try/catch, manual cost accumulation)
- `features/wire_stepdef_phase_into_orchestrators.feature`: New BDD feature file with scenarios covering all five orchestrators
- `features/step_definitions/wireStepdefPhaseIntoOrchestratorsSteps.ts`: Step definitions for the new feature file

### Key Changes

- **Four `CostTracker`-based orchestrators** (`adwSdlc`, `adwPlanBuildTest`, `adwPlanBuildTestReview`, `adwChore`): A single `await runPhase(config, tracker, executeStepDefPhase, 'stepDef')` call inserted between `executeBuildPhase` and `executeTestPhase`. The `'stepDef'` string registers the phase in the top-level state file, enabling skip-on-resume.

- **`adwPrReview.tsx` inline adapter**: This orchestrator uses `PRReviewWorkflowConfig` (not `WorkflowConfig`) with manual cost management. An adapter object is constructed from the PR config's compatible fields (`orchestratorStatePath`, `adwId`, `issueNumber ?? prNumber`, `prDetails.body` → `issue.body`, `worktreePath`, `logsDir`, `installContext`), then `executeStepDefPhase` is called directly. Cost results are merged into running totals and token counts are persisted — matching the existing install-phase inline pattern in the same file. The call is wrapped in try/catch to remain non-fatal.

- **Non-fatal by design**: `executeStepDefPhase` catches all internal errors and returns zero-cost results. If no `.feature` files exist in the target repo, the agent returns early. Orchestrators are unaffected by step-def failures.

- **State ledger tracking**: Passing `'stepDef'` as the fourth argument to `runPhase` causes the phase runner to record `stepDef_running` and `stepDef_completed` entries in the top-level state file, enabling skip-on-resume when a workflow is restarted.

## How to Use

The step-def phase runs automatically — no configuration required. When any of the five orchestrators execute, step definitions are now generated between the build and test phases:

1. Run any workflow (e.g., `bunx tsx adws/adwSdlc.tsx <issueNumber>`)
2. After the build phase completes, `executeStepDefPhase` runs the step-def agent against the built code in the worktree
3. Step definition files are written to the worktree before the test phase starts
4. The phase is recorded in the top-level state file as `stepDef_completed`
5. On resume, the phase is skipped if already recorded as completed

## Configuration

No configuration required. The phase inherits all necessary paths from the existing `WorkflowConfig` or `PRReviewWorkflowConfig`.

## Testing

```bash
bun run test          # Vitest unit tests — verify no regressions
bun run lint          # ESLint — verify code quality
bunx tsc --noEmit     # Root project type-check
bunx tsc --noEmit -p adws/tsconfig.json  # adws subproject type-check
```

Manual smoke test: run an SDLC workflow against a feature issue with `@adw-{N}` scenarios and confirm step definition files are written to the worktree before the test phase runs.

## Notes

- The `adwPrReview` inline adapter casts to `unknown as WorkflowConfig` due to the structural mismatch between `PRReviewWorkflowConfig` and `WorkflowConfig`. This is intentional and safe — `executeStepDefPhase` only reads the subset of fields provided in the adapter.
- The four CostTracker-based orchestrators do not pass phase names to their existing `runPhase` calls (install, plan, build). Adding names to those calls is out of scope for this issue.
- This is a prerequisite for slice 6 (scenario test phase). Step definitions now exist in the worktree before any scenario execution phase runs.
