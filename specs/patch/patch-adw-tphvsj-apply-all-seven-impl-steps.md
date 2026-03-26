# Patch: Apply all 7 spec implementation steps for git repo context threading

## Metadata
adwId: `tphvsj`
reviewChangeRequest: `Issue #2: None of the 7 spec implementation steps were performed. The core bug fix was not applied: copyEnvToWorktree still lacks baseRepoPath parameter, getRepoInfo still lacks cwd parameter, activateGitHubAppAuth still lacks cwd parameter, autoMergeHandler does not derive target repo workspace path, workflowInit does not thread targetRepoWorkspacePath to findWorktreeForIssue/copyEnvToWorktree, and no convertToSshUrl helper exists in targetRepoManager.ts.`

## Issue Summary
**Original Spec:** `specs/issue-317-adw-tphvsj-fix-ensure-all-git-o-sdlc_planner-fix-git-repo-context.md`
**Issue:** All 7 implementation steps from the spec are unimplemented. Every function signature change, caller threading, and helper addition described in the spec is missing from the codebase.
**Solution:** Execute each of the 7 spec steps in order: add `baseRepoPath` to `copyEnvToWorktree`, thread it through `ensureWorktree`, add `cwd` to `getRepoInfo`, add `cwd` to `activateGitHubAppAuth`, fix `autoMergeHandler` to derive target repo path, thread `targetRepoWorkspacePath` in `workflowInit`, and add `convertToSshUrl` to `targetRepoManager.ts`.

## Files to Modify

- `adws/vcs/worktreeOperations.ts` — Add `baseRepoPath?` param to `copyEnvToWorktree`, pass to `getMainRepoPath`
- `adws/vcs/worktreeCreation.ts` — Thread `baseRepoPath` to both `copyEnvToWorktree` calls in `ensureWorktree`
- `adws/github/githubApi.ts` — Add `cwd?` param to `getRepoInfo`, pass to `execSync`
- `adws/github/githubAppAuth.ts` — Add `cwd?` param to `activateGitHubAppAuth`, pass to git remote fallback `execSync`
- `adws/triggers/autoMergeHandler.ts` — Derive target repo workspace path from webhook payload, pass `baseRepoPath` to `ensureWorktree`
- `adws/phases/workflowInit.ts` — Thread `targetRepoWorkspacePath` to `findWorktreeForIssue` and all `copyEnvToWorktree` calls
- `adws/core/targetRepoManager.ts` — Add `convertToSshUrl` helper, use it in `cloneTargetRepo`

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add `baseRepoPath` to `copyEnvToWorktree` and thread through `ensureWorktree`
- In `adws/vcs/worktreeOperations.ts`: change `copyEnvToWorktree(worktreePath: string): void` to `copyEnvToWorktree(worktreePath: string, baseRepoPath?: string): void`
- Change `const mainRepoPath = getMainRepoPath();` to `const mainRepoPath = getMainRepoPath(baseRepoPath);`
- In `adws/vcs/worktreeCreation.ts`: change both `copyEnvToWorktree(existingPath)` and `copyEnvToWorktree(worktreePath)` calls inside `ensureWorktree` to pass `baseRepoPath` as second argument

### Step 2: Add `cwd` to `getRepoInfo` and `activateGitHubAppAuth`
- In `adws/github/githubApi.ts`: change `getRepoInfo(): RepoInfo` to `getRepoInfo(cwd?: string): RepoInfo`
- Change `execSync('git remote get-url origin', { encoding: 'utf-8' })` to `execSync('git remote get-url origin', { encoding: 'utf-8', cwd })`
- In `adws/github/githubAppAuth.ts`: change `activateGitHubAppAuth(owner?: string, repo?: string): boolean` to `activateGitHubAppAuth(owner?: string, repo?: string, cwd?: string): boolean`
- Change the git remote fallback `execSync` call to include `cwd`

### Step 3: Fix `autoMergeHandler` to derive and pass target repo workspace path
- Import `getTargetRepoWorkspacePath` from `'../core'` and `existsSync` from `'fs'`
- After the `adwId` assignment, derive `targetRepoWorkspacePath` using the pattern from `webhookHandlers.ts` lines 69-71:
  ```typescript
  const targetRepoWorkspacePath = (() => {
    const workspacePath = getTargetRepoWorkspacePath(repoInfo.owner, repoInfo.repo);
    return existsSync(workspacePath) ? workspacePath : undefined;
  })();
  ```
- Change `ensureWorktree(headBranch)` to `ensureWorktree(headBranch, undefined, targetRepoWorkspacePath)`

### Step 4: Thread `targetRepoWorkspacePath` in `workflowInit`
- Change `findWorktreeForIssue(issueType, issueNumber)` to `findWorktreeForIssue(issueType, issueNumber, targetRepoWorkspacePath)`
- Change every `copyEnvToWorktree(worktreePath)` and `copyEnvToWorktree(existingWorktree)` call to pass `targetRepoWorkspacePath` as second argument

### Step 5: Add `convertToSshUrl` helper to `targetRepoManager.ts`
- Add a pure function:
  ```typescript
  function convertToSshUrl(cloneUrl: string): string {
    const httpsMatch = cloneUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (httpsMatch) {
      return `git@github.com:${httpsMatch[1]}/${httpsMatch[2]}.git`;
    }
    return cloneUrl;
  }
  ```
- In `cloneTargetRepo`, convert the URL before the `git clone` execSync call: `const sshUrl = convertToSshUrl(cloneUrl);` and use `sshUrl` in the command

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bun run lint` — Linter passes
- `bunx tsc --noEmit` — Root TypeScript config type-checks
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW TypeScript config type-checks
- `bun run build` — Build succeeds
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317 and @regression"` — Issue-specific BDD scenarios pass

## Patch Scope
**Lines of code to change:** ~30
**Risk level:** low
**Testing required:** Type-check + lint + BDD scenarios tagged @adw-317
