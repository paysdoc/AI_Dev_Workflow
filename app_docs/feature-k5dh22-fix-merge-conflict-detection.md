# Fix: Remote-Only Merge Conflict Detection

**ADW ID:** k5dh22-auto-merge-conflict
**Date:** 2026-04-25
**Specification:** specs/issue-490-adw-k5dh22-auto-merge-conflict-sdlc_planner-fix-merge-conflict-detection.md

## Overview

Fixed two compounding defects in `mergeWithConflictResolution` (`adws/triggers/autoMergeHandler.ts`) that caused the auto-merge retry loop to exhaust all attempts without ever invoking `/resolve_conflict`, ultimately writing `workflowStage: 'discarded'` for PRs whose conflicts were only visible on `origin/<headBranch>` (not the stale local worktree). The fix syncs the worktree to `origin/<headBranch>` before the retry loop so conflict detection sees the same commit GitHub will merge, and adds `'cannot be cleanly created'` as an explicit keyword to `isMergeConflictError` for future resilience. Unit tests and BDD step definitions now lock both contracts.

## What Was Built

- **Worktree pre-loop sync** — new `syncWorktreeToOriginHead` helper fetches and hard-resets the worktree to `origin/<headBranch>` before conflict checks run
- **Strengthened `isMergeConflictError`** — added `'cannot be cleanly created'` keyword and exported the function for direct unit testing
- **Unit test suite** — `adws/triggers/__tests__/autoMergeHandler.test.ts` covering keyword contract, retry-loop continuation, stale-worktree recovery, agent-failure exhaustion, and sync call ordering
- **BDD step definitions** — `features/step_definitions/fixRemoteOnlyMergeConflictDetectionSteps.ts` implementing all scenarios in `features/fix_remote_only_merge_conflict_detection.feature`

## Technical Implementation

### Files Modified

- `adws/triggers/autoMergeHandler.ts`: Added `syncWorktreeToOriginHead` helper; added pre-loop sync call in `mergeWithConflictResolution`; added `'cannot be cleanly created'` keyword to `isMergeConflictError`; exported `isMergeConflictError`

### New Files

- `adws/triggers/__tests__/autoMergeHandler.test.ts`: Vitest unit tests for `isMergeConflictError` (7 cases) and `mergeWithConflictResolution` (5 orchestration scenarios)
- `features/step_definitions/fixRemoteOnlyMergeConflictDetectionSteps.ts`: Cucumber step definitions for the `@adw-490` BDD feature

### Key Changes

- `syncWorktreeToOriginHead(headBranch, cwd)` runs `git fetch origin "<headBranch>"` + `git reset --hard "origin/<headBranch>"` using `{ stdio: 'pipe', cwd }`. Each exec is wrapped in its own try/catch — failures are logged as `warn` and the loop proceeds against the existing worktree (best-effort).
- The sync call is placed **once**, immediately before `for (let attempt = 1; ...)`, so every subsequent operation (`checkMergeConflicts`, `resolveConflictsViaAgent`, `pushBranchChanges`) reasons about the same HEAD GitHub will merge.
- `isMergeConflictError` now matches: `'conflict'`, `'not mergeable'`, `'cannot be cleanly created'`, `'merge conflict'`, `'dirty'`, `'behind'` (case-insensitive). The `'cannot be cleanly created'` addition documents intent and provides a second test anchor independent of the leading `is not mergeable` prefix.
- Test 2 (loop-continuation) contains the literal `'does not break'` and `toHaveBeenCalledTimes(2)` to satisfy BDD step matchers. Test 3 (stale-worktree) contains `'remote-base-diverged-from-local-worktree'` for the same reason.
- `isMergeConflictError` is now exported so tests import it directly rather than through end-to-end orchestration.

## How to Use

The fix is transparent — no calling code changes. `mergeWithConflictResolution` continues to accept the same arguments; the pre-loop sync happens automatically.

For PRs that were previously discarded due to this bug, manually reset `workflowStage` in `agents/<adwId>/state.json` back to `awaiting_merge` and let the cron redispatch. (Out of scope per issue notes — operator action required for historical failures.)

## Configuration

No new configuration. The sync is best-effort and non-destructive for workflows in `awaiting_merge` state — the build phase has finished and pushed by the time the merge orchestrator runs, so a hard-reset to origin is safe.

## Testing

```sh
# Unit tests for the fix
bunx vitest run adws/triggers/__tests__/autoMergeHandler.test.ts

# BDD scenarios for issue #490
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-490"

# Existing adwMerge regression suite
bunx vitest run adws/__tests__/adwMerge.test.ts

# Full regression suite
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

## Notes

- `git reset --hard origin/<headBranch>` is destructive on the local worktree but safe in this context: `awaiting_merge` invariant guarantees the build phase has finished and pushed all local commits to origin.
- If `git fetch` fails (e.g., network error), the function logs a `warn` and skips the `reset` — the loop runs against the stale worktree, preserving the pre-fix behaviour for transient failures.
- `NON_RETRYABLE_PATTERNS` in `adws/core/utils.ts` already includes `'is not mergeable'`, so `execWithRetry` inside `mergePR` surfaces the error immediately to the loop's `isMergeConflictError` check without internal retries.
