# Bug: Total cost CSV contains duplicate/orphaned rows

## Metadata
issueNumber: `60`
adwId: `total-cost-contains-ojlavn`
issueJson: `{"number":60,"title":"Total cost contains unlinked item lines","body":"The total cost sometimes contains lines that do not correspond with lines in the issue csv. \n\nTo prevent this error from occurring, the total-cost.csv should be deleted and recalculated based on all the issue csv's in the project directory.\n\nSee the following example. \n### 6-set-up-adw-environment.csv\n```\nModel,Input Tokens,Output Tokens,Cache Read,Cache Write,Cost (USD)\nclaude-opus-4-6,45,11896,1190928,26536,1.0589\nclaude-haiku-4-5-20251001,21308,1156,0,0,0.0271\nclaude-sonnet-4-6,22,3906,530753,14183,0.4518\n\nTotal Cost (USD):,1.5378\nTotal Cost (EUR):,1.3030\n```\n\n### total-cost.csv\n```\nIssue number,Issue description,Cost (USD),Markup (10%)\n6,Set up adw environment,1.1719,0.1172\n6,Set up adw environment,1.5378,0.1538\n\nTotal Cost (USD):,2.9807\nTotal Cost (EUR):,2.5255\n```","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-03T10:20:21Z","comments":[],"actionableComment":null}`

## Bug Description
The `total-cost.csv` file accumulates duplicate and orphaned rows over time. When the same issue goes through multiple workflow runs (e.g., build then PR review, or a re-run after failure), `updateProjectCostCsv()` blindly appends a new row each time without checking whether an entry for that issue already exists. This results in multiple rows for the same issue number with different costs, and the totals become inflated.

**Expected behavior:** Each issue should have exactly one row in `total-cost.csv`, reflecting the latest cost from its individual issue CSV file. The total should be the sum of all individual issue CSVs in the project directory.

**Actual behavior:** The same issue number appears multiple times with different cost values (e.g., issue 6 appears twice with costs 1.1719 and 1.5378), and the total is the sum of all duplicate rows.

## Problem Statement
`updateProjectCostCsv()` in `adws/core/costCsvWriter.ts` reads the existing `total-cost.csv`, appends a new row unconditionally, and writes back. It never checks for existing rows with the same issue number, and it never cross-references the actual issue CSV files on disk. This causes duplicates when an issue goes through multiple workflow phases or re-runs.

## Solution Statement
Replace the append-based `updateProjectCostCsv()` with a new `rebuildProjectCostCsv()` function that deletes the existing `total-cost.csv` and rebuilds it from scratch by scanning all individual issue CSV files in the project directory. Each issue CSV file is parsed to extract its total cost, and the issue number and description are derived from the filename. This ensures `total-cost.csv` is always an accurate reflection of the issue CSVs on disk, with no duplicates or orphaned entries.

## Steps to Reproduce
1. Run an ADW workflow on an issue (e.g., issue #6 via `adwPlanBuild.tsx 6`). This writes `6-set-up-adw-environment.csv` and appends a row to `total-cost.csv`.
2. Run another ADW workflow on the same issue (e.g., PR review via `adwPrReview.tsx`). This overwrites the issue CSV with updated costs but appends a second row to `total-cost.csv`.
3. Observe `total-cost.csv` now has two rows for issue 6 with different costs.

## Root Cause Analysis
In `adws/core/costCsvWriter.ts`, the `updateProjectCostCsv()` function (lines 121-150):
1. Reads the existing `total-cost.csv` and parses its rows via `parseProjectCostCsv()`
2. **Always pushes** a new `ProjectCostRow` to the array (line 140-145) without checking if a row for the same `issueNumber` already exists
3. Writes the full array back to disk

Meanwhile, `writeIssueCostCsv()` (lines 104-118) **overwrites** the issue CSV file each time it runs, so the individual issue CSV always has the correct latest cost. But `total-cost.csv` accumulates stale rows.

The callers in `workflowLifecycle.ts:373` and `prReviewPhase.ts:318` both call `updateProjectCostCsv()` after `writeIssueCostCsv()`, so every workflow completion adds another row.

## Relevant Files
Use these files to fix the bug:

- `adws/core/costCsvWriter.ts` — Contains `updateProjectCostCsv()` (the buggy function), `writeIssueCostCsv()`, `parseProjectCostCsv()`, `formatProjectCostCsv()`, `getProjectCsvPath()`, and `getIssueCsvPath()`. This is the primary file to modify.
- `adws/phases/workflowLifecycle.ts` — Calls `updateProjectCostCsv()` at line 373 inside `completeWorkflow()`. Must be updated to call the new `rebuildProjectCostCsv()`.
- `adws/phases/prReviewPhase.ts` — Calls `updateProjectCostCsv()` at line 318 inside `completePRReviewWorkflow()`. Must be updated to call the new `rebuildProjectCostCsv()`.
- `adws/core/index.ts` — Barrel exports for core module. Must export the new function and remove the old export.
- `adws/__tests__/costCsvWriter.test.ts` — Unit tests for `costCsvWriter.ts`. Must add tests for the new function and update/remove tests for the old function.
- `adws/__tests__/workflowPhases.test.ts` — Tests for `completeWorkflow()`. Must update mocks and assertions to use the new function.
- `adws/__tests__/prReviewCostTracking.test.ts` — Tests for `completePRReviewWorkflow()`. Must update mocks and assertions to use the new function.
- `adws/core/utils.ts` — Contains `slugify()`. Read-only reference to understand how issue CSV filenames are generated.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow strictly.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Add `parseIssueCostTotal()` helper to `costCsvWriter.ts`
- Add a new exported function `parseIssueCostTotal(csvContent: string): number` that parses an issue CSV file's content and extracts the `Total Cost (USD)` value
- Find the line starting with `Total Cost (USD):,` and parse the number after the comma
- Return `0` if the line is not found or the value cannot be parsed

### 2. Add `rebuildProjectCostCsv()` function to `costCsvWriter.ts`
- Add a new exported function `rebuildProjectCostCsv(repoRoot: string, repoName: string, eurRate: number): void`
- Compute the project directory path: `path.join(repoRoot, 'projects', repoName)`
- List all `.csv` files in the project directory using `fs.readdirSync()`
- Filter out `total-cost.csv` from the list
- For each remaining CSV file:
  - Extract the issue number from the filename: parse the digits before the first `-` character (e.g., `6` from `6-set-up-adw-environment.csv`). Skip files where the prefix is not a valid number (e.g., files that don't follow the `{number}-{slug}.csv` pattern)
  - Extract the issue description: take the part after the first `-` and before `.csv`, replace all `-` with spaces (e.g., `set up adw environment`)
  - Read the file content and call `parseIssueCostTotal()` to get the cost
  - Create a `ProjectCostRow` with the extracted data and `markupUsd: costUsd * 0.1`
- Sort the rows by `issueNumber` ascending for consistent output
- Write the file using `formatProjectCostCsv(rows, eurRate)` to the `total-cost.csv` path
- Log a success message

### 3. Remove `updateProjectCostCsv()` from `costCsvWriter.ts`
- Delete the entire `updateProjectCostCsv()` function (lines 121-150)
- It is no longer needed since `rebuildProjectCostCsv()` replaces its functionality

### 4. Update barrel exports in `core/index.ts`
- Replace the export of `updateProjectCostCsv` with `rebuildProjectCostCsv` and `parseIssueCostTotal`
- Remove `updateProjectCostCsv` from the export list

### 5. Update caller in `workflowLifecycle.ts`
- Update the import to use `rebuildProjectCostCsv` instead of `updateProjectCostCsv`
- Replace line 373: `updateProjectCostCsv(adwRepoRoot, repoName, config.issueNumber, config.issue.title, costBreakdown.totalCostUsd, eurRate)` with `rebuildProjectCostCsv(adwRepoRoot, repoName, eurRate)`

### 6. Update caller in `prReviewPhase.ts`
- Update the import to use `rebuildProjectCostCsv` instead of `updateProjectCostCsv`
- Replace line 318: `updateProjectCostCsv(adwRepoRoot, repoName, config.issueNumber, config.prDetails.title, costBreakdown.totalCostUsd, eurRate)` with `rebuildProjectCostCsv(adwRepoRoot, repoName, eurRate)`

### 7. Update unit tests in `costCsvWriter.test.ts`
- Add tests for `parseIssueCostTotal()`:
  - Parses valid issue CSV content and returns the correct total
  - Returns `0` for content without a `Total Cost (USD)` line
  - Returns `0` for empty content
- Add tests for `rebuildProjectCostCsv()`:
  - Rebuilds correctly from multiple issue CSV files, producing one row per file with correct totals
  - Handles the case where the project directory does not exist (should create it and produce an empty CSV or handle gracefully)
  - Skips `total-cost.csv` when scanning files
  - Skips files that don't follow the `{number}-{slug}.csv` naming pattern
  - Sorts rows by issue number ascending
  - Correctly handles re-running: write issue CSVs, rebuild, overwrite an issue CSV with new cost, rebuild again — verify the row reflects the latest cost with no duplicates
- Remove or update the existing `updateProjectCostCsv` tests:
  - Remove the three existing tests (`creates new CSV when none exists`, `appends to existing CSV and updates totals`, `handles multiple sequential updates correctly`) since the function is being deleted

### 8. Update test mocks in `workflowPhases.test.ts`
- Replace `updateProjectCostCsv: vi.fn()` with `rebuildProjectCostCsv: vi.fn()` in the mock setup
- Update the import to use `rebuildProjectCostCsv` instead of `updateProjectCostCsv`
- Update assertions that check `updateProjectCostCsv` was called: change to verify `rebuildProjectCostCsv` is called with `(adwRepoRoot, repoName, eurRate)` — note the simplified signature (no issueNumber, issueTitle, or costUsd params)

### 9. Update test mocks in `prReviewCostTracking.test.ts`
- Replace `updateProjectCostCsv: vi.fn()` with `rebuildProjectCostCsv: vi.fn()` in the mock setup
- Update the import to use `rebuildProjectCostCsv` instead of `updateProjectCostCsv`
- Update assertions that check `updateProjectCostCsv` was called: change to verify `rebuildProjectCostCsv` is called with `(adwRepoRoot, repoName, eurRate)`
- Update negative assertions (where `updateProjectCostCsv` should not have been called) to check `rebuildProjectCostCsv` instead

### 10. Run validation commands
- Execute all validation commands listed below to confirm the fix works with zero regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `npm test` — Run all unit tests to validate the new `rebuildProjectCostCsv()` function works correctly and all existing tests pass
- `npm run lint` — Run linter to check for code quality issues
- `npx tsc --noEmit` — Type check the Next.js project
- `npx tsc --noEmit -p adws/tsconfig.json` — Type check the ADW scripts project
- `npm run build` — Build the application to verify no build errors

## Notes
- The `guidelines/coding_guidelines.md` must be strictly followed: pure functions, immutability, strict TypeScript, functional programming patterns (map/filter/reduce over for loops).
- The issue description derived from the filename is lossy (lowercase, truncated at 50 chars by `slugify()`), but this is acceptable since the description is only used for display in the total-cost CSV.
- Files prefixed with `0-` (e.g., `0-bug-52-issue-classifier-running-on-incorrect-repo.csv`) should be handled correctly — the issue number `0` is valid.
- The `eurRate` is still needed by the callers and passed through to `rebuildProjectCostCsv()`. The rate comes from the exchange rate API at workflow completion time.
- No new libraries are needed for this fix.
