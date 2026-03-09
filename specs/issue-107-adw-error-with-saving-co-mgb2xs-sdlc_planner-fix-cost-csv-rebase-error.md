# Bug: Cost CSV git pull --rebase fails with "Cannot rebase onto multiple branches"

## Metadata
issueNumber: `107`
adwId: `error-with-saving-co-mgb2xs`
issueJson: `{"number":107,"title":"Error with saving cost","body":"📋 [2026-03-09T12:15:18.353Z] Issue #103 is already closed, skipping\n📋 [2026-03-09T12:15:18.360Z] Issue #103 was already closed or could not be closed\n❌ [2026-03-09T12:15:21.201Z] Failed to handle cost CSV files for issue #103: Error: Command failed: git pull --rebase --autostash origin \"main\"\nFrom github.com:paysdoc/AI_Dev_Workflow\n * branch            main       -> FETCH_HEAD\nfatal: Cannot rebase onto multiple branches.\n\n📋 [2026-03-09T12:15:21.201Z] PR close event handled: {\"status\":\"already_closed\",\"issue\":103}\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-09T13:24:10Z","comments":[],"actionableComment":null}`

## Bug Description
When a PR is closed (merged or not), the webhook handler calls `pullLatestCostBranch()` which runs `git pull --rebase --autostash origin "main"`. This command fails with `fatal: Cannot rebase onto multiple branches.`

**Expected behavior:** The cost CSV files should be committed and pushed successfully after a PR close event.

**Actual behavior:** The `git pull --rebase` command fails, preventing cost CSV data from being persisted.

## Problem Statement
The `git pull --rebase --autostash origin "${branch}"` command in `pullLatestCostBranch()` and `commitAndPushCostFiles()` uses `git pull` which internally relies on the shared `.git/FETCH_HEAD` file to determine merge heads. When concurrent webhook events (e.g., PR close + auto-issue close, or multiple PRs closing simultaneously) trigger parallel `git pull` operations on the same repository, concurrent writes to FETCH_HEAD can result in multiple merge-head entries. Git's rebase mode rejects this with "Cannot rebase onto multiple branches."

## Solution Statement
Replace `git pull --rebase --autostash origin "${branch}"` with two separate commands:
1. `git fetch origin "${branch}"` — fetches the latest remote state
2. `git rebase --autostash "origin/${branch}"` — rebases onto the remote tracking ref

Using the remote tracking ref (`origin/${branch}`) instead of FETCH_HEAD eliminates the race condition because remote tracking refs are atomically updated during fetch and do not suffer from the shared-file contention that FETCH_HEAD does.

Additionally, add a guard for empty branch names (detached HEAD case) to prevent malformed git commands.

## Steps to Reproduce
1. Set up the webhook server (`bunx tsx adws/triggers/trigger_webhook.ts`)
2. Close a PR linked to an issue (e.g., a PR with "Implements #103" in the body)
3. The PR close event triggers `handlePullRequestEvent()` in `webhookHandlers.ts`
4. `pullLatestCostBranch()` is called, which runs `git pull --rebase --autostash origin "main"`
5. If a concurrent webhook event (e.g., issue close triggered by the same PR close) also calls cost operations, FETCH_HEAD gets corrupted
6. Git fails with: `fatal: Cannot rebase onto multiple branches.`

## Root Cause Analysis
The `git pull --rebase` command is a composite operation: it runs `git fetch` followed by `git rebase FETCH_HEAD`. The FETCH_HEAD file is a shared resource in the `.git` directory. When two concurrent processes run `git pull` on the same repository:

1. Process A's `git pull` fetches and writes to FETCH_HEAD
2. Process B's `git pull` fetches and appends/overwrites FETCH_HEAD
3. When either process reads FETCH_HEAD for the rebase step, it may find multiple merge-head entries
4. Git's rebase mode rejects multiple merge heads with "Cannot rebase onto multiple branches"

This concurrency arises because:
- The webhook server handles events asynchronously (line 155 of `trigger_webhook.ts`: `handlePullRequestEvent(...).catch(...)`)
- A PR close triggers `handlePullRequestEvent()` which calls `pullLatestCostBranch()` (line 149 of `webhookHandlers.ts`)
- The same PR close may trigger `closeIssue()`, which causes GitHub to fire an issue close webhook, which calls `handleIssueCostRevert()` (line 178 of `trigger_webhook.ts`), which also calls `pullLatestCostBranch()` (line 61 of `trigger_webhook.ts`)
- Both calls run concurrently in the same process, sharing the same `.git/FETCH_HEAD` file

## Relevant Files
Use these files to fix the bug:

- `adws/github/gitCommitOperations.ts` — Contains `pullLatestCostBranch()` (line 57-62) and `commitAndPushCostFiles()` (line 150) where the failing `git pull --rebase --autostash` commands are. **This is the primary file to fix.**
- `adws/github/__tests__/commitCostFiles.test.ts` — Unit tests for `commitAndPushCostFiles()`. Tests at lines 210-248 verify the `git pull --rebase --autostash` behavior and need to be updated to match the new `git fetch` + `git rebase` pattern.
- `adws/triggers/__tests__/webhookHandlers.test.ts` — Integration tests for `handlePullRequestEvent()`. Mock for `pullLatestCostBranch` at line 24 should remain unchanged (it's already a no-op mock).
- `guidelines/coding_guidelines.md` — Coding guidelines to follow during implementation.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Fix `pullLatestCostBranch()` in `gitCommitOperations.ts`

- Replace the single `git pull --rebase --autostash origin "${branch}"` command (line 60) with two separate commands:
  1. `git fetch origin "${branch}"` — fetches latest changes from remote
  2. `git rebase --autostash "origin/${branch}"` — rebases onto the remote tracking ref
- Add a guard: if `getCurrentBranch()` returns an empty string (detached HEAD), throw a descriptive error or default to a safe branch name rather than executing a malformed command

### 2. Fix `commitAndPushCostFiles()` in `gitCommitOperations.ts`

- Apply the same fix to line 150: replace `git pull --rebase --autostash origin "${branch}"` with separate `git fetch origin "${branch}"` + `git rebase --autostash "origin/${branch}"` commands

### 3. Update unit tests in `commitCostFiles.test.ts`

- Update the test `'performs git pull --rebase --autostash before pushing'` (line 210) to verify the new two-step pattern: `git fetch` followed by `git rebase --autostash`
- Update the call order assertion from `['add', 'commit', 'pull-rebase', 'push']` to `['add', 'commit', 'fetch', 'rebase', 'push']`
- Update the test `'returns false when git pull --rebase --autostash fails'` (line 235) to simulate failure on `git fetch` or `git rebase` instead
- Add a new test verifying behavior when `getCurrentBranch()` returns an empty string

### 4. Run validation commands

- Run the validation commands listed below to confirm the fix works and no regressions are introduced.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun run lint` - Run linter to check for code quality issues
- `bunx tsc --noEmit` - Type-check the main project
- `bunx tsc --noEmit -p adws/tsconfig.json` - Type-check the adws scripts
- `bun run test` - Run all tests to validate the bug is fixed with zero regressions

## Notes
- The fix is minimal: only `gitCommitOperations.ts` needs code changes, plus corresponding test updates.
- The `pullLatestCostBranch` mock in `webhookHandlers.test.ts` is a `vi.fn()` that does nothing, so it does not need updating.
- The same `git pull --rebase` pattern does NOT appear in `checkoutBranch()` (`gitBranchOperations.ts:98`) — that function uses `git pull origin "${branchName}"` (without `--rebase`), which is a different command and not affected by this bug.
- Strictly adhere to the coding guidelines in `guidelines/coding_guidelines.md`.
