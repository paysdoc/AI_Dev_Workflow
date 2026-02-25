# Bug: Cost CSV files written to root worktree instead of issue worktree for ADW repo changes

## Metadata
issueNumber: `16`
adwId: `changes-to-adw-repo-duqcev`
issueJson: `{"number":16,"title":"Changes to ADW repo should have cost in worktree","body":"In issue 8 you extracted the costs and saved them in csv files. \nHowever, these seem to have been added in the root worktree instead ot the issue worktree, resulting in them not being committed.\n\nIn general, this is fine, since the issue is running in at different repository and the cost info needs to remain in the adw repository.\nHowever, whenever a change is required in the ADW repository - such as is the case whith this issue - the cost breakdown has to be maintained in the same worktree.\nThis is ONLY the case for changes in the ADW repo itself. All changes in other repos should have cost reporting exactly as is already implemented","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-02-25T10:30:18Z","comments":[],"actionableComment":null}`

## Bug Description
When ADW processes an issue that targets the ADW repository itself, the cost CSV files (`projects/<repo_name>/<issue-nr>-<slug>.csv` and `projects/<repo_name>/total-cost.csv`) are written to the main repository root (`process.cwd()`) instead of the issue's worktree directory. Since the worktree has its own working tree, files written to the main repo root are invisible to the worktree's git status and are never committed as part of the issue's PR.

**Expected behavior:** When processing ADW repo issues, cost CSV files should be written to `config.worktreePath` so they appear in the worktree's git status and can be committed with the PR.

**Actual behavior:** Cost CSV files are always written to `process.cwd()` (the main repo root), regardless of whether the issue targets the ADW repo or an external repo. For ADW repo issues, this means the files are not in the worktree and are not committed.

## Problem Statement
The `completeWorkflow()` function in `adws/phases/workflowLifecycle.ts` unconditionally uses `process.cwd()` as the root directory for writing cost CSV files. This is correct when processing external repo issues (the cost data belongs in the ADW repo root), but incorrect when processing ADW repo issues (the cost data should be in the worktree where changes are committed).

## Solution Statement
Modify the cost CSV writing logic in `completeWorkflow()` to detect whether the workflow is operating on the ADW repo itself or an external repo:
- **ADW repo issues** (`config.targetRepo` is `undefined`): Write cost CSV files to `config.worktreePath` so they are committed with the PR.
- **External repo issues** (`config.targetRepo` is defined): Continue writing cost CSV files to `process.cwd()` (the ADW repo root) — existing behavior, unchanged.

The detection is straightforward: `config.targetRepo` is only set when the issue comes from an external repository. When it is `undefined`, the workflow is operating on the ADW repo itself.

## Steps to Reproduce
1. Create a GitHub issue on the ADW repository (e.g., issue #16)
2. Run an ADW workflow for the issue: `npx tsx adws/adwPlanBuild.tsx 16`
3. ADW creates a worktree at `.worktrees/<branch-name>/`
4. On workflow completion, `completeWorkflow()` writes CSV files to `process.cwd()/projects/<repo>/...`
5. Check git status in the worktree — the CSV files are NOT there
6. The CSV files exist in the main repo root but are not part of the worktree's branch

## Root Cause Analysis
In `adws/phases/workflowLifecycle.ts`, line 246, inside `completeWorkflow()`:

```typescript
const adwRepoRoot = process.cwd();
```

This hardcodes the CSV output directory to the main process working directory. When ADW is processing its own issues through a worktree, changes need to be in the worktree path (`config.worktreePath`) to be included in the branch's commits. The `process.cwd()` path points to the main repo root, which is a different working tree than the issue's worktree.

The issue was introduced in the original cost CSV implementation (issue #8), where the spec explicitly noted: "The `repoRoot` for CSV paths is `process.cwd()` (the ADW repo root), not the worktree path." This assumption is correct for external repos but incorrect for self-referencing ADW repo issues.

## Relevant Files
Use these files to fix the bug:

- `adws/phases/workflowLifecycle.ts` — Contains `completeWorkflow()` where the cost CSV writing is triggered. **This is the file that needs to be modified.** Line 246 uses `process.cwd()` which should conditionally use `config.worktreePath` for ADW repo issues.
- `adws/core/costCsvWriter.ts` — Contains `writeIssueCostCsv()` and `updateProjectCostCsv()` that accept `repoRoot` as a parameter. These functions are correct and do not need modification — they already write to whatever root path is provided.
- `adws/core/costTypes.ts` — Defines `CostBreakdown`, `ModelUsageMap` types used in cost reporting. No changes needed.
- `adws/core/costReport.ts` — Contains `buildCostBreakdown()` and related functions. No changes needed.
- `adws/__tests__/workflowPhases.test.ts` — Contains existing tests for `completeWorkflow()`. New tests must be added to verify the worktree path logic for both ADW repo and external repo scenarios.
- `adws/__tests__/costCsvWriter.test.ts` — Existing cost CSV writer tests. No changes needed (the writer functions themselves are correct).
- `adws/README.md` — Read for general understanding of workflow architecture.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Modify `completeWorkflow()` in `adws/phases/workflowLifecycle.ts` to use worktree path for ADW repo issues
- In the `completeWorkflow()` function, locate the cost CSV writing block (lines 244-254)
- Replace the hardcoded `const adwRepoRoot = process.cwd();` with conditional logic:
  - If `config.targetRepo` is defined (external repo): use `process.cwd()` — unchanged behavior
  - If `config.targetRepo` is `undefined` (ADW repo): use `config.worktreePath`
- The change should be minimal — only the `adwRepoRoot` variable assignment changes:
  ```typescript
  const adwRepoRoot = config.targetRepo ? process.cwd() : config.worktreePath;
  ```
- All other code in the cost CSV writing block remains exactly the same

### Step 2: Add unit tests to `adws/__tests__/workflowPhases.test.ts` for cost CSV worktree path logic
- The existing `completeWorkflow` tests do not exercise the cost CSV writing path (they pass no `modelUsage` argument)
- Add the following test cases inside the existing `describe('completeWorkflow', ...)` block:
  - **Test: writes cost CSVs to worktree path when no targetRepo (ADW repo issue)**
    - Create a config with `worktreePath: '/mock/worktree'` and no `targetRepo`
    - Call `completeWorkflow(config, 1.5, undefined, mockModelUsage)` with a non-empty `modelUsage`
    - Assert that `writeIssueCostCsv` is called with `repoRoot` = `'/mock/worktree'`
    - Assert that `updateProjectCostCsv` is called with `repoRoot` = `'/mock/worktree'`
  - **Test: writes cost CSVs to process.cwd() when targetRepo is set (external repo)**
    - Create a config with `targetRepo: { owner: 'other', repo: 'app', cloneUrl: '...' }` and `worktreePath: '/mock/external-worktree'`
    - Call `completeWorkflow(config, 2.0, undefined, mockModelUsage)` with a non-empty `modelUsage`
    - Assert that `writeIssueCostCsv` is called with `repoRoot` = `process.cwd()` (not the worktree path)
    - Assert that `updateProjectCostCsv` is called with `repoRoot` = `process.cwd()`
- Ensure `writeIssueCostCsv` and `updateProjectCostCsv` are properly mocked in the test file's mock setup (they should already be mocked as part of the `../core` mock since they are imported via the core barrel export)
- Ensure `buildCostBreakdown` is mocked to return a valid `CostBreakdown` object with currencies including EUR so the EUR rate computation is exercised

### Step 3: Run validation commands
- Run `npm run lint` to check for code quality issues
- Run `npm run build` to verify no build errors
- Run `npm test` to validate the bug is fixed with zero regressions

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `npm run lint` - Run linter to check for code quality issues
- `npm run build` - Build the application to verify no build errors
- `npm test` - Run tests to validate the bug is fixed with zero regressions

## Notes
- The fix is a single line change in `workflowLifecycle.ts` plus corresponding unit tests. This is intentionally minimal to avoid introducing side effects.
- The `costCsvWriter.ts` functions (`writeIssueCostCsv`, `updateProjectCostCsv`) are already correct — they write to whatever `repoRoot` path is provided. The bug is entirely in the caller (`completeWorkflow`) passing the wrong root path.
- When `config.targetRepo` is `undefined`, the workflow is processing an issue from the ADW repo's own GitHub repository. In this case, all work (including cost CSV files) should be in the worktree so it can be committed and included in the PR.
- When `config.targetRepo` is defined, the workflow is processing an issue from an external repository. Cost CSVs belong in the ADW repo root (`process.cwd()`), not in the external repo's worktree. This is the existing correct behavior.
- No new dependencies are needed.
