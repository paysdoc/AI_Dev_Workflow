# Chore: Rewrite cost commit mechanism

## Metadata
issueNumber: `109`
adwId: `rewrite-cost-commit-22b71a`
issueJson: `{"number":109,"title":"Rewrite cost commit mechanism","body":"/adw_plan\n\n/bug\n\nAt leat 9 issues have been devoted to resolbving a persistent cost issue. Each time the solution is different. The problem is never fixed. If you were a programmer, you'd be fired by now.\n\nRevisit github issues, 60-, 66, 76, 77, 85, 94, 100, 104 and 107. See what the problem statement was and the solution you came up with. \nNow think hard why, after all these changes, the issue still throws away the cost file instead of saving it to git. Come up with a plan. I will review the plan and only allow you to implement it once I'm satisfied.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-09T13:43:37Z","comments":[],"actionableComment":null}`

## Chore Description

The cost CSV commit mechanism has been the subject of 9 separate issues (#60, #66, #76, #77, #85, #94, #100, #104, #107), each applying an incremental patch to fix a specific failure mode. Despite these fixes, the mechanism remains fragile and continues to lose cost data. This chore rewrites the mechanism from first principles to eliminate the three root causes that have driven every single failure.

### Root Cause Analysis

After reviewing all 9 issues, the failures fall into three categories:

**1. Concurrency — No serialization of git operations (Issues #76, #83/85, #107)**
When a PR is merged, GitHub fires both a `pull_request.closed` event and an `issues.closed` event nearly simultaneously. Both webhook handlers call `pullLatestCostBranch()` and `commitAndPushCostFiles()` concurrently on the same repository. This creates git race conditions:
- #76: `git push` rejected because remote had new commits → fix: added `git pull --rebase` before push
- #83/85: `git pull --rebase` failed with dirty working directory → fix: added `--autostash`
- #107: Concurrent `git pull --rebase` calls corrupted `.git/FETCH_HEAD` → fix: split into `git fetch` + `git rebase`

Each fix addressed one symptom. The next concurrency scenario will find another way to fail because **there is no mutex protecting the shared git state**.

**2. Dual-event race — PR close and issue close compete (Issues #94, #104)**
When a PR is merged, GitHub auto-closes the linked issue, producing two events that both try to manage cost files:
- The PR close handler commits the cost CSV (correct for merged PRs)
- The issue close handler reverts the cost CSV (intended for abandoned issues)

The fix was a `mergedPrIssues` Set with a 60-second TTL. This is fragile:
- #94: Without the guard, the issue close handler deleted costs that the PR merge handler just committed
- #104: The PR body lacked `Implements #N`, so the PR handler couldn't find the issue number, did nothing, and the issue close handler then reverted the costs

The 60-second TTL is arbitrary. The consume-on-read behavior means a second event check would miss the guard.

**3. Over-complicated staging modes (Issue #100)**
`commitAndPushCostFiles()` supports 4 different modes (single issue, project, all projects, explicit paths). The explicit-paths mode was needed for the revert case but introduced a bug: `git add` failed on deleted files that were never tracked by git. The fix added path-filtering logic that itself adds complexity.

### The Rewrite Strategy

Instead of patching symptoms, this rewrite addresses each root cause:

1. **Add an async operation queue** (`CostCommitQueue`) that serializes all cost-related git operations. Only one operation runs at a time. This eliminates the entire class of concurrency bugs.

2. **Make the merged-PR guard durable** by removing the TTL and the consume-on-read behavior. Once a PR merge handler records an issue number, it stays recorded for the lifetime of the process. The queue ensures the PR handler always runs to completion before the issue close handler checks the guard.

3. **Simplify `commitAndPushCostFiles` to 2 modes** (project and all-projects), removing the explicit-paths and single-issue modes. After any cost file operation (write, delete, rebuild), we simply commit all changes in `projects/<repoName>/`. This naturally handles additions, deletions, and updates without path-level bookkeeping.

## Relevant Files
Use these files to resolve the chore:

- `adws/github/gitCommitOperations.ts` — Contains `commitAndPushCostFiles()`, `pullLatestCostBranch()`, and `CommitCostFilesOptions`. This is the primary file to refactor: simplify to 2 modes and remove path-filtering complexity.
- `adws/triggers/webhookHandlers.ts` — Contains `handlePullRequestEvent()`, `mergedPrIssues` tracking, and the cost commit/revert orchestration for PR close events. Needs queue integration and simplified staging calls.
- `adws/triggers/trigger_webhook.ts` — Contains `handleIssueCostRevert()` which reverts cost CSVs on issue close. Needs queue integration and simplified staging calls.
- `adws/github/gitOperations.ts` — Barrel re-export file. Update exports if `CommitCostFilesOptions` changes.
- `adws/core/index.ts` — Core barrel exports. May need to export the new queue module.
- `adws/github/__tests__/commitCostFiles.test.ts` — Tests for `commitAndPushCostFiles`. Rewrite to match simplified 2-mode API.
- `adws/triggers/__tests__/webhookHandlers.test.ts` — Tests for `handlePullRequestEvent` cost logic. Update for queue and simplified calls.
- `adws/triggers/__tests__/triggerWebhookIssueClosed.test.ts` — Tests for `handleIssueCostRevert`. Update for queue and durable guard.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow during implementation.
- `app_docs/feature-trigger-should-commi-f8jwcf-commit-push-cost-csv.md` — Original feature doc for cost commit mechanism (reference only).
- `app_docs/feature-automatically-ccommi-wdlirj-auto-commit-cost-on-pr.md` — Feature doc for cost revert mechanism (reference only).

### New Files
- `adws/core/costCommitQueue.ts` — New module: async operation queue that serializes all cost-related git operations.
- `adws/core/__tests__/costCommitQueue.test.ts` — Tests for the new queue module.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Create the `CostCommitQueue` module

- Create `adws/core/costCommitQueue.ts` with a singleton queue class:
  - Maintains an internal promise chain initialized to `Promise.resolve()`
  - `enqueue(operation: () => Promise<void>): Promise<void>` — appends the operation to the chain, ensuring serial execution
  - Each operation is awaited before the next starts
  - Errors in one operation are caught and logged (do not block subsequent operations)
  - Export a singleton instance: `export const costCommitQueue = new CostCommitQueue()`
  - Export the class for testing: `export class CostCommitQueue { ... }`
- The queue guarantees that only one cost git operation (pull, commit, push) runs at a time, eliminating all concurrency race conditions from issues #76, #83, #107.

### Step 2: Create tests for `CostCommitQueue`

- Create `adws/core/__tests__/costCommitQueue.test.ts` with tests:
  - Operations execute serially (second operation starts only after first completes)
  - A failing operation does not block subsequent operations
  - Multiple operations enqueued concurrently execute in enqueue order
  - The returned promise resolves when the operation completes
  - Queue handles async operations correctly

### Step 3: Simplify `commitAndPushCostFiles` in `gitCommitOperations.ts`

- Remove the `paths` field from `CommitCostFilesOptions` interface
- Remove the `issueNumber` and `issueTitle` fields from `CommitCostFilesOptions` interface
- The simplified interface becomes: `{ repoName?: string; cwd?: string }`
- Remove the explicit-paths mode (lines 102-119) — this eliminates the path-filtering logic and the `existsSync`/`git ls-files` complexity that caused issue #100
- Remove the single-issue mode (lines 120-126) — the project mode already covers this case by staging all CSVs in the project directory
- Keep the **project mode**: when `repoName` is provided, stage `projects/<repoName>/*.csv` and use `projects/<repoName>/` for status check. Commit message: `cost: update cost data for <repoName>`. Note: use `git add "projects/<repoName>/"` (the directory, not a glob) so that git stages both additions AND deletions.
- Keep the **all-projects mode**: when no `repoName`, stage `projects/`. Commit message: `cost: update cost data for all projects`
- Remove the `issueNumber !== undefined && !repoName` guard (no longer needed)
- Remove the `fs` import (`existsSync`) — no longer used
- Remove the `path` import — no longer used
- Remove the `getIssueCsvPath` import — no longer used in this file
- Keep `getProjectCsvPath` import only if still needed elsewhere in the file; if not, remove it too
- Keep the fetch + rebase + push synchronization logic unchanged
- Keep the detached HEAD guard unchanged

### Step 4: Update `commitCostFiles.test.ts`

- Remove tests for single-issue mode (the `repoName + issueNumber + issueTitle` tests)
- Remove tests for explicit-paths mode (path filtering, untracked deleted files, tracked deletions)
- Remove the test for `issueNumber without repoName` validation
- Update the project-mode test to verify `git add "projects/<repoName>/"` (directory, not glob)
- Update the commit message expectation to `cost: update cost data for <repoName>`
- Keep the project-mode, all-projects-mode, no-changes, fetch+rebase ordering, fetch failure, rebase failure, and detached HEAD tests (updated for new commit messages where needed)
- Add a test verifying that deletions within the project directory are staged correctly when using directory-based `git add`

### Step 5: Make `mergedPrIssues` guard durable in `webhookHandlers.ts`

- Remove the `setTimeout(() => mergedPrIssues.delete(issueNumber), 60_000)` from `recordMergedPrIssue()`. Once recorded, the entry persists for the process lifetime.
- Change `wasMergedViaPR()` to NOT consume (delete) the entry on read. Simply return `mergedPrIssues.has(issueNumber)`.
- This makes the guard reliable regardless of event timing or ordering. The set won't grow unbounded because:
  - Each entry is just a number (negligible memory)
  - The webhook server process restarts periodically
  - `resetMergedPrIssues()` is available for test cleanup

### Step 6: Integrate queue into `handlePullRequestEvent` in `webhookHandlers.ts`

- Import `costCommitQueue` from `../core/costCommitQueue`
- Wrap the entire cost-handling block (lines 148-168) in `costCommitQueue.enqueue(async () => { ... })`
- Inside the queued operation:
  - Call `pullLatestCostBranch()` (unchanged)
  - Fetch EUR rate (unchanged)
  - If merged: `rebuildProjectCostCsv()` → `commitAndPushCostFiles({ repoName })` → `recordMergedPrIssue(issueNumber)`
  - If closed without merge: `revertIssueCostFile()` → `rebuildProjectCostCsv()` → `commitAndPushCostFiles({ repoName })`
  - Note: no longer pass `issueNumber`, `issueTitle`, or `paths` to `commitAndPushCostFiles` — just `repoName`
- The `await` on `costCommitQueue.enqueue()` is important: the function should `await` it inside the try/catch so errors are still caught and logged
- Remove the `getProjectCsvPath` import (no longer needed here)

### Step 7: Integrate queue into `handleIssueCostRevert` in `trigger_webhook.ts`

- Import `costCommitQueue` from `../core/costCommitQueue`
- Wrap the cost revert logic in `costCommitQueue.enqueue(async () => { ... })`
- Inside the queued operation:
  - Check `wasMergedViaPR()` first (unchanged)
  - Call `pullLatestCostBranch()` (unchanged)
  - Call `revertIssueCostFile()` (unchanged)
  - If files were reverted: fetch EUR rate, `rebuildProjectCostCsv()`, `commitAndPushCostFiles({ repoName })` — no longer pass `paths`
- Remove the `getProjectCsvPath` import (no longer needed here)

### Step 8: Update barrel exports

- In `adws/core/index.ts`: add `export { costCommitQueue, CostCommitQueue } from './costCommitQueue'`
- In `adws/github/gitOperations.ts`: update the `CommitCostFilesOptions` re-export if its shape changed. Remove `getIssueCsvPath` from imports if no longer needed.
- Verify no other files import the removed fields (`paths`, `issueNumber`, `issueTitle`) from `CommitCostFilesOptions`

### Step 9: Update `webhookHandlers.test.ts`

- Update mock for `commitAndPushCostFiles` — it now receives `{ repoName }` only, not `{ repoName, issueNumber, issueTitle }` or `{ repoName, paths: [...] }`
- Update assertions for the merged-PR path: verify `commitAndPushCostFiles` is called with `{ repoName: 'repo-name' }`
- Update assertions for the closed-without-merge path: verify `commitAndPushCostFiles` is called with `{ repoName: 'repo-name' }` (no `paths`)
- Add/update test verifying that `recordMergedPrIssue` is called after successful cost commit on merge
- Mock `costCommitQueue.enqueue` to execute the callback synchronously for test simplicity, OR mock the queue module entirely to pass-through
- Verify the `mergedPrIssues` guard no longer uses TTL or consumes on read

### Step 10: Update `triggerWebhookIssueClosed.test.ts`

- Update the test that verifies `commitAndPushCostFiles` is called with `paths` — it should now verify it's called with `{ repoName: 'my-repo' }` only
- Verify the `wasMergedViaPR` guard still works (the test for skipping revert when issue was handled by merged PR should remain unchanged)
- Mock `costCommitQueue.enqueue` to execute the callback synchronously for test simplicity, OR mock the queue module

### Step 11: Search for any other consumers of the removed API

- Search the codebase for any other files that import `CommitCostFilesOptions` or call `commitAndPushCostFiles` with the old signature (with `issueNumber`, `issueTitle`, or `paths`)
- Check `.claude/commands/commit_cost.md` — this is a slash command that instructs Claude to stage cost files manually. It does NOT call `commitAndPushCostFiles` programmatically, so it should be unaffected. Verify and update if needed.
- Check `adws/phases/workflowCompletion.ts` — this file writes cost CSVs to disk but does NOT call `commitAndPushCostFiles`. Verify it's unaffected.

### Step 12: Run validation commands

- Run all validation commands to ensure zero regressions (see below).

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint` - Run linter to check for code quality issues
- `bunx tsc --noEmit` - Type-check the main project
- `bunx tsc --noEmit -p adws/tsconfig.json` - Type-check the ADW scripts
- `bun run test` - Run all tests to validate zero regressions
- `bun run build` - Build the application to verify no build errors

## Notes
- IMPORTANT: Follow `guidelines/coding_guidelines.md` strictly — especially modularity (files under 300 lines), type safety, purity, and explicit error handling.
- The `CostCommitQueue` is a simple async mutex pattern (promise chain). Do not over-engineer it with retry logic, timeouts, or persistent storage. Its only job is serialization.
- The `/commit_cost` slash command (`.claude/commands/commit_cost.md`) instructs Claude to run git commands directly — it does not call `commitAndPushCostFiles()`. It is unaffected by this refactor.
- `workflowCompletion.ts` writes cost CSVs to disk but does not commit/push them. The commit/push happens later via the webhook handlers. This separation is intentional and should be preserved.
- When switching from `git add "projects/<repoName>/*.csv"` (glob) to `git add "projects/<repoName>/"` (directory), git will stage ALL changes in that directory (additions, modifications, AND deletions). This is the key simplification that eliminates the need for explicit path tracking.
