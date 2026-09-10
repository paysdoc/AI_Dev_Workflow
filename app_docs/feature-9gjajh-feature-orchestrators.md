# Feature & Utility Orchestrators

## Overview

This module contains the five top-level ADW orchestrator scripts — `adwPlan`, `adwBuild`, `adwTest`, `adwMerge`, and `adwUpgrade` — that drive a GitHub issue through the full AI development lifecycle. Each script owns one phase of the workflow, acquires a spawn lock before executing, and writes structured state files so the cron poller can advance the pipeline idempotently.

Since #820, every orchestrator in this module reaches the forge exclusively through `boundary.providers.*`/`config.repoContext.*` — none imports the legacy `adws/github/` free-function layer. `adwClearComments.tsx`'s `clearIssueComments(issueNumber, tracker: CommentClearingTracker)` takes a bound `IssueTracker` (`Pick<IssueTracker, 'fetchComments'|'getIssueTitle'|'deleteComment'>`) instead of a `repoInfo`; its documented `--repo owner/repo` CLI flag still works, now resolving to a `TargetRepoInfo` fed into `buildLaunchBoundary` rather than a raw `repoInfo` threaded through each call. `adwChore.tsx`'s pre-approval check reads `config.repoContext.issueTracker.fetchLabels(issueNumber)`/`config.repoContext.codeHost.approvePullRequest(prNumber)` instead of the legacy `issueHasLabel`/`approvePR`. `adwMerge.tsx`'s `MergeDeps.commentOnPR` field — declared and wired but never called — is gone. `buildDefaultDeps(boundary)` closes over the boundary's own `gitContext` and `providers.codeHost` and passes both into the real `mergeWithConflictResolution` (`adws/triggers/autoMergeHandler.ts`) at call time; since #821 that function's `gitContext` parameter is required (no internal fallback construction). `MergeDeps.mergeWithConflictResolution`'s own injected-seam signature stays `(prNumber, headBranch, baseBranch, worktreePath, adwId, logsDir, specPath)` — `codeHost` and `gitContext` are closed over by `buildDefaultDeps`, not part of the caller-facing seam. `adwPrReview.tsx`'s `main()` now builds `buildLaunchBoundary(targetRepo)` BEFORE resolving which PR to review (`resolvePrReviewInvocation`, `app_docs/feature-9gjajh-pr-and-merge-phases.md`) rather than after — the branch→PR lookup itself now runs through the boundary's code host instead of a pre-boundary legacy call.

## Responsibilities

- **adwPlan**: Fetches and classifies a GitHub issue, creates a feature branch and worktree, runs the plan agent to produce `specs/issue-{number}-plan.md`, commits the plan, and posts a completion comment.
- **adwBuild**: Verifies the plan file exists, runs the install phase followed by the build agent to implement the plan, commits the implementation, and finalises workflow state.
- **adwTest**: Runs the unit-test and BDD scenario phase (tagged `@adw-{issueNumber}`), retries on failure up to `MAX_TEST_RETRY_ATTEMPTS` (default 5), and records `unitTestsPassed` and `totalTestRetries` in the completion metadata.
- **adwMerge**: Reads existing workflow state directly (no `initializeWorkflow` call), looks up the PR by branch name, enforces the HITL gate (defers if `hitl` label present and PR unapproved), resolves conflicts via `mergeWithConflictResolution`, and transitions state to `completed`, `merge_blocked`, or `discarded`.
- **adwUpgrade**: Performs ADW framework regeneration — computes a content hash of the framework, derives a deterministic claim branch name, runs `/adw_init` via the Claude CLI, verifies the regen receipt, commits `.adw/` and `.adw-version`, opens a PR, and auto-merges unless `.github/adw.yml` sets `hitl: true`.

## Contracts & Invariants

- Every orchestrator acquires a spawn lock (`runWithOrchestratorLifecycle` or `runWithRawOrchestratorLifecycle`) before doing any work; a second concurrent invocation for the same issue exits 0 immediately.
- `adwBuild` hard-fails before acquiring the lock if `specs/issue-{number}-plan.md` does not exist in the worktree — it never creates the plan itself.
- `adwMerge` reads `branchName` from the top-level state file first; the orchestrator state file is a fallback for older runs only.
- `adwMerge` escalates to `merge_blocked` (not `discarded`) after `MAX_PR_RESOLUTION_ATTEMPTS` (3) failed PR lookups or after exhausting conflict-resolution retries; `merge_blocked` recovers only via an explicit `## Retry` comment.
- A closed-without-merge PR transitions to `discarded` (terminal, represents operator intent), not `merge_blocked`.
- `adwUpgrade` is idempotent: if the claim branch already has a PR in any state it exits without re-running regeneration. The `wontfix` label on a retired claim PR is the only escape hatch to force a rebuild.
- `adwUpgrade` fails closed if `verifyAdwRegen` reports a missing or stale receipt — it never writes `.adw-version` or opens a PR until the receipt hash matches the runtime hash.
- `adwUpgrade` never force-pushes the claim branch; a non-fast-forward rejection means another orchestrator owns the claim, so this instance parks silently as the loser.
- All orchestrators handle `AuthRequiredError` by pausing state and exiting rather than crashing.
- Cost and model-usage totals are accumulated via `CostTracker` and persisted in the completion metadata for every orchestrator that uses `initializeWorkflow`.

## Configuration

| Variable | Default | Used by |
|---|---|---|
| `ANTHROPIC_API_KEY` | required | all |
| `CLAUDE_CODE_PATH` | `/usr/local/bin/claude` | all (agent invocation) |
| `GITHUB_PAT` | optional | all |
| `MAX_TEST_RETRY_ATTEMPTS` | `5` | adwTest |

`adwUpgrade` also reads `.github/adw.yml` from the target worktree at runtime; `hitl: true` in that file suppresses auto-merge and leaves the upgrade PR open for human review.

## Gotchas

- `adwMerge` and `adwUpgrade` do **not** call `initializeWorkflow` — they read or bypass standard state initialisation and use `runWithRawOrchestratorLifecycle` instead of the higher-level lifecycle wrapper.
- `adwTest` does not accept `--issue-type`; passing it has no effect (`supportsIssueType: false`).
- `adwMerge` will strand in `abandoned` (not `merge_blocked`) if `branchName` is missing from both the top-level state and all orchestrator state files — this was the root cause of issue #508.
- `adwUpgrade` reuses an existing worktree for the claim branch but immediately hard-resets it to `origin/<claim-branch>` to avoid a stale-commit non-fast-forward push failure (#627).
- The `adwUpgrade` failure comment intentionally avoids the `## <emoji>` heading pattern and the `<!-- adw-bot -->` marker so that `isAdwComment()` does not count a failed upgrade as an in-progress workflow (User Story 22).
- All five orchestrators exit 0 on spawn-lock contention; callers must not interpret exit 0 as proof of success.
