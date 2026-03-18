# Bug: Fix issue number resolution in PR review workflow and serialise cost CSVs

## Metadata
issueNumber: `233`
adwId: `y000tl-fix-issue-number-res`
issueJson: `{"number":233,"title":"Fix issue number resolution in PR review workflow and serialise cost CSVs","body":"## Problem\n\nWhen the PR review workflow completes, it attempts to move the associated issue on the project board. However, the issue number defaults to `0` when it cannot be extracted from the PR body (`Implements #N` pattern), causing a GitHub API error:\n\n```\ngh: Could not resolve to an Issue with the number of 0.\n```\n\nThis happens because:\n1. `fetchPRDetails()` returns `issueNumber: null` when the PR body has no `Implements #N` link\n2. `initializePRReviewWorkflow()` converts `null` → `0` via `prDetails.issueNumber || 0`\n3. `completePRReviewWorkflow()` passes `0` to `moveToStatus()` and `writeIssueCostCsv()`\n4. The project board GraphQL query fails for issue `#0`\n\nAdditionally, PR review cost CSV files are written with issue number `0` (e.g., `0-chore-30-update-adw-settings.csv`), making them hard to associate with the original issue.\n\n## Required Changes\n\n### 1. Branch-name fallback for issue number extraction\n### 2. Make issue number nullable in PR review config\n### 3. Guard downstream consumers\n### 4. Serialised cost CSV naming for PR reviews","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-18T13:18:36Z","comments":[],"actionableComment":null}`

## Bug Description
When the PR review workflow completes, it calls `moveToStatus()` and `writeIssueCostCsv()` with issue number `0`, because:
- `fetchPRDetails()` only extracts issue numbers from the PR body (`Implements #N` pattern) — it has no branch-name fallback
- `initializePRReviewWorkflow()` converts `null` → `0` via `prDetails.issueNumber || 0`
- `completePRReviewWorkflow()` unconditionally passes `0` to `moveToStatus()` and `writeIssueCostCsv()`

This causes a GitHub API error (`gh: Could not resolve to an Issue with the number of 0`) and produces cost CSV files prefixed with `0-` that cannot be associated with the original issue.

**Expected:** Issue number is resolved from the branch name when the PR body has no `Implements #N` link; operations requiring a valid issue number are skipped when it remains `null`; PR review cost CSVs use serialised names (e.g., `30-update-adw-settings-1.csv`).

**Actual:** Issue number defaults to `0`, project board API fails, cost CSVs are misnamed.

## Problem Statement
Four connected problems must be fixed:
1. `fetchPRDetails()` has no branch-name fallback for issue number extraction
2. `PRReviewWorkflowConfig.issueNumber` is typed `number` and defaults to `0` instead of being nullable
3. `completePRReviewWorkflow()` calls `moveToStatus()` and `writeIssueCostCsv()` unconditionally
4. PR review cost CSV files overwrite the original issue CSV instead of using a serial suffix

## Solution Statement
1. Extend `extractIssueNumberFromBranch()` to also match the ADW branch format (`{type}-{issueNumber}-{adwId}-{slug}`) and use it as a fallback in `fetchPRDetails()`
2. Change `PRReviewWorkflowConfig.issueNumber` to `number | null` and remove the `|| 0` fallback
3. Guard `moveToStatus()` and `writeIssueCostCsv()` calls with `if (config.issueNumber)`
4. Add a `getNextSerialCsvPath()` function and use it when writing cost from `completePRReviewWorkflow()`

## Steps to Reproduce
1. Create a PR without an `Implements #N` link in the body (or with a body that uses a different pattern)
2. Add a review comment requesting changes on the PR
3. Trigger the PR review workflow via `adwPrReview.tsx` or the cron trigger
4. Observe: `moveToStatus()` fails with `gh: Could not resolve to an Issue with the number of 0`
5. Observe: cost CSV is written as `0-<slug>.csv` instead of `{issueNumber}-<slug>-{serial}.csv`

## Root Cause Analysis
The issue number resolution chain has two gaps:

1. **`fetchPRDetails()`** (`adws/github/prApi.ts:67-68`): Only tries `Implements #(\d+)` regex on the PR body. When no match is found, returns `issueNumber: null`. The branch name (`headRefName`) is available in the raw PR details but is not used as a fallback.

2. **`extractIssueNumberFromBranch()`** (`adws/triggers/webhookHandlers.ts:54-60`): Only matches the `issue-(\d+)` pattern (e.g., `feature/issue-42-slug`). Does NOT match the ADW branch format `{type}-{issueNumber}-{adwId}-{slug}` (e.g., `bugfix-233-y000tl-fix-issue`). This function is already used as a fallback in `handlePullRequestEvent()` but NOT in `fetchPRDetails()`.

3. **`initializePRReviewWorkflow()`** (`adws/phases/prReviewPhase.ts:71`): Converts `null` to `0` via `prDetails.issueNumber || 0`, making downstream code unable to distinguish "no issue" from "issue #0".

4. **`completePRReviewWorkflow()`** (`adws/phases/prReviewCompletion.ts:119,136`): Passes `config.issueNumber` (which is `0`) to `writeIssueCostCsv()` and `moveToStatus()` without checking for validity.

Evidence of the problem: the `projects/AI_Dev_Workflow/` directory contains 13 CSV files prefixed with `0-` (e.g., `0-bug-52-issue-classifier-running-on-incorrect-repo.csv`) — all from PR reviews where issue number extraction failed.

## Relevant Files
Use these files to fix the bug:

- `adws/triggers/webhookHandlers.ts` — Contains `extractIssueNumberFromBranch()` (line 54) which needs to be updated to match the ADW branch format. Also contains the existing fallback chain in `handlePullRequestEvent()` (line 108) which already works correctly — no changes needed there.
- `adws/github/prApi.ts` — Contains `fetchPRDetails()` (line 56) which needs a branch-name fallback for issue number extraction when the PR body regex fails.
- `adws/phases/prReviewPhase.ts` — Contains `PRReviewWorkflowConfig` interface (line 24) and `initializePRReviewWorkflow()` (line 45) where `issueNumber` type must change from `number` to `number | null` and the `|| 0` fallback on line 71 must be removed.
- `adws/phases/prReviewCompletion.ts` — Contains `completePRReviewWorkflow()` (line 105) where `moveToStatus()` and `writeIssueCostCsv()` calls must be guarded with `if (config.issueNumber)`.
- `adws/core/costCsvWriter.ts` — Contains `writeIssueCostCsv()` (line 112) and `getIssueCsvPath()` (line 20). A new `getNextSerialCsvPath()` function will be added here.
- `adws/types/workflowTypes.ts` — Contains `PRDetails` interface (line 62) where `issueNumber` is already `number | null` — confirms the type is correct at the source.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow.
- `app_docs/feature-trigger-should-commi-f8jwcf-commit-push-cost-csv.md` — Context on cost CSV tracking and commit/push logic.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Update `extractIssueNumberFromBranch()` to match ADW branch format
- In `adws/triggers/webhookHandlers.ts`, update the regex in `extractIssueNumberFromBranch()` (line 58)
- Current regex: `/issue-(\d+)/` — only matches `feature/issue-42-slug` style
- Add a second regex for the ADW branch format: `/^(?:feat|feature|bug|bugfix|chore|fix|hotfix)-(\d+)-/`
- Try the existing `issue-(\d+)` pattern first (backward compatibility), then fall back to the ADW format
- Return `null` if neither pattern matches

### Step 2: Add branch-name fallback in `fetchPRDetails()`
- In `adws/github/prApi.ts`, import `extractIssueNumberFromBranch` from `../triggers/webhookHandlers`
- After the existing PR body regex (line 67-68), if `issueNumber` is `null`, try `extractIssueNumberFromBranch(raw.headRefName)` as a fallback
- This ensures `PRDetails.issueNumber` is populated whenever the branch name encodes it

### Step 3: Make `PRReviewWorkflowConfig.issueNumber` nullable
- In `adws/phases/prReviewPhase.ts`, change the `PRReviewWorkflowConfig` interface (line 26): `issueNumber: number` → `issueNumber: number | null`
- On line 71, change `const issueNumber = prDetails.issueNumber || 0;` to `const issueNumber = prDetails.issueNumber;`
- Verify that `issueNumber` is used as `number | null` throughout the rest of `initializePRReviewWorkflow()` — the `ctx.issueNumber`, `initialState.issueNumber`, and the returned config should all accept `null`

### Step 4: Guard downstream consumers in `completePRReviewWorkflow()`
- In `adws/phases/prReviewCompletion.ts`, wrap the `moveToStatus()` call (line 136) with `if (config.issueNumber)`:
  ```typescript
  if (config.issueNumber) {
    await repoContext.issueTracker.moveToStatus(config.issueNumber, BoardStatus.Review);
  }
  ```
- Wrap the `writeIssueCostCsv()` call (line 119) with `if (config.issueNumber)` — but replace it with the serialised cost CSV logic (Step 5)

### Step 5: Add serialised cost CSV naming for PR reviews
- In `adws/core/costCsvWriter.ts`, add a new exported function `getNextSerialCsvPath()`:
  ```typescript
  export function getNextSerialCsvPath(repoRoot: string, repoName: string, issueNumber: number, issueTitle: string): string
  ```
  - Get the base CSV path using `getIssueCsvPath(repoName, issueNumber, issueTitle)` (e.g., `projects/repo/30-update-adw-settings.csv`)
  - Strip the `.csv` extension to get the base name
  - Scan the project directory for files matching `{base}-{N}.csv` where N is a number
  - Find the highest existing serial number and return the path with `{base}-{N+1}.csv`
  - If no serialised files exist, return `{base}-1.csv`
- In `adws/phases/prReviewCompletion.ts`, update the cost CSV writing block inside `completePRReviewWorkflow()`:
  - Guard with `if (config.issueNumber)`
  - Use `getNextSerialCsvPath()` to determine the file path
  - Write the cost CSV to the serialised path using `fs.writeFileSync()` with `formatIssueCostCsv()`
  - Import `getNextSerialCsvPath` and `formatIssueCostCsv` from `../core`
- Verify that `rebuildProjectCostCsv()` correctly parses serialised filenames — the existing parser (line 143-146 of `costCsvWriter.ts`) uses `filename.indexOf('-')` to split at the first dash, extracting the issue number prefix. Since serialised files still start with `{issueNumber}-`, the parser handles them naturally. No changes needed.

### Step 6: Verify type compatibility across the codebase
- Check that `PRReviewWorkflowConfig.issueNumber: number | null` does not break any call sites:
  - `executePRReviewPlanPhase()` uses `if (issueNumber)` on line 147 — already handles `null` correctly
  - `executePRReviewBuildPhase()` uses `issueNumber` only in `AgentStateManager.writeState()` metadata — accepts `null`
  - `executePRReviewTestPhase()` does not use `issueNumber` — no changes needed
  - `ctx.issueNumber` in `PRReviewWorkflowContext` — check this type accepts `null`
- In `adws/github/index.ts`, check what `PRReviewWorkflowContext` expects for `issueNumber` and update if needed

### Step 7: Run validation commands
- Run the validation commands listed below to confirm the fix is correct and introduces no regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors
- `bunx tsc --noEmit` — Type check the main project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check the adws sub-project
- `bunx cucumber-js --tags "@regression"` — Run regression BDD scenarios

## Notes
- The `guidelines/coding_guidelines.md` must be followed: prefer pure functions, use type narrowing over `!` assertions, keep files under 300 lines, and use strict null checks.
- The `extractIssueNumberFromBranch()` function is shared between `webhookHandlers.ts` and now `prApi.ts` — ensure the import does not create a circular dependency. `prApi.ts` is in `github/` and `webhookHandlers.ts` is in `triggers/` — no circular dependency risk.
- The serialised cost CSV approach is backward-compatible: `rebuildProjectCostCsv()` already splits on the first `-` to extract the issue number, so `30-update-adw-settings-1.csv` correctly yields issue number `30`.
- No new libraries required.
