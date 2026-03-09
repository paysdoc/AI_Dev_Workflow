# Bug: gh pr list uses invalid "merged" JSON field

## Metadata
issueNumber: `126`
adwId: `1773071145299-jiod5x`
issueJson: `{"number":126,"title":"JSON Error","body":"The logs show the following error: ...Unknown JSON field: \"merged\"..."}`

## Bug Description
The `concurrencyGuard.ts` module calls `gh pr list --json number,body,state,merged` but `merged` is not a valid JSON field for the `gh pr list` command. The GitHub CLI (`gh`) does not expose a `merged` boolean field on PR list output. The available fields include `mergedAt` (an ISO 8601 timestamp or null) but not `merged`.

**Actual behavior:** The `gh pr list` command fails with `Unknown JSON field: "merged"`, causing `fetchPRsForRepo()` to return an empty array. This means all open issues with ADW comments are incorrectly counted as in-progress (since no PRs are returned to exclude them), potentially blocking new workflows due to a false concurrency limit.

**Expected behavior:** The command should use `mergedAt` instead of `merged` and correctly determine whether a PR was merged by checking if `mergedAt` is non-null.

## Problem Statement
The `gh` CLI's `--json` flag for `gh pr list` does not support a `merged` boolean field. The code assumes this field exists, causing the command to fail entirely and breaking the concurrency guard logic.

## Solution Statement
Replace the `merged` field with `mergedAt` in the `gh pr list --json` arguments, update the `RawPR` interface to use `mergedAt: string | null` instead of `merged: boolean`, and update the merged-check logic to use `pr.mergedAt != null` instead of `pr.merged`.

## Steps to Reproduce
1. Run the cron trigger or any workflow that invokes `getInProgressIssueCount()` or `isConcurrencyLimitReached()` from `concurrencyGuard.ts`
2. The `gh pr list --repo <owner>/<repo> --state all --json number,body,state,merged --limit 200` command is executed
3. The command fails with: `Unknown JSON field: "merged"`
4. `fetchPRsForRepo()` catches the error and returns an empty array
5. All open issues with ADW comments are counted as in-progress, potentially hitting the concurrency limit incorrectly

## Root Cause Analysis
The `gh` CLI does not have a `merged` boolean field in its PR JSON output schema. The GitHub REST/GraphQL API webhook payloads do include a `merged` boolean (used correctly in `PullRequestWebhookPayload` in `issueTypes.ts`), but the `gh pr list --json` command uses a different field set. The correct field is `mergedAt`, which is a timestamp string when the PR was merged or `null`/empty when it was not.

The bug is isolated to `adws/triggers/concurrencyGuard.ts` — the `RawPR` interface and the `gh pr list` command on line 47 use `merged` which doesn't exist in the `gh` CLI's JSON output.

## Relevant Files
Use these files to fix the bug:

- `adws/triggers/concurrencyGuard.ts` — Contains the broken `gh pr list` command with `merged` field, the `RawPR` interface, and the `hasLinkedMergedOrClosedPR` logic that checks `pr.merged`. This is the only file that needs code changes.
- `adws/triggers/__tests__/concurrencyGuard.test.ts` — Contains tests for the concurrency guard. Tests need to be updated to use `mergedAt` instead of `merged` in mock PR data.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow during the fix.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Update `RawPR` interface in `concurrencyGuard.ts`
- Change the `merged: boolean` property to `mergedAt: string | null` in the `RawPR` interface (line 22)

### 2. Update the `gh pr list` command in `fetchPRsForRepo()`
- Replace `merged` with `mergedAt` in the `--json` argument on line 47
- The command should become: `gh pr list --repo ${repoInfo.owner}/${repoInfo.repo} --state all --json number,body,state,mergedAt --limit 200`

### 3. Update the merged check in `hasLinkedMergedOrClosedPR()`
- Change `pr.merged` to `pr.mergedAt != null` on line 65
- This correctly checks whether the PR was merged by testing if the `mergedAt` timestamp is present

### 4. Update test mock data in `concurrencyGuard.test.ts`
- In the "excludes issues with merged PRs" test (line 54): change `merged: true` to `mergedAt: '2026-01-01T00:00:00Z'`
- In the "excludes issues with closed PRs" test (line 75): change `merged: false` to `mergedAt: null`

### 5. Run validation commands
- Run all validation commands listed below to confirm the fix works with zero regressions

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type check the main project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check the adws project
- `bun run test` — Run all tests to validate the fix with zero regressions

## Notes
- The `PullRequestWebhookPayload` type in `adws/types/issueTypes.ts` correctly uses `merged: boolean` — this is the GitHub webhook payload format (not `gh` CLI output) and should NOT be changed.
- The fix is minimal: only `concurrencyGuard.ts` and its test file need changes.
- Strictly adhere to the coding guidelines in `guidelines/coding_guidelines.md`.
