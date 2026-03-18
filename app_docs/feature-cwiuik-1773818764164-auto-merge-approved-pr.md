# Auto-Merge Approved PRs

**ADW ID:** cwiuik-1773818764164
**Date:** 2026-03-18
**Specification:** specs/issue-225-adw-cwiuik-1773818764164-sdlc_planner-auto-merge-approved-pr.md

## Overview

When a GitHub pull request review is submitted with state `approved`, the ADW webhook handler now automatically merges the PR instead of spawning another review cycle. The flow detects merge conflicts, resolves them via the `/resolve_conflict` agent, and retries up to 3 times to handle race conditions where concurrent merges re-introduce conflicts.

## What Was Built

- **Auto-merge handler** (`adws/triggers/autoMergeHandler.ts`) — new module that orchestrates the full conflict-detect → resolve → push → merge retry loop
- **`mergePR` function** in `adws/github/prApi.ts` — calls `gh pr merge --merge` and returns a typed success/error result
- **`MAX_AUTO_MERGE_ATTEMPTS` constant** in `adws/core/constants.ts` — caps retries at 3
- **Webhook branching** in `adws/triggers/trigger_webhook.ts` — routes `pull_request_review` events with `state === 'approved'` to the auto-merge handler and non-approved reviews to the existing `adwPrReview.tsx` path
- **BDD feature and step definitions** — `features/auto_merge_approved_pr.feature` and `features/step_definitions/autoMergeApprovedPrSteps.ts` covering the full scenario matrix

## Technical Implementation

### Files Modified

- `adws/triggers/autoMergeHandler.ts`: New module — conflict detection, agent-based resolution, push, merge, retry loop, failure comment
- `adws/triggers/trigger_webhook.ts`: Split `pull_request_review` / `pull_request_review_comment` handlers; approved reviews now call `handleApprovedReview()`
- `adws/github/prApi.ts`: Added `mergePR(prNumber, repoInfo)` function using `gh pr merge --merge`
- `adws/github/index.ts`: Re-exported `mergePR`
- `adws/core/constants.ts`: Added `MAX_AUTO_MERGE_ATTEMPTS = 3`
- `adws/core/index.ts`: Re-exported new constant
- `features/auto_merge_approved_pr.feature`: BDD scenarios for all review state paths
- `features/step_definitions/autoMergeApprovedPrSteps.ts`: Cucumber step definitions

### Key Changes

- `checkMergeConflicts(baseBranch, cwd)` performs a dry-run merge (`git merge --no-commit --no-ff`) then aborts, returning a boolean — no working tree is modified
- `resolveConflictsViaAgent(...)` initiates the real merge (leaving conflict markers), then calls `runClaudeAgentWithCommand('/resolve_conflict', [adwId, specPath, baseBranch], ...)` to resolve and commit
- `isMergeConflictError(error)` classifies merge failures: conflict-related errors trigger a retry; non-conflict errors break the loop immediately
- `handleApprovedReview` is fire-and-forget from the webhook response (uses `.catch()` for error logging), matching the existing `spawnDetached` pattern
- Existing `shouldTriggerPrReview` deduplication applies to both the auto-merge and non-approved review paths

## How to Use

The feature is fully automatic once deployed:

1. A GitHub PR review webhook arrives with `event === 'pull_request_review'` and `body.review.state === 'approved'`
2. The webhook handler calls `handleApprovedReview(body)` asynchronously and returns `{ status: 'auto_merge_triggered', pr: <number> }` immediately
3. The handler fetches PR details, ensures a local worktree for the PR branch, and enters the retry loop
4. On each attempt: conflicts are checked → resolved via agent if needed → branch is pushed → `gh pr merge --merge` is called
5. On success, the PR is merged. On exhaustion (3 failed attempts), a comment is posted on the PR explaining the failure and requesting manual intervention

Non-approved reviews (`changes_requested`, `commented`) and `pull_request_review_comment` events continue to spawn `adwPrReview.tsx` as before.

## Configuration

- `MAX_AUTO_MERGE_ATTEMPTS` in `adws/core/constants.ts` — default `3`, controls how many resolve→push→merge cycles are attempted before giving up
- The `/resolve_conflict` command in `.claude/commands/resolve_conflict.md` is used for conflict resolution — accepts `adwId`, `specPath`, and `incomingBranch` (the base/target branch)
- `specPath` is resolved from the PR's associated ADW spec file via `getPlanFilePath`; if none is found, an empty string is passed and the agent uses git context

## Testing

Run the BDD scenarios:

```bash
bunx cucumber-js features/auto_merge_approved_pr.feature
```

Scenarios covered:
- Approved review, no conflicts → immediate merge
- Approved review, conflicts on first attempt → resolve → merge
- Approved review, persistent conflicts (race condition) after max retries → failure comment posted
- `changes_requested` review → spawns `adwPrReview.tsx`
- `commented` review → spawns `adwPrReview.tsx`
- `pull_request_review_comment` → always spawns `adwPrReview.tsx`
- Duplicate event within 60 s cooldown → ignored

## Notes

- The handler is resilient to PRs that are already `CLOSED` or `MERGED` when it runs — it exits early
- `incomingBranch` passed to `/resolve_conflict` is the **base** branch (e.g. `main`), not the head branch, because the target branch changes are being merged *into* the PR branch
- If a merge fails for a non-conflict reason (e.g. branch protection rule violation), the retry loop stops immediately and posts a failure comment with the error detail
- The auto-merge flow runs in the same ADW worktree infrastructure as other agents; logs are written to the standard `logs/<adwId>/` directory
