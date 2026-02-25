# Feature: Move Cost Breakdown into CSV Files

## Metadata
issueNumber: `8`
adwId: `move-cost-breakdown-9ntv1f`
issueJson: `{"number":8,"title":"Move cost breakdown into CSV file","body":"The image below shows a typical cost breakdown as produced after the adw has completed a task.\n\n<img width=\"889\" height=\"275\" alt=\"Image\" src=\"https://github.com/user-attachments/assets/f18ee1a2-31b3-4e9e-a531-dd849a7bee2d\" />\n\n## Issue cost CSV\nInstead of writing that into the issue itself, create a csv file in the AI_dev_Workflow repo with the following path:\n**<repo-root>/projects/<repo_name>/<issue-nr>-<issue-heading-slug>.csv**\nThe headers are:\nModel. Input Tokens, Output Tokens, Cache Read, Cache Write, Cost (USD) \n\nAdd the following lines at the bottom: \n**Total Cost (USD):**\n**Total Cost (EUR):**\n\n## Total project Cost\nAn additional CSV, tallying the running and total costs for the project / repo should contain:\n**Issue number, Issue description, Cost (USD), Markup (10%)**\n\nAdd the following totals:\n**Total Cost (USD):** Running total of <**Cost (USD) + Markup (10%)**>\n**Total Cost (EUR):** conversion of Total Cost (USD)\n\nThe total project Cost is a mutable file. Each time that a new issue is completed, a new line is added and the totals are updated.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-02-25T07:29:55Z","comments":[],"actionableComment":null}`

## Feature Description
When an ADW workflow completes, the cost breakdown (model usage, token counts, costs) is currently embedded in the GitHub issue completion comment. This feature moves that data into two persistent CSV files stored in the ADW repository:

1. **Issue Cost CSV** (`projects/<repo_name>/<issue-nr>-<issue-heading-slug>.csv`): A per-issue cost report with per-model token usage rows and USD/EUR totals at the bottom.
2. **Total Project Cost CSV** (`projects/<repo_name>/total-cost.csv`): A running ledger of all issue costs with 10% markup, updated each time an issue workflow completes.

This provides a structured, machine-readable cost tracking system that accumulates over time and enables project-level cost analysis.

## User Story
As a project manager using ADW
I want cost breakdowns written to CSV files in the repository
So that I can track and analyze costs per issue and per project over time using spreadsheets or other tools

## Problem Statement
Cost data is currently only available in GitHub issue comments as markdown tables. This makes it difficult to aggregate costs across issues, compute running totals, or import cost data into external tools for analysis. Each workflow run's cost data is scattered across different issue threads.

## Solution Statement
Create a new `costCsvWriter.ts` module in `adws/core/` that:
- Generates per-issue CSV files from the existing `CostBreakdown` data structure
- Maintains a running total project cost CSV that is appended with each completed workflow
- Fetches EUR exchange rate (reusing existing `fetchExchangeRates`) for the total lines
- Is called from `completeWorkflow()` in the workflow lifecycle after the cost breakdown is built
- The CSV files are committed to the repo in the `projects/` directory so they persist across runs

## Relevant Files
Use these files to implement the feature:

- `adws/core/costReport.ts` - Contains `formatCostBreakdownMarkdown()`, `buildCostBreakdown()`, `fetchExchangeRates()`, and `computeTotalCostUsd()`. The new CSV writer will follow similar patterns and reuse `fetchExchangeRates()`.
- `adws/core/costTypes.ts` - Defines `ModelUsageMap`, `CostBreakdown`, `ModelUsage`, `CurrencyAmount`. The CSV writer will consume these types.
- `adws/core/costPricing.ts` - Model pricing definitions, not modified but relevant for understanding cost calculation.
- `adws/core/index.ts` - Core barrel export file. Must export the new CSV functions.
- `adws/core/utils.ts` - Contains `slugify()` function which will be used to generate issue heading slugs for CSV filenames.
- `adws/phases/workflowLifecycle.ts` - Contains `completeWorkflow()` where the CSV writing will be triggered. Also `WorkflowConfig` which carries `issue`, `repoInfo`, and `targetRepo` needed for the CSV path.
- `adws/github/githubApi.ts` - Contains `getRepoInfo()` to extract owner/repo from git remote. Used to determine the `<repo_name>` for CSV paths.
- `adws/__tests__/costReport.test.ts` - Existing cost report tests, used as a pattern reference.
- `.gitignore` - Must NOT ignore the `projects/` directory (currently it is not ignored, but this should be verified).

### New Files
- `adws/core/costCsvWriter.ts` - New module containing CSV generation and writing functions.
- `adws/__tests__/costCsvWriter.test.ts` - Unit tests for the new CSV writer module.

## Implementation Plan
### Phase 1: Foundation
Create the `costCsvWriter.ts` module with pure functions for generating CSV content strings from `CostBreakdown` data. This includes:
- `formatIssueCostCsv(breakdown: CostBreakdown): string` - Generates CSV content for a single issue
- `formatProjectCostRow(issueNumber: number, issueDescription: string, costUsd: number): string` - Generates a single row for the project cost CSV
- `buildProjectCostCsv(rows: ProjectCostRow[], eurRate: number): string` - Generates the full project cost CSV content
- `getIssueCsvPath(repoName: string, issueNumber: number, issueTitle: string): string` - Computes the file path for an issue CSV
- `getProjectCsvPath(repoName: string): string` - Computes the file path for the project total CSV

### Phase 2: Core Implementation
Add file I/O functions for writing the CSV files:
- `writeIssueCostCsv(repoRoot: string, repoName: string, issueNumber: number, issueTitle: string, breakdown: CostBreakdown): Promise<void>` - Writes the per-issue CSV
- `updateProjectCostCsv(repoRoot: string, repoName: string, issueNumber: number, issueTitle: string, costUsd: number): Promise<void>` - Reads existing project CSV (if any), appends new row, recalculates totals, writes back
- Parse existing project CSV to extract data rows (excluding header and total lines)

### Phase 3: Integration
Wire the CSV writing into the workflow lifecycle:
- Call `writeIssueCostCsv()` and `updateProjectCostCsv()` from `completeWorkflow()` in `workflowLifecycle.ts`
- Determine `repoName` from `config.repoInfo` or `config.targetRepo` or fallback to `getRepoInfo()`
- Determine `repoRoot` as `process.cwd()` (the ADW repo root, not the worktree)
- Ensure `projects/<repo_name>/` directory is created if it doesn't exist

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Create `adws/core/costCsvWriter.ts` with CSV formatting functions
- Create the new module file
- Implement `getIssueCsvPath(repoName: string, issueNumber: number, issueTitle: string): string`
  - Uses `slugify()` from `utils.ts` to create the issue heading slug
  - Returns `projects/<repoName>/<issueNumber>-<slug>.csv`
- Implement `getProjectCsvPath(repoName: string): string`
  - Returns `projects/<repoName>/total-cost.csv`
- Implement `formatIssueCostCsv(breakdown: CostBreakdown): string`
  - First line: CSV header `Model,Input Tokens,Output Tokens,Cache Read,Cache Write,Cost (USD)`
  - One row per model in `breakdown.modelUsage`
  - Empty line separator
  - `Total Cost (USD):,<total>` line
  - `Total Cost (EUR):,<eurTotal>` line (using the EUR amount from `breakdown.currencies` if available, otherwise `N/A`)
- Implement `parseProjectCostCsv(csvContent: string): ProjectCostRow[]`
  - Interface `ProjectCostRow { issueNumber: number; issueDescription: string; costUsd: number; markupUsd: number; }`
  - Parses existing project CSV content, extracting data rows (skipping header and total summary lines)
  - Returns array of `ProjectCostRow`
- Implement `formatProjectCostCsv(rows: ProjectCostRow[], eurRate: number): string`
  - Header: `Issue number,Issue description,Cost (USD),Markup (10%)`
  - One row per `ProjectCostRow`
  - Empty line separator
  - `Total Cost (USD):,<sum of (costUsd + markupUsd) for all rows>`
  - `Total Cost (EUR):,<total USD converted to EUR>`
- Import types from `costTypes.ts` and `slugify` from `utils.ts`

### Step 2: Add file I/O functions to `costCsvWriter.ts`
- Implement `writeIssueCostCsv(repoRoot: string, repoName: string, issueNumber: number, issueTitle: string, breakdown: CostBreakdown): void`
  - Compute path using `getIssueCsvPath`
  - Create directory `projects/<repoName>/` if it doesn't exist (`fs.mkdirSync` with `recursive: true`)
  - Write CSV content using `fs.writeFileSync`
  - Log the file path using `log()` from `utils.ts`
- Implement `updateProjectCostCsv(repoRoot: string, repoName: string, issueNumber: number, issueTitle: string, costUsd: number, eurRate: number): void`
  - Compute path using `getProjectCsvPath`
  - Read existing CSV if file exists, parse with `parseProjectCostCsv`
  - Append new row: `{ issueNumber, issueDescription: issueTitle, costUsd, markupUsd: costUsd * 0.1 }`
  - Regenerate full CSV with `formatProjectCostCsv` using all rows plus new one
  - Write using `fs.writeFileSync`
  - Log the file path
- Export all public functions

### Step 3: Export new functions from `adws/core/index.ts`
- Add exports for `writeIssueCostCsv`, `updateProjectCostCsv`, `getIssueCsvPath`, `getProjectCsvPath`, `formatIssueCostCsv`, `formatProjectCostCsv`, `parseProjectCostCsv` from `./costCsvWriter`
- Export the `ProjectCostRow` type

### Step 4: Integrate CSV writing into `completeWorkflow()` in `adws/phases/workflowLifecycle.ts`
- Import `writeIssueCostCsv`, `updateProjectCostCsv` from `../core`
- Import `getRepoInfo` from `../github`
- In `completeWorkflow()`, after the cost breakdown is built (inside the `if (modelUsage ...)` block):
  - Determine repo name: use `config.repoInfo?.repo` or `config.targetRepo?.repo` or call `getRepoInfo().repo` as fallback
  - Determine repo root: use the main repo root, which is `process.cwd()` (not the worktree path)
  - Extract EUR rate from `costBreakdown.currencies` (find the EUR entry)
  - Call `writeIssueCostCsv(repoRoot, repoName, config.issueNumber, config.issue.title, costBreakdown)`
  - Call `updateProjectCostCsv(repoRoot, repoName, config.issueNumber, config.issue.title, costBreakdown.totalCostUsd, eurRate)`
  - Wrap in try/catch so CSV writing failures don't crash the workflow — log error and continue

### Step 5: Create unit tests in `adws/__tests__/costCsvWriter.test.ts`
- Test `getIssueCsvPath` returns correct path with slugified title
- Test `getProjectCsvPath` returns correct path
- Test `formatIssueCostCsv` produces correct CSV with:
  - Correct headers
  - Per-model rows with correct token counts
  - Total Cost (USD) and Total Cost (EUR) lines at bottom
  - Edge case: empty model usage
  - Edge case: no EUR currency in breakdown
- Test `parseProjectCostCsv`:
  - Parses valid CSV content
  - Returns empty array for empty/header-only content
  - Skips total summary lines
- Test `formatProjectCostCsv`:
  - Correct headers
  - Correct data rows with 10% markup
  - Correct total lines with EUR conversion
  - Edge case: empty rows
- Test `writeIssueCostCsv`:
  - Creates directory and writes file (using temp directory)
  - File content matches expected CSV format
- Test `updateProjectCostCsv`:
  - Creates new CSV when none exists
  - Appends to existing CSV and updates totals
  - Handles multiple sequential updates correctly
- Mock `log` from `../core/utils` as in existing tests

### Step 6: Run validation commands
- Run `npm run lint` to check for code quality issues
- Run `npm run build` to verify no build errors
- Run `npm test` to validate the feature works with zero regressions

## Testing Strategy
### Unit Tests
- **`formatIssueCostCsv`**: Verify CSV output format with single model, multiple models, and empty usage
- **`formatProjectCostCsv`**: Verify header, data rows, markup calculation, and total lines
- **`parseProjectCostCsv`**: Verify round-trip: format then parse returns original data
- **`writeIssueCostCsv`**: Use `os.tmpdir()` to write actual files, verify content
- **`updateProjectCostCsv`**: Test append behavior with existing CSV, verify totals recalculated
- **`getIssueCsvPath` / `getProjectCsvPath`**: Verify path construction with various repo names and issue titles

### Edge Cases
- Issue title with special characters (non-ASCII, emoji, very long titles) — `slugify()` handles this
- Empty model usage map — should still produce valid CSV with just totals
- EUR exchange rate not available — should show `N/A` for EUR total
- First issue for a repo (no existing project CSV) — should create file from scratch
- Multiple issues added sequentially — each update should preserve previous rows
- Concurrent writes to project CSV — not addressed (ADW runs sequentially per issue)
- Very large cost values — verify formatting precision (4 decimal places like existing code)

## Acceptance Criteria
- When a workflow completes, a CSV file is created at `projects/<repo_name>/<issue-nr>-<slug>.csv` with per-model cost data and USD/EUR totals
- When a workflow completes, the `projects/<repo_name>/total-cost.csv` is created or updated with a new row for the issue and recalculated totals including 10% markup
- CSV files use the correct headers as specified in the issue
- EUR conversion uses the same exchange rate API as the existing cost report
- CSV writing failures do not crash the workflow (graceful error handling)
- All existing tests pass (zero regressions)
- New unit tests cover the CSV formatting, parsing, writing, and updating functions
- Lint and build pass cleanly

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `npm run lint` - Run linter to check for code quality issues
- `npm run build` - Build the application to verify no build errors
- `npm test` - Run tests to validate the feature works with zero regressions

## Notes
- The `projects/` directory is not in `.gitignore`, so CSV files will be tracked in git. This is intentional — the cost data should persist in the repository.
- The existing cost breakdown in GitHub issue comments is **not removed** — it continues to work as before. The CSV files are an additional output.
- The `slugify()` function from `adws/core/utils.ts` is reused for generating the issue heading slug in filenames, ensuring consistency.
- EUR rate is extracted from the already-fetched `CostBreakdown.currencies` array (which is built by `buildCostBreakdown`), avoiding a duplicate API call.
- The `repoRoot` for CSV paths is `process.cwd()` (the ADW repo root), not the worktree path. This ensures all CSV files end up in the main repo.
- Token counts in CSV use raw numbers (not formatted with commas) for machine readability, unlike the markdown table which uses locale formatting.
