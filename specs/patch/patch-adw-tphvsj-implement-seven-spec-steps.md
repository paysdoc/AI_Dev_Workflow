# Patch: Implement all 7 spec steps for git repo context threading

## Metadata
adwId: `tphvsj`
reviewChangeRequest: `specs/issue-317-adw-tphvsj-fix-ensure-all-git-o-sdlc_planner-fix-git-repo-context.md`

## Issue Summary
**Original Spec:** specs/issue-317-adw-tphvsj-fix-ensure-all-git-o-sdlc_planner-fix-git-repo-context.md
**Issue:** None of the 7 implementation steps from the spec were executed. The source files (`worktreeOperations.ts`, `worktreeCreation.ts`, `githubApi.ts`, `githubAppAuth.ts`, `autoMergeHandler.ts`, `workflowInit.ts`, `targetRepoManager.ts`) remain unmodified.
**Solution:** Execute all 7 implementation steps exactly as specified: add `baseRepoPath` to `copyEnvToWorktree`, thread it through `ensureWorktree`, add `cwd` to `getRepoInfo`, add `cwd` to `activateGitHubAppAuth`, fix auto-merge handler target repo derivation, thread `targetRepoWorkspacePath` in `workflowInit.ts`, and add `convertToSshUrl` in `targetRepoManager.ts`.

## Files to Modify

- `adws/vcs/worktreeOperations.ts` — Add `baseRepoPath?` parameter to `copyEnvToWorktree()` and pass it to `getMainRepoPath()`
- `adws/vcs/worktreeCreation.ts` — Pass `baseRepoPath` to both `copyEnvToWorktree()` calls in `ensureWorktree()`
- `adws/github/githubApi.ts` — Add `cwd?` parameter to `getRepoInfo()` and pass it to `execSync`
- `adws/github/githubAppAuth.ts` — Add `cwd?` parameter to `activateGitHubAppAuth()` and pass it to git remote fallback
- `adws/triggers/autoMergeHandler.ts` — Derive target repo workspace path and pass `baseRepoPath` to `ensureWorktree()`
- `adws/phases/workflowInit.ts` — Thread `targetRepoWorkspacePath` to `findWorktreeForIssue()`, `copyEnvToWorktree()` calls
- `adws/core/targetRepoManager.ts` — Add `convertToSshUrl()` helper and use it in `cloneTargetRepo()`

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add `baseRepoPath` to `copyEnvToWorktree()` in `worktreeOperations.ts`
- Change the signature from `copyEnvToWorktree(worktreePath: string): void` to `copyEnvToWorktree(worktreePath: string, baseRepoPath?: string): void`
- Update the JSDoc `@param` to document `baseRepoPath`
- Change line 83 from `const mainRepoPath = getMainRepoPath();` to `const mainRepoPath = getMainRepoPath(baseRepoPath);`

### Step 2: Thread `baseRepoPath` through `ensureWorktree()` in `worktreeCreation.ts`
- At line 203, change `copyEnvToWorktree(existingPath)` to `copyEnvToWorktree(existingPath, baseRepoPath)`
- At line 209, change `copyEnvToWorktree(worktreePath)` to `copyEnvToWorktree(worktreePath, baseRepoPath)`

### Step 3: Add `cwd` to `getRepoInfo()` in `githubApi.ts`
- Change the signature from `getRepoInfo(): RepoInfo` to `getRepoInfo(cwd?: string): RepoInfo`
- Update JSDoc to document `cwd`
- Change the `execSync` call to pass `cwd`: `execSync('git remote get-url origin', { encoding: 'utf-8', cwd })`

### Step 4: Add `cwd` to `activateGitHubAppAuth()` git remote fallback in `githubAppAuth.ts`
- Change the signature from `activateGitHubAppAuth(owner?: string, repo?: string): boolean` to `activateGitHubAppAuth(owner?: string, repo?: string, cwd?: string): boolean`
- Update JSDoc to document `cwd`
- At line 180, change the `execSync` to pass `cwd`: `execSync('git remote get-url origin', { encoding: 'utf-8', cwd })`

### Step 5: Fix auto-merge handler in `autoMergeHandler.ts`
- Import `getTargetRepoWorkspacePath` from `'../core'` and `existsSync` from `'fs'`
- After the `adwId`/`logsDir` setup (line 224), derive target repo workspace path:
  ```typescript
  const targetRepoWorkspacePath = (() => {
    const workspacePath = getTargetRepoWorkspacePath(repoInfo.owner, repoInfo.repo);
    return existsSync(workspacePath) ? workspacePath : undefined;
  })();
  ```
- Change `ensureWorktree(headBranch)` at line 231 to `ensureWorktree(headBranch, undefined, targetRepoWorkspacePath)`

### Step 6: Thread `targetRepoWorkspacePath` in `workflowInit.ts`
- At line 181, change `findWorktreeForIssue(issueType, issueNumber)` to `findWorktreeForIssue(issueType, issueNumber, targetRepoWorkspacePath)`
- At line 186, change `copyEnvToWorktree(worktreePath)` to `copyEnvToWorktree(worktreePath, targetRepoWorkspacePath)`
- At line 201, change `copyEnvToWorktree(existingWorktree)` to `copyEnvToWorktree(existingWorktree, targetRepoWorkspacePath)`

### Step 7: Add `convertToSshUrl()` in `targetRepoManager.ts`
- Add a pure helper function before `cloneTargetRepo()`:
  ```typescript
  /**
   * Converts an HTTPS GitHub URL to SSH format for non-interactive contexts.
   * Returns non-HTTPS URLs unchanged.
   */
  export function convertToSshUrl(cloneUrl: string): string {
    const httpsMatch = cloneUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/.]+)(\.git)?$/);
    if (!httpsMatch) return cloneUrl;
    return `git@github.com:${httpsMatch[1]}/${httpsMatch[2]}.git`;
  }
  ```
- In `cloneTargetRepo()`, convert the URL before cloning: `const sshUrl = convertToSshUrl(cloneUrl);`
- Use `sshUrl` in the `git clone` command and log messages

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type-check root TypeScript config
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check adws-specific TypeScript config
- `bun run build` — Build the application to verify no build errors
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317 and @regression"` — Run issue-specific regression BDD scenarios

## Patch Scope
**Lines of code to change:** ~35
**Risk level:** low
**Testing required:** Type checking (tsc), lint, BDD regression scenarios tagged @adw-317. All parameter additions are optional (`?`) — full backward compatibility preserved.
