# Simplify Webhook Handlers — Remove Auto-Merge, Thin Out PR/Issue Close Handlers

**ADW ID:** 7fy9ry-remove-webhook-auto
**Date:** 2026-04-03
**Specification:** specs/issue-382-adw-7fy9ry-remove-webhook-auto-sdlc_planner-simplify-webhook-handlers.md

## Overview

The webhook is refactored into a thin event relay by removing all orchestration work from its handlers. Auto-merge on approval is removed entirely (now handled by the cron + `adwMerge.tsx`), the `pull_request.closed` handler is narrowed to only mark abandoned PRs, and a new `handleIssueClosedEvent()` absorbs all cleanup (worktree removal, remote branch deletion, dependency cascades) with a grace period guard to prevent cleanup while an orchestrator is still running.

## What Was Built

- **Removed `handleApprovedReview()`** — the `pull_request_review` (approved) webhook now returns `ignored`; merge is driven by cron + `adwMerge.tsx`.
- **Rewritten `handlePullRequestEvent()`** — merged PRs are a no-op; abandoned PRs (closed without merge) write `abandoned` to the top-level state file and close the linked issue, which cascades to `issues.closed`.
- **New `handleIssueClosedEvent()`** — consolidated handler that cleans up worktrees and remote branches, enforces a grace period guard for active orchestrators, and routes dependency handling between abandoned and normal closures.
- **New `closeAbandonedDependents()`** — in `webhookGatekeeper.ts`; finds open issues that depend on an abandoned issue and closes them with an explanatory comment.
- **Dependency injection pattern** — both `handlePullRequestEvent()` and `handleIssueClosedEvent()` accept injectable `deps` for unit testing without real `gh` CLI calls.
- **Unit tests** — `adws/triggers/__tests__/webhookHandlers.test.ts` covering merged PR no-op, abandoned PR flow, grace period skip, normal and abandoned closure cleanup.
- **Updated `known_issues.md`** — `claude-cli-enoent` entry now distinguishes CWD-gone (worktree deleted while orchestrator running, now mitigated by grace period) from binary-missing (Claude CLI symlink auto-update).

## Technical Implementation

### Files Modified

- `adws/triggers/trigger_webhook.ts`: Removed `handleApprovedReview` import/call; `pull_request_review` approved path now returns `ignored`; `issues.closed` delegates entirely to `handleIssueClosedEvent()`; removed `handleIssueClosedDependencyUnblock` import from this file.
- `adws/triggers/webhookHandlers.ts`: Rewrote `handlePullRequestEvent()` (merged = no-op, abandoned = state write + issue close); added `handleIssueClosedEvent()` with grace period guard, worktree/branch cleanup, and dependency routing; added `PrClosedDeps` and `IssueClosedDeps` injectable interfaces.
- `adws/triggers/autoMergeHandler.ts`: Deleted `handleApprovedReview()` and all imports only used by it (`writeFileSync`, `existsSync`, `generateAdwId`, `ensureLogsDirectory`, `getTargetRepoWorkspacePath`, `fetchPRDetails`, `commentOnPR`, `getRepoInfoFromPayload`, `ensureWorktree`, `getPlanFilePath`, `planFileExists`). `mergeWithConflictResolution()` and its support functions are preserved.
- `adws/triggers/webhookGatekeeper.ts`: Added `closeAbandonedDependents()` — fetches open issues, identifies dependents via `parseDependencies()`, closes each with an error comment.
- `adws/triggers/__tests__/webhookHandlers.test.ts`: New file — unit tests for both handlers with injected deps.
- `adws/known_issues.md`: Updated `claude-cli-enoent` entry to separate the two failure modes.

### Key Changes

- **Approved review → no-op**: The `pull_request_review` handler no longer calls `handleApprovedReview()`; it returns `{ status: 'ignored' }` immediately. The cooldown check (`shouldTriggerPrReview`) is moved after the early-return to avoid logging a duplicate-skip for a no-op path.
- **Grace period guard in `handleIssueClosedEvent()`**: Reads `workflowStage` from the top-level state file. If `isActiveStage(workflowStage)` is true and `Date.now() - lastActivity < GRACE_PERIOD_MS` (5 min), cleanup is skipped to avoid deleting worktrees while an orchestrator is still running.
- **Cascade design**: When a PR is abandoned, `handlePullRequestEvent()` writes `abandoned` to state and closes the linked issue. GitHub then fires an `issues.closed` webhook, which `handleIssueClosedEvent()` handles — it sees `workflowStage === 'abandoned'` and routes to `closeAbandonedDependents()` instead of the normal dependency-unblock path.
- **Worktree + branch cleanup moved to `issues.closed`**: Both merged and abandoned PRs now get their worktrees cleaned up through `handleIssueClosedEvent()`, giving a single cleanup point.
- **Dependency injection**: `PrClosedDeps` and `IssueClosedDeps` interfaces allow unit tests to inject mock implementations of all I/O operations (fetch comments, read/write state, remove worktrees, delete branches, close issues).

## How to Use

The changes are fully internal — no operator action is required.

1. **Merged PRs**: GitHub auto-closes the linked issue, firing `issues.closed`. The `handleIssueClosedEvent()` handler performs cleanup (worktrees, branch, dependency unblock).
2. **Abandoned PRs** (closed without merge): The `pull_request.closed` webhook fires, `handlePullRequestEvent()` writes `abandoned` to the state file and closes the linked issue. The resulting `issues.closed` event triggers `handleIssueClosedEvent()`, which performs cleanup and closes dependent issues.
3. **PR approved**: The `pull_request_review` webhook fires with `state=approved`. The handler immediately returns `ignored` — the cron job picks up the `awaiting_merge` stage and calls `adwMerge.tsx`.

## Configuration

- **`GRACE_PERIOD_MS`** (`adws/core/config.ts`): 300,000 ms (5 minutes). Controls how long after the last state activity the orchestrator is considered still running. Reused from the cron trigger.
- No new environment variables required.

## Testing

```bash
# Unit tests (includes new webhookHandlers.test.ts)
bun vitest run

# Type check
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json

# BDD regression
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

## Notes

- `mergeWithConflictResolution()` and its supporting functions in `autoMergeHandler.ts` are **preserved** — they are used by `adwMerge.tsx`. Only `handleApprovedReview()` was deleted.
- The cascade from `pull_request.closed` → `closeIssue()` → `issues.closed` is intentional. The `abandoned` stage is written to the state file before `closeIssue()` is called so the `issues.closed` handler sees it and routes correctly.
- `extractLatestAdwId()` from `cronStageResolver.ts` accepts any array with a `body: string` property, so it works with `fetchIssueCommentsRest()` output without any adaptation.
- The `isActiveStage()` function returns `true` for `starting`, `*_running`, and intermediate `*_completed` stages but **not** for terminal stages (`completed`, `abandoned`, `paused`). This ensures the grace period guard fires only when an orchestrator is genuinely mid-flight.
