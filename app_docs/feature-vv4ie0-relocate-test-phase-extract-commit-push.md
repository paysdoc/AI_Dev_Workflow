# executePRReviewTestPhase Relocation + Commit+Push Extraction

**ADW ID:** vv4ie0-executeprreviewtestp
**Date:** 2026-04-08
**Specification:** specs/issue-402-adw-vv4ie0-executeprreviewtestp-sdlc_planner-relocate-test-phase-extract-commit-push.md

## Overview

This slice performs two structural cleanups to `prReviewCompletion.ts`, leaving it containing only terminal-state handlers. `executePRReviewTestPhase` is moved from `prReviewCompletion.ts` to `prReviewPhase.ts`, and the commit+push block is extracted from `completePRReviewWorkflow` into a new `executePRReviewCommitPushPhase` function wired via `runPhase` in the orchestrator.

## What Was Built

- Moved `executePRReviewTestPhase` from `prReviewCompletion.ts` to `prReviewPhase.ts` (pure relocation, no behavior change)
- Created new `executePRReviewCommitPushPhase` in `prReviewPhase.ts` that extracts commit agent invocation + branch push from `completePRReviewWorkflow`
- Wired `executePRReviewCommitPushPhase` via `runPhase` in `adwPrReview.tsx` between the scenario test loop and `completePRReviewWorkflow`
- Updated all export chains (`phases/index.ts`, `workflowPhases.ts`, `adws/index.ts`)
- Trimmed `completePRReviewWorkflow` to a true terminal handler: cost section + state write + completion comments + board status move + log banner only
- Removed backward-compat re-export block from `prReviewPhase.ts`

## Technical Implementation

### Files Modified

- `adws/phases/prReviewPhase.ts`: Received `executePRReviewTestPhase` (moved in) and new `executePRReviewCommitPushPhase`. Added imports for `runUnitTestsWithRetry`, `runE2ETestsWithRetry`, `runCommitAgent`, `pushBranch`, `inferIssueTypeFromBranch`, `postIssueStageComment`. Removed backward-compat re-export block. Also received `PRReviewWorkflowConfig.base: WorkflowConfig` composition from the prior slice.
- `adws/phases/prReviewCompletion.ts`: Removed `executePRReviewTestPhase` definition. Removed commit+push block from `completePRReviewWorkflow`. Cleaned up now-unused imports (`pushBranch`, `inferIssueTypeFromBranch`, `runCommitAgent`, `runUnitTestsWithRetry`, `runE2ETestsWithRetry`, `MAX_TEST_RETRY_ATTEMPTS`, `postIssueStageComment`). Now exports only `completePRReviewWorkflow` and `handlePRReviewWorkflowError`.
- `adws/phases/index.ts`: Updated `executePRReviewTestPhase` import source from `./prReviewCompletion` to `./prReviewPhase`. Added `executePRReviewCommitPushPhase` export.
- `adws/workflowPhases.ts`: Added `executePRReviewCommitPushPhase` to barrel export.
- `adws/index.ts`: Added `executePRReviewCommitPushPhase` to module root exports.
- `adws/adwPrReview.tsx`: Wired `executePRReviewCommitPushPhase` via `runPhase` after the scenario test loop and before `completePRReviewWorkflow`.

### Key Changes

- `prReviewCompletion.ts` is now a pure terminal-state file — it holds no phase-execution logic, only the final orchestrator handlers
- `executePRReviewCommitPushPhase` follows the closure-wrapper pattern: `runPhase(config.base, tracker, _ => executePRReviewCommitPushPhase(config), 'pr_review_commit_push')`
- The new commit+push phase posts `pr_review_committing` and `pr_review_pushed` stage comments and returns a proper `PhaseResult` capturing `runCommitAgent` cost data
- `completePRReviewWorkflow` retains `moveToStatus(issueNumber, BoardStatus.Review)` — moving the board status is a terminal action, not a phase side-effect
- The `PRReviewWorkflowConfig` shape (with `base: WorkflowConfig`) was already introduced in the prior slice; this slice accesses flat fields through `config.base.*`

## How to Use

The PR review orchestrator (`adwPrReview.tsx`) calls phases in order:
1. Initialize workflow
2. Plan phase
3. Build phase
4. Unit test phase
5. Scenario test loop (with fix retries)
6. **`executePRReviewCommitPushPhase`** — commits and pushes the branch
7. `completePRReviewWorkflow` — terminal handler

No configuration changes are needed. The commit+push phase is automatically wired and runs as part of every PR review workflow run.

## Configuration

No new configuration options. The phase inherits `worktreePath`, `branchName`, `logsDir`, and `repoContext` from `config.base`.

## Testing

- Run `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` to verify type correctness
- Run `bun run lint` and `bun run build` for static validation
- Run BDD acceptance scenarios: `bun run test:e2e --tags @issue-402` against `features/relocate_test_phase_extract_commit_push.feature`
- Manual smoke test: trigger a PR review workflow and confirm commit+push happens at the new phase boundary before `completePRReviewWorkflow`

## Notes

- `completePRReviewWorkflow` and `workflowCompletion.ts` now both contain only terminal-state handlers, fully resolving the anti-pattern identified in the parent PRD (`specs/prd/test-review-refactor.md`)
- `runCommitAgent` is `await`-ed and its result is captured — if it returns `AgentResult` with cost data, the phase builds proper `PhaseCostRecord[]`; if it returns void or zero cost, the phase returns a zero-cost `PhaseResult`
- The BDD step definitions in `features/step_definitions/relocateTestPhaseExtractCommitPushSteps.ts` contain code-inspection steps that verify `prReviewCompletion.ts` no longer exports phase functions and that `adwPrReview.tsx` calls the new phase
