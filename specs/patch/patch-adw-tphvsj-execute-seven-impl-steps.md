# Patch: Execute all 7 spec implementation steps for git repo context threading

## Metadata
adwId: `tphvsj-fix-ensure-all-git-o`
reviewChangeRequest: `Issue #1: Implementation completely missing: 0 of 7 spec steps were executed. No changes to worktreeOperations.ts, worktreeCreation.ts, githubApi.ts, githubAppAuth.ts, autoMergeHandler.ts, workflowInit.ts, or targetRepoManager.ts. The commit only created spec/feature files.`

## Issue Summary
**Original Spec:** specs/issue-317-adw-tphvsj-fix-ensure-all-git-o-sdlc_planner-fix-git-repo-context.md
**Issue:** The previous commit (`0cc7546`) only added spec/feature files but applied zero code changes. All 7 source files remain unmodified.
**Solution:** Apply all 7 implementation steps from the spec: thread `baseRepoPath`/`cwd` through `copyEnvToWorktree`, `ensureWorktree`, `getRepoInfo`, `activateGitHubAppAuth`, the auto-merge handler, `workflowInit.ts` callers, and add `convertToSshUrl` to `targetRepoManager.ts`.

## Files to Modify

- `adws/vcs/worktreeOperations.ts` — Add `baseRepoPath` param to `copyEnvToWorktree`
- `adws/vcs/worktreeCreation.ts` — Pass `baseRepoPath` to both `copyEnvToWorktree` calls in `ensureWorktree`
- `adws/github/githubApi.ts` — Add `cwd` param to `getRepoInfo`
- `adws/github/githubAppAuth.ts` — Add `cwd` param to `activateGitHubAppAuth` git remote fallback
- `adws/triggers/autoMergeHandler.ts` — Derive target repo workspace path, pass to `ensureWorktree`
- `adws/phases/workflowInit.ts` — Thread `targetRepoWorkspacePath` to `findWorktreeForIssue` and `copyEnvToWorktree`
- `adws/core/targetRepoManager.ts` — Add `convertToSshUrl` helper, use in `cloneTargetRepo`

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add `baseRepoPath` parameter to `copyEnvToWorktree()` in `worktreeOperations.ts`
- Read `adws/vcs/worktreeOperations.ts`
- Change function signature at line 81 from:
  ```typescript
  export function copyEnvToWorktree(worktreePath: string): void {
  ```
  to:
  ```typescript
  export function copyEnvToWorktree(worktreePath: string, baseRepoPath?: string): void {
  ```
- Update JSDoc above the function to include `@param baseRepoPath - Optional base repository path for resolving the source .env file`
- Change line 83 from `const mainRepoPath = getMainRepoPath();` to `const mainRepoPath = getMainRepoPath(baseRepoPath);`
- `getMainRepoPath(cwd?)` already accepts an optional `cwd` param (line 55), so this threads through correctly

### Step 2: Thread `baseRepoPath` through `ensureWorktree()` to `copyEnvToWorktree()` in `worktreeCreation.ts`
- Read `adws/vcs/worktreeCreation.ts`
- Line 203: change `copyEnvToWorktree(existingPath)` to `copyEnvToWorktree(existingPath, baseRepoPath)`
- Line 209: change `copyEnvToWorktree(worktreePath)` to `copyEnvToWorktree(worktreePath, baseRepoPath)`
- The `baseRepoPath` parameter is already in the `ensureWorktree` signature (line 198), so no signature change needed

### Step 3: Add `cwd` parameter to `getRepoInfo()` in `githubApi.ts`
- Read `adws/github/githubApi.ts`
- Change line 16 from `export function getRepoInfo(): RepoInfo {` to `export function getRepoInfo(cwd?: string): RepoInfo {`
- Update JSDoc to include `@param cwd - Optional working directory to read git remote from`
- Change line 18 from:
  ```typescript
  const remoteUrl = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim();
  ```
  to:
  ```typescript
  const remoteUrl = execSync('git remote get-url origin', { encoding: 'utf-8', cwd }).trim();
  ```

### Step 4: Add `cwd` parameter to `activateGitHubAppAuth()` git remote fallback in `githubAppAuth.ts`
- Read `adws/github/githubAppAuth.ts`
- Change line 172 from `export function activateGitHubAppAuth(owner?: string, repo?: string): boolean {` to `export function activateGitHubAppAuth(owner?: string, repo?: string, cwd?: string): boolean {`
- Update JSDoc to include `@param cwd - Optional working directory for resolving the git remote when owner/repo are not provided`
- Change line 180 from:
  ```typescript
  const remote = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim();
  ```
  to:
  ```typescript
  const remote = execSync('git remote get-url origin', { encoding: 'utf-8', cwd }).trim();
  ```

### Step 5: Fix auto-merge handler to pass target repo workspace path to `ensureWorktree()` in `autoMergeHandler.ts`
- Read `adws/triggers/autoMergeHandler.ts`
- Add import for `getTargetRepoWorkspacePath` from `'../core'` (append to existing core import at line 14)
- Add import for `existsSync` from `'fs'` (new import)
- After line 226 (after the log line `Auto-merge: head=...`), add:
  ```typescript
  // Derive target repo workspace path from webhook payload
  const targetRepoWorkspacePath = (() => {
    const workspacePath = getTargetRepoWorkspacePath(repoInfo.owner, repoInfo.repo);
    return existsSync(workspacePath) ? workspacePath : undefined;
  })();
  ```
- Change line 231 from `worktreePath = ensureWorktree(headBranch);` to `worktreePath = ensureWorktree(headBranch, undefined, targetRepoWorkspacePath);`
- Reference pattern: `adws/triggers/webhookHandlers.ts` lines 69-71

### Step 6: Thread `targetRepoWorkspacePath` through `workflowInit.ts` callers
- Read `adws/phases/workflowInit.ts`
- Line 181: change `findWorktreeForIssue(issueType, issueNumber)` to `findWorktreeForIssue(issueType, issueNumber, targetRepoWorkspacePath)`
- Line 186: change `copyEnvToWorktree(worktreePath)` to `copyEnvToWorktree(worktreePath, targetRepoWorkspacePath)`
- Line 201: change `copyEnvToWorktree(existingWorktree)` to `copyEnvToWorktree(existingWorktree, targetRepoWorkspacePath)`
- `targetRepoWorkspacePath` is already defined at line 148 and in scope for all three call sites

### Step 7: Add `convertToSshUrl` helper and use it in `cloneTargetRepo()` in `targetRepoManager.ts`
- Read `adws/core/targetRepoManager.ts`
- Add a pure helper function before `cloneTargetRepo` (before line 34):
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
- In `cloneTargetRepo`, convert the URL before cloning. Replace the function body to:
  ```typescript
  export function cloneTargetRepo(cloneUrl: string, workspacePath: string): void {
    const parentDir = path.dirname(workspacePath);
    fs.mkdirSync(parentDir, { recursive: true });

    const sshUrl = convertToSshUrl(cloneUrl);
    if (sshUrl !== cloneUrl) {
      log(`Converted clone URL to SSH: ${cloneUrl} -> ${sshUrl}`, 'info');
    }

    log(`Cloning ${sshUrl} into ${workspacePath}...`, 'info');
    execSync(`git clone "${sshUrl}" "${workspacePath}"`, {
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    log(`Cloned ${sshUrl} into ${workspacePath}`, 'success');
  }
  ```

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `bun run lint` — Verify no lint errors
2. `bunx tsc --noEmit` — Type-check root TypeScript config
3. `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check adws-specific config
4. `bun run build` — Verify build succeeds
5. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317 and @regression"` — Run issue-specific regression BDD scenarios
6. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run full regression suite to verify zero regressions

## Patch Scope
**Lines of code to change:** ~40
**Risk level:** low
**Testing required:** TypeScript type-check + lint + build + BDD regression scenarios for @adw-317 + full regression suite
