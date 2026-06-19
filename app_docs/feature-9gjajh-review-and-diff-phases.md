# Review and Diff Phases

## Overview

The review and diff phases govern the quality gate before a PR is merged. The review phase acts as a passive judge reading the scenario proof artifact; the diff evaluation phase classifies branch diffs for safe auto-merge; the review patch helpers apply individual blocker fixes atomically within a patch cycle.

## Responsibilities

- `reviewPhase.ts` (`executeReviewPhase`) — calls `runReviewAgent` once with the plan file path and optional `scenarioProofPath`; posts stage comments; when review passes and a GitHub App is configured, approves the PR using a PAT; returns `reviewPassed`, `reviewIssues`, and cost fields
- `reviewPhase.ts` (`executeReviewPatchCycle`) — receives the current blocker list, routes each blocker to `applyPatchBlocker` or `applyRefactorBlockers` based on `remediationStrategy`, commits all changes in one commit, and pushes the branch
- `diffEvaluationPhase.ts` — computes `git diff {defaultBranch}...HEAD`, passes the diff to `runDiffEvaluatorAgent`, posts the verdict as an audit comment on the issue, and returns a `DiffEvaluationPhaseResult` with `verdict: 'safe' | 'regression_possible'`
- `reviewPatchHelpers.ts` (`applyPatchBlocker`) — runs `runPatchAgent` for a single blocker, then runs `runBuildAgent` on the patch output to apply the changes
- `reviewPatchHelpers.ts` (`applyRefactorBlockers`) — runs `runRefactorAgent` for each refactor blocker, then runs `runBuildAgent` on the refactor output; warns when more than one refactor blocker is received (reviewer is contracted to consolidate)

## Contracts & Invariants

- `executeReviewPhase` is a single-shot judge; the patch-retest retry loop is the orchestrator's responsibility, not the phase's
- PR approval in `executeReviewPhase` requires both `isGitHubAppConfigured()` and `GITHUB_PAT` to be truthy and `ctx.prUrl` to be set; approval failure is non-fatal
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
