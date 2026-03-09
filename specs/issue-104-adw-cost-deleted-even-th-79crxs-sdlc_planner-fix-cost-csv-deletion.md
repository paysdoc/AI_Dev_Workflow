# Bug: Cost CSV deleted even though branch was merged

## Metadata
issueNumber: `104`
adwId: `cost-deleted-even-th-79crxs`
issueJson: `{"number":104,"title":"Cost deleted even though branch was merged","body":"The bugfix issue #99 was merged, yet the corresponding cost csv was deleted and not added. the cost csv should always be added. \nRemember that the csv is always created on the default branch of the ADW repo, so it should not be searched for anywhere else. \n\n✅ [2026-03-09T11:50:16.779Z] Deleted remote branch 'bugfix-issue-99-fix-currency-conversion'\n📋 [2026-03-09T11:50:16.779Z] No issue link found in PR #102 body (no \"Implements #N\" pattern)\n📋 [2026-03-09T11:50:16.780Z] PR close event handled: {\"status\":\"ignored\"}\n📋 [2026-03-09T11:50:16.780Z] Issue #99 closed, removing associated worktrees\n📋 [2026-03-09T11:50:16.780Z] Target repo registry set: paysdoc/AI_Dev_Workflow\n📋 [2026-03-09T11:50:16.794Z] No worktrees found matching issue #99\n✅ [2026-03-09T11:50:16.794Z] Removed 0 worktree(s) for issue #99\n\n[...]\n\n✅ [2026-03-09T11:50:19.874Z] Pulled latest changes from origin/main\n✅ [2026-03-09T11:50:19.875Z] Deleted cost CSV: projects/AI_Dev_Workflow/99-bug-in-currency-conversion.csv\n📋 [2026-03-09T11:50:19.882Z] Checking comment on issue #103: \"## :white_check_mark: Implementation Plan Created","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-09T11:55:12Z","comments":[],"actionableComment":null}`

## Bug Description
When PR #102 (linked to issue #99) was merged, the cost CSV file `projects/AI_Dev_Workflow/99-bug-in-currency-conversion.csv` was deleted instead of being kept. The expected behavior is that merged PRs preserve their cost CSV files and rebuild the project total. Instead, the cost CSV was deleted by the issue close handler because the PR body did not contain the `Implements #N` pattern.

**Expected behavior:** When a PR is merged, the associated cost CSV should always be kept, the total-cost.csv rebuilt, and the files committed/pushed.

**Actual behavior:** The cost CSV was deleted because: (1) the PR close handler returned early without processing cost files (no "Implements #N" in body), and (2) the subsequent issue close handler deleted the cost CSV since it didn't know the issue was merged via PR.

## Problem Statement
`handlePullRequestEvent()` in `webhookHandlers.ts` relies exclusively on the `Implements #N` pattern in the PR body to extract the linked issue number. When this pattern is absent (e.g., PR was created manually or the pattern wasn't included), the function returns early with `{ status: 'ignored' }` **before** reaching the cost CSV handling code. This means:
1. `recordMergedPrIssue()` is never called
2. When GitHub auto-closes the issue (or the issue is closed separately), `handleIssueCostRevert()` in `trigger_webhook.ts` checks `wasMergedViaPR()` which returns `false`
3. The cost CSV is then incorrectly deleted

## Solution Statement
Add a fallback mechanism to extract the issue number from the PR's head branch name when the PR body does not contain the `Implements #N` pattern. The ADW branch naming convention is `{prefix}/issue-{number}-{slug}` (e.g., `bugfix/issue-99-fix-currency-conversion`), so the issue number can be reliably extracted using the regex `/issue-(\d+)/`.

This ensures that even when the PR body lacks the explicit issue link, the merged PR's cost CSV is handled correctly — kept for merged PRs, deleted for closed-without-merge PRs.

## Steps to Reproduce
1. Create a PR for an issue where the PR body does NOT contain `Implements #N`
2. The PR branch follows ADW naming: e.g., `bugfix/issue-99-fix-currency-conversion`
3. Merge the PR
4. Observe that the PR close handler logs `No issue link found in PR #N body (no "Implements #N" pattern)` and returns `{ status: 'ignored' }`
5. The issue is closed (auto-closed or manually)
6. The issue close handler calls `handleIssueCostRevert()` which deletes the cost CSV

## Root Cause Analysis
The root cause is that `handlePullRequestEvent()` has a single extraction strategy for the issue number — the `Implements #N` pattern in the PR body. When this pattern is missing, the entire cost CSV handling path is skipped, including the critical `recordMergedPrIssue()` call that protects the cost CSV from being deleted by the issue close handler.

The flow that caused the bug:
1. PR #102 merged → `handlePullRequestEvent()` called
2. `extractIssueNumberFromPRBody('...')` returns `null` (no `Implements #N` in body)
3. Function returns `{ status: 'ignored' }` at line 108 — `recordMergedPrIssue(99)` never called
4. GitHub auto-closes issue #99 → `handleIssueCostRevert(99, 'AI_Dev_Workflow')` called
5. `wasMergedViaPR(99)` returns `false` → cost CSV deleted

## Relevant Files
Use these files to fix the bug:

- `adws/triggers/webhookHandlers.ts` — Contains `handlePullRequestEvent()` and `extractIssueNumberFromPRBody()`. The main file to modify: add branch-name fallback for issue number extraction.
- `adws/triggers/__tests__/webhookHandlers.test.ts` — Tests for `handlePullRequestEvent` and helpers. Must update existing test ("does not call commitAndPushCostFiles when no issue link found") and add new tests for branch-name extraction.
- `adws/triggers/__tests__/triggerWebhookIssueClosed.test.ts` — Tests for `handleIssueCostRevert`. No changes expected, but verify existing tests still pass.
- `adws/triggers/trigger_webhook.ts` — Contains `handleIssueCostRevert()`. No code changes needed, but understanding its interaction with `wasMergedViaPR()` is essential for the fix.
- `adws/core/costCsvWriter.ts` — Contains `revertIssueCostFile()` and `rebuildProjectCostCsv()`. No changes needed.
- `adws/github/gitCommitOperations.ts` — Contains `commitAndPushCostFiles()`. No changes needed.
- `app_docs/feature-automatically-ccommi-wdlirj-auto-commit-cost-on-pr.md` — Documentation for the auto-commit cost CSV feature. Read for context on the merged vs closed-without-merge flow.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add `extractIssueNumberFromBranch` function to `webhookHandlers.ts`

- Add a new exported function `extractIssueNumberFromBranch(branchName: string | null | undefined): number | null` in `adws/triggers/webhookHandlers.ts`
- The function should use the regex `/issue-(\d+)/` to extract the issue number from the branch name
- Return the parsed integer if found, `null` otherwise
- Return `null` for falsy input (null, undefined, empty string)
- Place this function next to `extractIssueNumberFromPRBody` for logical grouping

### Step 2: Update `handlePullRequestEvent` to use branch-name fallback

- In `adws/triggers/webhookHandlers.ts`, modify the issue number extraction logic in `handlePullRequestEvent()`
- After `extractIssueNumberFromPRBody(prBody)` returns `null`, try `extractIssueNumberFromBranch(headBranch)` as a fallback
- Only return `{ status: 'ignored' }` if BOTH extraction methods return `null`
- When the issue number is extracted from the branch name, log this fact (e.g., `Found linked issue #N from branch name: <branch>`)
- The rest of the function (issue closing, cost CSV handling) should work the same regardless of which extraction method succeeded

### Step 3: Update existing tests in `webhookHandlers.test.ts`

- In `adws/triggers/__tests__/webhookHandlers.test.ts`, update the test "does not call commitAndPushCostFiles when no issue link found":
  - The test payload currently has branch `feature/issue-42-add-login` which DOES contain the issue number
  - Change the branch name to something without an issue number (e.g., `feature/random-branch`) to test that when BOTH extraction methods fail, `commitAndPushCostFiles` is still not called
- Add tests for `extractIssueNumberFromBranch`:
  - Extracts issue number from `feature/issue-42-add-login` → `42`
  - Extracts issue number from `bugfix/issue-99-fix-currency-conversion` → `99`
  - Returns `null` for branch without issue pattern (e.g., `feature/random-branch`)
  - Returns `null` for `null` input
  - Returns `null` for empty string

### Step 4: Add integration test for branch-name fallback in merged PR flow

- In `adws/triggers/__tests__/webhookHandlers.test.ts`, add a test:
  - "falls back to branch name for issue extraction when PR body has no Implements #N (merged PR)"
  - Create a payload with `merged: true`, body without `Implements #N`, and branch `feature/issue-55-some-feature`
  - Assert that `rebuildProjectCostCsv` is called (merged path)
  - Assert that `commitAndPushCostFiles` is called with `{ repoName: 'repo', issueNumber: 55, issueTitle: '<PR title>' }`
  - Assert that `wasMergedViaPR(55)` returns `true` (recordMergedPrIssue was called)

### Step 5: Add integration test for branch-name fallback in closed-without-merge PR flow

- In `adws/triggers/__tests__/webhookHandlers.test.ts`, add a test:
  - "falls back to branch name for issue extraction when PR body has no Implements #N (closed without merge)"
  - Create a payload with `merged: false`, body without `Implements #N`, and branch `bugfix/issue-55-some-fix`
  - Assert that `revertIssueCostFile` is called (closed-without-merge path)
  - Assert that `commitAndPushCostFiles` is called with the reverted paths
  - Assert that `wasMergedViaPR(55)` returns `false`

### Step 6: Run validation commands

- Run `bun run lint` to check for code quality issues
- Run `bunx tsc --noEmit` to type-check the main project
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to type-check adws scripts
- Run `bun run test` to validate the bug is fixed with zero regressions
- Run `bun run build` to verify no build errors

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type-check the main project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the adws scripts
- `bun run test` — Run all tests to validate the fix and ensure zero regressions
- `bun run build` — Build the application to verify no build errors

## Notes
- The `guidelines/coding_guidelines.md` must be followed: prefer pure functions, use type narrowing, and keep code modular.
- The fix is minimal and surgical: one new function + one fallback line in the existing flow. No architectural changes needed.
- The regex `/issue-(\d+)/` matches the ADW branch naming convention `{prefix}/issue-{number}-{slug}`. This pattern is consistent across all branch types (feature, bugfix, chore, review).
- The `closeIssue()` call that happens after issue number extraction will still work correctly — if the issue was already auto-closed by GitHub, `closeIssue` returns `false` (already closed) which is handled gracefully.
- The `extractIssueNumberFromBranch` function is intentionally broad (matches `issue-(\d+)` anywhere in the string) to handle both slash-separated (`feature/issue-42-...`) and hyphen-separated (`bugfix-issue-42-...`) branch naming styles.
