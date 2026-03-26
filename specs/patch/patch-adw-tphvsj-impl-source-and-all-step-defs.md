# Patch: Implement all 7 source code changes and create step definition file for #317

## Metadata
adwId: `tphvsj-fix-ensure-all-git-o`
reviewChangeRequest: `All @adw-317 BDD scenarios fail — every 'Then' step definition is undefined. Zero source code implementation has been applied across 7 files. Resolution: execute all 7 implementation steps from the spec and create the corresponding Cucumber step definitions.`

## Issue Summary
**Original Spec:** specs/issue-317-adw-tphvsj-fix-ensure-all-git-o-sdlc_planner-fix-git-repo-context.md
**Issue:** All 20 @adw-317 BDD scenarios fail with "Undefined" steps. Two root causes: (1) none of the 7 source code changes from the spec have been applied — `copyEnvToWorktree` has no `baseRepoPath` parameter, `getRepoInfo` has no `cwd` parameter, `activateGitHubAppAuth` has no `cwd` parameter, `autoMergeHandler` has no `targetRepoWorkspacePath` derivation, `ensureWorktree` doesn't thread `baseRepoPath` to `copyEnvToWorktree`, `workflowInit` doesn't pass `targetRepoWorkspacePath` to VCS functions, and `targetRepoManager` has no `convertToSshUrl` helper. (2) No step definition file exists at `features/step_definitions/fixGitRepoContextSteps.ts`.
**Solution:** Apply all 7 source code changes from spec steps 1-7 (small surgical edits adding optional parameters and threading repo context), then create the step definition file with all 22 Then/When steps using the established `sharedCtx.fileContent` assertion pattern.

## Files to Modify
Use these files to implement the patch:

**Source code changes (7 files):**
- `adws/vcs/worktreeOperations.ts` — Add `baseRepoPath?: string` param to `copyEnvToWorktree()`, pass to `getMainRepoPath()`
- `adws/vcs/worktreeCreation.ts` — Pass `baseRepoPath` to both `copyEnvToWorktree()` calls in `ensureWorktree()`
- `adws/github/githubApi.ts` — Add `cwd?: string` param to `getRepoInfo()`, pass to `execSync`
- `adws/github/githubAppAuth.ts` — Add `cwd?: string` param to `activateGitHubAppAuth()`, pass to git remote fallback `execSync`
- `adws/triggers/autoMergeHandler.ts` — Derive `targetRepoWorkspacePath` from webhook payload, pass to `ensureWorktree()`
- `adws/phases/workflowInit.ts` — Pass `targetRepoWorkspacePath` to `findWorktreeForIssue()` and both `copyEnvToWorktree()` calls
- `adws/core/targetRepoManager.ts` — Add `convertToSshUrl()` helper, use in `cloneTargetRepo()`

**New file (1 file):**
- `features/step_definitions/fixGitRepoContextSteps.ts` — All 22 step definitions for `features/fix_git_repo_context.feature`

**Reference files (read-only, for patterns):**
- `adws/triggers/webhookHandlers.ts` lines 69-71 — Pattern for deriving `targetRepoWorkspacePath`
- `adws/phases/prReviewPhase.ts` line 99 — Pattern for passing `baseRepoPath` to `ensureWorktree()`
- `features/step_definitions/commonSteps.ts` — `sharedCtx` import and step definition pattern
- `features/step_definitions/fixPrRoutingAndStatusSteps.ts` — Reference pattern for source-code-verification steps

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Apply all 7 source code changes from the original spec

Read each file, apply the change. These are all small, surgical edits — each adds an optional parameter or threads an existing variable:

**1a. `adws/vcs/worktreeOperations.ts`** — `copyEnvToWorktree` signature
- Change `copyEnvToWorktree(worktreePath: string): void` → `copyEnvToWorktree(worktreePath: string, baseRepoPath?: string): void`
- Change `const mainRepoPath = getMainRepoPath();` → `const mainRepoPath = getMainRepoPath(baseRepoPath);`
- Note: `getMainRepoPath(cwd?: string)` already accepts the parameter at line 55

**1b. `adws/vcs/worktreeCreation.ts`** — thread `baseRepoPath` to `copyEnvToWorktree`
- Line ~203: Change `copyEnvToWorktree(existingPath)` → `copyEnvToWorktree(existingPath, baseRepoPath)`
- Line ~209: Change `copyEnvToWorktree(worktreePath)` → `copyEnvToWorktree(worktreePath, baseRepoPath)`

**1c. `adws/github/githubApi.ts`** — `getRepoInfo` signature
- Change `getRepoInfo(): RepoInfo` → `getRepoInfo(cwd?: string): RepoInfo`
- Change `execSync('git remote get-url origin', { encoding: 'utf-8' })` → `execSync('git remote get-url origin', { encoding: 'utf-8', cwd })`

**1d. `adws/github/githubAppAuth.ts`** — `activateGitHubAppAuth` cwd parameter
- Change `activateGitHubAppAuth(owner?: string, repo?: string): boolean` → `activateGitHubAppAuth(owner?: string, repo?: string, cwd?: string): boolean`
- At the git remote fallback `execSync`, change `{ encoding: 'utf-8' }` → `{ encoding: 'utf-8', cwd }`

**1e. `adws/triggers/autoMergeHandler.ts`** — derive target repo workspace path
- Import `getTargetRepoWorkspacePath` from `'../core'` and `existsSync` from `'fs'`
- Read `adws/triggers/webhookHandlers.ts` lines 69-71 for the correct pattern
- After the `const adwId = ...` line, add:
  ```typescript
  // Derive target repo workspace path from webhook payload
  const targetRepoWorkspacePath = (() => {
    const workspacePath = getTargetRepoWorkspacePath(repoInfo.owner, repoInfo.repo);
    return existsSync(workspacePath) ? workspacePath : undefined;
  })();
  ```
- Change `worktreePath = ensureWorktree(headBranch);` → `worktreePath = ensureWorktree(headBranch, undefined, targetRepoWorkspacePath);`

**1f. `adws/phases/workflowInit.ts`** — thread `targetRepoWorkspacePath`
- Line ~181: Change `findWorktreeForIssue(issueType, issueNumber)` → `findWorktreeForIssue(issueType, issueNumber, targetRepoWorkspacePath)`
- Line ~186: Change `copyEnvToWorktree(worktreePath)` → `copyEnvToWorktree(worktreePath, targetRepoWorkspacePath)`
- Line ~201: Change `copyEnvToWorktree(existingWorktree)` → `copyEnvToWorktree(existingWorktree, targetRepoWorkspacePath)`

**1g. `adws/core/targetRepoManager.ts`** — SSH URL conversion
- Add a pure helper function before `cloneTargetRepo()`:
  ```typescript
  /** Convert HTTPS GitHub URLs to SSH format. Non-HTTPS URLs pass through unchanged. */
  export function convertToSshUrl(cloneUrl: string): string {
    const httpsMatch = cloneUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (!httpsMatch) return cloneUrl;
    const [, owner, repo] = httpsMatch;
    return `git@github.com:${owner}/${repo}.git`;
  }
  ```
- In `cloneTargetRepo()`, before the `execSync` call, convert the URL: `const sshUrl = convertToSshUrl(cloneUrl);` and use `sshUrl` in the git clone command
- Update log messages to show the original URL and converted URL when they differ

### Step 2: Create `features/step_definitions/fixGitRepoContextSteps.ts`

Create the step definition file implementing all 22 Then/When steps. Follow the established pattern from `fixPrRoutingAndStatusSteps.ts` and `commonSteps.ts`:

- Import `{ Given, When, Then }` from `@cucumber/cucumber`
- Import `{ readFileSync, existsSync }` from `fs`
- Import `{ join }` from `path`
- Import `assert` from `assert`
- Import `{ execSync }` from `child_process`
- Import `{ sharedCtx }` from `./commonSteps.ts`
- Use `const ROOT = process.cwd()` for project root

Each step reads `sharedCtx.fileContent` (set by `Given "{file}" is read` in commonSteps.ts) and asserts string patterns:

**Section 1 — copyEnvToWorktree (3 Then steps):**
- `Then('the copyEnvToWorktree function signature accepts an optional baseRepoPath parameter', ...)` — assert `sharedCtx.fileContent` contains `baseRepoPath` in the function signature with `?` optional marker
- `Then('copyEnvToWorktree passes baseRepoPath to getMainRepoPath when provided', ...)` — assert content contains `getMainRepoPath(baseRepoPath)`
- `Then('copyEnvToWorktree can be called with only worktreePath and defaults to the ADW repo', ...)` — assert `baseRepoPath` param has `?` (optional)

**Section 2 — getRepoInfo (3 Then steps):**
- `Then('the getRepoInfo function signature accepts an optional cwd parameter', ...)` — assert content contains `cwd` in function signature with `?`
- `Then('getRepoInfo passes the cwd option to execSync when cwd is provided', ...)` — assert `execSync` call includes `cwd` in options
- `Then('getRepoInfo called without cwd reads the remote URL from the current working directory', ...)` — assert `cwd?` (optional) so undefined defaults to process.cwd behavior

**Section 3 — githubAppAuth (1 Then step):**
- `Then('the git remote get-url fallback in activateGitHubAppAuth passes cwd to execSync when available', ...)` — assert content contains `cwd` param in signature and `cwd` in the execSync options

**Section 4 — autoMergeHandler (3 Then steps):**
- `Then('the auto-merge handler extracts owner and repo from the webhook payload repository field', ...)` — assert content contains `repoInfo.owner` and `repoInfo.repo` or `getRepoInfoFromPayload`
- `Then('the auto-merge handler derives the target repo workspace path before calling ensureWorktree', ...)` — assert content contains `getTargetRepoWorkspacePath`
- `Then('ensureWorktree is called with baseRepoPath derived from the target repo workspace', ...)` — assert `ensureWorktree` call has 3 arguments (including `targetRepoWorkspacePath`)

**Section 5 — worktreeCreation (1 Then step):**
- `Then('every call to copyEnvToWorktree inside ensureWorktree passes the baseRepoPath argument', ...)` — read `adws/vcs/worktreeCreation.ts`, find the `ensureWorktree` function body, assert every `copyEnvToWorktree(` call includes `, baseRepoPath`

**Section 6 — workflowInit (2 Then steps):**
- `Then('findWorktreeForIssue is called with targetRepoWorkspacePath as the cwd parameter', ...)` — assert content contains `findWorktreeForIssue(` with a third argument
- `Then('every call to copyEnvToWorktree in workflowInit passes the repo context when targetRepoWorkspacePath is available', ...)` — assert every `copyEnvToWorktree(` call passes a second argument

**Section 7 — targetRepoManager (3 Then steps):**
- `Then('HTTPS clone URLs are converted to SSH format before cloning', ...)` — assert content contains `convertToSshUrl`
- `Then('the SSH URL conversion transforms {string} to {string}', ...)` — assert the regex pattern in `convertToSshUrl` matches the expected transformation
- `Then('clone URLs already in SSH format are passed through unchanged', ...)` — assert the function returns early for non-HTTPS URLs (the `if (!httpsMatch) return cloneUrl` pattern)

**Section 8 — No silent defaults (1 Then step):**
- `Then('every git execSync call in repo-specific functions accepts a cwd parameter', ...)` — read each of the three files, assert each `execSync` call for `git remote` includes `cwd` in its options

**Section 9 — TypeScript integrity (1 When + 1 Then step):**
- `When('{string} and {string} are run', ...)` — run both commands via `execSync`, store exit codes
- `Then('both type-check commands exit with code {int}', ...)` — assert both stored exit codes equal the expected value

**Section 10 — E2E scenarios (Given/When/Then steps):**
- Implement as source-code-verification steps (same approach as all other ADW BDD steps):
  - `Given('an external target repo exists at a workspace path', ...)` — verify `getTargetRepoWorkspacePath` function exists in `targetRepoManager.ts`
  - `Given('the target repo has its own .env file', ...)` — no-op (context setup)
  - `Given('the ADW repo has a different .env file', ...)` — no-op (context setup)
  - `When('ensureWorktree is called with the target repo's baseRepoPath', ...)` — verify `ensureWorktree` accepts `baseRepoPath` param
  - `Then('the worktree's .env file matches the target repo's .env', ...)` — verify `copyEnvToWorktree` passes `baseRepoPath` to `getMainRepoPath`
  - `Then('the worktree's .env file does not match the ADW repo's .env', ...)` — verify `baseRepoPath` overrides the default
  - `Given('a pull_request_review webhook payload for repository {string}', ...)` — store repo name in context
  - `Given('the review state is {string}', ...)` — no-op (context setup)
  - `When('the auto-merge handler processes the webhook', ...)` — verify handler function exists
  - `Then('the worktree is created inside the vestmatic workspace path', ...)` — verify `targetRepoWorkspacePath` is passed to `ensureWorktree`
  - `Then('the worktree is not created inside the ADW repository directory', ...)` — verify `baseRepoPath` argument prevents defaulting to process.cwd()

### Step 3: Run validation and fix any issues

- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317"` — expect 20 scenarios passed, 0 undefined
- Fix any failing steps by adjusting assertions to match actual source code patterns
- Run remaining validation commands from the validation section

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type-check root TypeScript config
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check adws-specific TypeScript config
- `bun run build` — Build the application to verify no build errors
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317"` — Run ALL issue-specific BDD scenarios (expect 20 passed, 0 failures, 0 undefined)
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317 and @regression"` — Run regression subset
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run full regression suite to verify zero regressions

## Patch Scope
**Lines of code to change:** ~400-500 (new step definition file ~300-350 lines, ~100-150 lines across 7 source files)
**Risk level:** low
**Testing required:** All 20 @adw-317 scenarios must pass (0 undefined/pending). Full @regression suite must show no regressions. TypeScript type-check must pass for both root and adws configs.
