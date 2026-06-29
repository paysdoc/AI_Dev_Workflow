# PR Review Orchestrator (`adwPrReview`)

## Overview

`adwPrReview.tsx` is the orchestrator that addresses unaddressed review comments on an open PR. It re-plans, re-implements, regenerates step definitions, re-runs unit and BDD scenario tests, and runs a bounded review→patch→retest loop. On completion it calls `completePRReviewWorkflow` in `prReviewCompletion.ts`, which writes the terminal `workflowStage` (`awaiting_merge` on pass, `review_failed` on exhaustion) along with `orchestratorScript: 'adws/adwPrReview.tsx'` to the top-level state — enabling the cron to route a `## Retry` back to PR-review rather than SDLC. `adwSdlc.tsx` mirrors this gate via `decidePostReviewOutcome` + `executeSdlcReviewFailedHandoff` for its own review-exhaustion path.

## Responsibilities

- Parse CLI args in two forms: fresh `<prNumber>` (single positional) or resume `<issueNumber> <adwId>` (two positionals, non-numeric second) via `resolvePrReviewInvocation`; on resume, re-resolve the PR from the persisted `branchName` via `defaultFindPRByBranch`
- Persist `orchestratorScript: 'adws/adwPrReview.tsx'` + `branchName` to top-level state at init (covers mid-run takeover) and again at completion (co-stamped with the terminal stage)
- Run the install phase, scenario test/fix phases, and step-def generation phase in order
- Execute a bounded review→patch→retest loop (up to `MAX_REVIEW_RETRY_ATTEMPTS`), capturing `reviewPassed` on each iteration
- Commit and push review changes via `executePRReviewCommitPushPhase`
- Compute `PostReviewOutcome` via `decidePostReviewOutcome(reviewPassed)` and pass it to `completePRReviewWorkflow`
- Post cost section, `pr_review_completed` comment, and write terminal stage to top-level state
- **`completePRReviewWorkflow`**: gates on `outcome.workflowStage` presence (not `writeAwaitingMerge`) — writes `awaiting_merge` on pass, `review_failed` on exhaustion, both with `orchestratorScript: 'adws/adwPrReview.tsx'`; logs a success or warn line accordingly
- **`executeSdlcReviewFailedHandoff`** (`sdlcReviewHandoff.ts`): called by `adwSdlc.tsx` when `decidePostReviewOutcome` returns `skipDocAndPR: true`; writes `workflowStage: 'review_failed'` to top-level state and posts the branch/retry issue comment

## Contracts & Invariants

- **Pure gate**: `decidePostReviewOutcome(reviewPassed: boolean): PostReviewOutcome` is a total pure function — no I/O. `true` → `{ writeAwaitingMerge: true, workflowStage: 'awaiting_merge' }`; `false` → `{ writeAwaitingMerge: false, workflowStage: 'review_failed', skipDocAndPR: true }`.
- **Terminal write gated on `workflowStage` presence**: `completePRReviewWorkflow` writes whenever `outcome.workflowStage` is non-null — both pass and fail paths reach the write. The earlier `writeAwaitingMerge`-only gate was the bug fixed by this feature.
- **`orchestratorScript` co-stamped at completion**: every terminal write includes `orchestratorScript: 'adws/adwPrReview.tsx'`, so the `review_failed` state the BDD fail-path driver observes carries the routing tag even when only the completion handler runs (not the init).
- **Init write covers mid-run takeover**: `writeTopLevelState` at init persists `orchestratorScript` before any phase runs; the completion write is idempotent (same value). Together they guarantee the tag is present at every observable checkpoint.
- **Shallow-merge safety**: `writeTopLevelState` merges (`{ ...existing, ...state }`), so the `orchestratorScript` field persists through `runPhase`'s `${phase}_running/_completed` writes and all subsequent terminal writes.
- **Resume-mode bypass**: when `initializePRReviewWorkflow` is called in resume mode (`adwId !== null` and a prior top-level state exists), the `unaddressedComments.length === 0 → process.exit(0)` early-exit is skipped so the review re-runs even after the human's fix resolved the PR threads.
- **Back-compat default**: the `outcome` parameter on `completePRReviewWorkflow` defaults to `decidePostReviewOutcome(false)` (inert path → `review_failed`); existing callers that omit it now write `review_failed` rather than silently no-oping.
- **PhaseRunner / CostTracker composition**: each phase is wrapped in a `runPhase()` closure that handles rate-limit pausing and cost tracking; adding a new phase follows the same closure-wrapper pattern.
- **`PRReviewWorkflowConfig`**: wraps a `base: WorkflowConfig` (which carries `adwId`, `orchestratorStatePath`, `repoContext`, etc.) plus PR-specific fields (`prNumber`, `prDetails`, `unaddressedComments`). PR-specific phase functions receive the full config; `WorkflowConfig`-typed phases receive `config.base`.

## Configuration

- CLI args (fresh form): `<prNumber> [targetRepoPath flags]`
- CLI args (resume form): `<issueNumber> <adwId> [targetRepoPath flags]` — second positional must be non-numeric
- `MAX_REVIEW_RETRY_ATTEMPTS` — bounded review→patch loop cap (defined in `adwPrReview.tsx`)
- Relies on the same `.adw/commands.md` sections as other orchestrators (`## Install Dependencies`, `## Run Scenarios by Tag`, etc.)

## Gotchas

- **`review_failed` comment carries branch and retry instructions**: `formatReviewFailedComment` in `workflowCommentsIssue.ts` appends `**Branch:** \`<branchName>\`` and a `## Retry` instruction line so operators know exactly where to push a fix.
- **adwId discoverability from issue comments**: the `review_failed` comment that PR-review posts to the **issue** carries `**ADW ID:** \`<prReviewAdwId>\`` — `extractAdwIdFromComment` matches it, so `retryHandler` and `evaluateCandidate` resolve the PR-review adwId without needing the full adwId-consolidation slice.
- **adwId ownership (fresh vs resume)**: fresh runs self-generate the adwId. Resume runs reuse the adwId from the second positional CLI arg. Full adwId discovery/reuse from issue comments and cron PR-comment polling is deferred to slice #4.
- **No double-overwrite**: `completePRReviewWorkflow` writes execution state to `orchestratorStatePath` (the agent state file) and the terminal stage + `orchestratorScript` to the top-level state file (`agents/<adwId>/state.json`). These are distinct files.
- **`reviewPassed` must be hoisted**: the review→patch loop uses `break` on success. `reviewPassed` must be declared before the loop and assigned on each iteration (mirroring `adwSdlc.tsx`), or the value is lost when the loop exits by exhaustion.
- **Phase functions typed for `WorkflowConfig`**: phases like `executeScenarioTestPhase` expect `WorkflowConfig`, not `PRReviewWorkflowConfig`. Pass `config.base` at those call sites.
- **`sdlcReviewHandoff.ts` is isolated for testability**: extracted from `adwSdlc.tsx` main() so BDD scenarios can drive the SDLC review-failed handoff without spawning a full orchestrator subprocess.
