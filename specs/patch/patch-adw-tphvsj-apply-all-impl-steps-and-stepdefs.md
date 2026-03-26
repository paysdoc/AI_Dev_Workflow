# Patch: Apply all 7 implementation steps and create BDD step definitions

## Metadata
adwId: `tphvsj-fix-ensure-all-git-o`
reviewChangeRequest: `Issue #1: No implementation source code changes exist on this branch. The spec defines 8 steps across 7 files (adding baseRepoPath to copyEnvToWorktree, cwd to getRepoInfo, cwd to activateGitHubAppAuth, target repo derivation in autoMergeHandler, repo context threading in workflowInit, and HTTPS-to-SSH conversion in targetRepoManager), but git diff origin/dev -- adws/ is empty. The entire implementation is missing. Resolution: Apply all 8 implementation steps from the spec file.`

## Issue Summary
**Original Spec:** specs/issue-317-adw-tphvsj-fix-ensure-all-git-o-sdlc_planner-fix-git-repo-context.md
**Issue:** Zero source code changes exist on the branch — all 7 files remain unmodified. Additionally, no Cucumber step definitions exist for the 13 undefined `Then` steps in `features/fix_git_repo_context.feature`, so BDD validation cannot pass.
**Solution:** Apply all 7 implementation steps from the spec (minimal, backward-compatible parameter additions), then create step definitions that scan the modified source files to validate each change. All changes are additive optional parameters — no existing callers break.

## Files to Modify
Use these files to implement the patch:

- `adws/vcs/worktreeOperations.ts` — Add `baseRepoPath` param to `copyEnvToWorktree` (line 81)
- `adws/vcs/worktreeCreation.ts` — Pass `baseRepoPath` to `copyEnvToWorktree` calls (lines 203, 209)
- `adws/github/githubApi.ts` — Add `cwd` param to `getRepoInfo` (line 16), pass to `execSync` (line 18)
- `adws/github/githubAppAuth.ts` — Add `cwd` param to `activateGitHubAppAuth` (line 172), pass to `execSync` (line 180)
- `adws/triggers/autoMergeHandler.ts` — Import `getTargetRepoWorkspacePath` + `existsSync`, derive target workspace, pass to `ensureWorktree` (line 231)
- `adws/phases/workflowInit.ts` — Thread `targetRepoWorkspacePath` to `findWorktreeForIssue` (line 183), `copyEnvToWorktree` (lines 188, 203)
- `adws/core/targetRepoManager.ts` — Add `convertToSshUrl` helper, use in `cloneTargetRepo` (line 39)
- `features/step_definitions/fixGitRepoContextSteps.ts` — **New file**: step definitions for `@adw-317` BDD scenarios

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add `baseRepoPath` parameter to `copyEnvToWorktree()` in `worktreeOperations.ts`
- Change line 81 signature from `copyEnvToWorktree(worktreePath: string): void` to `copyEnvToWorktree(worktreePath: string, baseRepoPath?: string): void`
- Add `@param baseRepoPath` to the JSDoc block (lines 75-80)
- Change line 83 from `const mainRepoPath = getMainRepoPath();` to `const mainRepoPath = getMainRepoPath(baseRepoPath);`
- `getMainRepoPath(cwd?)` at line 55 already accepts the optional param

### Step 2: Thread `baseRepoPath` through `ensureWorktree()` to `copyEnvToWorktree()` in `worktreeCreation.ts`
- Line 203: change `copyEnvToWorktree(existingPath)` to `copyEnvToWorktree(existingPath, baseRepoPath)`
- Line 209: change `copyEnvToWorktree(worktreePath)` to `copyEnvToWorktree(worktreePath, baseRepoPath)`
- No signature change needed — `ensureWorktree` already has `baseRepoPath` at line 198

### Step 3: Add `cwd` parameter to `getRepoInfo()` in `githubApi.ts`
- Change line 16 from `getRepoInfo(): RepoInfo` to `getRepoInfo(cwd?: string): RepoInfo`
- Add `@param cwd` to the JSDoc block (lines 12-15)
- Change line 18: add `cwd` to execSync options — `execSync('git remote get-url origin', { encoding: 'utf-8', cwd })`

### Step 4: Add `cwd` parameter to `activateGitHubAppAuth()` git remote fallback in `githubAppAuth.ts`
- Change line 172 from `activateGitHubAppAuth(owner?: string, repo?: string)` to `activateGitHubAppAuth(owner?: string, repo?: string, cwd?: string)`
- Add `@param cwd` to the JSDoc block
- Change line 180: add `cwd` to execSync options — `execSync('git remote get-url origin', { encoding: 'utf-8', cwd })`

### Step 5: Fix auto-merge handler to derive target repo workspace path in `autoMergeHandler.ts`
- Add `getTargetRepoWorkspacePath` to the import from `'../core'` (line 14)
- Add `import { existsSync } from 'fs';` as a new import
- After line 226 (after the log line), insert:
  ```typescript
  // Derive target repo workspace path from webhook payload
  const targetRepoWorkspacePath = (() => {
    const workspacePath = getTargetRepoWorkspacePath(repoInfo.owner, repoInfo.repo);
    return existsSync(workspacePath) ? workspacePath : undefined;
  })();
  ```
- Change line 231 from `ensureWorktree(headBranch)` to `ensureWorktree(headBranch, undefined, targetRepoWorkspacePath)`
- Reference: `webhookHandlers.ts` lines 69-70, `prReviewPhase.ts` line 99

### Step 6: Thread `targetRepoWorkspacePath` through `workflowInit.ts` callers
- Line 183: change `findWorktreeForIssue(issueType, issueNumber)` to `findWorktreeForIssue(issueType, issueNumber, targetRepoWorkspacePath)`
- Line 188: change `copyEnvToWorktree(worktreePath)` to `copyEnvToWorktree(worktreePath, targetRepoWorkspacePath)`
- Line 203: change `copyEnvToWorktree(existingWorktree)` to `copyEnvToWorktree(existingWorktree, targetRepoWorkspacePath)`
- `targetRepoWorkspacePath` is already defined at line 153 and in scope

### Step 7: Convert HTTPS clone URLs to SSH in `targetRepoManager.ts`
- Add a pure helper `convertToSshUrl(cloneUrl: string): string` before `cloneTargetRepo` (before line 31):
  - Match HTTPS GitHub URLs: `https://github.com/{owner}/{repo}` (optional `.git` suffix)
  - Convert to SSH: `git@github.com:{owner}/{repo}.git`
  - Return non-HTTPS URLs unchanged
- In `cloneTargetRepo`, before line 39, convert: `const sshUrl = convertToSshUrl(cloneUrl);`
- Use `sshUrl` in the `execSync` call and log messages
- Log when conversion occurs for operator visibility

### Step 8: Create BDD step definitions for `@adw-317` scenarios
- Create `features/step_definitions/fixGitRepoContextSteps.ts`
- The `Given` steps (`the ADW codebase is checked out`, `{string} is read`) are already handled by `commonSteps.ts`
- Implement 13 `Then` steps that scan the source file content stored in `this[filePath]` (set by `commonSteps.ts`):
  1. `the copyEnvToWorktree function signature accepts an optional baseRepoPath parameter` — assert `worktreePath: string, baseRepoPath?: string` in signature
  2. `copyEnvToWorktree passes baseRepoPath to getMainRepoPath when provided` — assert `getMainRepoPath(baseRepoPath)` call
  3. `copyEnvToWorktree can be called with only worktreePath and defaults to the ADW repo` — assert `baseRepoPath?` (optional)
  4. `the getRepoInfo function signature accepts an optional cwd parameter` — assert `getRepoInfo(cwd?: string)` in signature
  5. `getRepoInfo passes the cwd option to execSync when cwd is provided` — assert `{ encoding: 'utf-8', cwd }` or similar in execSync options
  6. `the git remote get-url fallback in activateGitHubAppAuth passes cwd to execSync when available` — assert `cwd` in execSync options
  7. `the auto-merge handler extracts owner and repo from the webhook payload repository field` — assert `repoInfo.owner` and `repoInfo.repo` usage with `getTargetRepoWorkspacePath`
  8. `the auto-merge handler derives the target repo workspace path before calling ensureWorktree` — assert `getTargetRepoWorkspacePath` call before `ensureWorktree`
  9. `ensureWorktree is called with baseRepoPath derived from the target repo workspace` — assert `ensureWorktree(headBranch, undefined, targetRepoWorkspacePath)`
  10. `every call to copyEnvToWorktree inside ensureWorktree passes the baseRepoPath argument` — assert both `copyEnvToWorktree` calls include `baseRepoPath`
  11. `findWorktreeForIssue is called with targetRepoWorkspacePath as the cwd parameter` — assert third argument in call
  12. `every call to copyEnvToWorktree in workflowInit passes the repo context when targetRepoWorkspacePath is available` — assert `targetRepoWorkspacePath` in calls
  13. `HTTPS clone URLs are converted to SSH format before cloning` — assert `convertToSshUrl` call or SSH pattern
  14. `the SSH URL conversion transforms "https://github.com/owner/repo" to "git@github.com:owner/repo.git"` — assert regex/conversion logic
  15. `clone URLs already in SSH format are passed through unchanged` — assert passthrough logic
  16. `every git execSync call in repo-specific functions accepts a cwd parameter` — assert `cwd` in all relevant execSync calls across three files
  17. TypeScript type-check scenario (`bunx tsc --noEmit`) — uses `spawnSync` to run both tsc commands, assert exit code 0
- Follow the established pattern from other step definition files in `features/step_definitions/`

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `bun run lint` — Verify no lint errors
2. `bunx tsc --noEmit` — Type-check root TypeScript config
3. `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check adws-specific config
4. `bun run build` — Verify build succeeds
5. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317 and @regression" --dry-run` — Verify no undefined steps
6. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317 and @regression"` — Run issue-specific regression BDD scenarios
7. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run full regression suite to verify zero regressions

## Patch Scope
**Lines of code to change:** ~60 across 7 implementation files + ~150 for step definitions file
**Risk level:** low
**Testing required:** TypeScript type-check + lint + build + BDD regression scenarios for @adw-317 + full @regression suite
