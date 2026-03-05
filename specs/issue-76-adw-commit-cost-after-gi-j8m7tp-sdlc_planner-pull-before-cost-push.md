# Feature: Pull before cost push

## Metadata
issueNumber: `76`
adwId: `commit-cost-after-gi-j8m7tp`
issueJson: `{"number":76,"title":"Commit cost after git pull","body":"In issue 66 the autmatic commit of the cost files was implemented. However, the push sometimes fails due to a mismatch with origin: \n\n```\n[2026-03-05T12:51:46.145Z] Failed to commit cost CSV files: Error: Command failed: git push origin \"main\"\nTo github.com:paysdoc/AI_Dev_Workflow.git\n ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs to 'github.com:paysdoc/AI_Dev_Workflow.git'\nhint: Updates were rejected because the remote contains work that you do\nhint: not have locally. This is usually caused by another repository pushing\nhint: to the same ref. You may want to first integrate the remote changes\nhint: (e.g., 'git pull ...') before pushing again.\nhint: See the 'Note about fast-forwards' in 'git push --help' for details.\n```\n\nMake sure to have the latest version of the repo before pushing cost. This includes a pull before calculating the cost and a rebase just before pushing to mitigate changes on origin during the cost calculation.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-05T12:57:28Z","comments":[],"actionableComment":null}`

## Feature Description
The automatic cost CSV commit-and-push flow (implemented in issue #66) sometimes fails because the local branch is behind origin when `git push` is executed. This happens when another workflow or manual push has advanced the remote branch during or before cost calculation. The fix adds two safeguards:

1. **Pull before cost calculation** — callers of the cost commit flow pull the latest from origin before computing and writing cost CSVs, ensuring the working directory starts from a current state.
2. **Rebase before push** — `commitAndPushCostFiles()` performs a `git pull --rebase` just before pushing, so any commits that landed on origin during the cost calculation window are incorporated automatically.

## User Story
As a developer using the ADW webhook trigger
I want cost CSV commits to automatically handle out-of-date local branches
So that cost data is never lost due to push rejections from concurrent remote changes

## Problem Statement
When multiple ADW workflows run concurrently or a manual push occurs between cost calculation and the push step, `git push origin "main"` is rejected with "Updates were rejected because the remote contains work that you do not have locally." The cost CSV data is computed but never persisted to the remote repository.

## Solution Statement
Add a two-pronged approach:
1. In callers (`handlePullRequestEvent` and the issue close handler in `trigger_webhook.ts`), pull the latest changes before calling cost calculation functions (`rebuildProjectCostCsv`, `writeIssueCostCsv`).
2. In `commitAndPushCostFiles()` itself, perform a `git pull --rebase` immediately before `git push` to rebase the cost commit on top of any changes that arrived during the calculation window.

## Relevant Files
Use these files to implement the feature:

- `adws/github/gitOperations.ts` — Contains `commitAndPushCostFiles()` which needs a `git pull --rebase` before the push step. Also contains `getCurrentBranch()` used to determine the branch to push.
- `adws/triggers/webhookHandlers.ts` — Contains `handlePullRequestEvent()` which calls cost calculation then `commitAndPushCostFiles()`. Needs a `git pull` before cost calculation.
- `adws/triggers/trigger_webhook.ts` — Contains the issue `closed` event handler which calls `revertIssueCostFile`, `rebuildProjectCostCsv`, and `commitAndPushCostFiles`. Needs a `git pull` before cost operations.
- `adws/__tests__/commitCostFiles.test.ts` — Existing tests for `commitAndPushCostFiles()`. Needs new tests for the rebase-before-push behavior.
- `adws/__tests__/webhookHandlers.test.ts` — Existing tests for `handlePullRequestEvent()`. Needs updates to verify pull-before-cost behavior.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow during implementation.

## Implementation Plan
### Phase 1: Foundation
Add a `git pull --rebase` step inside `commitAndPushCostFiles()` in `gitOperations.ts`, placed after the `git commit` and before the `git push`. This ensures that even if the caller forgot to pull, the push will succeed by rebasing the cost commit on top of the latest remote state.

### Phase 2: Core Implementation
Update the two callers that invoke cost calculation + commit:
1. In `handlePullRequestEvent()` (`webhookHandlers.ts`), add a `git pull` (via `execSync`) on the current branch before calling `fetchExchangeRates` / `rebuildProjectCostCsv` / `commitAndPushCostFiles`.
2. In the issue `closed` handler (`trigger_webhook.ts`), add a `git pull` before calling `revertIssueCostFile` / `rebuildProjectCostCsv` / `commitAndPushCostFiles`.

### Phase 3: Integration
Update existing unit tests to account for the new `git pull --rebase` call in `commitAndPushCostFiles()`, and add new test cases covering:
- Successful rebase before push
- Rebase failure handling (should still fail gracefully and return false)
- Pull before cost calculation in webhook handlers

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Add `git pull --rebase` before push in `commitAndPushCostFiles()`
- In `adws/github/gitOperations.ts`, inside `commitAndPushCostFiles()`, add a `git pull --rebase origin <branch>` call after the `git commit` line and before the `git push` line.
- Use `getCurrentBranch(resolvedCwd)` (already called for the push) to determine the branch.
- The pull-rebase should be inside the existing try/catch so failures are caught and logged.

### 2. Add `pullLatest()` helper for callers
- In `adws/github/gitOperations.ts`, add and export a `pullLatestCostBranch(cwd?: string)` function that runs `git pull --rebase` on the current branch. This keeps the callers simple.
- Alternatively, callers can use an inline `execSync('git pull --rebase', ...)`. Choose the simpler approach — since the callers already import from `gitOperations`, adding a small exported helper is cleanest.

### 3. Pull before cost calculation in `handlePullRequestEvent()`
- In `adws/triggers/webhookHandlers.ts`, inside the cost CSV try/catch block, add a `git pull --rebase` call (using the helper or inline) before the `fetchExchangeRates` call.
- This ensures the working directory has the latest remote state before cost CSVs are written.

### 4. Pull before cost operations in `trigger_webhook.ts` issue close handler
- In `adws/triggers/trigger_webhook.ts`, inside the issue `closed` handler's cost revert block, add a `git pull --rebase` call before `revertIssueCostFile`.
- This ensures the working directory is current before deleting issue CSVs and rebuilding totals.

### 5. Update existing tests for `commitAndPushCostFiles()`
- In `adws/__tests__/commitCostFiles.test.ts`, update the `mockExecSync` implementations to handle the new `git pull --rebase` command.
- Add a new test case: "performs git pull --rebase before pushing" — verify the rebase call is made with the correct branch and cwd.
- Add a new test case: "returns false when git pull --rebase fails" — verify graceful failure.

### 6. Update webhook handler tests
- In `adws/__tests__/webhookHandlers.test.ts`, update mocks to account for the new `git pull --rebase` call that happens before cost calculation.
- Verify that `execSync` is called with `git pull --rebase` before cost-related functions.

### 7. Run validation commands
- Run `npm run lint`, `npx tsc --noEmit`, `npx tsc --noEmit -p adws/tsconfig.json`, `npm test`, and `npm run build` to validate the feature works correctly with zero regressions.

## Testing Strategy
### Unit Tests
- Test that `commitAndPushCostFiles()` calls `git pull --rebase origin <branch>` after commit and before push.
- Test that `commitAndPushCostFiles()` returns false and logs error when `git pull --rebase` fails.
- Test that existing behavior (no changes → skip, commit failure → return false) still works with the added rebase step.
- Test that `handlePullRequestEvent()` pulls before cost calculation.

### Edge Cases
- Rebase conflict during `git pull --rebase` — should fail gracefully and return false from `commitAndPushCostFiles()`.
- No changes to commit — the rebase step should never be reached (early return before commit).
- Network failure on pull — caught by existing try/catch, logged, returns false.
- Multiple concurrent cost commits — the rebase ensures they serialize correctly on origin.

## Acceptance Criteria
- `commitAndPushCostFiles()` performs `git pull --rebase` before `git push` so pushes succeed even when origin has advanced.
- Callers in `webhookHandlers.ts` and `trigger_webhook.ts` pull latest changes before computing cost data.
- All existing tests pass with the new behavior.
- New tests cover the rebase-before-push flow and failure handling.
- `npm run lint`, `npx tsc --noEmit`, `npx tsc --noEmit -p adws/tsconfig.json`, `npm test`, and `npm run build` all pass.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `npm run lint` — Run linter to check for code quality issues
- `npx tsc --noEmit` — Type-check the Next.js application
- `npx tsc --noEmit -p adws/tsconfig.json` — Type-check the ADW scripts
- `npm test` — Run all unit tests to validate the feature works with zero regressions
- `npm run build` — Build the application to verify no build errors

## Notes
- The `git pull --rebase` approach is preferred over `git pull --merge` because it creates a linear history for cost commits, avoiding unnecessary merge commits.
- The rebase in `commitAndPushCostFiles()` is a safety net — the caller-side pull is the primary mechanism. Together they handle both "stale before calculation" and "stale during calculation" scenarios.
- Follow `guidelines/coding_guidelines.md`: use try-catch at system boundaries, provide meaningful error messages, keep functions focused on a single responsibility.
