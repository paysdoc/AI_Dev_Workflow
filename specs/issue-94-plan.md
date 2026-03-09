# PR-Review: Fix merge conflicts on PR #95

## PR-Review Description
The reviewer (paysdoc) posted a general comment "Fix conflicts" on PR #95 (`bugfix-issue-94-fix-cost-csv-deletion`). This indicates the branch needs to be rebased or merged with the latest `main` branch to resolve any merge conflicts and ensure the branch is up to date before merging.

Current state analysis:
- The branch has 2 commits ahead of `origin/main` and 0 behind
- GitHub reports the PR as `MERGEABLE` with `CLEAN` merge state
- No file-level overlaps exist with other open PRs (#92, #96)
- Files changed: `adws/triggers/trigger_webhook.ts`, `adws/triggers/webhookHandlers.ts`, `adws/__tests__/triggerWebhookIssueClosed.test.ts`, `adws/__tests__/webhookHandlers.test.ts`, and a spec file

The review may have been posted when conflicts existed that have since been resolved, or the reviewer wants the branch rebased onto latest `main` as a standard practice before merge.

## Summary of Original Implementation Plan
The original plan (`specs/issue-94-adw-cost-csv-files-delet-c2eqrt-sdlc_planner-fix-cost-csv-deletion.md`) addressed a bug where cost CSV files were incorrectly deleted when a GitHub issue was closed after its related PR had already been merged. The fix involved:
1. Adding merged PR issue tracking via an in-memory `Set<number>` in `webhookHandlers.ts` with `recordMergedPrIssue`/`wasMergedViaPR` functions
2. Extracting `handleIssueCostRevert` in `trigger_webhook.ts` to skip cost revert for merged PRs, fix the empty array truthiness check, and scope commits to specific files
3. Comprehensive unit tests for both the tracking mechanism and the issue close cost revert guard

## Relevant Files
Use these files to resolve the review:

- `adws/triggers/trigger_webhook.ts` — Main webhook handler containing `handleIssueCostRevert`. May have conflicts if `main` has changes to the same file.
- `adws/triggers/webhookHandlers.ts` — Contains merged PR tracking logic. May have conflicts if `main` has changes to the same file.
- `adws/__tests__/triggerWebhookIssueClosed.test.ts` — New test file for issue close cost revert. Unlikely to conflict since it's a new file.
- `adws/__tests__/webhookHandlers.test.ts` — Extended test file. May have conflicts if `main` has test changes.
- `specs/issue-94-adw-cost-csv-files-delet-c2eqrt-sdlc_planner-fix-cost-csv-deletion.md` — Implementation spec. Unlikely to conflict.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Fetch latest remote state
- Run `git fetch origin` to ensure we have the latest remote `main` branch
- Run `git log --oneline origin/main..HEAD` to confirm commits ahead
- Run `git rev-list --left-right --count origin/main...HEAD` to check behind/ahead counts

### Step 2: Rebase branch onto latest main
- Run `git rebase origin/main` to rebase the branch onto the latest `main`
- If conflicts occur, resolve them by examining the conflicting files and choosing the correct resolution:
  - For `adws/triggers/trigger_webhook.ts`: preserve the `handleIssueCostRevert` function and `wasMergedViaPR` import while incorporating any upstream changes
  - For `adws/triggers/webhookHandlers.ts`: preserve the `mergedPrIssues` tracking Set and related functions while incorporating any upstream changes
  - For test files: preserve all new tests while incorporating any upstream test changes
- After resolving each file, run `git add <file>` and `git rebase --continue`
- If no conflicts occur, the rebase will complete cleanly

### Step 3: Force-push the rebased branch
- Run `git push --force-with-lease origin bugfix-issue-94-fix-cost-csv-deletion` to update the remote branch
- This uses `--force-with-lease` as a safety measure to avoid overwriting unexpected remote changes

### Step 4: Verify PR status
- Run `gh pr view 95 --json mergeable,mergeStateStatus,state` to confirm the PR is still mergeable after the rebase

### Step 5: Run validation commands
- Run all validation commands to ensure zero regressions after the rebase

## Validation Commands
Execute every command to validate the review is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type-check the main project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check adws scripts
- `bun run test` — Run all tests to validate the review is complete with zero regressions

## Notes
- The branch is currently 0 commits behind `main` and GitHub reports the PR as `MERGEABLE/CLEAN`. The rebase may complete as a no-op if `main` hasn't advanced since the last check.
- Use `--force-with-lease` instead of `--force` for push safety.
- If the rebase results in no changes (already up to date), skip the force-push step.
- Other open PRs (#92 modifying review agent files, #96 modifying only a spec) do not overlap with files changed in this PR, so no cross-PR conflicts are expected.
