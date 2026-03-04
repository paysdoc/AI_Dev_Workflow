# PR-Review: Commit only specific issue CSV and total-cost CSV instead of all CSVs

## PR-Review Description
The reviewer identified that when a PR is closed without merge, `commitAndPushCostFiles({ repoName })` is called in "project mode" which uses `addPath = "projects/${repoName}/*.csv"` (line 339 in `gitOperations.ts`). This wildcard stages **all** CSV files in the project directory, not just the reverted issue's CSV and the recalculated `total-cost.csv`. This could accidentally commit unrelated CSV changes from other issues.

The fix should ensure that only the specific issue's cost CSV (which was just deleted) and the recalculated `total-cost.csv` are staged and committed — matching the precise behavior of the merged PR path which uses "single issue mode".

## Summary of Original Implementation Plan
The original plan (`specs/issue-66-adw-automatically-ccommi-wdlirj-sdlc_planner-auto-commit-cost-on-pr.md`) implements automatic cost CSV committing/reverting based on PR lifecycle events. When merged, it rebuilds `total-cost.csv` and commits issue + total CSVs. When closed without merge, it reverts the issue CSV, rebuilds total, and commits. The plan defined three modes for `commitAndPushCostFiles`: single-issue, project-wide, and all-projects. The review found that the revert path incorrectly uses project-wide mode instead of targeting specific files.

## Relevant Files
Use these files to resolve the review:

- `adws/core/costCsvWriter.ts` — Contains `revertIssueCostFile()` which currently returns `boolean`. Needs to return deleted file paths so they can be staged precisely.
- `adws/github/gitOperations.ts` — Contains `commitAndPushCostFiles()` and `CommitCostFilesOptions`. Needs a new `paths` option for explicit file staging.
- `adws/triggers/webhookHandlers.ts` — Contains the PR close handler. The revert path (line 118) needs to pass explicit paths instead of using project mode.
- `adws/__tests__/webhookHandlers.test.ts` — Tests need updating for the new `commitAndPushCostFiles` call signature in the revert case.
- `adws/__tests__/revertIssueCostFile.test.ts` — Tests need updating since `revertIssueCostFile` will return `string[]` instead of `boolean`.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Modify `revertIssueCostFile` to return deleted file paths
- In `adws/core/costCsvWriter.ts`, change the return type of `revertIssueCostFile` from `boolean` to `string[]`
- Instead of returning `true`/`false`, return an array of relative paths (e.g., `projects/repoName/42-add-login.csv`) of deleted files
- Return an empty array `[]` when no files are found or directory doesn't exist (replaces `false`)
- The relative paths should match the format used by `getIssueCsvPath()` (i.e., `projects/<repoName>/<filename>`)

### Step 2: Add `paths` option to `CommitCostFilesOptions` in `gitOperations.ts`
- Add an optional `paths?: string[]` property to the `CommitCostFilesOptions` interface
- In `commitAndPushCostFiles()`, add a new branch before the existing modes that handles the `paths` case:
  - When `paths` is provided and non-empty, use those exact paths for `addPath` (join with spaces, each quoted)
  - Use the same paths for `statusPath`
  - Set an appropriate commit message (e.g., `cost: update cost data for ${repoName}`)
- This mode should be checked first, before the existing single-issue/project/all-projects modes

### Step 3: Update the revert path in `webhookHandlers.ts`
- In `handlePullRequestEvent()`, in the `!wasMerged` branch (line 114-118):
  - Capture the return value of `revertIssueCostFile()`: `const deletedPaths = revertIssueCostFile(...)`
  - After `rebuildProjectCostCsv()`, get the total-cost.csv path: `const totalCsvPath = getProjectCsvPath(repoName)` (import from `../core`)
  - Call `commitAndPushCostFiles({ repoName, paths: [...deletedPaths, totalCsvPath] })` instead of `commitAndPushCostFiles({ repoName })`
  - Import `getProjectCsvPath` from `../core`

### Step 4: Update `revertIssueCostFile.test.ts`
- Update all test assertions to expect `string[]` instead of `boolean`:
  - `'deletes a matching issue CSV file and returns true'` → expect `['projects/my-repo/42-add-login.csv']`
  - `'returns false when no matching file exists'` → expect `[]`
  - `'returns false when the project directory does not exist'` → expect `[]`
  - `'deletes all matching files when multiple matches exist'` → expect `['projects/my-repo/42-add-login.csv', 'projects/my-repo/42-add-login-v2.csv']`
  - `'does not delete total-cost.csv'` → expect `[]`

### Step 5: Update `webhookHandlers.test.ts`
- Update the mock for `revertIssueCostFile` to return `string[]` instead of `boolean` (e.g., `['projects/repo/42-add-login.csv']`)
- Add mock for `getProjectCsvPath` in the `costCsvWriter` mock (return `'projects/repo/total-cost.csv'`)
- Update the `'calls revertIssueCostFile, rebuildProjectCostCsv, and commitAndPushCostFiles for closed-without-merge PRs'` test:
  - Update `revertIssueCostFile` mock to return `['projects/repo/42-add-login.csv']`
  - Update the `commitAndPushCostFiles` assertion to verify it's called with `{ repoName: 'repo', paths: ['projects/repo/42-add-login.csv', 'projects/repo/total-cost.csv'] }` instead of `{ repoName: 'repo' }`

### Step 6: Run validation commands
- Run all validation commands to ensure zero regressions.

## Validation Commands
Execute every command to validate the review is complete with zero regressions.

- `npm run lint` — Run linter to check for code quality issues
- `npx tsc --noEmit` — Type check the main project
- `npx tsc --noEmit -p adws/tsconfig.json` — Type check the adws scripts
- `npm test` — Run all tests to validate the review is complete with zero regressions
- `npm run build` — Build the application to verify no build errors

## Notes
- The `paths` option in `commitAndPushCostFiles` handles deleted files correctly because `git add` on a path that was deleted stages the deletion (tracked files that are now missing are recognized by git).
- Shell glob patterns like `*.csv` do NOT match deleted files since they no longer exist on disk, but explicit paths passed to `git add` will correctly stage deletions of tracked files.
- The merged PR path already uses single-issue mode (`{ repoName, issueNumber, issueTitle }`) and is not affected by this review.
- The `getProjectCsvPath` import is already available in the `../core` barrel export, so no new exports are needed for that.
