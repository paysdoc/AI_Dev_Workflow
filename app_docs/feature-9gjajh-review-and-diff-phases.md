# Review and Diff Phases

## Overview

The review and diff phases govern the quality gate before a PR is merged. The review phase acts as a passive judge reading the scenario proof artifact; the diff evaluation phase classifies branch diffs for safe auto-merge; the review patch helpers apply individual blocker fixes atomically within a patch cycle.

## Responsibilities

- `reviewPhase.ts` (`executeReviewPhase`) — calls `runReviewAgent` once with the plan file path and optional `scenarioProofPath`; after the agent returns, uploads the images of the judged proof (`ctx.scenarioProof.artifactsDir`) via `uploadProofArtifacts` and always assigns `ctx.screenshotUrls` (empty without `repoContext` or scenario proof) before posting `review_passed`/`review_failed`, so the issue comment embeds the screenshots; when review passes, `ctx.prUrl` is set, the code host reports `canApprovePullRequests()`, and the issue does **not** currently carry the `hitl` label (read live via `IssueTracker.fetchLabels`), approves the PR; otherwise logs a skip naming the issue; returns `reviewPassed`, `reviewIssues`, and cost fields
- `reviewPhase.ts` (`executeReviewPatchCycle`) — receives the current blocker list, routes each blocker to `applyPatchBlocker` or `applyRefactorBlockers` based on `remediationStrategy`, commits all changes in one commit, and pushes the branch
- `reviewRetryLoop.ts` (`runReviewRetryLoop`) — the one review-retry loop shared by `adwSdlc`, `adwPlanBuildReview`, `adwPlanBuildTestReview`, `adwChore` and `adwPrReview`; owns the review attempt counter (`ReviewAttempts`, rules in `adws/core/devServerFailure.ts`). A failed dev-server start becomes a review blocker (`serverStartBlocker`: command, health URL, `MAX_START_ATTEMPTS` and the output tail) recorded as a failed review (`recordFailedStartReview`, which posts `review_failed`), routed into `executeReviewPatchCycle`, followed by a new scenario run (a new start attempt). Returns `{ reviewPassed, reviewRetries }`
- `diffEvaluationPhase.ts` — computes `git diff {defaultBranch}...HEAD`, passes the diff to `runDiffEvaluatorAgent`, posts the verdict as an audit comment on the issue, and returns a `DiffEvaluationPhaseResult` with `verdict: 'safe' | 'regression_possible'`
- `reviewPatchHelpers.ts` (`applyPatchBlocker`) — runs `runPatchAgent` for a single blocker, then runs `runBuildAgent` on the patch output to apply the changes
- `reviewPatchHelpers.ts` (`applyRefactorBlockers`) — runs `runRefactorAgent` for each refactor blocker, then runs `runBuildAgent` on the refactor output; warns when more than one refactor blocker is received (reviewer is contracted to consolidate)

## Contracts & Invariants

- `executeReviewPhase` is a single-shot judge; the patch-retest retry loop is `runReviewRetryLoop`'s, not the phase's
- Each failed start counts as one failed review; at the cap the loop returns `reviewPassed: false` (the orchestrator writes `review_failed`). The review agent is not run on a failed start. A started server resets the failed count to zero only when the previous start failed, so a healthy server never erases real review failures; `reviewRetries` counts every failed review of the run and is never reset
- The loop sets `ctx.reviewAttempt`/`ctx.maxReviewAttempts` before each review, so the `review_running` comment shows the count and its reset
- With no declared dev server the loop is the old one: at most `maxAttempts` reviews and `maxAttempts - 1` patches; `maxAttempts <= 0` runs no review
- PR approval in `executeReviewPhase` requires `ctx.prUrl` to be set, `repoContext.codeHost.canApprovePullRequests()` to be true, and the issue to **not** currently carry the `hitl` label (read live via `repoContext.issueTracker.fetchLabels`, never from the `config.issue.labels` workflow-start snapshot); approval failure, a refused capability probe, and a refused label read are all non-fatal — a refused label read does not approve (fail-closed)
- The review-phase approval is the second of the two approval sites in ADW (`adwChore.tsx`'s pre-approval is the other); both honour `hitl`, so the merge gate `(no hitl) OR approved` cannot be satisfied by automation on a `hitl` issue (#848)
- `executeReviewPatchCycle` issues one commit after all patch and refactor blockers are resolved, not one commit per blocker
- `diffEvaluationPhase.ts` defaults to `'regression_possible'` when the diff is empty (no changes — treat as safe), when the agent returns no parsed verdict, or when the agent throws; only a confirmed `'safe'` verdict propagates up
- `applyPatchBlocker` always runs `runBuildAgent` after `runPatchAgent` when the patch succeeds; the build agent applies the patch instructions to the actual codebase
- `applyRefactorBlockers` processes blockers sequentially; each blocker runs refactor then build before the next blocker starts
- The audit comment posted by `diffEvaluationPhase.ts` is non-fatal to catch: `repoContext.issueTracker.commentOnIssue` errors are swallowed with a warn log

## Configuration

- `GITHUB_PAT` — required for PR approval in the review phase
- `defaultBranch` — used by the diff evaluation phase as the base for `git diff`
- `logsDir` — determines JSONL output paths for all agents invoked within the patch cycle
- `branchName` — used by `executeReviewPatchCycle` to push the branch after patching

## Gotchas

- `executeReviewPhase` receives `scenarioProofPath` as a caller-supplied string; when empty, the review agent falls through to its own Strategy B (code-diff review)
- `diffEvaluationPhase.ts` uses a 10 MB `maxBuffer` for `execSync git diff`; very large diffs are truncated by the shell before reaching the agent
- `reviewPatchHelpers.ts` runs `runBuildAgent` with the patch agent's raw output as the plan content; the build agent interprets that output as instructions, not a standard plan file
- `executeReviewPatchCycle` pushes the branch via `pushBranch(branchName, worktreePath)` unconditionally after committing; if the commit produced no changes (all patches were no-ops), the push is still attempted

## Decisions

- [ADR-0027](../specs/adr/0027-llm-diff-gate-for-chores.md) — LLM diff gate for chores
- [ADR-0031](../specs/adr/0031-active-test-phase-passive-review-judge.md) — Active test phase, passive review judge
- [ADR-0038](../specs/adr/0038-stateless-merge-gate.md) — The merge gate is one stateless rule: no `hitl` label, or an approved PR
- [ADR-0062](../specs/adr/0062-dev-server-start-failure-is-a-failed-review.md) — A dev server that will not start on the issue branch is a failed review
