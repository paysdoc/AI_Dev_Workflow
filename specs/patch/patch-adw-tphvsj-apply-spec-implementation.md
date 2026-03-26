# Patch: Apply all 7 spec implementation steps for git repo context fix

## Metadata
adwId: `tphvsj-fix-ensure-all-git-o`
reviewChangeRequest: `specs/issue-317-adw-tphvsj-fix-ensure-all-git-o-sdlc_planner-fix-git-repo-context.md`

## Issue Summary
**Original Spec:** `specs/issue-317-adw-tphvsj-fix-ensure-all-git-o-sdlc_planner-fix-git-repo-context.md`
**Issue:** The previous commit (`0cc7546`) only added the spec and BDD feature files, but none of the 7 implementation steps from the spec were applied. All source files remain unchanged.
**Solution:** Apply spec Steps 1-7 exactly as specified: add `baseRepoPath` to `copyEnvToWorktree`, thread it through `ensureWorktree`, add `cwd` to `getRepoInfo` and `activateGitHubAppAuth`, fix `autoMergeHandler` to derive workspace path, thread repo context in `workflowInit`, and add `convertToSshUrl` to `targetRepoManager`.

## Files to Modify

- `adws/vcs/worktreeOperations.ts` — Add `baseRepoPath` param to `copyEnvToWorktree` (Step 1)
- `adws/vcs/worktreeCreation.ts` — Thread `baseRepoPath` to `copyEnvToWorktree` calls in `ensureWorktree` (Step 2)
- `adws/github/githubApi.ts` — Add `cwd` param to `getRepoInfo` (Step 3)
- `adws/github/githubAppAuth.ts` — Add `cwd` param to `activateGitHubAppAuth` git remote fallback (Step 4)
- `adws/triggers/autoMergeHandler.ts` — Derive target repo workspace path, pass `baseRepoPath` to `ensureWorktree` (Step 5)
- `adws/phases/workflowInit.ts` — Thread `targetRepoWorkspacePath` to `findWorktreeForIssue` and `copyEnvToWorktree` calls (Step 6)
- `adws/core/targetRepoManager.ts` — Add `convertToSshUrl` helper, use it in `cloneTargetRepo` (Step 7)

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add `baseRepoPath` parameter to `copyEnvToWorktree()` in `worktreeOperations.ts`
- Change line 81 signature from `copyEnvToWorktree(worktreePath: string): void` to `copyEnvToWorktree(worktreePath: string, baseRepoPath?: string): void`
- Update JSDoc `@param` to document the new `baseRepoPath` parameter
- Change line 83 from `const mainRepoPath = getMainRepoPath();` to `const mainRepoPath = getMainRepoPath(baseRepoPath);`

### Step 2: Thread `baseRepoPath` through `ensureWorktree()` to `copyEnvToWorktree()` in `worktreeCreation.ts`
- Line 203: change `copyEnvToWorktree(existingPath)` to `copyEnvToWorktree(existingPath, baseRepoPath)`
- Line 209: change `copyEnvToWorktree(worktreePath)` to `copyEnvToWorktree(worktreePath, baseRepoPath)`

### Step 3: Add `cwd` parameter to `getRepoInfo()` in `githubApi.ts`
- Change line 16 signature from `getRepoInfo(): RepoInfo` to `getRepoInfo(cwd?: string): RepoInfo`
- Update JSDoc to document the new `cwd` parameter
- Change line 18: add `cwd` to the `execSync` options: `execSync('git remote get-url origin', { encoding: 'utf-8', cwd })`

### Step 4: Add `cwd` parameter to `activateGitHubAppAuth()` git remote fallback in `githubAppAuth.ts`
- Change line 172 signature from `activateGitHubAppAuth(owner?: string, repo?: string): boolean` to `activateGitHubAppAuth(owner?: string, repo?: string, cwd?: string): boolean`
- Update JSDoc to document the new `cwd` parameter
- Change line 180: add `cwd` to the `execSync` options: `execSync('git remote get-url origin', { encoding: 'utf-8', cwd })`

### Step 5: Fix auto-merge handler to derive target repo workspace path and pass `baseRepoPath` to `ensureWorktree()` in `autoMergeHandler.ts`
- Add imports: `getTargetRepoWorkspacePath` from `'../core'` and `existsSync` from `'fs'` (note: `fs` is already imported but only `path`; need to add `existsSync` import)
- After line 226 (`log(...)`), derive `targetRepoWorkspacePath` using the pattern from `webhookHandlers.ts` lines 69-71:
  ```typescript
  const targetRepoWorkspacePath = (() => {
    const workspacePath = getTargetRepoWorkspacePath(repoInfo.owner, repoInfo.repo);
    return existsSync(workspacePath) ? workspacePath : undefined;
  })();
  ```
- Change line 231 from `worktreePath = ensureWorktree(headBranch);` to `worktreePath = ensureWorktree(headBranch, undefined, targetRepoWorkspacePath);`

### Step 6: Thread `targetRepoWorkspacePath` through `workflowInit.ts` callers
- Line 181: change `findWorktreeForIssue(issueType, issueNumber)` to `findWorktreeForIssue(issueType, issueNumber, targetRepoWorkspacePath)`
- Line 186: change `copyEnvToWorktree(worktreePath)` to `copyEnvToWorktree(worktreePath, targetRepoWorkspacePath)`
- Line 201: change `copyEnvToWorktree(existingWorktree)` to `copyEnvToWorktree(existingWorktree, targetRepoWorkspacePath)`

### Step 7: Add `convertToSshUrl` helper and use it in `cloneTargetRepo()` in `targetRepoManager.ts`
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
- In `cloneTargetRepo`, before the `execSync` call, convert the URL:
  ```typescript
  const sshUrl = convertToSshUrl(cloneUrl);
  if (sshUrl !== cloneUrl) {
    log(`Converted clone URL to SSH: ${cloneUrl} -> ${sshUrl}`, 'info');
  }
  ```
- Use `sshUrl` in place of `cloneUrl` in the `git clone` command and success log

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `bun run lint` — Verify no lint errors
2. `bunx tsc --noEmit` — Type-check root TypeScript config
3. `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check adws-specific config
4. `bun run build` — Verify build succeeds
5. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317 and @regression"` — Run issue-specific regression BDD scenarios

## Patch Scope
**Lines of code to change:** ~35
**Risk level:** low
**Testing required:** TypeScript type-check + BDD regression scenarios for @adw-317
