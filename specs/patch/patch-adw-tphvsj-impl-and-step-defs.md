# Patch: Implement all 7 source changes and BDD step definitions for issue #317

## Metadata
adwId: `tphvsj-fix-ensure-all-git-o`
reviewChangeRequest: `specs/issue-317-adw-tphvsj-fix-ensure-all-git-o-sdlc_planner-fix-git-repo-context.md`

## Issue Summary
**Original Spec:** `specs/issue-317-adw-tphvsj-fix-ensure-all-git-o-sdlc_planner-fix-git-repo-context.md`
**Issue:** All 7 source files from the spec are unmodified — the build agent only produced planning artifacts (spec, feature file, patch specs) without executing any implementation steps. All `@adw-317` BDD scenarios fail because (a) source code was never changed and (b) step definitions are missing.
**Solution:** Apply all 7 source code changes from the spec directly to the source files, then create a step definition file for the `fix_git_repo_context.feature` scenarios. Each source change is a small, backward-compatible parameter addition.

## Files to Modify
Use these files to implement the patch:

### Source code changes (7 files)
- `adws/vcs/worktreeOperations.ts` — Add `baseRepoPath?: string` to `copyEnvToWorktree()`, pass to `getMainRepoPath()`
- `adws/vcs/worktreeCreation.ts` — Pass `baseRepoPath` to both `copyEnvToWorktree()` calls in `ensureWorktree()`
- `adws/github/githubApi.ts` — Add `cwd?: string` to `getRepoInfo()`, pass to `execSync`
- `adws/github/githubAppAuth.ts` — Add `cwd?: string` to `activateGitHubAppAuth()`, pass to `execSync` in git remote fallback
- `adws/triggers/autoMergeHandler.ts` — Derive `targetRepoWorkspacePath` from webhook payload, pass to `ensureWorktree()`
- `adws/phases/workflowInit.ts` — Pass `targetRepoWorkspacePath` to `findWorktreeForIssue()` and both `copyEnvToWorktree()` calls
- `adws/core/targetRepoManager.ts` — Add `convertToSshUrl()` helper, use in `cloneTargetRepo()` before `git clone`

### Step definitions (1 new file)
- `features/step_definitions/fixGitRepoContextSteps.ts` — Step definitions for all scenarios in `features/fix_git_repo_context.feature`

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add `baseRepoPath` parameter to `copyEnvToWorktree()` (worktreeOperations.ts)
- Read `adws/vcs/worktreeOperations.ts`
- Change function signature at line 81 from `copyEnvToWorktree(worktreePath: string): void` to `copyEnvToWorktree(worktreePath: string, baseRepoPath?: string): void`
- Add JSDoc `@param baseRepoPath` — Optional base repo path for external target repos
- Change line 83 from `const mainRepoPath = getMainRepoPath();` to `const mainRepoPath = getMainRepoPath(baseRepoPath);`

### Step 2: Thread `baseRepoPath` through `ensureWorktree()` to `copyEnvToWorktree()` (worktreeCreation.ts)
- Read `adws/vcs/worktreeCreation.ts`
- At line 203, change `copyEnvToWorktree(existingPath)` to `copyEnvToWorktree(existingPath, baseRepoPath)`
- At line 209, change `copyEnvToWorktree(worktreePath)` to `copyEnvToWorktree(worktreePath, baseRepoPath)`

### Step 3: Add `cwd` parameter to `getRepoInfo()` (githubApi.ts)
- Read `adws/github/githubApi.ts`
- Change function signature at line 16 from `getRepoInfo(): RepoInfo` to `getRepoInfo(cwd?: string): RepoInfo`
- Add JSDoc `@param cwd` — Optional working directory for the git remote command
- Change line 18 `execSync('git remote get-url origin', { encoding: 'utf-8' })` to `execSync('git remote get-url origin', { encoding: 'utf-8', cwd })`

### Step 4: Add `cwd` parameter to `activateGitHubAppAuth()` git remote fallback (githubAppAuth.ts)
- Read `adws/github/githubAppAuth.ts`
- Change function signature at line 172 from `activateGitHubAppAuth(owner?: string, repo?: string): boolean` to `activateGitHubAppAuth(owner?: string, repo?: string, cwd?: string): boolean`
- Add JSDoc `@param cwd` — Optional working directory for the git remote fallback
- At line 180, change `execSync('git remote get-url origin', { encoding: 'utf-8' })` to `execSync('git remote get-url origin', { encoding: 'utf-8', cwd })`

### Step 5: Fix auto-merge handler to pass `baseRepoPath` to `ensureWorktree()` (autoMergeHandler.ts)
- Read `adws/triggers/autoMergeHandler.ts`
- Add import: `import { existsSync } from 'fs';`
- Add `getTargetRepoWorkspacePath` to the existing `'../core'` import on line 14
- After line 226 (`log('Auto-merge: head=...')`), insert target repo workspace path derivation:
  ```typescript
  // Derive target repo workspace path from webhook payload
  const targetRepoWorkspacePath = (() => {
    const workspacePath = getTargetRepoWorkspacePath(repoInfo.owner, repoInfo.repo);
    return existsSync(workspacePath) ? workspacePath : undefined;
  })();
  ```
- Change line 231 from `worktreePath = ensureWorktree(headBranch);` to `worktreePath = ensureWorktree(headBranch, undefined, targetRepoWorkspacePath);`

### Step 6: Thread `targetRepoWorkspacePath` through `workflowInit.ts` callers
- Read `adws/phases/workflowInit.ts`
- At line 181, change `findWorktreeForIssue(issueType, issueNumber)` to `findWorktreeForIssue(issueType, issueNumber, targetRepoWorkspacePath)`
- At line 186, change `copyEnvToWorktree(worktreePath)` to `copyEnvToWorktree(worktreePath, targetRepoWorkspacePath)`
- At line 201, change `copyEnvToWorktree(existingWorktree)` to `copyEnvToWorktree(existingWorktree, targetRepoWorkspacePath)`

### Step 7: Convert HTTPS clone URLs to SSH in `targetRepoManager.ts`
- Read `adws/core/targetRepoManager.ts`
- Add exported pure helper function `convertToSshUrl(cloneUrl: string): string` before `cloneTargetRepo()`:
  - Match HTTPS GitHub URLs: `https://github.com/{owner}/{repo}` (with optional `.git` suffix)
  - Convert to SSH format: `git@github.com:{owner}/{repo}.git`
  - Return non-HTTPS URLs unchanged
- In `cloneTargetRepo()`, before the `execSync`, convert: `const sshUrl = convertToSshUrl(cloneUrl);`
- Use `sshUrl` in the git clone command and log when URL was converted

### Step 8: Create step definitions file `features/step_definitions/fixGitRepoContextSteps.ts`
- Create the file with step definitions for all scenarios in `features/fix_git_repo_context.feature`
- Import `{ Then, When, Given }` from `@cucumber/cucumber`, `assert` from `assert`, `{ sharedCtx }` from `./commonSteps`, `{ readFileSync }` from `fs`, `{ join }` from `path`, `{ spawnSync }` from `child_process`
- Define `const ROOT = process.cwd();`
- All source-inspection steps use `sharedCtx.fileContent` (populated by the `Given "{file}" is read` step from `commonSteps.ts`)

Implement these step definitions:

**copyEnvToWorktree scenarios (3 steps):**
1. `Then('the copyEnvToWorktree function signature accepts an optional baseRepoPath parameter', ...)` — assert content matches `copyEnvToWorktree(worktreePath: string, baseRepoPath?: string)`
2. `Then('copyEnvToWorktree passes baseRepoPath to getMainRepoPath when provided', ...)` — assert body contains `getMainRepoPath(baseRepoPath)`
3. `Then('copyEnvToWorktree can be called with only worktreePath and defaults to the ADW repo', ...)` — assert `baseRepoPath?` is optional

**getRepoInfo scenarios (3 steps):**
4. `Then('the getRepoInfo function signature accepts an optional cwd parameter', ...)` — assert content matches `getRepoInfo(cwd?: string)`
5. `Then('getRepoInfo passes the cwd option to execSync when cwd is provided', ...)` — assert execSync includes `cwd` in options
6. `Then('getRepoInfo called without cwd reads the remote URL from the current working directory', ...)` — assert `cwd?:` is optional

**githubAppAuth scenario (1 step):**
7. `Then('the git remote get-url fallback in activateGitHubAppAuth passes cwd to execSync when available', ...)` — assert execSync in git remote fallback includes `cwd`

**Auto-merge handler scenarios (3 steps):**
8. `Then('the auto-merge handler extracts owner and repo from the webhook payload repository field', ...)` — assert `getRepoInfoFromPayload` is called
9. `Then('the auto-merge handler derives the target repo workspace path before calling ensureWorktree', ...)` — assert `getTargetRepoWorkspacePath` appears before `ensureWorktree(`
10. `Then('ensureWorktree is called with baseRepoPath derived from the target repo workspace', ...)` — assert `ensureWorktree` call has 3 arguments

**worktreeCreation scenario (1 step):**
11. `Then('every call to copyEnvToWorktree inside ensureWorktree passes the baseRepoPath argument', ...)` — assert all `copyEnvToWorktree(` calls include `baseRepoPath`

**workflowInit scenarios (2 steps):**
12. `Then('findWorktreeForIssue is called with targetRepoWorkspacePath as the cwd parameter', ...)` — assert content contains `findWorktreeForIssue(issueType, issueNumber, targetRepoWorkspacePath)`
13. `Then('every call to copyEnvToWorktree in workflowInit passes the repo context when targetRepoWorkspacePath is available', ...)` — assert `copyEnvToWorktree` calls include `targetRepoWorkspacePath`

**targetRepoManager scenarios (3 steps):**
14. `Then('HTTPS clone URLs are converted to SSH format before cloning', ...)` — assert `convertToSshUrl` exists and is called in `cloneTargetRepo`
15. `Then('the SSH URL conversion transforms {string} to {string}', ...)` — dynamically import and test `convertToSshUrl`
16. `Then('clone URLs already in SSH format are passed through unchanged', ...)` — dynamically import and test passthrough

**Cross-file assertion (1 step):**
17. `Then('every git execSync call in repo-specific functions accepts a cwd parameter', ...)` — read 3 files, assert `execSync` calls include `cwd`

**TypeScript integrity scenario (1 When + 1 Then):**
18. `When('{string} and {string} are run', ...)` — execute both commands via `spawnSync`, store results
19. `Then('both type-check commands exit with code 0', ...)` — assert both have `status === 0`

**E2E: external target repo worktree (6 steps — context-only preconditions + source inspection):**
20-25. Given/When/Then steps for the external target repo worktree scenario — verify `ensureWorktree` signature includes `baseRepoPath` and `copyEnvToWorktree` receives it

**E2E: auto-merge for external repo PR (5 steps):**
26-30. Given/When/Then steps for the auto-merge external repo scenario — verify `getTargetRepoWorkspacePath` + `ensureWorktree` with `baseRepoPath`

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type-check root TypeScript config
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check adws-specific TypeScript config
- `bun run build` — Build the application to verify no build errors
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --dry-run --tags "@adw-317"` — Dry-run to verify 0 undefined steps
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317 and @regression"` — Run issue-specific regression BDD scenarios
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run full regression suite

## Patch Scope
**Lines of code to change:** ~300 (7 source file edits ~50 lines + 1 new step definition file ~250 lines)
**Risk level:** medium
**Testing required:** TypeScript type-check (root + adws), lint, build, cucumber dry-run, all `@adw-317` BDD scenarios, full `@regression` suite
