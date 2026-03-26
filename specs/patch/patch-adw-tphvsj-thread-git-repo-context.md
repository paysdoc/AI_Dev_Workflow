# Patch: Thread git repo context through all 7 call sites

## Metadata
adwId: `tphvsj-fix-ensure-all-git-o`
reviewChangeRequest: `Issue #1: None of the 7 spec implementation steps were applied. copyEnvToWorktree still lacks baseRepoPath parameter, getRepoInfo still lacks cwd parameter, autoMergeHandler still calls ensureWorktree without baseRepoPath, targetRepoManager has no SSH URL conversion, and workflowInit.ts does not thread targetRepoWorkspacePath to VCS functions. The core bug described in issue #317 remains completely unfixed.`

## Issue Summary
**Original Spec:** specs/issue-317-adw-tphvsj-fix-ensure-all-git-o-sdlc_planner-fix-git-repo-context.md
**Issue:** All 7 source files remain unmodified — `copyEnvToWorktree`, `getRepoInfo`, `activateGitHubAppAuth`, `ensureWorktree`, `autoMergeHandler`, `workflowInit.ts`, and `targetRepoManager.ts` have no repo context threading. Git operations silently default to `process.cwd()` (the ADW repo) when targeting external repos.
**Solution:** Apply all 7 implementation steps from the spec exactly as specified. Each change adds an optional parameter or passes an existing variable — minimal, backward-compatible modifications.

## Files to Modify
Use these files to implement the patch:

- `adws/vcs/worktreeOperations.ts` — Add `baseRepoPath` param to `copyEnvToWorktree` (Step 1)
- `adws/vcs/worktreeCreation.ts` — Pass `baseRepoPath` to `copyEnvToWorktree` calls in `ensureWorktree` (Step 2)
- `adws/github/githubApi.ts` — Add `cwd` param to `getRepoInfo` (Step 3)
- `adws/github/githubAppAuth.ts` — Add `cwd` param to `activateGitHubAppAuth` git remote fallback (Step 4)
- `adws/triggers/autoMergeHandler.ts` — Derive target repo workspace path, pass to `ensureWorktree` (Step 5)
- `adws/phases/workflowInit.ts` — Thread `targetRepoWorkspacePath` to `findWorktreeForIssue` and `copyEnvToWorktree` (Step 6)
- `adws/core/targetRepoManager.ts` — Add `convertToSshUrl` helper, use in `cloneTargetRepo` (Step 7)

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add `baseRepoPath` parameter to `copyEnvToWorktree()` in `worktreeOperations.ts`
- Change function signature at line 81 from `copyEnvToWorktree(worktreePath: string): void` to `copyEnvToWorktree(worktreePath: string, baseRepoPath?: string): void`
- Add JSDoc `@param baseRepoPath - Optional base repository path for resolving the source .env file`
- Change line 83 from `const mainRepoPath = getMainRepoPath();` to `const mainRepoPath = getMainRepoPath(baseRepoPath);`
- `getMainRepoPath(cwd?)` already accepts the optional param at line 55, so this threads through correctly

### Step 2: Thread `baseRepoPath` through `ensureWorktree()` to `copyEnvToWorktree()` in `worktreeCreation.ts`
- Line 203: change `copyEnvToWorktree(existingPath)` to `copyEnvToWorktree(existingPath, baseRepoPath)`
- Line 209: change `copyEnvToWorktree(worktreePath)` to `copyEnvToWorktree(worktreePath, baseRepoPath)`
- No signature change needed — `ensureWorktree` already has `baseRepoPath` in its signature at line 198

### Step 3: Add `cwd` parameter to `getRepoInfo()` in `githubApi.ts`
- Change line 16 from `getRepoInfo(): RepoInfo` to `getRepoInfo(cwd?: string): RepoInfo`
- Add JSDoc `@param cwd - Optional working directory to read git remote from`
- Change line 18 — add `cwd` to the execSync options: `execSync('git remote get-url origin', { encoding: 'utf-8', cwd })`

### Step 4: Add `cwd` parameter to `activateGitHubAppAuth()` git remote fallback in `githubAppAuth.ts`
- Change line 172 from `activateGitHubAppAuth(owner?: string, repo?: string)` to `activateGitHubAppAuth(owner?: string, repo?: string, cwd?: string)`
- Add JSDoc `@param cwd - Optional working directory for resolving the git remote when owner/repo are not provided`
- Change line 180 — add `cwd` to the execSync options: `execSync('git remote get-url origin', { encoding: 'utf-8', cwd })`

### Step 5: Fix auto-merge handler to derive target repo workspace path and pass to `ensureWorktree()` in `autoMergeHandler.ts`
- Add import for `getTargetRepoWorkspacePath` from `'../core'` (append to existing core import at line 14)
- Add import for `existsSync` from `'fs'` (new import line)
- After line 226 (after the log line), add:
  ```typescript
  // Derive target repo workspace path from webhook payload
  const targetRepoWorkspacePath = (() => {
    const workspacePath = getTargetRepoWorkspacePath(repoInfo.owner, repoInfo.repo);
    return existsSync(workspacePath) ? workspacePath : undefined;
  })();
  ```
- Change line 231 from `ensureWorktree(headBranch)` to `ensureWorktree(headBranch, undefined, targetRepoWorkspacePath)`
- Reference pattern: `webhookHandlers.ts` lines 69-71, `prReviewPhase.ts` line 99

### Step 6: Thread `targetRepoWorkspacePath` through `workflowInit.ts` callers
- Line 181: change `findWorktreeForIssue(issueType, issueNumber)` to `findWorktreeForIssue(issueType, issueNumber, targetRepoWorkspacePath)`
- Line 186: change `copyEnvToWorktree(worktreePath)` to `copyEnvToWorktree(worktreePath, targetRepoWorkspacePath)`
- Line 201: change `copyEnvToWorktree(existingWorktree)` to `copyEnvToWorktree(existingWorktree, targetRepoWorkspacePath)`
- `targetRepoWorkspacePath` is already defined at line 148 and in scope for all three sites

### Step 7: Convert HTTPS clone URLs to SSH in `targetRepoManager.ts`
- Add a pure helper function `convertToSshUrl(cloneUrl: string): string` before `cloneTargetRepo`:
  - Matches HTTPS GitHub URLs: `https://github.com/{owner}/{repo}` (with optional `.git`)
  - Converts to SSH format: `git@github.com:{owner}/{repo}.git`
  - Returns non-HTTPS URLs unchanged
- In `cloneTargetRepo`, call `convertToSshUrl(cloneUrl)` before the `git clone` and log when conversion happens
- Use the SSH URL in the `execSync` call and log messages

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `bun run lint` — Verify no lint errors
2. `bunx tsc --noEmit` — Type-check root TypeScript config
3. `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check adws-specific config
4. `bun run build` — Verify build succeeds
5. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317 and @regression"` — Run issue-specific regression BDD scenarios

## Patch Scope
**Lines of code to change:** ~40
**Risk level:** low
**Testing required:** TypeScript type-check + lint + build + BDD regression scenarios for @adw-317
