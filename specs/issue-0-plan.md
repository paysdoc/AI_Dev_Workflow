# PR-Review: Add getTargetRepo() fallback to gitOperations, pullRequestCreator, and prCommentDetector

## PR-Review Description
The files `gitOperations.ts`, `pullRequestCreator.ts`, and `prCommentDetector.ts` run shell commands (`git`, `gh`) against whichever repo `process.cwd()` happens to point to. When ADW processes external target repositories, these commands silently target the wrong repo if no explicit `cwd` is passed by the caller. The fix is to add `resolveTargetRepoCwd()` as an internal fallback — the same pattern already used in `worktreeOperations.ts` — so that when no explicit `cwd` is provided, the TargetRepoRegistry is consulted to resolve the correct workspace path.

Additionally, `pullRequestCreator.ts` should fall back to `getTargetRepo()` for the `repoInfo` parameter to ensure `gh pr create` always targets the correct repository.

## Summary of Original Implementation Plan
The original plan (`specs/issue-0-adw-adw-unknown-sdlc_planner-fix-worktree-target-repo-registry.md`) addressed a bug where worktree operations ran against the ADW repository instead of the target repository. It introduced:
1. A `resolveTargetRepoCwd` helper in `worktreeOperations.ts`
2. Updated `isBranchCheckedOutElsewhere` and `freeBranchFromMainRepo` to accept and use an optional `cwd` parameter with registry fallback
3. Threaded `baseRepoPath` through `createWorktree` in `worktreeCreation.ts`
4. Added corresponding tests

A follow-up PR review plan addressed passing `repoInfo` to `prCommentDetector` callers in `prReviewPhase.ts` and `trigger_cron.ts`.

This current review extends the same pattern to three additional files that were identified as risk areas.

## Relevant Files
Use these files to resolve the review:

- `adws/core/targetRepoRegistry.ts` — Central registry module. Will be extended with the shared `resolveTargetRepoCwd` helper so all files use one canonical implementation.
- `adws/core/index.ts` — Core barrel export. Must re-export the new `resolveTargetRepoCwd` function.
- `adws/github/gitOperations.ts` — All functions accept `cwd?` but pass it directly to `execSync` without registry fallback. Needs `resolveTargetRepoCwd` to wrap `cwd` before passing to `execSync`.
- `adws/github/pullRequestCreator.ts` — `createPullRequest` accepts `cwd?` and `repoInfo?` but has no fallback for either. Needs `resolveTargetRepoCwd` for `cwd` and `getTargetRepo()` for `repoInfo`.
- `adws/github/prCommentDetector.ts` — `getLastAdwCommitTimestamp` has no `cwd` parameter at all and always runs `git log` against `process.cwd()`. Needs a `cwd?` parameter with `resolveTargetRepoCwd` fallback.
- `adws/github/worktreeOperations.ts` — Currently has a private `resolveTargetRepoCwd`. Will be updated to import the shared version from `targetRepoRegistry`.
- `adws/__tests__/gitOperations.test.ts` — Needs new tests verifying registry fallback behavior.
- `adws/__tests__/prCommentDetector.test.ts` — Needs new tests verifying `getLastAdwCommitTimestamp` uses `cwd` and registry fallback.
- `adws/__tests__/targetRepoRegistry.test.ts` — Needs tests for the new `resolveTargetRepoCwd` function.
- `adws/__tests__/worktreeOperations.test.ts` — Must update mock to use shared `resolveTargetRepoCwd` import.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add `resolveTargetRepoCwd` to `core/targetRepoRegistry.ts`
- Import `getTargetRepoWorkspacePath` from `./targetRepoManager`
- Add the following exported function at the end of the file:
  ```typescript
  /**
   * Resolves the working directory for git commands targeting the correct repository.
   * Uses an explicit cwd if provided, otherwise falls back to the TargetRepoRegistry
   * to resolve the workspace path for external target repositories.
   *
   * @param cwd - Optional explicit working directory override
   * @returns The resolved cwd, or undefined to use process.cwd()
   */
  export function resolveTargetRepoCwd(cwd?: string): string | undefined {
    if (cwd) return cwd;
    if (hasTargetRepo()) {
      const { owner, repo } = getTargetRepo();
      return getTargetRepoWorkspacePath(owner, repo);
    }
    return undefined;
  }
  ```
- Note: `hasTargetRepo` and `getTargetRepo` are already defined in this file, so no import needed for those. Only `getTargetRepoWorkspacePath` needs to be imported.

### Step 2: Export `resolveTargetRepoCwd` from `core/index.ts`
- Add `resolveTargetRepoCwd` to the existing target repo registry export line (line 117):
  ```typescript
  export { setTargetRepo, getTargetRepo, clearTargetRepo, hasTargetRepo, resolveTargetRepoCwd } from './targetRepoRegistry';
  ```

### Step 3: Update `worktreeOperations.ts` to use the shared helper
- Update the import on line 13 from:
  ```typescript
  import { hasTargetRepo, getTargetRepo } from '../core/targetRepoRegistry';
  ```
  to:
  ```typescript
  import { resolveTargetRepoCwd } from '../core/targetRepoRegistry';
  ```
- Remove the import of `getTargetRepoWorkspacePath` on line 14:
  ```typescript
  import { getTargetRepoWorkspacePath } from '../core/targetRepoManager';
  ```
- Remove the local `resolveTargetRepoCwd` function definition (lines 26–40, including the JSDoc comment).
- All existing call sites of `resolveTargetRepoCwd` in the file (lines 135, 181, 239, 317) remain unchanged — they now call the imported version.

### Step 4: Add `resolveTargetRepoCwd` fallback to `gitOperations.ts`
- Add import at the top of the file:
  ```typescript
  import { resolveTargetRepoCwd } from '../core/targetRepoRegistry';
  ```
- Update each function that accepts `cwd?` to resolve it before use. For each function below, add `const resolvedCwd = resolveTargetRepoCwd(cwd);` as the first line of the function body (or first line inside the try block where applicable), then replace all occurrences of `cwd` in `execSync` options with `resolvedCwd`:
  - **`getCurrentBranch`** (line 13): resolve cwd, use `resolvedCwd` in execSync
  - **`createFeatureBranch`** (line 55): resolve cwd inside the try block (line 63), use `resolvedCwd` in all three execSync calls
  - **`checkoutBranch`** (line 86): resolve cwd inside the try block, use `resolvedCwd` in both execSync calls
  - **`commitChanges`** (line 102): resolve cwd inside the try block, use `resolvedCwd` in all three execSync calls
  - **`pushBranch`** (line 127): resolve cwd, use `resolvedCwd` in execSync
  - **`getDefaultBranch`** (line 135): resolve cwd inside the try block, use `resolvedCwd` in execSync
  - **`checkoutDefaultBranch`** (line 186): resolve cwd at the start of the function body (before the `getDefaultBranch` call), pass `resolvedCwd` to `getDefaultBranch(resolvedCwd)` and both execSync calls
  - **`deleteLocalBranch`** (line 249): resolve cwd after the protected branch check, use `resolvedCwd` in execSync
  - **`deleteRemoteBranch`** (line 273): resolve cwd after the protected branch check, use `resolvedCwd` in execSync
  - **`commitAndPushCostFiles`** (line 306): resolve `cwd` from destructured options at the start of the try block: `const resolvedCwd = resolveTargetRepoCwd(cwd);`, use `resolvedCwd` in all execSync calls and pass it to `getCurrentBranch(resolvedCwd)`
- Do NOT change `mergeLatestFromDefaultBranch` — its `cwd` parameter is required (not optional), so no fallback is needed.
- Do NOT change pure functions (`generateBranchName`, `generateFeatureBranchName`, `inferIssueTypeFromBranch`) — they don't run shell commands.

### Step 5: Add `resolveTargetRepoCwd` fallback to `pullRequestCreator.ts`
- Add import at the top of the file:
  ```typescript
  import { resolveTargetRepoCwd, getTargetRepo } from '../core/targetRepoRegistry';
  ```
- In `createPullRequest` (line 57), at the start of the function body:
  1. Resolve cwd: `const resolvedCwd = resolveTargetRepoCwd(cwd);`
  2. Resolve repoInfo: `const resolvedRepoInfo = repoInfo ?? getTargetRepo();`
- Replace all uses of `cwd` with `resolvedCwd`:
  - `getCurrentBranch(resolvedCwd)` (line 65)
  - `pushBranch(branchName, resolvedCwd)` (line 75)
  - `execSync(...)` for `gh pr create` (lines 78–80): use `resolvedCwd`
- Replace `repoInfo` with `resolvedRepoInfo` for the `--repo` flag:
  - Change the `repoFlag` line to always use `resolvedRepoInfo`:
    ```typescript
    const repoFlag = ` --repo ${resolvedRepoInfo.owner}/${resolvedRepoInfo.repo}`;
    ```

### Step 6: Add `cwd` parameter and `resolveTargetRepoCwd` fallback to `prCommentDetector.ts`
- Add import at the top of the file:
  ```typescript
  import { resolveTargetRepoCwd } from '../core/targetRepoRegistry';
  ```
- Update `getLastAdwCommitTimestamp` signature (line 18) to accept an optional `cwd`:
  ```typescript
  export function getLastAdwCommitTimestamp(branchName: string, cwd?: string): Date | null {
  ```
- Add cwd resolution as the first line inside the try block:
  ```typescript
  const resolvedCwd = resolveTargetRepoCwd(cwd);
  ```
- Update the `execSync` call (lines 21–23) to pass `resolvedCwd`:
  ```typescript
  const output = execSync(
    `git log "${branchName}" --format="%aI %s" --no-merges`,
    { encoding: 'utf-8', cwd: resolvedCwd }
  );
  ```
- No changes needed to `getUnaddressedComments` or `hasUnaddressedComments` — the registry fallback inside `getLastAdwCommitTimestamp` handles external repos automatically.

### Step 7: Add tests for `resolveTargetRepoCwd` in `targetRepoRegistry.test.ts`
- Add a mock for `../core/targetRepoManager` at the top of the test file:
  ```typescript
  vi.mock('../core/targetRepoManager', () => ({
    getTargetRepoWorkspacePath: vi.fn((owner: string, repo: string) => `/repos/${owner}/${repo}`),
  }));
  ```
- Import `resolveTargetRepoCwd` from the registry module
- Add a new `describe('resolveTargetRepoCwd', ...)` block with these tests:
  - `'returns explicit cwd when provided'` — call with `'/explicit/path'`, expect `'/explicit/path'` regardless of registry state
  - `'returns workspace path from registry when no explicit cwd and registry is set'` — call `setTargetRepo({ owner: 'ext-owner', repo: 'ext-repo' })`, then call `resolveTargetRepoCwd()`, expect `/repos/ext-owner/ext-repo`
  - `'returns undefined when no explicit cwd and registry is not set'` — call `resolveTargetRepoCwd()` without setting registry, expect `undefined`
  - `'explicit cwd takes priority over registry'` — set registry, call with explicit cwd, expect the explicit value

### Step 8: Add registry fallback tests to `gitOperations.test.ts`
- Add mock for `../core/targetRepoRegistry` at the top of the file:
  ```typescript
  vi.mock('../core/targetRepoRegistry', () => ({
    resolveTargetRepoCwd: vi.fn((cwd?: string) => cwd),
  }));
  ```
  This mock makes `resolveTargetRepoCwd` a pass-through by default (returns `cwd` as-is), so all existing tests continue to pass without modifications.
- Import `resolveTargetRepoCwd` from the mocked module
- Add a new `describe('registry fallback', ...)` block:
  - Test: `'getCurrentBranch uses resolved cwd from registry'` — mock `resolveTargetRepoCwd` to return `'/target/repo'`, call `getCurrentBranch()` (without cwd), assert `execSync` was called with `cwd: '/target/repo'`
  - Test: `'getDefaultBranch uses resolved cwd from registry'` — same pattern
  - Test: `'deleteLocalBranch uses resolved cwd from registry'` — same pattern
  - These three tests cover the pattern sufficiently; all other functions follow the same approach.

### Step 9: Add `getLastAdwCommitTimestamp` cwd tests to `prCommentDetector.test.ts`
- Add mock for `../core/targetRepoRegistry` at the top of the file:
  ```typescript
  vi.mock('../core/targetRepoRegistry', () => ({
    resolveTargetRepoCwd: vi.fn((cwd?: string) => cwd),
  }));
  ```
- Import `getLastAdwCommitTimestamp` from `../github/prCommentDetector`
- Import `resolveTargetRepoCwd` from `../core/targetRepoRegistry` (mocked)
- Import `execSync` from `child_process` (already mocked)
- Add a new `describe('getLastAdwCommitTimestamp cwd resolution', ...)` block:
  - Test: `'passes resolved cwd to execSync'` — mock `resolveTargetRepoCwd` to return `'/target/repo'`, mock `execSync` to return a git log line matching an ADW commit, call `getLastAdwCommitTimestamp('feature/test')`, assert `execSync` was called with `expect.objectContaining({ cwd: '/target/repo' })`
  - Test: `'passes undefined cwd when registry is not set'` — call with no cwd and default pass-through mock, assert `execSync` was called with `expect.objectContaining({ cwd: undefined })`
  - Test: `'passes explicit cwd when provided'` — call with explicit cwd, assert `execSync` was called with that cwd value

### Step 10: Update `worktreeOperations.test.ts` mock for shared `resolveTargetRepoCwd`
- Update the existing mock of `../core/targetRepoRegistry` to include `resolveTargetRepoCwd`:
  ```typescript
  vi.mock('../core/targetRepoRegistry', () => ({
    hasTargetRepo: vi.fn(() => false),
    getTargetRepo: vi.fn(),
    resolveTargetRepoCwd: vi.fn((cwd?: string) => cwd),
  }));
  ```
- Check if `../core/targetRepoManager` mock for `getTargetRepoWorkspacePath` is still needed by other functions in the file — if the only consumer was the local `resolveTargetRepoCwd` that is now removed, the manager mock can be simplified.
- Update existing tests that verify the registry fallback (lines ~167, ~994, ~1864) to mock `resolveTargetRepoCwd` returning a workspace path instead of mocking the individual `hasTargetRepo`/`getTargetRepo`/`getTargetRepoWorkspacePath` chain.

### Step 11: Run validation commands
- Execute every validation command to confirm zero regressions.

## Validation Commands
Execute every command to validate the review is complete with zero regressions.

- `npm run lint` — Run linter to check for code quality issues
- `npx tsc --noEmit` — Type check the project
- `npx tsc --noEmit -p adws/tsconfig.json` — Type check the ADW scripts
- `npm test` — Run all tests to validate zero regressions
- `npm run build` — Build the application to verify no build errors

## Notes
- The `resolveTargetRepoCwd` function follows a priority chain: explicit `cwd` > TargetRepoRegistry workspace path > `undefined` (process.cwd()). This is identical to the pattern already proven in `worktreeOperations.ts`.
- By extracting the helper to `targetRepoRegistry.ts`, we eliminate duplication (4 files sharing one implementation) and ensure consistent behavior across the codebase.
- No changes are needed to `mergeLatestFromDefaultBranch` since its `cwd` parameter is already required (not optional).
- The `pullRequestCreator.ts` change makes the `--repo` flag always present (using `getTargetRepo()` as fallback). This is safe because `getTargetRepo()` itself falls back to reading the local git remote, which is the current behavior when no `--repo` flag is set.
- Existing tests continue to pass because the mock makes `resolveTargetRepoCwd` a pass-through by default. New tests specifically verify the fallback behavior.
- No API signature changes for callers — the fallback is internal to each function. The only signature change is adding `cwd?: string` to `getLastAdwCommitTimestamp`, which is backwards-compatible.
