# Commit and Push Cost CSV Files on PR Close

**ADW ID:** trigger-should-commi-f8jwcf
**Date:** 2026-02-26
**Specification:** specs/issue-34-adw-trigger-should-commi-f8jwcf-sdlc_planner-commit-push-cost-csv.md

## Overview

When an ADW workflow completes and its PR is merged or closed, cost CSV files written by `completeWorkflow()` are automatically committed and pushed to the repository. This eliminates the need for manual intervention to persist cost tracking data after each workflow run.

## What Was Built

- New `/commit_cost` Claude slash command that stages only cost-related CSV files instead of all changes
- New `commitAndPushCostFiles()` function in `gitOperations.ts` that programmatically stages, commits, and pushes the two cost CSV files
- Integration into `handlePullRequestEvent()` so cost data is persisted automatically when a PR closes
- `/commit_cost` registered in the `SlashCommand` type union and both model maps (mapped to `haiku`)
- Unit tests covering `commitAndPushCostFiles()` behavior and its integration with the webhook handler

## Technical Implementation

### Files Modified

- `.claude/commands/commit_cost.md`: New slash command for committing cost CSV files; mirrors `/commit` but uses targeted `git add` on only `projects/<repoName>/<issueNumber>-*.csv` and `projects/<repoName>/total-cost.csv`
- `adws/github/gitOperations.ts`: Added `commitAndPushCostFiles(repoName, issueNumber, issueTitle, cwd?)` function that checks for changes, stages cost CSVs, commits, and pushes
- `adws/triggers/webhookHandlers.ts`: Updated `handlePullRequestEvent()` to call `commitAndPushCostFiles()` after PR close with error isolation so failures don't disrupt existing cleanup
- `adws/core/issueTypes.ts`: Added `'/commit_cost'` to the `SlashCommand` type union
- `adws/core/config.ts`: Added `'/commit_cost': 'haiku'` to both `SLASH_COMMAND_MODEL_MAP` and `SLASH_COMMAND_MODEL_MAP_FAST`
- `adws/__tests__/commitCostFiles.test.ts`: New unit tests for `commitAndPushCostFiles()`
- `adws/__tests__/webhookHandlers.test.ts`: Added tests for cost commit integration in the PR close handler

### Key Changes

- `commitAndPushCostFiles()` uses `getIssueCsvPath()` and `getProjectCsvPath()` from `costCsvWriter.ts` to compute exact file paths, avoiding path duplication
- The function checks `git status --porcelain` on the two target paths before staging; returns `false` with a log message if no changes exist
- The cost commit step in `handlePullRequestEvent()` is wrapped in a try/catch so any failure is logged but does not interrupt worktree cleanup or issue closure
- The PR title is used as the issue title when constructing the issue CSV filename since the full issue payload is not available in the webhook event
- `/commit_cost` is mapped to `haiku` in both model maps because it performs simple, structured git operations with no complex reasoning required

## How to Use

### Automatic (via webhook)

No action needed. When the webhook trigger detects a PR close event with a linked issue (`Implements #N` in the PR body), `commitAndPushCostFiles()` is called automatically and cost CSV files are committed and pushed.

### Manual (via slash command)

Use the `/commit_cost` command with the following variables:

```
/commit_cost <agentName> <issueClass> <issue> <repoName>
```

1. The command stages `projects/<repoName>/<issueNumber>-*.csv` and `projects/<repoName>/total-cost.csv`
2. Generates a commit message in the format: `<agentName>: <issueClass>: add cost data for issue #<N>`
3. Creates the commit

## Configuration

No additional configuration required. The feature uses existing `getIssueCsvPath()` and `getProjectCsvPath()` path utilities from `adws/core/costCsvWriter.ts`. Cost CSV files must exist at the expected paths for the commit to proceed.

## Testing

Run the full test suite to validate:

```bash
npm test
npx tsc --noEmit -p adws/tsconfig.json
```

Key test files:
- `adws/__tests__/commitCostFiles.test.ts` — Unit tests for `commitAndPushCostFiles()`
- `adws/__tests__/webhookHandlers.test.ts` — Integration tests for the PR close handler

Test cases cover: successful commit and push, no-op when no CSV changes exist, error handling when git commands fail, and correct `cwd` propagation.

## Notes

- If the PR is closed without an `Implements #N` pattern in the body, the issue number cannot be extracted and `commitAndPushCostFiles()` is not called
- If cost CSV files do not yet exist (no workflow cost data), `git status --porcelain` returns empty and the function returns `false` without error
- The commit and push run on whatever branch the ADW repo is currently on (expected to be the default branch); the function does not switch branches
- Git push failures (e.g., network errors) are caught and logged but do not affect the rest of the PR close flow
