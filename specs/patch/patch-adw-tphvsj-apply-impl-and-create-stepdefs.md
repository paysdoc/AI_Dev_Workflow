# Patch: Apply all 7 source implementation steps and create step definitions

## Metadata
adwId: `tphvsj-fix-ensure-all-git-o`
reviewChangeRequest: `Issue #1: No implementation source code changes were made. All 7 files listed in the spec are identical to origin/dev. Resolution: Execute all 8 implementation steps defined in the spec file.`

## Issue Summary
**Original Spec:** specs/issue-317-adw-tphvsj-fix-ensure-all-git-o-sdlc_planner-fix-git-repo-context.md
**Issue:** None of the 7 implementation steps from the spec were applied to source files. All source functions retain their original signatures without repo context parameters. Additionally, no step definitions exist for the 20 BDD scenarios in `features/fix_git_repo_context.feature`, causing all `@adw-317` tests to fail with "Undefined" steps.
**Solution:** Apply all 7 source code changes exactly as specified in the original spec, then create `features/step_definitions/fixGitRepoContextSteps.ts` implementing all 20 Then/When steps using the existing `sharedCtx` pattern from `commonSteps.ts`.

## Files to Modify
Use these files to implement the patch:

**Source implementation (7 files to edit):**
1. `adws/vcs/worktreeOperations.ts` — Add `baseRepoPath?: string` param to `copyEnvToWorktree()`, pass it to `getMainRepoPath()`
2. `adws/vcs/worktreeCreation.ts` — Pass `baseRepoPath` to both `copyEnvToWorktree()` calls in `ensureWorktree()`
3. `adws/github/githubApi.ts` — Add `cwd?: string` param to `getRepoInfo()`, pass it to `execSync`
4. `adws/github/githubAppAuth.ts` — Add `cwd?: string` param to `activateGitHubAppAuth()`, pass it to git remote fallback `execSync`
5. `adws/triggers/autoMergeHandler.ts` — Import `getTargetRepoWorkspacePath` and `existsSync`, derive `targetRepoWorkspacePath`, pass it to `ensureWorktree()`
6. `adws/phases/workflowInit.ts` — Thread `targetRepoWorkspacePath` to `findWorktreeForIssue()` (line 181) and both `copyEnvToWorktree()` calls (lines 186, 201)
7. `adws/core/targetRepoManager.ts` — Add `convertToSshUrl()` helper, use it in `cloneTargetRepo()`

**Step definitions (1 new file):**
8. `features/step_definitions/fixGitRepoContextSteps.ts` — All 20 Then/When steps for `fix_git_repo_context.feature`

**Reference files (read-only):**
- `adws/triggers/webhookHandlers.ts` lines 69-71 — Correct pattern for deriving target repo workspace path
- `adws/phases/prReviewPhase.ts` line 99 — Correct pattern for passing `baseRepoPath` to `ensureWorktree()`
- `features/step_definitions/commonSteps.ts` — `sharedCtx` pattern for step definitions
- `features/fix_git_repo_context.feature` — The 20 BDD scenarios (do not modify)

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add `baseRepoPath` parameter to `copyEnvToWorktree()` in `worktreeOperations.ts`
- Read `adws/vcs/worktreeOperations.ts`
- Change function signature from `copyEnvToWorktree(worktreePath: string): void` to `copyEnvToWorktree(worktreePath: string, baseRepoPath?: string): void`
- Update JSDoc: add `@param baseRepoPath - Optional base repo path for resolving the source .env (defaults to ADW repo)`
- Change `const mainRepoPath = getMainRepoPath();` to `const mainRepoPath = getMainRepoPath(baseRepoPath);`
- `getMainRepoPath(cwd?)` already accepts the optional parameter — no signature change needed there

### Step 2: Thread `baseRepoPath` through `ensureWorktree()` to `copyEnvToWorktree()` in `worktreeCreation.ts`
- Read `adws/vcs/worktreeCreation.ts`
- At the `copyEnvToWorktree(existingPath)` call (around line 203), change to `copyEnvToWorktree(existingPath, baseRepoPath)`
- At the `copyEnvToWorktree(worktreePath)` call (around line 209), change to `copyEnvToWorktree(worktreePath, baseRepoPath)`
- `ensureWorktree` already has `baseRepoPath?: string` as its third parameter — no signature change needed

### Step 3: Add `cwd` parameter to `getRepoInfo()` in `githubApi.ts`
- Read `adws/github/githubApi.ts`
- Change function signature from `getRepoInfo(): RepoInfo` to `getRepoInfo(cwd?: string): RepoInfo`
- Update JSDoc: add `@param cwd - Optional working directory for git commands (defaults to process.cwd())`
- Change `execSync('git remote get-url origin', { encoding: 'utf-8' })` to `execSync('git remote get-url origin', { encoding: 'utf-8', cwd })`

### Step 4: Add `cwd` parameter to `activateGitHubAppAuth()` in `githubAppAuth.ts`
- Read `adws/github/githubAppAuth.ts`
- Change function signature from `activateGitHubAppAuth(owner?: string, repo?: string): boolean` to `activateGitHubAppAuth(owner?: string, repo?: string, cwd?: string): boolean`
- Update JSDoc: add `@param cwd - Optional working directory for git remote resolution (defaults to process.cwd())`
- At the git remote fallback line, change `execSync('git remote get-url origin', { encoding: 'utf-8' })` to `execSync('git remote get-url origin', { encoding: 'utf-8', cwd })`

### Step 5: Fix auto-merge handler to derive `targetRepoWorkspacePath` and pass to `ensureWorktree()`
- Read `adws/triggers/autoMergeHandler.ts`
- Read `adws/triggers/webhookHandlers.ts` lines 69-71 for the correct pattern
- Add `getTargetRepoWorkspacePath` to the import from `'../core'`
- Add `import { existsSync } from 'fs';` at the top
- After the `log(\`Auto-merge: head=...\`)` line, add:
  ```typescript
  // Derive target repo workspace path from webhook payload
  const targetRepoWorkspacePath = (() => {
    const workspacePath = getTargetRepoWorkspacePath(repoInfo.owner, repoInfo.repo);
    return existsSync(workspacePath) ? workspacePath : undefined;
  })();
  ```
- Change `worktreePath = ensureWorktree(headBranch);` to `worktreePath = ensureWorktree(headBranch, undefined, targetRepoWorkspacePath);`
- The `repoInfo` variable is already available from the webhook payload extraction earlier in the function

### Step 6: Thread `targetRepoWorkspacePath` through `workflowInit.ts` callers
- Read `adws/phases/workflowInit.ts`
- Line 181: change `findWorktreeForIssue(issueType, issueNumber)` to `findWorktreeForIssue(issueType, issueNumber, targetRepoWorkspacePath)`
  - Defensive change: the `else` block only executes when there's no `targetRepoWorkspacePath` today, but threading prevents regressions if control flow changes
  - `findWorktreeForIssue` already accepts `cwd?: string` as its third parameter
- Line 186: change `copyEnvToWorktree(worktreePath)` to `copyEnvToWorktree(worktreePath, targetRepoWorkspacePath)`
- Line 201: change `copyEnvToWorktree(existingWorktree)` to `copyEnvToWorktree(existingWorktree, targetRepoWorkspacePath)`

### Step 7: Add `convertToSshUrl()` and use it in `cloneTargetRepo()` in `targetRepoManager.ts`
- Read `adws/core/targetRepoManager.ts`
- Add a pure helper function before `cloneTargetRepo()`:
  ```typescript
  /**
   * Converts HTTPS GitHub URLs to SSH format for non-interactive contexts.
   * Non-HTTPS URLs (already SSH or other formats) are returned unchanged.
   */
  export function convertToSshUrl(cloneUrl: string): string {
    const httpsMatch = cloneUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/.]+)(\.git)?$/);
    if (httpsMatch) {
      return `git@github.com:${httpsMatch[1]}/${httpsMatch[2]}.git`;
    }
    return cloneUrl;
  }
  ```
- In `cloneTargetRepo()`, before the `execSync` call, convert the URL:
  ```typescript
  const sshUrl = convertToSshUrl(cloneUrl);
  if (sshUrl !== cloneUrl) {
    log(`Converting HTTPS URL to SSH: ${cloneUrl} -> ${sshUrl}`, 'info');
  }
  ```
- Update the git clone command to use `sshUrl` instead of `cloneUrl`
- Update the log message to show `sshUrl`

### Step 8: Create step definitions file `features/step_definitions/fixGitRepoContextSteps.ts`
- Read `features/step_definitions/commonSteps.ts` to understand the `sharedCtx` pattern
- Read `features/fix_git_repo_context.feature` to get exact step text
- Create `features/step_definitions/fixGitRepoContextSteps.ts` implementing all 20 Then/When steps
- Use `sharedCtx.fileContent` (populated by the `Given "{file}" is read` step) and assert expected code patterns
- Each step reads `sharedCtx.fileContent` and asserts the expected source code pattern is present

**Step definitions to implement (20 steps across 10 sections):**

**Section 1 — copyEnvToWorktree (3 Then steps):**
- `the copyEnvToWorktree function signature accepts an optional baseRepoPath parameter` — assert signature contains `baseRepoPath?: string`
- `copyEnvToWorktree passes baseRepoPath to getMainRepoPath when provided` — assert `getMainRepoPath(baseRepoPath)` call
- `copyEnvToWorktree can be called with only worktreePath and defaults to the ADW repo` — assert param is optional (`baseRepoPath?`)

**Section 2 — getRepoInfo (3 Then steps):**
- `the getRepoInfo function signature accepts an optional cwd parameter` — assert signature contains `cwd?: string`
- `getRepoInfo passes the cwd option to execSync when cwd is provided` — assert execSync options contain `cwd`
- `getRepoInfo called without cwd reads the remote URL from the current working directory` — assert `cwd` param is optional

**Section 3 — githubAppAuth (1 Then step):**
- `the git remote get-url fallback in activateGitHubAppAuth passes cwd to execSync when available` — assert execSync call contains `cwd`

**Section 4 — autoMergeHandler (3 Then steps):**
- `the auto-merge handler extracts owner and repo from the webhook payload repository field` — assert `repoInfo.owner` and `repoInfo.repo` usage
- `the auto-merge handler derives the target repo workspace path before calling ensureWorktree` — assert `getTargetRepoWorkspacePath` call
- `ensureWorktree is called with baseRepoPath derived from the target repo workspace` — assert `ensureWorktree` call includes `targetRepoWorkspacePath`

**Section 5 — worktreeCreation (1 Then step):**
- `every call to copyEnvToWorktree inside ensureWorktree passes the baseRepoPath argument` — read `worktreeCreation.ts` via `sharedCtx.fileContent`, extract `ensureWorktree` body, assert all `copyEnvToWorktree` calls include `baseRepoPath`

**Section 6 — workflowInit (2 Then steps):**
- `findWorktreeForIssue is called with targetRepoWorkspacePath as the cwd parameter` — assert call includes `targetRepoWorkspacePath`
- `every call to copyEnvToWorktree in workflowInit passes the repo context when targetRepoWorkspacePath is available` — assert all `copyEnvToWorktree` calls pass a second argument

**Section 7 — targetRepoManager (3 Then steps):**
- `HTTPS clone URLs are converted to SSH format before cloning` — assert `convertToSshUrl` call
- `the SSH URL conversion transforms "https://github.com/owner/repo" to "git@github.com:owner/repo.git"` — assert regex pattern matches HTTPS GitHub URLs
- `clone URLs already in SSH format are passed through unchanged` — assert function returns original URL when not HTTPS

**Section 8 — no silent defaults (1 Then step):**
- `every git execSync call in repo-specific functions accepts a cwd parameter` — use `sharedCtx.filesRead` (multiple files read via Given steps), verify all repo-specific execSync calls include `cwd`

**Section 9 — TypeScript integrity (1 When + 1 Then step):**
- When `"bunx tsc --noEmit" and "bunx tsc --noEmit -p adws/tsconfig.json" are run` — run both commands via `spawnSync`, store results in `sharedCtx`
- Then `both type-check commands exit with code 0` — assert both exit codes are 0

**Section 10 — E2E scenarios (2 scenarios, ~5 Given/When/Then steps):**
- These require runtime infrastructure (real git repos, webhook processing). Implement as `pending` with a comment: `// Requires runtime infrastructure: real git repos and webhook processing`

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `bun run lint` — Run linter to check for code quality issues
2. `bunx tsc --noEmit` — Type-check root TypeScript config
3. `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check adws-specific TypeScript config
4. `bun run build` — Build the application to verify no build errors
5. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317 and @regression"` — Run issue-specific regression BDD scenarios
6. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run full regression suite to verify zero regressions

## Patch Scope
**Lines of code to change:** ~130 (7 source files ~50 lines total, 1 step def file ~200 lines)
**Risk level:** low
**Testing required:** TypeScript type-check (both configs), lint, build, BDD `@adw-317 @regression` scenarios, full `@regression` suite
