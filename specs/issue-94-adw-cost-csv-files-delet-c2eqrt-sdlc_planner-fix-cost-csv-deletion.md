# Bug: Cost CSV files deleted unjustly on PR merge

## Metadata
issueNumber: `94`
adwId: `cost-csv-files-delet-c2eqrt`
issueJson: `{"number":94,"title":"Cost csv files deleted unjustly","body":"Even though PR 93 was approved, the cost csv for related issue 91 was deleted, though it should have been pushed.\nCost files for unrelated issue 90 were also deleted even though they ought to have been ignored. \n\n```\n📋 [2026-03-06T14:53:28.027Z] No worktrees found matching issue #91\n✅ [2026-03-06T14:53:28.027Z] Removed 0 worktree(s) for issue #91\n✅ [2026-03-06T14:53:31.203Z] Pulled latest changes from origin/main\n✅ [2026-03-06T14:53:31.203Z] Deleted cost CSV: projects/AI_Dev_Workflow/91-an-issue-should-only-be-moved-to-review-once-the-r.csv\n✅ [2026-03-06T14:53:31.238Z] Project cost CSV rebuilt: projects/AI_Dev_Workflow/total-cost.csv\n✅ [2026-03-06T14:53:37.222Z] Committed and pushed cost CSV files\n✅ [2026-03-06T14:53:37.223Z] Reverted cost CSV for issue #91 in AI_Dev_Workflow\n```","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-06T14:57:18Z","comments":[{"author":"paysdoc","createdAt":"2026-03-08T11:39:57Z","body":"## Take action"}],"actionableComment":null}`

## Bug Description
When PR #93 (implementing issue #91) was merged, the cost CSV for issue #91 was deleted instead of being preserved. Additionally, cost CSV files for unrelated issue #90 were also deleted. The expected behavior is that when a PR is merged, its linked issue's cost CSV should be kept and committed; only when a PR is closed _without_ merging should the cost CSV be reverted (deleted).

**Expected:** Issue #91's cost CSV is committed and pushed after PR merge. Unrelated issue #90's cost CSV is untouched.

**Actual:** Issue #91's cost CSV was deleted. Issue #90's cost CSV was also deleted and committed.

## Problem Statement
Two webhook events fire when a PR is merged: `pull_request.closed` (handled by `handlePullRequestEvent`) and `issues.closed` (handled inline in `trigger_webhook.ts`). The PR handler correctly keeps the cost CSV for merged PRs, but the issue close handler unconditionally reverts (deletes) the cost CSV, undoing the PR handler's work. Additionally, the issue close handler uses a project-wide commit scope that catches unrelated cost files.

## Solution Statement
1. Track which issue numbers have had their cost CSV handled by a merged PR using an in-memory Set in `webhookHandlers.ts`.
2. In the issue close handler (`trigger_webhook.ts`), skip cost CSV revert if the issue was already handled by a merged PR.
3. Scope the commit in the issue close handler to only the specific deleted files + total CSV, instead of all CSVs in the project directory.
4. Fix the empty array truthiness check (`if (reverted)` → `if (reverted.length > 0)`) since `revertIssueCostFile` returns `string[]` and `[]` is truthy in JavaScript.

## Steps to Reproduce
1. Create an issue (e.g., #91) and run ADW workflow to generate cost CSV
2. Create a PR that implements issue #91 with "Implements #91" in the body
3. Merge the PR
4. Observe that both `pull_request.closed` and `issues.closed` webhook events fire
5. The PR handler correctly commits the cost CSV, but the issue close handler then deletes it
6. Any other locally-modified cost CSVs (e.g., issue #90) get caught in the project-wide commit

## Root Cause Analysis
Three bugs combine to cause this issue:

**Bug 1 — Double-fire race condition:** When `handlePullRequestEvent()` processes a merged PR, it calls `closeIssue()` which triggers a `issues.closed` webhook event. The issue close handler in `trigger_webhook.ts` then unconditionally calls `revertIssueCostFile()`, deleting the cost CSV that the PR handler just committed. There is no coordination between the two handlers.

**Bug 2 — Project-wide commit scope:** The issue close handler calls `commitAndPushCostFiles({ repoName: closedRepoName })` which uses project-wide mode (`git add "projects/<repoName>/*.csv"`). This stages ALL CSV changes in the project directory, including unrelated files for issue #90 that may have been locally modified or deleted by the pull/rebase operation.

**Bug 3 — Incorrect truthiness check:** `revertIssueCostFile()` returns `string[]` but the issue close handler checks `if (reverted)`. Since empty arrays `[]` are truthy in JavaScript, this check always passes, meaning rebuild and commit always run even when no files were reverted.

## Relevant Files
Use these files to fix the bug:

- `adws/triggers/webhookHandlers.ts` — Contains `handlePullRequestEvent()` which handles PR close events. Needs to record merged PR issue numbers in a tracking Set and export functions for querying it.
- `adws/triggers/trigger_webhook.ts` — Contains the issue close handler that unconditionally reverts cost CSV. Needs to check the merged PR tracking set before reverting, fix the commit scope, and fix the truthiness check.
- `adws/__tests__/webhookHandlers.test.ts` — Existing tests for `handlePullRequestEvent`. Needs new tests for the merged PR tracking functionality.
- `adws/__tests__/triggerWebhookIssueClosed.test.ts` — New test file for the issue close cost revert logic.
- `adws/core/costCsvWriter.ts` — Contains `revertIssueCostFile()`. Read-only reference to understand return type.
- `adws/github/gitOperations.ts` — Contains `commitAndPushCostFiles()`. Read-only reference to understand commit modes.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow.
- `app_docs/feature-automatically-ccommi-wdlirj-auto-commit-cost-on-pr.md` — Documentation for the cost CSV auto-commit feature. Read-only reference.

### New Files
- `adws/__tests__/triggerWebhookIssueClosed.test.ts` — Unit tests for the issue close cost revert logic in `trigger_webhook.ts`.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add merged PR issue tracking to `webhookHandlers.ts`
- Add a module-level `Set<number>` named `mergedPrIssues` to track issue numbers whose PRs were merged and cost CSV was committed.
- Add a `recordMergedPrIssue(issueNumber: number): void` function that adds to the set and schedules removal after 60 seconds (to prevent unbounded growth).
- Add a `wasMergedViaPR(issueNumber: number): boolean` function that checks and removes from the set (consume-once pattern).
- Export both functions and a `resetMergedPrIssues()` function for test cleanup.
- In `handlePullRequestEvent()`, after the successful `commitAndPushCostFiles()` call in the `wasMerged` branch, call `recordMergedPrIssue(issueNumber)`.

### Step 2: Fix issue close handler in `trigger_webhook.ts`
- Import `wasMergedViaPR` from `./webhookHandlers`.
- In the `action === 'closed'` block for issues, before calling `revertIssueCostFile`, check `wasMergedViaPR(issueNumber)`. If true, skip cost revert entirely and log a message like `Skipping cost revert for issue #${issueNumber}: already handled by merged PR`.
- Fix the truthiness check: change `if (reverted)` to `if (reverted.length > 0)`.
- Fix the commit scope: replace `commitAndPushCostFiles({ repoName: closedRepoName })` with `commitAndPushCostFiles({ repoName: closedRepoName, paths: [...reverted, getProjectCsvPath(closedRepoName)] })` to only stage the specific deleted files and total CSV.
- Import `getProjectCsvPath` from `../core` (already available in the barrel export).

### Step 3: Add tests for merged PR tracking in `webhookHandlers.test.ts`
- Add a test that verifies `recordMergedPrIssue` records an issue number and `wasMergedViaPR` returns true for it.
- Add a test that verifies `wasMergedViaPR` returns false for an unrecorded issue number.
- Add a test that verifies `wasMergedViaPR` consumes the entry (returns false on second call).
- Add a test that verifies `handlePullRequestEvent` calls `recordMergedPrIssue` after a successful merged PR with cost commit.
- Add a test that verifies `handlePullRequestEvent` does NOT call `recordMergedPrIssue` for closed-without-merge PRs.
- Import `resetMergedPrIssues` and call it in `beforeEach` for cleanup.

### Step 4: Add tests for issue close cost revert guard in `triggerWebhookIssueClosed.test.ts`
- Create a new test file `adws/__tests__/triggerWebhookIssueClosed.test.ts`.
- Test that when `wasMergedViaPR` returns true, `revertIssueCostFile` is NOT called.
- Test that when `wasMergedViaPR` returns false, `revertIssueCostFile` IS called.
- Test that when `revertIssueCostFile` returns an empty array, `rebuildProjectCostCsv` and `commitAndPushCostFiles` are NOT called.
- Test that when `revertIssueCostFile` returns deleted paths, `commitAndPushCostFiles` is called with specific paths (not project-wide).
- Note: The issue close handler is embedded in the HTTP server's request handler, so tests may need to either extract the handler logic into a testable function, or test via HTTP request simulation. Prefer extracting the logic into a separate exported function for testability.

### Step 5: Extract issue close cost handler for testability
- If not already testable, extract the cost revert logic from the `action === 'closed'` block in `trigger_webhook.ts` into a separate exported async function, e.g., `handleIssueCostRevert(issueNumber: number, repoName: string): Promise<void>`.
- This function should contain: the `wasMergedViaPR` check, `pullLatestCostBranch`, `revertIssueCostFile`, `rebuildProjectCostCsv`, and scoped `commitAndPushCostFiles`.
- Update the inline handler to call this new function.
- Update the tests in Step 4 to test this extracted function directly.

### Step 6: Run validation commands

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type-check the main project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check adws scripts
- `bun run test` — Run all tests to validate the bug is fixed with zero regressions

## Notes
- The in-memory Set approach for tracking merged PR issues is simple and effective because both webhook events (PR close and issue close) fire within seconds of each other in the same process.
- The 60-second expiry on tracked entries prevents unbounded memory growth while providing ample time for the issue close event to arrive.
- The `wasMergedViaPR` function uses a consume-once pattern (removes the entry after checking) to prevent stale entries from accumulating.
- The `revertIssueCostFile()` function is already idempotent — if no files exist, it returns `[]` and logs a message. The fix ensures we don't proceed to rebuild/commit in that case.
- Strictly follow `guidelines/coding_guidelines.md`: modularity, type safety, pure functions where possible, meaningful variable names, and unit tests for all changes.
