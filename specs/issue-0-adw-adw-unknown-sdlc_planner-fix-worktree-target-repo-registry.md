# Bug: Worktree operations run against ADW repo instead of target repo (TargetRepoRegistry fix)

## Metadata
issueNumber: `0`
adwId: `adw-unknown`
issueJson: `{}`

## Bug Description
When ADW processes issues from an external target repository (e.g., `paysdoc/Millennium`), worktree creation fails with an error at `worktreeCreation.ts:144` because internal worktree helper functions operate against the ADW repository (`process.cwd()`) instead of the target repository.

**Expected behavior**: When creating a worktree for an external target repository, all git worktree operations (branch checkout detection, branch freeing, env copying) should execute against the target repository's workspace path.

**Actual behavior**: `isBranchCheckedOutElsewhere()` and `freeBranchFromMainRepo()` run `git worktree list` and other git commands without a `cwd` parameter, causing them to operate on the ADW repository instead of the target repository. This was identified in issue #52 as "insufficiently addressed" — the classifier was fixed but the worktree operations were not.

## Problem Statement
Inside `createWorktree()` in `worktreeCreation.ts`, the function correctly receives and uses `baseRepoPath` for `getWorktreePath`, `getWorktreesDir`, and the main git commands (via `gitOpts`). However, on line 113 it calls `isBranchCheckedOutElsewhere(branchName)` **without** passing any repo context. This function (in `worktreeOperations.ts:114`) runs `git worktree list --porcelain` with no `cwd`, so it checks worktrees of the ADW repo instead of the target repo. Similarly, if the branch is found checked out, `freeBranchFromMainRepo()` (line 119) also operates on the ADW repo via `getMainRepoPath()` with no `cwd`.

Additionally, in `freeBranchFromMainRepo` (line 190), `getDefaultBranch()` is called without a `cwd` parameter, so it queries the default branch of the ADW repo instead of the target repo.

This can cause:
1. **False positives**: A branch with the same name in the ADW repo triggers incorrect checkout detection
2. **Wrong worktree path returned**: The ADW worktree path is returned instead of the target repo worktree path
3. **Wrong repo manipulation**: `freeBranchFromMainRepo` auto-commits and switches branches in the ADW repo instead of the target repo
4. **Worktree creation failure**: The `git worktree add` command fails because the preceding logic made incorrect decisions, triggering the catch at line 144

## Solution Statement
Use the existing `TargetRepoRegistry` pattern to resolve the correct repository context inside `isBranchCheckedOutElsewhere()` and `freeBranchFromMainRepo()`. This mirrors how `issueApi.ts` and `prApi.ts` already use `getTargetRepo()` as a fallback for repo resolution. Specifically:

1. Add a private helper `resolveTargetRepoCwd(cwd?: string): string | undefined` in `worktreeOperations.ts` that checks the TargetRepoRegistry and resolves the workspace path when an explicit `cwd` is not provided.
2. Update both functions to accept an optional `cwd?: string` parameter (following the established pattern where functions accept an optional override and fall back to the registry).
3. Update `createWorktree()` to pass `baseRepoPath` explicitly for safety and clarity.

This approach is consistent with the codebase's established convention: `issueApi` and `prApi` functions accept an optional `repoInfo` parameter that falls back to `getTargetRepo()`. Here, worktree functions accept an optional `cwd` that falls back to the registry-resolved workspace path.

## Steps to Reproduce
1. Start the webhook trigger: `npx tsx adws/triggers/trigger_webhook.ts`
2. Create an issue on an external target repository (e.g., `paysdoc/Millennium`)
3. The webhook receives the event and spawns an orchestrator with `--target-repo paysdoc/Millennium`
4. `initializeWorkflow()` calls `ensureWorktree(branchName, defaultBranch, targetRepoWorkspacePath)`
5. Inside `createWorktree()`, `isBranchCheckedOutElsewhere(branchName)` runs against the ADW repo (no `cwd`)
6. Worktree creation fails with `Error` at `worktreeCreation.ts:144`

## Root Cause Analysis
The issue #52 fix correctly addressed the issue classifier fetching from the wrong repository by threading `repoInfo` through `classifyIssueForTrigger()`. However, the deeper problem persists in the worktree layer: `isBranchCheckedOutElsewhere()` and `freeBranchFromMainRepo()` in `worktreeOperations.ts` do not use the `TargetRepoRegistry` and do not accept a `cwd` parameter. When these are called from `createWorktree()` (which does have a `baseRepoPath`), they default to `process.cwd()` — the ADW repository directory — instead of operating on the target repository.

The `TargetRepoRegistry` (`adws/core/targetRepoRegistry.ts`) was designed as "a single source of truth for which repository ADW is operating on." Entry points (triggers, orchestrators) initialize it via `setTargetRepo()`, and all GitHub API functions read from it by default via `getTargetRepo()`. However, the worktree layer was never updated to use this registry — it still relies on implicit `process.cwd()`.

The call chain is:
1. `initializeWorkflow()` → `ensureWorktree(branchName, defaultBranch, targetRepoWorkspacePath)` ✓ passes target repo
2. `ensureWorktree()` → `createWorktree(branchName, baseBranch, baseRepoPath)` ✓ passes target repo
3. `createWorktree()` → `isBranchCheckedOutElsewhere(branchName)` ✗ **no target repo passed, no registry check**
4. `createWorktree()` → `freeBranchFromMainRepo(branchName)` ✗ **no target repo passed, no registry check**
5. `freeBranchFromMainRepo()` → `getDefaultBranch()` ✗ **no cwd, queries ADW repo's default branch**

## Relevant Files
Use these files to fix the bug:

- **`adws/core/targetRepoRegistry.ts`** — The central TargetRepoRegistry module. Contains `hasTargetRepo()`, `getTargetRepo()`. Used as the fallback source of truth for repo context. Read this to understand the registry pattern.
- **`adws/core/targetRepoManager.ts`** — Contains `getTargetRepoWorkspacePath(owner, repo)` which resolves the filesystem path for a target repo's workspace. Needed to convert registry repo info into a `cwd` path.
- **`adws/github/worktreeOperations.ts`** — Contains `isBranchCheckedOutElsewhere()` (line 114) and `freeBranchFromMainRepo()` (line 160) which need to use the TargetRepoRegistry for `cwd` resolution. Also contains `getMainRepoPath()` which already accepts `cwd`.
- **`adws/github/worktreeCreation.ts`** — Contains `createWorktree()` (line 80) where the bug manifests. Needs to pass `baseRepoPath` to `isBranchCheckedOutElsewhere()` and `freeBranchFromMainRepo()` for explicit override.
- **`adws/__tests__/worktreeOperations.test.ts`** — Contains existing tests for `isBranchCheckedOutElsewhere` (line 829) and `freeBranchFromMainRepo` (line 900). Needs new tests verifying correct behavior when `cwd` is provided and when the TargetRepoRegistry is set.
- **`guidelines/coding_guidelines.md`** — Coding guidelines to follow during implementation.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add `resolveTargetRepoCwd` helper in `worktreeOperations.ts`

- Open `adws/github/worktreeOperations.ts`
- Add imports for the TargetRepoRegistry and TargetRepoManager at the top of the file:
  ```typescript
  import { hasTargetRepo, getTargetRepo } from '../core/targetRepoRegistry';
  import { getTargetRepoWorkspacePath } from '../core/targetRepoManager';
  ```
- Add a private helper function after the existing imports and before the `sanitizeBranchName` function:
  ```typescript
  /**
   * Resolves the working directory for git commands targeting the correct repository.
   * Uses an explicit cwd if provided, otherwise falls back to the TargetRepoRegistry
   * to resolve the workspace path for external target repositories.
   *
   * @param cwd - Optional explicit working directory override
   * @returns The resolved cwd, or undefined to use process.cwd()
   */
  function resolveTargetRepoCwd(cwd?: string): string | undefined {
    if (cwd) return cwd;
    if (hasTargetRepo()) {
      const { owner, repo } = getTargetRepo();
      return getTargetRepoWorkspacePath(owner, repo);
    }
    return undefined;
  }
  ```

### Step 2: Update `isBranchCheckedOutElsewhere` to use the registry

- In `adws/github/worktreeOperations.ts`, update the `isBranchCheckedOutElsewhere` function signature (line 114) to accept an optional `cwd` parameter:
  ```typescript
  export function isBranchCheckedOutElsewhere(branchName: string, cwd?: string): BranchCheckoutStatus {
  ```
- Inside the function body, resolve the cwd using the helper and pass it to the `execSync` call:
  ```typescript
  const resolvedCwd = resolveTargetRepoCwd(cwd);
  const output = execSync('git worktree list --porcelain', { encoding: 'utf-8', cwd: resolvedCwd });
  ```
- The rest of the function (parsing worktree list output, checking branches) does not need changes since the worktree list output will now come from the correct repository.

### Step 3: Update `freeBranchFromMainRepo` to use the registry

- In `adws/github/worktreeOperations.ts`, update the `freeBranchFromMainRepo` function signature (line 160) to accept an optional `cwd` parameter:
  ```typescript
  export function freeBranchFromMainRepo(branchName: string, cwd?: string): void {
  ```
- At the top of the function body, resolve the cwd and pass it to `getMainRepoPath`:
  ```typescript
  const resolvedCwd = resolveTargetRepoCwd(cwd);
  const mainRepoPath = getMainRepoPath(resolvedCwd);
  ```
- On line 190, update the `getDefaultBranch()` call to pass `mainRepoPath` as `cwd` so it queries the correct repo's default branch:
  ```typescript
  const defaultBranch = getDefaultBranch(mainRepoPath);
  ```
- All subsequent git commands in this function already use `cwd: mainRepoPath`, so they will correctly operate on the target repo once `mainRepoPath` is resolved correctly.

### Step 4: Thread `baseRepoPath` through `createWorktree` in `worktreeCreation.ts`

- Open `adws/github/worktreeCreation.ts`
- On line 113, change `isBranchCheckedOutElsewhere(branchName)` to `isBranchCheckedOutElsewhere(branchName, baseRepoPath)` — this provides an explicit override in addition to the registry fallback for safety:
  ```typescript
  const checkoutStatus = isBranchCheckedOutElsewhere(branchName, baseRepoPath);
  ```
- On line 119, change `freeBranchFromMainRepo(branchName)` to `freeBranchFromMainRepo(branchName, baseRepoPath)`:
  ```typescript
  freeBranchFromMainRepo(branchName, baseRepoPath);
  ```

### Step 5: Add tests for `resolveTargetRepoCwd` helper behavior

- Open `adws/__tests__/worktreeOperations.test.ts`
- Add a mock for the TargetRepoRegistry module near the top of the file with the other mocks:
  ```typescript
  vi.mock('../core/targetRepoRegistry', () => ({
    hasTargetRepo: vi.fn(() => false),
    getTargetRepo: vi.fn(() => ({ owner: 'ext-owner', repo: 'ext-repo' })),
  }));

  vi.mock('../core/targetRepoManager', () => ({
    getTargetRepoWorkspacePath: vi.fn((owner: string, repo: string) => `/mock/repos/${owner}/${repo}`),
  }));
  ```
- Import the mocked functions:
  ```typescript
  import { hasTargetRepo, getTargetRepo } from '../core/targetRepoRegistry';
  import { getTargetRepoWorkspacePath } from '../core/targetRepoManager';
  ```

### Step 6: Add tests for `isBranchCheckedOutElsewhere` with `cwd` parameter and registry

- In the `describe('isBranchCheckedOutElsewhere', ...)` block (line 829), add the following tests:

- **Test: 'passes explicit cwd to execSync when provided'**:
  - Call `isBranchCheckedOutElsewhere('feature/issue-99', '/target/repo')` with mock worktree output.
  - Verify that `execSync` was called with `{ encoding: 'utf-8', cwd: '/target/repo' }`.
  - Confirm that `hasTargetRepo` was NOT called (explicit cwd takes priority).

- **Test: 'uses TargetRepoRegistry to resolve cwd when no explicit cwd is provided'**:
  - Mock `hasTargetRepo` to return `true` and `getTargetRepo` to return `{ owner: 'ext-owner', repo: 'ext-repo' }`.
  - Call `isBranchCheckedOutElsewhere('feature/issue-99')` without cwd.
  - Verify that `execSync` was called with `{ encoding: 'utf-8', cwd: '/mock/repos/ext-owner/ext-repo' }`.

- **Test: 'falls back to undefined cwd when registry is not set and no explicit cwd'**:
  - Ensure `hasTargetRepo` returns `false`.
  - Call `isBranchCheckedOutElsewhere('feature/issue-99')` without cwd.
  - Verify that `execSync` was called with `{ encoding: 'utf-8', cwd: undefined }`.

### Step 7: Add tests for `freeBranchFromMainRepo` with `cwd` parameter and registry

- In the `describe('freeBranchFromMainRepo', ...)` block (line 900), add the following tests:

- **Test: 'passes explicit cwd to getMainRepoPath when provided'**:
  - Call `freeBranchFromMainRepo('feature/issue-51', '/target/repo')`.
  - Verify the first `execSync` call (for `getMainRepoPath`) used `{ encoding: 'utf-8', cwd: '/target/repo' }`.

- **Test: 'uses TargetRepoRegistry to resolve cwd when no explicit cwd is provided'**:
  - Mock `hasTargetRepo` to return `true` and `getTargetRepo` to return `{ owner: 'ext-owner', repo: 'ext-repo' }`.
  - Call `freeBranchFromMainRepo('feature/issue-51')` without cwd.
  - Verify the first `execSync` call (for `getMainRepoPath`) used `{ encoding: 'utf-8', cwd: '/mock/repos/ext-owner/ext-repo' }`.

- **Test: 'passes mainRepoPath to getDefaultBranch'**:
  - Call `freeBranchFromMainRepo('feature/issue-51')` with appropriate mocks.
  - Verify that the `getDefaultBranch` mock was called with the resolved `mainRepoPath` value (not `undefined`).

### Step 8: Run validation commands

- Run all validation commands listed below to ensure the bug is fixed with zero regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `npx tsc --noEmit` — Type check the main project
- `npx tsc --noEmit -p adws/tsconfig.json` — Type check the ADW scripts
- `npm run lint` — Run linter to check for code quality issues
- `npm test` — Run all tests to validate the fix with zero regressions
- `npm run build` — Build the application to verify no build errors

## Notes
- This bug is a continuation of issue #52. The #52 fix addressed only the issue classifier; this fix addresses the worktree layer which was identified as "insufficiently addressed."
- The fix leverages the existing `TargetRepoRegistry` pattern, consistent with how `issueApi.ts` and `prApi.ts` resolve repo context via `getTargetRepo()` as a fallback. This ensures worktree functions are registry-aware without requiring all callers to thread `cwd` manually.
- Both functions accept an optional `cwd?: string` override parameter (following the `repoInfo?: RepoInfo` pattern in `issueApi`/`prApi`), with fallback to the `TargetRepoRegistry` when no explicit `cwd` is provided. When the registry is not set (local ADW repo), the functions fall back to `undefined` (i.e., `process.cwd()`).
- `createWorktree` still passes `baseRepoPath` explicitly for safety and clarity — this is belt-and-suspenders since the registry would also resolve correctly, but explicit is better than implicit.
- `copyEnvToWorktree` (called from `ensureWorktree`) also calls `getMainRepoPath()` without `cwd`, but this is a separate concern — it copies the ADW repo's `.env` to the worktree, which may actually be the desired behavior (ADW config should be available in all worktrees). Do not change this in this fix.
- `findWorktreeForIssue` and `worktreeExists` also run `git worktree list --porcelain` without `cwd`. These may also need updating for target repo support in the future, but are out of scope for this surgical fix.
- Strictly adhere to the coding guidelines in `guidelines/coding_guidelines.md`.
