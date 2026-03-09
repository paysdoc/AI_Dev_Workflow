# Bug: git add fails for deleted untracked cost CSV files

## Metadata
issueNumber: `100`
adwId: `error-committing-cos-grqal5`
issueJson: `{"number":100,"title":"Error committing cost","body":"✅ [2026-03-09T11:26:55.437Z] Deleted cost CSV: projects/AI_Dev_Workflow/97-refactor-the-code.csv\n✅ [2026-03-09T11:26:55.911Z] Project cost CSV rebuilt: projects/AI_Dev_Workflow/total-cost.csv\n❌ [2026-03-09T11:26:56.040Z] Failed to commit cost CSV files: Error: Command failed: git add \"projects/AI_Dev_Workflow/97-refactor-the-code.csv\" \"projects/AI_Dev_Workflow/total-cost.csv\"\nfatal: pathspec 'projects/AI_Dev_Workflow/97-refactor-the-code.csv' did not match any files\n\n\n97-refactor-the-code.csv was lost as a result of the above and total-cost.csv was not committed\n","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-09T11:30:22Z","comments":[{"author":"paysdoc","createdAt":"2026-03-09T11:32:25Z","body":"## Take action"}],"actionableComment":null}`

## Bug Description
When a PR is closed without merge (or an issue is closed directly), the cost revert flow:
1. Deletes the issue's cost CSV file from disk via `revertIssueCostFile()`
2. Rebuilds `total-cost.csv` via `rebuildProjectCostCsv()`
3. Calls `commitAndPushCostFiles()` with explicit `paths` that include the deleted file path and `total-cost.csv`

The `commitAndPushCostFiles()` function then runs `git add "<deleted-file>" "<total-cost.csv>"`. If the deleted file was **never previously committed to git** (i.e., it was an untracked file that only existed on disk), `git add` fails with `fatal: pathspec '...' did not match any files` because the file is neither on disk nor in the git index.

**Expected behavior:** The cost revert flow should gracefully handle deleted files that were never tracked by git, committing only the files that have actual git changes (in this case, `total-cost.csv`).

**Actual behavior:** The entire `git add` command fails, which means `total-cost.csv` is also not committed or pushed. Both the deletion tracking and the rebuilt total are lost.

## Problem Statement
`commitAndPushCostFiles()` in explicit `paths` mode passes all paths directly to a single `git add` command without checking whether each path exists on disk or is tracked by git. When a path refers to a file that was deleted from disk but was never committed to git, `git add` fails for the entire batch.

## Solution Statement
In the explicit `paths` mode of `commitAndPushCostFiles()`, filter the provided paths before running `git add`:
- Keep paths that **exist on disk** (new or modified files to stage)
- Keep paths that **are tracked by git** (deleted tracked files — `git add` will stage the deletion)
- Exclude paths that are **neither on disk nor tracked** (deleted untracked files — nothing to commit)

If no valid paths remain after filtering, return `false` (no changes). This makes the function robust against callers passing paths of deleted untracked files.

## Steps to Reproduce
1. Run an ADW workflow that creates a cost CSV file (e.g., `projects/AI_Dev_Workflow/97-refactor-the-code.csv`)
2. Ensure this CSV file is **not committed** to git (it only exists on disk as an untracked file)
3. Close the associated PR without merging
4. The webhook handler calls `revertIssueCostFile()` which deletes the file from disk
5. The handler then calls `commitAndPushCostFiles({ repoName, paths: [deletedPath, totalCsvPath] })`
6. `git add` fails with `fatal: pathspec '...' did not match any files`
7. Neither the deletion nor the rebuilt `total-cost.csv` is committed

## Root Cause Analysis
The `commitAndPushCostFiles()` function in `adws/github/gitCommitOperations.ts` has an explicit `paths` mode (lines 94-98) that builds a `git add` command by quoting all provided paths and joining them. It does not validate whether each path is valid for `git add`:

```typescript
if (paths && paths.length > 0) {
  addPath = paths.map(p => `"${p}"`).join(' ');
  statusPath = addPath;
  commitMessage = `cost: update cost data for ${repoName ?? 'project'}`;
}
```

The `git status --porcelain` check (lines 118-126) passes because `total-cost.csv` has changes, so the function proceeds to `git add`. However, the `git add` command (line 128) includes the deleted untracked file path, causing the entire command to fail.

The callers (`webhookHandlers.ts` line 148 and `trigger_webhook.ts` line 139) pass `deletedPaths` from `revertIssueCostFile()` directly into `paths` without checking whether those files were ever tracked by git. This is correct behavior from the caller's perspective — the function should be able to handle this case.

## Relevant Files
Use these files to fix the bug:

- `adws/github/gitCommitOperations.ts` — Contains `commitAndPushCostFiles()` where the fix is needed. The explicit `paths` mode must filter out paths that don't exist on disk and aren't tracked by git before running `git add`.
- `adws/github/__tests__/commitCostFiles.test.ts` — Contains existing tests for `commitAndPushCostFiles()`. New test cases must be added for the explicit `paths` mode, especially for the scenario where a path in `paths` refers to a deleted untracked file.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow during implementation.
- `app_docs/feature-trigger-should-commi-f8jwcf-commit-push-cost-csv.md` — Documentation for the cost commit feature (for context).
- `app_docs/feature-automatically-ccommi-wdlirj-auto-commit-cost-on-pr.md` — Documentation for the auto-commit/revert cost feature (for context).

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Filter invalid paths in `commitAndPushCostFiles()` explicit paths mode
- In `adws/github/gitCommitOperations.ts`, modify the explicit `paths` mode branch (the `if (paths && paths.length > 0)` block) to filter paths before building the `git add` command.
- Import `existsSync` from `fs` and `path` from `path` at the top of the file.
- After resolving `resolvedCwd`, filter each path in `paths`:
  - If the file exists on disk at `path.join(resolvedCwd, p)`, keep it (it's a new or modified file).
  - If the file does NOT exist on disk, check if it's tracked by git using `execSync('git ls-files "<path>"', { encoding: 'utf-8', cwd: resolvedCwd }).trim()`. If the output is non-empty, keep it (it's a deleted tracked file whose deletion should be staged).
  - Otherwise, exclude it and log a message like `Skipping untracked deleted path: <path>`.
- If `validPaths` is empty after filtering, log `No valid cost CSV paths to commit` and return `false`.
- Use `validPaths` instead of `paths` to build `addPath` and `statusPath`.
- The logic change should be minimal and surgical — only the explicit `paths` branch needs modification.

### 2. Add unit tests for the explicit paths mode fix
- In `adws/github/__tests__/commitCostFiles.test.ts`, add new test cases:
  - **"filters out deleted untracked paths and commits remaining valid paths"**: Mock `git ls-files` to return empty for a deleted path, verify `git add` is called with only the valid paths.
  - **"stages deletion of tracked files passed via paths"**: Mock `git ls-files` to return the path (tracked), verify `git add` includes the deleted tracked path.
  - **"returns false when all paths are deleted and untracked"**: Provide only paths that don't exist and aren't tracked. Verify the function returns `false` without calling `git add` or `git commit`.
  - **"commits successfully with explicit paths when all paths are valid"**: Verify the happy path with explicit `paths` mode works correctly (existing files).
- Mock `fs.existsSync` for the path existence checks in the new tests (or use the existing `execSync` mock patterns to simulate git behavior).

### 3. Run validation commands
- Run all validation commands listed below to confirm the fix works with zero regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type-check the main project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the adws scripts
- `bun run test` — Run all tests to validate the fix with zero regressions

## Notes
- The fix is intentionally placed in `commitAndPushCostFiles()` rather than in the callers (`webhookHandlers.ts` / `trigger_webhook.ts`) because:
  1. It makes the function robust against any future caller passing invalid paths.
  2. Both callers use the same pattern (`[...deletedPaths, totalCsvPath]`), so fixing the function avoids duplicating the fix in two places.
- The `guidelines/coding_guidelines.md` requires strict type safety and meaningful error messages — the fix should log clearly when paths are skipped.
- The `revertIssueCostFile()` function correctly returns deleted paths — the contract is fine. The issue is that `commitAndPushCostFiles()` doesn't validate those paths against git's index before use.
