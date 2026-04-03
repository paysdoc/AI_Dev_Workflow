# Orchestrators Exit After PR Approval with `awaiting_merge` Handoff

**ADW ID:** xngqn4-orchestrators-exit-a
**Date:** 2026-04-03
**Specification:** specs/issue-380-adw-xngqn4-orchestrators-exit-a-sdlc_planner-orchestrators-awaiting-merge-handoff.md

## Overview

All four orchestrators (`adwSdlc.tsx`, `adwChore.tsx`, `adwPlanBuildReview.tsx`, `adwPlanBuildTestReview.tsx`) were restructured so that no worktree-dependent phase runs after PR creation. After PR creation, each orchestrator approves the PR via the GitHub API and writes `awaiting_merge` to the top-level workflow state file, then exits — decoupling orchestrator completion from merge execution.

## What Was Built

- Removed `executeAutoMergePhase` from all four orchestrators
- Added post-PR approval + `awaiting_merge` state write inline in each orchestrator
- Reordered phases in `adwSdlc.tsx`: KPI phase now runs before PR creation
- Reordered phases in `adwChore.tsx`: DiffEvaluation phase now runs before PR creation; Document phase (regression path) now runs before PR creation
- `awaiting_merge` added as a valid `WorkflowStage` union value in `adws/types/workflowTypes.ts`
- `deriveOrchestratorScript` helper moved from `workflowCompletion.ts` to `adws/core/orchestratorLib.ts`
- `completeWorkflow`, `handleRateLimitPause`, and `handleWorkflowError` now all write their respective lifecycle stages (`completed`, `paused`, `abandoned`) to the top-level state file
- New BDD feature file `features/orchestrators_awaiting_merge_handoff.feature` covering all acceptance criteria
- New step definitions in `features/step_definitions/orchestratorsAwaitingMergeHandoffSteps.ts`

## Technical Implementation

### Files Modified

- `adws/adwSdlc.tsx`: Removed `executeAutoMergePhase`; moved `executeKpiPhase` before `executePRPhase`; added inline post-PR approval + `awaiting_merge` write
- `adws/adwChore.tsx`: Removed `executeAutoMergePhase`; moved `executeDiffEvaluationPhase` before `executePRPhase`; added inline post-PR approval + `awaiting_merge` write in both safe and regression paths
- `adws/adwPlanBuildReview.tsx`: Removed `executeAutoMergePhase`; added inline post-PR approval + `awaiting_merge` write
- `adws/adwPlanBuildTestReview.tsx`: Removed `executeAutoMergePhase`; added inline post-PR approval + `awaiting_merge` write
- `adws/phases/workflowCompletion.ts`: Added `writeTopLevelState('completed')` in `completeWorkflow`, `writeTopLevelState('paused')` in `handleRateLimitPause`, `writeTopLevelState('abandoned')` in `handleWorkflowError`; removed `deriveOrchestratorScript` (moved to `orchestratorLib.ts`)
- `adws/core/orchestratorLib.ts`: Added `deriveOrchestratorScript` helper
- `adws/types/workflowTypes.ts`: Added `'awaiting_merge'` to `WorkflowStage` union type
- `features/auto_approve_merge_after_review.feature`: Updated scenarios asserting orchestrators do not call `executeAutoMergePhase`
- `features/build_agent_routing_pipeline.feature`: Updated adwSdlc phase ordering table (kpi moved before pr)

### Key Changes

- **Post-PR handoff pattern**: Each orchestrator now calls `approvePR()` (guarded by `isGitHubAppConfigured()`) then `AgentStateManager.writeTopLevelState(adwId, { workflowStage: 'awaiting_merge' })` immediately after `executePRPhase`. Approval failure is non-fatal (logged as warning).
- **Phase reordering**: Worktree-dependent phases (KPI in SDLC, DiffEval in Chore, Document in Chore regression path) were moved before `executePRPhase` to ensure the worktree is no longer needed after PR creation.
- **Lifecycle state completeness**: `completeWorkflow`, `handleRateLimitPause`, and `handleWorkflowError` now all write their terminal state to the top-level state file, giving a consistent state machine across all exit paths.
- **`executeAutoMergePhase` preserved**: The function remains in `adws/phases/autoMergePhase.ts` and is still exported from `adws/workflowPhases.ts` for future use by a dedicated `adwMerge.tsx` handler.

## How to Use

No user-facing changes. The orchestrators continue to be invoked the same way:

```bash
bunx tsx adws/adwSdlc.tsx <issueNumber> [targetRepo]
bunx tsx adws/adwChore.tsx <issueNumber> [targetRepo]
bunx tsx adws/adwPlanBuildReview.tsx <issueNumber> [targetRepo]
bunx tsx adws/adwPlanBuildTestReview.tsx <issueNumber> [targetRepo]
```

After a successful run, the top-level state file at `projects/<adwId>/state.json` will contain `"workflowStage": "awaiting_merge"` instead of `"workflowStage": "completed"`. The PR will be approved and ready for a merge handler to process.

## Configuration

- `isGitHubAppConfigured()` — PR approval is skipped if the GitHub App is not configured; `awaiting_merge` is still written to state
- No new environment variables introduced

## Testing

```bash
# Run new BDD scenarios for this feature
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-380"

# Run full regression suite
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"

# TypeScript type-check
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json
```

## Notes

- `adwMerge.tsx` (the future merge handler that will consume `awaiting_merge` state) is out of scope for this issue.
- `autoMergePhase.ts` is intentionally not deleted — it is preserved for the webhook/merge handler path.
- The internal audit messages in `diffEvaluationPhase.ts` ("Auto-approving and merging" / "Escalating to review → document → auto-merge") were not updated; that is a follow-up task.
- The escalation comment in `adwChore.tsx` was updated from "review → document → auto-merge" to "review → document → PR" to reflect the new flow.
