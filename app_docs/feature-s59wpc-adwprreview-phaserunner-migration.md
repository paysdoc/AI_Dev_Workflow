# PR Review Orchestrator (`adwPrReview`)

## Overview

`adwPrReview.tsx` is the orchestrator that addresses unaddressed review comments on an open PR. It re-plans, re-implements, regenerates step definitions, re-runs unit and BDD scenario tests, and runs a bounded review→patch→retest loop. On completion it calls `completePRReviewWorkflow` in `prReviewCompletion.ts`, which posts the cost section and final comment to the PR, then — when the review passed — writes `workflowStage: 'awaiting_merge'` to the top-level state so the cron merge dispatch picks it up. When the review did not pass, the completion path stays inert (no `awaiting_merge`).

## Responsibilities

- Parse CLI args (`prNumber`, `adwId`, target-repo path, optional `--pr-details`) and initialize `PRReviewWorkflowConfig`
- Run the install phase, scenario test/fix phases, and step-def generation phase in order
- Execute a bounded review→patch→retest loop (up to `MAX_REVIEW_RETRY_ATTEMPTS`), capturing `reviewPassed` on each iteration
- Commit and push review changes via `executePRReviewCommitPushPhase`
- Compute `PostReviewOutcome` via `decidePostReviewOutcome(reviewPassed)` and pass it to `completePRReviewWorkflow`
- Post cost section, `pr_review_completed` comment, and hand off to cron merge dispatch when the review passed

## Contracts & Invariants

- **Pure gate**: `decidePostReviewOutcome(reviewPassed: boolean): PostReviewOutcome` is a total pure function — no I/O, no side effects. `true` → `{ writeAwaitingMerge: true, workflowStage: 'awaiting_merge' }`; `false` → `{ writeAwaitingMerge: false, workflowStage: null }`.
- **Conditional handoff**: `completePRReviewWorkflow` writes `workflowStage: 'awaiting_merge'` to `agents/<adwId>/state.json` (via `AgentStateManager.writeTopLevelState`) **only** when `outcome.writeAwaitingMerge` is true. A failed or exhausted review leaves the top-level state untouched.
- **Back-compat default**: the `outcome` parameter on `completePRReviewWorkflow` defaults to `decidePostReviewOutcome(false)` (inert), so existing callers that omit it see no behaviour change.
- **Partial-write safety**: `writeTopLevelState` merges (`{ ...existing, ...state }`), so writing only `{ workflowStage: 'awaiting_merge' }` preserves all prior top-level fields.
- **Merge by existing dispatch**: writing `awaiting_merge` is sufficient — cron's `cronIssueFilter.ts` already dispatches `adwMerge` for that stage. No new merge mechanism is introduced.
- **PhaseRunner / CostTracker composition**: each phase is wrapped in a `runPhase()` closure that handles rate-limit pausing and cost tracking; adding a new phase follows the same closure-wrapper pattern.
- **`PRReviewWorkflowConfig`**: wraps a `base: WorkflowConfig` (which carries `adwId`, `orchestratorStatePath`, `repoContext`, etc.) plus PR-specific fields (`prNumber`, `prDetails`, `unaddressedComments`). PR-specific phase functions receive the full config; `WorkflowConfig`-typed phases receive `config.base`.

## Configuration

- CLI args: `<prNumber> <adwId> <targetRepoPath> [--pr-details <json>]`
- `MAX_REVIEW_RETRY_ATTEMPTS` — bounded review→patch loop cap (defined in `adwPrReview.tsx`)
- Relies on the same `.adw/commands.md` sections as other orchestrators (`## Install Dependencies`, `## Run Scenarios by Tag`, etc.)

## Gotchas

- **adwId discoverability**: PR-review uses its own generated adwId (not the originating issue's adwId). Cron finds the adwId by scanning the *issue's* comments. Until the adwId-consolidation slice lands (later PRD slice), the end-to-end cron-finds-it-and-merges path is not fully drivable by BDD alone.
- **No double-overwrite**: `completePRReviewWorkflow` writes execution state to `orchestratorStatePath` (the agent state file), not to the top-level stage — so writing `awaiting_merge` to the top-level state is not clobbered. This differs from the SDLC `completeWorkflow` pattern, where there is a caveat about ordering.
- **`reviewPassed` must be hoisted**: the review→patch loop uses `break` on success. `reviewPassed` must be declared *before* the loop and assigned inside it on each iteration (mirroring `adwSdlc.tsx`), or the value is lost when the loop exits normally (exhausted) vs. early (passed).
- **Phase functions typed for `WorkflowConfig`**: phases like `executeScenarioTestPhase` expect `WorkflowConfig`, not `PRReviewWorkflowConfig`. Pass `config.base` at those call sites.
