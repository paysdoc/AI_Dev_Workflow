# PR Review Orchestrator & adwId Consolidation (`adwPrReview`)

## Overview

`adwPrReview.tsx` is the orchestrator that addresses unaddressed review comments on an open PR. It re-plans, re-implements, regenerates step definitions, re-runs unit and BDD scenario tests, and runs a bounded review→patch→retest loop. A single issue now accumulates exactly **one** adwId across both SDLC and PR-review runs: the `resolvePrReviewTarget` pure resolver discovers the issue's existing adwId (via the same "latest adwId in issue comments" resolver cron uses) or generates a fresh one for genuinely new work, and every trigger delegates to `resolvePrReviewSpawn` before spawning. On completion, `completePRReviewWorkflow` writes the terminal `workflowStage` (`awaiting_merge` on pass, `review_failed` on exhaustion) plus `orchestratorScript: 'adws/adwPrReview.tsx'`, enabling resume-routing (slice #721's `resolveResumeSpawn`) to route a later `## Retry` back to PR-review. `adwSdlc.tsx` mirrors the review-failed path via `decidePostReviewOutcome` + `executeSdlcReviewFailedHandoff`.

## Responsibilities

- **`resolvePrReviewTarget(pr, deps): PrReviewTarget`** (`adws/core/resolvePrReviewTarget.ts`): pure function with injected deps (`fetchIssueComments`, `generateAdwId`). Returns a discriminated union: `reuse` (issue-linked, existing adwId from latest issue comment), `fresh` (issue-linked, no adwId yet → generate one), or `skip` (not issue-linked → no ADW review/auto-merge).
- **`resolvePrReviewSpawn(prNumber, repoInfo)`** (`adws/triggers/webhookHandlers.ts`): impure delegation helper — calls `fetchPRDetails` + `resolvePrReviewTarget`; on `fresh`, seeds the new adwId's top-level state with `{ adwId, issueNumber, branchName, orchestratorScript: 'adws/adwPrReview.tsx' }`; returns `{ issueNumber, adwId }` or `null` (skip). Consumed by cron `checkPRsForReviewComments` and both webhook PR-review spawn sites.
- Parse CLI args in two forms via `resolvePrReviewInvocation`: canonical `<issueNumber> <adwId>` (two positionals, non-numeric second — re-resolves PR via persisted `branchName` using `defaultFindPRByBranch`) or legacy `<pr-number>` (single positional — routed through `resolvePrReviewSpawn`; issue-less PRs exit cleanly).
- Persist `orchestratorScript: 'adws/adwPrReview.tsx'` + `branchName` to top-level state at init (covers mid-run takeover) and again at completion (co-stamped with the terminal stage).
- Run the install phase, scenario test/fix phases, and step-def generation phase in order.
- Execute a bounded review→patch→retest loop (up to `MAX_REVIEW_RETRY_ATTEMPTS`), capturing `reviewPassed` on each iteration.
- Commit and push review changes via `executePRReviewCommitPushPhase`.
- Compute `PostReviewOutcome` via `decidePostReviewOutcome(reviewPassed)` and pass it to `completePRReviewWorkflow`.
- Post cost section, `pr_review_completed` comment, and write terminal stage to top-level state.
- **`completePRReviewWorkflow`**: gates on `outcome.workflowStage` presence — writes `awaiting_merge` on pass, `review_failed` on exhaustion, both with `orchestratorScript: 'adws/adwPrReview.tsx'`.
- **`executeSdlcReviewFailedHandoff`** (`sdlcReviewHandoff.ts`): called by `adwSdlc.tsx` when `decidePostReviewOutcome` returns `skipDocAndPR: true`; writes `workflowStage: 'review_failed'` to top-level state and posts the branch/retry issue comment.

## Contracts & Invariants

- **`resolvePrReviewTarget` is pure**: no I/O, no side effects. `issueNumber === null` → `skip`; issue-linked + existing adwId → `reuse`; issue-linked + no adwId → `fresh`. Neither `fetchIssueComments` nor `generateAdwId` is called on the `skip` path.
- **`extractLatestAdwId` is shared**: the same "newest-to-oldest scan of issue comments for an adwId" function used by cron (via `cronStageResolver` re-export) is imported from `adws/core/workflowCommentParsing.ts` by `resolvePrReviewTarget` — one implementation, two consumers.
- **One adwId per issue**: `initializePRReviewWorkflow` takes a required `adwId: string` (not nullable). The orchestrator never self-generates an adwId; the identity is always resolved upstream by `resolvePrReviewTarget`.
- **Fresh-path state seeding**: on the `fresh` path, `resolvePrReviewSpawn` writes `{ adwId, issueNumber, branchName, orchestratorScript }` to the new adwId's top-level state before spawning. This enables the orchestrator to resolve its PR from `state.branchName` uniformly in both reuse and fresh cases.
- **Reuse path self-heals**: the `reuse` path picks the latest adwId in the issue's comments. Issues that pre-date this feature and carry multiple adwIds converge to a single adwId after one PR-review cycle.
- **Issue-less skip is silent and clean**: cron `continue`s, webhook returns `{status:'ignored',reason:'not_issue_linked'}`. No spawn, no worktree, no log directory.
- **`isResumeMode` is evidence-based**: a fresh trigger-seed writes `branchName` but no `phases`; `isResumeMode = !!existingState?.phases && Object.keys(existingState.phases).length > 0`. The empty-comments early-exit fires correctly on fresh runs and is bypassed only for true resumes.
- **Pure gate**: `decidePostReviewOutcome(reviewPassed: boolean): PostReviewOutcome` is total and pure. `true` → `{ writeAwaitingMerge: true, workflowStage: 'awaiting_merge' }`; `false` → `{ writeAwaitingMerge: false, workflowStage: 'review_failed', skipDocAndPR: true }`.
- **Terminal write gated on `workflowStage` presence**: `completePRReviewWorkflow` writes whenever `outcome.workflowStage` is non-null — both pass and fail paths reach the write.
- **`orchestratorScript` co-stamped at completion**: every terminal write includes `orchestratorScript: 'adws/adwPrReview.tsx'`, so `resolveResumeSpawn` routes a later `## Retry` correctly.
- **Init write covers mid-run takeover**: `writeTopLevelState` at init persists `orchestratorScript` before any phase runs; the completion write is idempotent (same value).
- **Shallow-merge safety**: `writeTopLevelState` merges existing state, so `orchestratorScript` persists through `runPhase`'s `${phase}_running/_completed` writes and all terminal writes.
- **Back-compat default**: the `outcome` parameter on `completePRReviewWorkflow` defaults to `decidePostReviewOutcome(false)` (inert path → `review_failed`).
- **PhaseRunner / CostTracker composition**: each phase is wrapped in a `runPhase()` closure that handles rate-limit pausing and cost tracking.
- **`PRReviewWorkflowConfig`**: wraps a `base: WorkflowConfig` (which carries `adwId`, `orchestratorStatePath`, `repoContext`, etc.) plus PR-specific fields (`prNumber`, `prDetails`, `unaddressedComments`). PR-specific phase functions receive the full config; `WorkflowConfig`-typed phases receive `config.base`.

## Configuration

- CLI args (canonical form): `<issueNumber> <adwId> [targetRepoPath flags]` — second positional is non-numeric adwId; PR is resolved from persisted `branchName`
- CLI args (legacy manual fallback): `<prNumber> [targetRepoPath flags]` — routed through `resolvePrReviewSpawn`; issue-less PRs exit cleanly
- `MAX_REVIEW_RETRY_ATTEMPTS` — bounded review→patch loop cap (defined in `adwPrReview.tsx`)
- Relies on the same `.adw/commands.md` sections as other orchestrators (`## Install Dependencies`, `## Run Scenarios by Tag`, etc.)

## Gotchas

- **`review_failed` comment carries branch and retry instructions**: `formatReviewFailedComment` in `workflowCommentsIssue.ts` appends `**Branch:** \`<branchName>\`` and a `## Retry` instruction line so operators know where to push a fix.
- **`orchestratorScript: 'adws/adwPrReview.tsx'` is load-bearing for `## Retry` routing**: `resolveResumeSpawn` uses it to route a later takeover back to `adwPrReview` rather than SDLC. If a `review_failed` state lacks this field (legacy pre-feature adwIds), `resolveResumeSpawn` defaults to SDLC.
- **`resolvePrReviewSpawn` must not be called from `adws/core/`**: it does I/O (`fetchPRDetails`, `fetchIssueCommentsRest`, `writeTopLevelState`). It lives in `adws/triggers/webhookHandlers.ts`; the pure `resolvePrReviewTarget` lives in `adws/core/`.
- **No double-overwrite**: `completePRReviewWorkflow` writes execution state to `orchestratorStatePath` (the agent state file) and the terminal stage + `orchestratorScript` to the top-level state file (`agents/<adwId>/state.json`). These are distinct files.
- **`reviewPassed` must be hoisted**: the review→patch loop uses `break` on success. `reviewPassed` must be declared before the loop and assigned on each iteration (mirroring `adwSdlc.tsx`), or the value is lost when the loop exits by exhaustion.
- **Phase functions typed for `WorkflowConfig`**: phases like `executeScenarioTestPhase` expect `WorkflowConfig`, not `PRReviewWorkflowConfig`. Pass `config.base` at those call sites.
- **`sdlcReviewHandoff.ts` is isolated for testability**: extracted from `adwSdlc.tsx` main() so BDD scenarios can drive the SDLC review-failed handoff without spawning a full orchestrator subprocess.
- **Reuse path does not re-seed branchName**: on `reuse`, the SDLC adwId's state already carries `branchName` (feature sh8m9r). `adwPrReview` itself co-stamps `orchestratorScript` on init ("overwrite on takeover"). No pre-seed needed.
- **Multiple pre-existing adwIds on an issue (legacy)**: `extractLatestAdwId` picks the newest; the issue self-heals to a single adwId after one PR-review cycle.
