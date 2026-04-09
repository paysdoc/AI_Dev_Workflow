# Replace `## Clear` with `## Cancel` Directive

**ADW ID:** 9jpn7u-replace-clear-with-c
**Date:** 2026-04-09
**Specification:** specs/issue-425-adw-9jpn7u-replace-clear-with-c-sdlc_planner-replace-clear-with-cancel.md

## Overview

Replaces the `## Clear` comment directive with `## Cancel`, which performs a full scorched-earth reset of all local ADW state for an issue. Unlike the old `## Clear` (which only deleted GitHub comments), `## Cancel` kills agent processes, removes git worktrees and local branches, deletes `agents/{adwId}/` state directories, clears GitHub comments, and removes the issue from cron dedup sets so it re-spawns on the next cycle.

## What Was Built

- **Rename:** `CLEAR_COMMENT_PATTERN` → `CANCEL_COMMENT_PATTERN`, `isClearComment` → `isCancelComment` across the full re-export chain
- **New module:** `adws/triggers/cancelHandler.ts` implementing the full cleanup sequence via `handleCancelDirective`
- **New type:** `MutableProcessedSets` — passed by cron so cancelled issues skip the current cycle and re-spawn next cycle
- **Cron integration:** Cancel detection runs before `filterEligibleIssues`; cancelled issues are added to `processedSpawns`
- **Webhook integration:** `isCancelComment` + `handleCancelDirective` replaces `isClearComment` + `clearIssueComments`; fetches full issue comments via `fetchIssueCommentsRest`
- **Unit tests:** `adws/triggers/__tests__/cancelHandler.test.ts` covering the full sequence, edge cases, and graceful error handling

## Technical Implementation

### Files Modified

- `adws/core/workflowCommentParsing.ts`: Renamed `CLEAR_COMMENT_PATTERN` → `CANCEL_COMMENT_PATTERN` and `isClearComment` → `isCancelComment`; updated regex to `/^## Cancel$/mi`
- `adws/github/workflowComments.ts`: Updated re-exports to use new names
- `adws/github/index.ts`: Updated re-exports to use new names
- `adws/core/index.ts`: Updated re-exports to use new names; added `getTargetRepoWorkspacePath` to cron import
- `adws/triggers/trigger_cron.ts`: Replaced old clear block (post-filter) with cancel scan before `filterEligibleIssues`; imports `handleCancelDirective` and `isCancelComment`
- `adws/triggers/trigger_webhook.ts`: Replaced `isClearComment`/`clearIssueComments` with `isCancelComment`/`handleCancelDirective`; fetches full comments via `fetchIssueCommentsRest`; resolves cwd from webhook payload

### New Files

- `adws/triggers/cancelHandler.ts`: Core cancel logic — `handleCancelDirective` + private `killOrchestratorProcess`
- `adws/triggers/__tests__/cancelHandler.test.ts`: Unit tests for `handleCancelDirective`

### Key Changes

- **Cancel sequence in `handleCancelDirective`:** (1) extract all adwIds from comments → (2) SIGTERM→SIGKILL orchestrator PIDs → (3) `removeWorktreesForIssue` (kills child processes, removes worktrees + branches) → (4) `fs.rmSync` agent state dirs → (5) `clearIssueComments` → (6) remove from `processedSets` if provided
- **Cron timing shift:** Cancel detection moved before `filterEligibleIssues` so cancelled issues never enter the spawn loop in the same cycle
- **No backwards compatibility:** `## Clear` is no longer recognized; the function `clearIssueComments` in `adwClearComments.tsx` was not renamed (it describes its action, not the directive)
- **`processedPRs` untouched:** PR review lifecycle is independent and not affected by cancel
- **Two-layer process kill:** SIGTERM on the orchestrator PID covers the Claude CLI process tree; `killProcessesInDirectory` (called inside `removeWorktreesForIssue`) covers detached children with open file handles in worktree dirs

## How to Use

1. On any open GitHub issue being processed by ADW, post a comment with exactly:
   ```
   ## Cancel
   ```
2. The next cron cycle (or immediately via webhook if the webhook trigger is active) will detect the directive
3. ADW will: kill agent processes → remove worktrees → delete state directories → clear all GitHub comments on the issue
4. The issue becomes re-eligible for spawning on the **next** cron cycle (not the same cycle)

## Configuration

No configuration required. The directive is detected case-insensitively by the regex `/^## Cancel$/mi`.

When ADW is running against a target repo (`--target-repo` flag on the cron, or `target-repo` in the webhook payload), the `cwd` is resolved via `getTargetRepoWorkspacePath` so worktree removal operates in the correct directory.

## Testing

Run the unit tests:

```bash
bun run test
```

The test file `adws/triggers/__tests__/cancelHandler.test.ts` covers:
- Full sequence execution (adwId extraction → process kill → worktree removal → state dir deletion → comment clearing → dedup set cleanup)
- Graceful handling of missing state files, already-dead processes, and no adwIds
- `processedSets` cleaned when provided, untouched when not provided

## Notes

- `clearIssueComments` in `adwClearComments.tsx` was **not** renamed — it describes its action (clearing comments), not the directive
- All adwIds found in comments are cleaned up, not just the latest workflow run's adwId
- `agents/{adwId}/` directories are fully deleted; no post-mortem preservation
- `fs.rmSync` with `{ force: true }` handles the case where a state directory was already deleted
- The spin-wait between SIGTERM and SIGKILL is 500 ms — intentionally short since cancel is a rare manual operation
