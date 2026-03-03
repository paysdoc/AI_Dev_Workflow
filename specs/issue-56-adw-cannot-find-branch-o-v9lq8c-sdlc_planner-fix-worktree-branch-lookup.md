# Bug: Worktree branch lookup fails for target repositories

## Metadata
issueNumber: `56`
adwId: `cannot-find-branch-o-v9lq8c`
issueJson: `{"number":56,"title":"Cannot find branch on target repository","body":"The PrReview workflow fails because it cannot create a worktree. The worktree exists on that repository, but cannot be found. Subsequently, an attempt to create that worktree fails.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-03T07:01:44Z","comments":[],"actionableComment":null}`

## Bug Description
The PR Review workflow (`adwPrReview.tsx`) fails when trying to find or create a worktree for a branch on a target repository. The worktree already exists in the target repository workspace, but the `getWorktreeForBranch` function cannot find it because it runs `git worktree list` in the wrong directory (the ADW repo instead of the target repo). When the lookup fails, `createWorktree` is called, which also runs git commands in the wrong directory, fails to find the branch, and throws: `"Branch 'bugfix-issue-43-fix-expo-command-not-found' does not exist and no base branch was provided"`.

**Expected behavior:** The PR Review workflow finds the existing worktree for the branch in the target repository and reuses it.

**Actual behavior:** The workflow looks for the worktree in the ADW repo (wrong directory), fails to find it, then fails to create a new one because the branch doesn't exist in the ADW repo either.

## Problem Statement
The four functions in `worktreeCreation.ts` (`getWorktreeForBranch`, `createWorktree`, `createWorktreeForNewBranch`, `ensureWorktree`) do not use `resolveTargetRepoCwd` to resolve the working directory for git commands. When operating on a target repository (set via `setTargetRepo(repoInfo)`), these functions run git commands in the default process CWD (the ADW repo) instead of the target repository workspace. This is inconsistent with `worktreeOperations.ts`, where `isBranchCheckedOutElsewhere`, `worktreeExists`, `freeBranchFromMainRepo`, and `findWorktreeForIssue` all correctly use `resolveTargetRepoCwd`.

## Solution Statement
Update all four functions in `worktreeCreation.ts` to resolve `baseRepoPath` using `resolveTargetRepoCwd(baseRepoPath)` at the start of each function, consistent with the pattern already established in `worktreeOperations.ts`. When no explicit `baseRepoPath` is passed and a target repo is set in the registry, `resolveTargetRepoCwd` will automatically resolve to the target repo workspace path. When no target repo is set, it returns `undefined`, preserving the existing behavior (falls back to process CWD).

## Steps to Reproduce
1. Set up ADW with a target repository (e.g., `npx tsx adws/adwPrReview.tsx 123 --owner paysdoc --repo SomeTargetRepo`)
2. Ensure a previous plan/build workflow has already created a worktree for the PR branch in the target repo workspace
3. Post a review comment on the PR to trigger the PR review workflow
4. Observe the error: `"Failed to create worktree for branch 'branchName': Error: Branch 'branchName' does not exist and no base branch was provided"`

## Root Cause Analysis
The call chain that triggers the bug:

1. `adwPrReview.tsx` calls `initializePRReviewWorkflow(prNumber, null, repoInfo)` (line 45)
2. `initializePRReviewWorkflow` calls `setTargetRepo(repoInfo)` (line 43 of `prReviewPhase.ts`), setting the target repo in the central registry
3. `initializePRReviewWorkflow` then calls `ensureWorktree(prDetails.headBranch)` (line 88 of `prReviewPhase.ts`) — **without passing `baseRepoPath`**
4. `ensureWorktree` calls `getWorktreeForBranch(branchName, baseRepoPath)` — `baseRepoPath` is `undefined`
5. `getWorktreeForBranch` runs `git worktree list --porcelain` with `cwd: undefined` (defaults to ADW repo CWD)
6. The worktree exists in the target repo workspace (e.g., `~/.adw/repos/owner/repo/.worktrees/branch-name`), but `git worktree list` in the ADW repo doesn't see it
7. `getWorktreeForBranch` returns `null`
8. `createWorktree` is called, which also runs `git rev-parse --verify` in the ADW repo CWD
9. The branch doesn't exist in the ADW repo, so `branchExists` = `false`
10. No `baseBranch` was provided, so the error is thrown

The root cause is that `worktreeCreation.ts` does not import or use `resolveTargetRepoCwd` from `targetRepoRegistry`, unlike `worktreeOperations.ts` which correctly uses it in all its functions. This inconsistency was introduced when the target repo registry pattern was added to other git operation files but missed in `worktreeCreation.ts`.

## Relevant Files
Use these files to fix the bug:

- `adws/github/worktreeCreation.ts` — Contains the four functions that need to be updated: `getWorktreeForBranch`, `createWorktree`, `createWorktreeForNewBranch`, `ensureWorktree`. This is the primary file to modify.
- `adws/core/targetRepoRegistry.ts` — Contains `resolveTargetRepoCwd` which needs to be imported in `worktreeCreation.ts`. Read-only reference.
- `adws/github/worktreeOperations.ts` — Contains the correct pattern for using `resolveTargetRepoCwd` (see `isBranchCheckedOutElsewhere`, `worktreeExists`, `findWorktreeForIssue`). Read-only reference.
- `adws/__tests__/worktreeOperations.test.ts` — Existing test file that tests worktree functions. Needs new test cases for target repo resolution in creation functions.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Update `worktreeCreation.ts` to import `resolveTargetRepoCwd`
- Add `import { resolveTargetRepoCwd } from '../core/targetRepoRegistry';` to the imports at the top of `adws/github/worktreeCreation.ts`.

### 2. Update `getWorktreeForBranch` to resolve `baseRepoPath`
- At the start of the `getWorktreeForBranch` function (inside the try block, before line 26), add: `const resolvedBaseRepoPath = resolveTargetRepoCwd(baseRepoPath);`
- Replace all uses of `baseRepoPath` in the function body with `resolvedBaseRepoPath`:
  - `execSync('git worktree list --porcelain', { encoding: 'utf-8', cwd: resolvedBaseRepoPath })`
  - `getWorktreePath(branchName, resolvedBaseRepoPath)`

### 3. Update `createWorktree` to resolve `baseRepoPath`
- At the start of the `createWorktree` function (after the empty string validation, before line 85), add: `const resolvedBaseRepoPath = resolveTargetRepoCwd(baseRepoPath);`
- Replace all uses of `baseRepoPath` in the function body with `resolvedBaseRepoPath`:
  - `getWorktreePath(branchName, resolvedBaseRepoPath)`
  - `getWorktreesDir(resolvedBaseRepoPath)`
  - `const gitOpts = resolvedBaseRepoPath ? { stdio: 'pipe' as const, cwd: resolvedBaseRepoPath } : { stdio: 'pipe' as const };`

### 4. Update `createWorktreeForNewBranch` to resolve `baseRepoPath`
- At the start of the `createWorktreeForNewBranch` function (after the empty string validation, before line 163), add: `const resolvedBaseRepoPath = resolveTargetRepoCwd(baseRepoPath);`
- Replace all uses of `baseRepoPath` in the function body with `resolvedBaseRepoPath`:
  - `getWorktreePath(branchName, resolvedBaseRepoPath)`
  - `getWorktreesDir(resolvedBaseRepoPath)`
  - `const gitOpts = resolvedBaseRepoPath ? { stdio: 'pipe' as const, cwd: resolvedBaseRepoPath } : { stdio: 'pipe' as const };`

### 5. Update `ensureWorktree` to resolve `baseRepoPath`
- At the start of the `ensureWorktree` function, add: `const resolvedBaseRepoPath = resolveTargetRepoCwd(baseRepoPath);`
- Replace all uses of `baseRepoPath` in the function body with `resolvedBaseRepoPath`:
  - `getWorktreeForBranch(branchName, resolvedBaseRepoPath)`
  - `createWorktree(branchName, baseBranch, resolvedBaseRepoPath)`

### 6. Add tests for target repo resolution in worktree creation functions
- In `adws/__tests__/worktreeOperations.test.ts`, add test cases to verify that `getWorktreeForBranch`, `createWorktree`, `createWorktreeForNewBranch`, and `ensureWorktree` call `resolveTargetRepoCwd` with the provided `baseRepoPath` argument.
- Add tests to verify that when `resolveTargetRepoCwd` returns a resolved path (simulating a target repo being set), the git commands run with the correct `cwd`.
- Follow the existing test pattern for target repo resolution, as seen in the `isBranchCheckedOutElsewhere` and `worktreeExists` test sections (which test `resolveTargetRepoCwd` integration).

### 7. Run validation commands to confirm the fix
- Execute all validation commands listed below to ensure the bug is fixed with zero regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `npm run lint` — Run linter to check for code quality issues
- `npx tsc --noEmit` — Type check the main project
- `npx tsc --noEmit -p adws/tsconfig.json` — Type check the ADW scripts
- `npm test` — Run all tests to validate the bug is fixed with zero regressions

## Notes
- The fix follows the established pattern in `worktreeOperations.ts` where `resolveTargetRepoCwd` is already used consistently. This ensures `worktreeCreation.ts` is aligned with the rest of the codebase.
- The `resolveTargetRepoCwd` function returns `undefined` when no target repo is set, which is equivalent to passing `undefined` for `baseRepoPath`. This means the fix is fully backward-compatible — existing non-target-repo workflows are unaffected.
- Strictly adhere to the coding guidelines in `guidelines/coding_guidelines.md`, particularly around type safety, immutability, and pure function patterns.
