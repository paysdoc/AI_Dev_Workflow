# Orchestrators Exit After PR Approval with `awaiting_merge` Handoff

**ADW ID:** bpn4sv-orchestrators-exit-a
**Date:** 2026-04-03
**Specification:** specs/issue-380-adw-bpn4sv-orchestrators-exit-a-sdlc_planner-orchestrator-awaiting-merge-handoff.md

## Overview

All four review-capable orchestrators (`adwSdlc.tsx`, `adwChore.tsx`, `adwPlanBuildReview.tsx`, `adwPlanBuildTestReview.tsx`) have been restructured so that no worktree-dependent phase runs after PR creation. After `executePRPhase`, each orchestrator approves the PR via API call, writes `workflowStage: 'awaiting_merge'` to the top-level state file, then exits. Merge responsibility is fully delegated to the webhook-triggered auto-merge handler.

## What Was Built

- Removed `executeAutoMergePhase` from all four orchestrators (phase file retained for webhook use)
- Added inline approve-and-handoff block to each orchestrator after `executePRPhase`
- Moved worktree-dependent phases before PR creation:
  - `adwSdlc.tsx`: `executeKpiPhase` now runs before `executePRPhase`
  - `adwChore.tsx`: `executeDiffEvaluationPhase` and `executeDocumentPhase` (regression path) now run before `executePRPhase`
- Added `extractPrNumber()` helper to `adwBuildHelpers.ts`
- Wrote BDD step definitions for all new `orchestrator_awaiting_merge_handoff.feature` scenarios
- Updated `auto_approve_merge_after_review.feature` to remove obsolete `executeAutoMergePhase` assertions for the four orchestrators

## Technical Implementation

### Files Modified

- `adws/adwSdlc.tsx`: Removed `executeAutoMergePhase`; moved `executeKpiPhase` before `executePRPhase`; added approve + `awaiting_merge` write after PR
- `adws/adwChore.tsx`: Removed `executeAutoMergePhase`; moved `executeDiffEvaluationPhase` before PR; moved `executeDocumentPhase` before PR in regression path; restructured branching to converge on single post-PR block
- `adws/adwPlanBuildReview.tsx`: Removed `executeAutoMergePhase`; added approve + `awaiting_merge` write after PR
- `adws/adwPlanBuildTestReview.tsx`: Removed `executeAutoMergePhase`; added approve + `awaiting_merge` write after PR
- `adws/adwBuildHelpers.ts`: Added `extractPrNumber(prUrl)` utility function
- `features/auto_approve_merge_after_review.feature`: Removed scenarios asserting `executeAutoMergePhase` is imported/called in the four orchestrators
- `features/orchestrator_awaiting_merge_handoff.feature`: New BDD scenarios for the handoff pattern (pre-written)
- `features/step_definitions/orchestratorAwaitingMergeHandoffSteps.ts`: New step definitions for the handoff scenarios

### Key Changes

- **Phase ordering**: All worktree-dependent phases (KPI, DiffEval, Document) now complete before `executePRPhase`, enabling earlier worktree cleanup
- **Post-PR block** (identical across all four orchestrators):
  1. Extract PR number from `ctx.prUrl` via `extractPrNumber()`
  2. Check `hitl` label — if present, skip approval and post human-review comment
  3. Call `approvePR(prNumber, repoInfo)` when `isGitHubAppConfigured()` is true
  4. Write `workflowStage: 'awaiting_merge'` via `AgentStateManager.writeTopLevelState()`
- **`executeAutoMergePhase` preserved**: Removed from orchestrators but the phase file and exports remain intact for the webhook auto-merge handler (`adws/triggers/autoMergeHandler.ts`)
- **`adwChore.tsx` restructured**: Branching now splits only worktree phases (review + document in regression path); PR creation and handoff are shared by both `safe` and `regression_possible` paths

## How to Use

The orchestrators handle the handoff automatically — no operator intervention needed. After a workflow run:

1. The orchestrator completes all build, test, review, document, and KPI phases (all worktree-dependent)
2. The PR is created via `executePRPhase`
3. The PR is approved (unless `hitl` label is present)
4. `workflowStage: 'awaiting_merge'` is written to `agents/<adwId>/state.json`
5. The orchestrator exits — the worktree can now be released
6. The webhook-triggered auto-merge handler picks up the approved PR and merges it

To check the handoff state of a running workflow:
```sh
cat agents/<adwId>/state.json | jq .workflowStage
# → "awaiting_merge"
```

## Configuration

- **`hitl` label**: Add the `hitl` label to a GitHub issue to skip auto-approval. The orchestrator will post a comment (`## ✋ Awaiting human approval — PR #N ready for review`) and write `awaiting_merge` without approving.
- **GitHub App**: PR approval via `approvePR()` only fires when `isGitHubAppConfigured()` returns true (i.e., `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` are set). Without a GitHub App, `awaiting_merge` is still written but approval is skipped.

## Testing

Run the feature's BDD scenarios:
```sh
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-bpn4sv-orchestrators-exit-a"
```

Run full regression suite:
```sh
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

Run unit tests:
```sh
bun run test
```

## Notes

- `executeAutoMergePhase` and `adws/phases/autoMergePhase.ts` must NOT be deleted — they are still used by the webhook auto-merge path.
- The `approvePR()` function temporarily unsets `GH_TOKEN` to use the personal `gh auth login` identity (needed when the GitHub App authored the PR). This behavior is preserved in the inline approve block.
- `adwChore.tsx` safe path: `executeDiffEvaluationPhase` runs before PR. If the verdict is `safe`, no review/document phases execute, but PR + approve + `awaiting_merge` still run.
- `adwChore.tsx` regression path: DiffEval → escalation comment → review → document → PR → approve → `awaiting_merge`.
- If `executePRPhase` fails to populate `ctx.prUrl`, the approve block is skipped gracefully but `awaiting_merge` is still written.
