# Feature: Automatically commit cost when PR is closed

## Metadata
issueNumber: `66`
adwId: `automatically-ccommi-wdlirj`
issueJson: `{"number":66,"title":"Automatically ccommit cost when PR is closed","body":"The \n```\n/commit_cost\n```\ncommand should be called when a PR is closed. \nCurrently, the cost files, which are saved per issue, are saved in the default branch of the ADW repository. It is never commited nor pushed. \n\nThe cost files for the isssue, as well as total_cost of the project that the issue is in, need to be committed and pushed when the pr is approved, and reverted when the pr is closed without being approved, or the issue is closed without an approved PR. \n\nBefore the commit get executed, the total-cost.csv for that project has to be recalculated to ensure that it is up to date.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-04T13:48:19Z","comments":[],"actionableComment":null}`

## Feature Description
When a PR is closed, the cost tracking system should automatically handle cost CSV files based on the PR outcome:
- **PR merged (approved):** Rebuild the project's `total-cost.csv` to ensure accuracy, then commit and push the issue's cost CSV and the updated total-cost.csv.
- **PR closed without merge:** Delete the issue's cost CSV file (reverting the cost entry), rebuild `total-cost.csv` to exclude the reverted issue, then commit and push the changes.
- **Issue closed without an approved PR:** Delete the issue's cost CSV file, rebuild `total-cost.csv`, then commit and push.

The `total-cost.csv` must always be recalculated from all existing issue CSVs before any commit to ensure it reflects the current state.

## User Story
As a project manager
I want cost data to be automatically committed when a PR is approved and reverted when it's rejected
So that the cost tracking CSV files always accurately reflect the state of completed work

## Problem Statement
Currently, `handlePullRequestEvent()` calls `commitAndPushCostFiles()` for every PR close regardless of whether the PR was merged or not. It also does not rebuild `total-cost.csv` before committing, which can result in stale totals. There is no mechanism to revert cost data when a PR is closed without merging or when an issue is closed without an approved PR.

## Solution Statement
1. Modify `handlePullRequestEvent()` to differentiate between merged and closed-without-merge PRs.
2. Add a new `revertIssueCostFile()` function that deletes an issue's cost CSV file.
3. Call `rebuildProjectCostCsv()` before `commitAndPushCostFiles()` in all cases to ensure `total-cost.csv` is up to date.
4. When a PR is closed without merging: delete the issue CSV, rebuild total-cost.csv, commit and push.
5. Add cost revert logic to the issue `closed` event handler in `trigger_webhook.ts` for issues closed without an approved PR.

## Relevant Files
Use these files to implement the feature:

- `adws/triggers/webhookHandlers.ts` — Contains `handlePullRequestEvent()` which needs to differentiate merged vs closed-without-merge and call rebuild before commit.
- `adws/triggers/trigger_webhook.ts` — Contains the issue `closed` event handler that needs cost revert logic.
- `adws/github/gitOperations.ts` — Contains `commitAndPushCostFiles()`. Needs no changes but is called by the modified handlers.
- `adws/core/costCsvWriter.ts` — Contains `rebuildProjectCostCsv()` and path utilities. A new `revertIssueCostFile()` function will be added here.
- `adws/core/index.ts` — Barrel exports; needs to export the new `revertIssueCostFile()` function.
- `adws/__tests__/webhookHandlers.test.ts` — Existing tests for `handlePullRequestEvent()` that need updating for new merged/closed logic.
- `adws/__tests__/commitCostFiles.test.ts` — Existing tests, may need minor updates.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow.
- `app_docs/feature-trigger-should-commi-f8jwcf-commit-push-cost-csv.md` — Documentation for the existing cost commit feature.
- `adws/core/config.ts` — Contains `COST_REPORT_CURRENCIES` needed for EUR rate in rebuild.
- `adws/core/costReport.ts` — Contains `fetchExchangeRates()` for getting EUR rate.

### New Files
- `adws/__tests__/revertIssueCostFile.test.ts` — Unit tests for the new `revertIssueCostFile()` function.

## Implementation Plan
### Phase 1: Foundation
Add the `revertIssueCostFile()` function to `costCsvWriter.ts` that deletes an issue's cost CSV file if it exists. Export it from `core/index.ts`. Write unit tests for this new function.

### Phase 2: Core Implementation
Modify `handlePullRequestEvent()` in `webhookHandlers.ts` to:
1. When PR is merged: call `rebuildProjectCostCsv()` first, then `commitAndPushCostFiles()`.
2. When PR is closed without merge: call `revertIssueCostFile()`, then `rebuildProjectCostCsv()`, then `commitAndPushCostFiles()`.

The `rebuildProjectCostCsv()` requires a `repoRoot` (cwd of the ADW repo), `repoName`, and `eurRate`. The EUR rate should be fetched via `fetchExchangeRates(['EUR'])` to stay consistent with the existing cost system.

### Phase 3: Integration
Add cost revert logic to the issue `closed` event handler in `trigger_webhook.ts`. When an issue is closed directly (not via PR), check if a cost CSV exists for the issue and revert it (delete the file, rebuild total, commit and push). Update all existing tests and add new tests for the new behavior.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add `revertIssueCostFile()` to `costCsvWriter.ts`
- Add a new function `revertIssueCostFile(repoRoot: string, repoName: string, issueNumber: number)` that:
  - Scans the project directory `projects/<repoName>/` for any CSV file matching the pattern `<issueNumber>-*.csv`
  - Deletes the matching file(s) if found
  - Returns `true` if a file was deleted, `false` otherwise
  - Logs the action using `log()`
- Note: We scan by pattern rather than requiring the issue title because the title may not be available in all contexts (e.g., issue close events).

### Step 2: Export `revertIssueCostFile` from `core/index.ts`
- Add `revertIssueCostFile` to the exports in `adws/core/index.ts` alongside the other `costCsvWriter` exports.

### Step 3: Write unit tests for `revertIssueCostFile()`
- Create `adws/__tests__/revertIssueCostFile.test.ts` with tests for:
  - Successfully deletes a matching issue CSV file
  - Returns `false` when no matching file exists
  - Returns `false` when the project directory doesn't exist
  - Handles multiple matches (edge case — should delete all matching files)

### Step 4: Modify `handlePullRequestEvent()` for merged PRs
- In `webhookHandlers.ts`, update the cost commit section to:
  - Import `rebuildProjectCostCsv` from `../core` and `fetchExchangeRates` from `../core/costReport`
  - Before calling `commitAndPushCostFiles()`, call `fetchExchangeRates(['EUR'])` to get the EUR rate
  - Call `rebuildProjectCostCsv(process.cwd(), repoName, eurRate)` to recalculate `total-cost.csv`
  - Then call `commitAndPushCostFiles()` as before
  - Make `handlePullRequestEvent` aware that cost commit is async now (due to `fetchExchangeRates`)

### Step 5: Modify `handlePullRequestEvent()` for closed-without-merge PRs
- In the same function, when `wasMerged` is `false`:
  - Import `revertIssueCostFile` from `../core`
  - Call `revertIssueCostFile(process.cwd(), repoName, issueNumber)` to delete the issue's cost CSV
  - Call `fetchExchangeRates(['EUR'])` and then `rebuildProjectCostCsv()` to update the total
  - Call `commitAndPushCostFiles()` with project-only mode (just `repoName`, no `issueNumber`) since the issue CSV has been deleted
  - Wrap in try/catch to match existing error isolation pattern

### Step 6: Add cost revert to issue `closed` handler in `trigger_webhook.ts`
- In the `action === 'closed'` block for issue events:
  - After worktree cleanup, add cost revert logic
  - Extract the repo name from the payload
  - Call `revertIssueCostFile()` to delete the issue cost CSV
  - Call `rebuildProjectCostCsv()` with fetched EUR rate
  - Call `commitAndPushCostFiles()` in project mode
  - Wrap in try/catch for error isolation

### Step 7: Update `webhookHandlers.test.ts`
- Update existing tests to account for the new behavior:
  - Mock `rebuildProjectCostCsv` and `fetchExchangeRates`
  - Test that `rebuildProjectCostCsv` is called before `commitAndPushCostFiles` for merged PRs
  - Test that `revertIssueCostFile` is called for closed-without-merge PRs
  - Test that `commitAndPushCostFiles` is called with project-only mode after revert
  - Test that `rebuildProjectCostCsv` is called after revert
  - Test error isolation — failures in revert/rebuild don't break the handler
  - Update the "still succeeds when commitAndPushCostFiles throws" test

### Step 8: Run validation commands
- Run all validation commands to ensure zero regressions.

## Testing Strategy
### Unit Tests
- `revertIssueCostFile()` — file deletion, no-op when no file, directory doesn't exist
- `handlePullRequestEvent()` — merged path calls rebuild then commit; closed-without-merge path calls revert, rebuild, then commit; error isolation for all new operations
- Issue close handler — cost revert logic is triggered on issue close

### Edge Cases
- Issue CSV file doesn't exist when trying to revert (no-op, should not error)
- Project directory doesn't exist (no-op for revert)
- EUR rate fetch fails (should use 0 as fallback, matching existing `fetchExchangeRates` behavior)
- `rebuildProjectCostCsv` fails (should be caught and logged, not break handler)
- PR closed without merge but no issue link in body (should be ignored, existing behavior)
- Issue closed via PR close (both handlers fire — PR handler handles cost, issue close handler should be idempotent)

## Acceptance Criteria
- When a PR is merged, `total-cost.csv` is rebuilt before committing to ensure accuracy
- When a PR is closed without merging, the issue's cost CSV is deleted, `total-cost.csv` is rebuilt, and changes are committed and pushed
- When an issue is closed without a merged PR, the issue's cost CSV is deleted, `total-cost.csv` is rebuilt, and changes are committed and pushed
- All existing tests continue to pass
- New tests cover the revert, rebuild, and conditional commit logic
- Error isolation is maintained — failures in cost operations don't break issue closure or worktree cleanup

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `npm run lint` — Run linter to check for code quality issues
- `npx tsc --noEmit` — Type check the main project
- `npx tsc --noEmit -p adws/tsconfig.json` — Type check the adws scripts
- `npm test` — Run all tests to validate zero regressions
- `npm run build` — Build the application to verify no build errors

## Notes
- The `rebuildProjectCostCsv()` function already exists and scans all issue CSV files in the project directory to rebuild the total. This is idempotent and safe to call at any time.
- `fetchExchangeRates()` handles network errors gracefully by returning an empty map, so a failed rate fetch will result in `eurRate = 0` which `formatProjectCostCsv` handles by showing 'N/A' for EUR.
- The issue close handler in `trigger_webhook.ts` may fire alongside the PR close handler when a PR is merged and the issue is auto-closed. The revert logic should be idempotent (no-op if the CSV doesn't exist), so this double-fire scenario is safe.
- Follow `guidelines/coding_guidelines.md` strictly: use pure functions, avoid mutation, handle errors at boundaries, and maintain type safety.
