# Patch: Implement all 8 spec steps for git repo context threading

## Metadata
adwId: `tphvsj-fix-ensure-all-git-o`
reviewChangeRequest: `specs/issue-317-adw-tphvsj-fix-ensure-all-git-o-sdlc_planner-fix-git-repo-context.md`

## Issue Summary
**Original Spec:** `specs/issue-317-adw-tphvsj-fix-ensure-all-git-o-sdlc_planner-fix-git-repo-context.md`
**Issue:** Commit `0cc7546` only added spec/feature/README files. All 7 affected source files (`worktreeOperations.ts`, `worktreeCreation.ts`, `githubApi.ts`, `githubAppAuth.ts`, `autoMergeHandler.ts`, `workflowInit.ts`, `targetRepoManager.ts`) remain unchanged. The 8 implementation steps from the spec were never executed.
**Solution:** Apply all 8 steps from the spec verbatim: add `baseRepoPath` to `copyEnvToWorktree`, thread it through `ensureWorktree`, add `cwd` to `getRepoInfo` and `activateGitHubAppAuth`, fix auto-merge handler to derive target repo path, thread `targetRepoWorkspacePath` through `workflowInit.ts`, convert HTTPS clone URLs to SSH in `targetRepoManager.ts`, and run validation.

## Files to Modify
Use these files to implement the patch:

- `adws/vcs/worktreeOperations.ts` — Add `baseRepoPath` param to `copyEnvToWorktree` (Step 1)
- `adws/vcs/worktreeCreation.ts` — Pass `baseRepoPath` to `copyEnvToWorktree` calls in `ensureWorktree` (Step 2)
- `adws/github/githubApi.ts` — Add `cwd` param to `getRepoInfo` (Step 3)
- `adws/github/githubAppAuth.ts` — Add `cwd` param to `activateGitHubAppAuth` git remote fallback (Step 4)
- `adws/triggers/autoMergeHandler.ts` — Derive target repo workspace path from webhook payload, pass `baseRepoPath` to `ensureWorktree` (Step 5)
- `adws/phases/workflowInit.ts` — Thread `targetRepoWorkspacePath` to `findWorktreeForIssue` and `copyEnvToWorktree` calls (Step 6)
- `adws/core/targetRepoManager.ts` — Add `convertToSshUrl` helper, use it in `cloneTargetRepo` (Step 7)

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add `baseRepoPath` parameter to `copyEnvToWorktree()` and thread `baseRepoPath` in `ensureWorktree()`
**File:** `adws/vcs/worktreeOperations.ts`
- Change the `copyEnvToWorktree` function signature at line 81 from:
  ```typescript
  export function copyEnvToWorktree(worktreePath: string): void {
  ```
  to:
  ```typescript
  export function copyEnvToWorktree(worktreePath: string, baseRepoPath?: string): void {
  ```
- Add `@param baseRepoPath` to the JSDoc comment above it
- Change line 83 from `const mainRepoPath = getMainRepoPath();` to `const mainRepoPath = getMainRepoPath(baseRepoPath);`

**File:** `adws/vcs/worktreeCreation.ts`
- At line 203, change `copyEnvToWorktree(existingPath)` to `copyEnvToWorktree(existingPath, baseRepoPath)`
- At line 209, change `copyEnvToWorktree(worktreePath)` to `copyEnvToWorktree(worktreePath, baseRepoPath)`

### Step 2: Add `cwd` parameter to `getRepoInfo()` and `activateGitHubAppAuth()`
**File:** `adws/github/githubApi.ts`
- Change line 16 signature from `getRepoInfo(): RepoInfo` to `getRepoInfo(cwd?: string): RepoInfo`
- Add `@param cwd` to the JSDoc
- Change line 18: add `cwd` to execSync options: `execSync('git remote get-url origin', { encoding: 'utf-8', cwd })`

**File:** `adws/github/githubAppAuth.ts`
- Change line 172 signature from `activateGitHubAppAuth(owner?: string, repo?: string): boolean` to `activateGitHubAppAuth(owner?: string, repo?: string, cwd?: string): boolean`
- Add `@param cwd` to the JSDoc
- Change line 180: add `cwd` to execSync options: `execSync('git remote get-url origin', { encoding: 'utf-8', cwd })`

### Step 3: Fix auto-merge handler to derive target repo workspace path
**File:** `adws/triggers/autoMergeHandler.ts`
- Add imports: `import { existsSync } from 'fs';` (new top-level import) and add `getTargetRepoWorkspacePath` to the `'../core'` import
- After line 226 (the `log(...)` call), add:
  ```typescript
  // Derive target repo workspace path from webhook payload
  const targetRepoWorkspacePath = (() => {
    const workspacePath = getTargetRepoWorkspacePath(repoInfo.owner, repoInfo.repo);
    return existsSync(workspacePath) ? workspacePath : undefined;
  })();
  ```
- Change line 231 from `worktreePath = ensureWorktree(headBranch);` to `worktreePath = ensureWorktree(headBranch, undefined, targetRepoWorkspacePath);`

### Step 4: Thread `targetRepoWorkspacePath` through `workflowInit.ts` callers
**File:** `adws/phases/workflowInit.ts`
- At line 181, change `findWorktreeForIssue(issueType, issueNumber)` to `findWorktreeForIssue(issueType, issueNumber, targetRepoWorkspacePath)`
- At line 186, change `copyEnvToWorktree(worktreePath)` to `copyEnvToWorktree(worktreePath, targetRepoWorkspacePath)`
- At line 201, change `copyEnvToWorktree(existingWorktree)` to `copyEnvToWorktree(existingWorktree, targetRepoWorkspacePath)`

### Step 5: Convert HTTPS clone URLs to SSH in `targetRepoManager.ts`
**File:** `adws/core/targetRepoManager.ts`
- Add a pure helper function before `cloneTargetRepo`:
  ```typescript
  /**
   * Converts a GitHub HTTPS clone URL to SSH format.
   * Non-HTTPS URLs (already SSH or other formats) are returned unchanged.
   */
  export function convertToSshUrl(cloneUrl: string): string {
    const httpsMatch = cloneUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/.]+)(\.git)?$/);
    if (!httpsMatch) return cloneUrl;
    return `git@github.com:${httpsMatch[1]}/${httpsMatch[2]}.git`;
  }
  ```
- In `cloneTargetRepo`, convert the URL before the `execSync` call:
  ```typescript
  const sshUrl = convertToSshUrl(cloneUrl);
  if (sshUrl !== cloneUrl) {
    log(`Converted clone URL to SSH: ${cloneUrl} -> ${sshUrl}`, 'info');
  }
  ```
- Use `sshUrl` in the `git clone` command and success log message

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `bun run lint` — Verify no lint errors
2. `bunx tsc --noEmit` — Type-check root TypeScript config
3. `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check adws-specific config
4. `bun run build` — Verify build succeeds
5. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317 and @regression"` — Run issue-specific regression BDD scenarios
6. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run full regression suite

## Patch Scope
**Lines of code to change:** ~40
**Risk level:** low
**Testing required:** TypeScript type-check + BDD regression scenarios for @adw-317 + full regression suite
