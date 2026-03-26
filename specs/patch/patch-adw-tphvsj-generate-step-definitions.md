# Patch: Generate step definitions for fix_git_repo_context.feature

## Metadata
adwId: `tphvsj-fix-ensure-all-git-o`
reviewChangeRequest: `Issue #1: All @adw-317 BDD scenarios FAILED with undefined step definitions`

## Issue Summary
**Original Spec:** specs/issue-317-adw-tphvsj-fix-ensure-all-git-o-sdlc_planner-fix-git-repo-context.md
**Issue:** All 17+ Then steps across every scenario in `features/fix_git_repo_context.feature` are marked `Undefined` — no step definition implementations exist. The scenarios use static analysis to verify code changes, but the matching step definitions file was never created.
**Solution:** Create `features/step_definitions/fixGitRepoContextSteps.ts` implementing all undefined Then steps as static code analysis assertions. Reuse existing shared steps (`When '{string} and '{string}' are run'` from `removeUnnecessaryExportsSteps.ts`, `Then 'the worktree is created inside the vestmatic workspace path'` from `wrongRepositoryTargetSteps.ts`). The e2e scenarios (18-19) are implemented as context-only Given/When + static analysis Then steps, consistent with the codebase pattern.

## Files to Modify

- `features/step_definitions/fixGitRepoContextSteps.ts` — **NEW FILE** — step definitions for all @adw-317 scenarios

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Create the step definitions file with all Then steps
- Create `features/step_definitions/fixGitRepoContextSteps.ts`
- Import `{ Given, When, Then }` from `@cucumber/cucumber`, `{ readFileSync }` from `fs`, `{ join }` from `path`, `assert` from `assert`, and `{ sharedCtx }` from `./commonSteps.ts`
- Define `const ROOT = process.cwd();`
- Implement each undefined step as a static analysis assertion against `sharedCtx.fileContent` (the file loaded by the Background `Given "{file}" is read` step)

### Step 2: Implement scenarios 1-3 (copyEnvToWorktree baseRepoPath)
These verify `adws/vcs/worktreeOperations.ts` (loaded via `Given "adws/vcs/worktreeOperations.ts" is read`):

- **`Then the copyEnvToWorktree function signature accepts an optional baseRepoPath parameter`**
  - Find `function copyEnvToWorktree(` in `sharedCtx.fileContent`
  - Assert the signature slice contains `baseRepoPath`

- **`Then copyEnvToWorktree passes baseRepoPath to getMainRepoPath when provided`**
  - Find the `copyEnvToWorktree` function body
  - Assert it contains `getMainRepoPath(baseRepoPath)` or `getMainRepoPath(baseRepoPath`

- **`Then copyEnvToWorktree can be called with only worktreePath and defaults to the ADW repo`**
  - Assert the parameter is optional (`baseRepoPath?` or `baseRepoPath:` with optional marker)
  - Assert `getMainRepoPath` is called (default behavior still works)

### Step 3: Implement scenarios 4-6 (getRepoInfo cwd)
These verify `adws/github/githubApi.ts`:

- **`Then the getRepoInfo function signature accepts an optional cwd parameter`**
  - Find `function getRepoInfo(` in content
  - Assert signature contains `cwd`

- **`Then getRepoInfo passes the cwd option to execSync when cwd is provided`**
  - Find the `getRepoInfo` function body
  - Assert it contains `{ encoding: 'utf-8', cwd }` or `cwd` in the execSync options

- **`Then getRepoInfo called without cwd reads the remote URL from the current working directory`**
  - Assert `cwd` parameter is optional (has `?`)
  - Assert `git remote get-url origin` is present (backward compatibility)

### Step 4: Implement scenario 7 (githubAppAuth cwd)
Verifies `adws/github/githubAppAuth.ts`:

- **`Then the git remote get-url fallback in activateGitHubAppAuth passes cwd to execSync when available`**
  - Find `activateGitHubAppAuth` function
  - Assert the function signature includes `cwd`
  - Assert the `git remote get-url origin` execSync call includes `cwd` in its options

### Step 5: Implement scenarios 8-10 (auto-merge handler)
Verifies `adws/triggers/autoMergeHandler.ts`:

- **`Then the auto-merge handler extracts owner and repo from the webhook payload repository field`**
  - Assert content contains `repository` and `full_name` or `repoFullName`
  - Assert `getRepoInfoFromPayload` or equivalent is called

- **`Then the auto-merge handler derives the target repo workspace path before calling ensureWorktree`**
  - Assert content contains `getTargetRepoWorkspacePath` or `targetRepoWorkspacePath`
  - Assert this appears before `ensureWorktree(`

- **`Then ensureWorktree is called with baseRepoPath derived from the target repo workspace`**
  - Find `ensureWorktree(` call in the auto-merge handler content (use `sharedCtx.fileContent` which is `autoMergeHandler.ts`)
  - Assert the call includes `targetRepoWorkspacePath` or `workspacePath` or `baseRepoPath`
  - NOTE: This step text differs from the one in `wrongRepositoryTargetSteps.ts` (which says "with **a** baseRepoPath") so no conflict

### Step 6: Implement scenario 11 (worktreeCreation threads baseRepoPath)
Verifies `adws/vcs/worktreeCreation.ts`:

- **`Then every call to copyEnvToWorktree inside ensureWorktree passes the baseRepoPath argument`**
  - Find `ensureWorktree` function body
  - Find all `copyEnvToWorktree(` calls within that function
  - Assert each call includes `baseRepoPath` as an argument

### Step 7: Implement scenarios 12-13 (workflowInit repo context)
Verifies `adws/phases/workflowInit.ts`:

- **`Then findWorktreeForIssue is called with targetRepoWorkspacePath as the cwd parameter`**
  - Find `findWorktreeForIssue(` in content
  - Assert at least one call includes `targetRepoWorkspacePath`

- **`Then every call to copyEnvToWorktree in workflowInit passes the repo context when targetRepoWorkspacePath is available`**
  - Find all `copyEnvToWorktree(` calls in content
  - Assert they include `targetRepoWorkspacePath` or repo context argument

### Step 8: Implement scenarios 14-16 (SSH URL conversion)
Verifies `adws/core/targetRepoManager.ts`:

- **`Then HTTPS clone URLs are converted to SSH format before cloning`**
  - Assert content contains `convertToSshUrl` or `ssh` URL conversion logic
  - Assert this appears before or is used in the `git clone` command

- **`Then the SSH URL conversion transforms "https://github.com/owner/repo" to "git@github.com:owner/repo.git"`**
  - Assert content contains `git@github.com:` pattern
  - Assert content contains conversion logic from `https://github.com` to SSH format

- **`Then clone URLs already in SSH format are passed through unchanged`**
  - Assert the conversion function checks for existing SSH format or non-HTTPS URLs
  - Assert it returns unchanged for non-HTTPS input (check for conditional logic)

### Step 9: Implement scenario 17 (no silent process.cwd defaults)
Cross-file verification (`worktreeOperations.ts`, `githubApi.ts`, `githubAppAuth.ts` all loaded via multiple `Given "{file}" is read` steps — use `sharedCtx` which holds the last read file, so load all three and check):

- **`Then every git execSync call in repo-specific functions accepts a cwd parameter`**
  - Read all three files: `worktreeOperations.ts`, `githubApi.ts`, `githubAppAuth.ts`
  - For each: find `execSync('git ` calls in repo-specific functions
  - Assert each has `cwd` in its options

Note: Since the Background reads files sequentially and `sharedCtx` holds only the last one, this step should read all three files explicitly using `readFileSync`.

### Step 10: Implement e2e scenario steps (scenarios 18-19) as context-only + static analysis
Following the codebase pattern (e.g., `wrongRepositoryTargetSteps.ts`), implement e2e scenarios as static analysis:

**Scenario 18 steps (context-only Given/When + static Then):**
- `Given an external target repo exists at a workspace path` — context-only (pass-through)
- `Given the target repo has its own .env file` — context-only
- `Given the ADW repo has a different .env file` — context-only
- `When ensureWorktree is called with the target repo's baseRepoPath` — load `worktreeCreation.ts`
- `Then the worktree's .env file matches the target repo's .env` — static analysis: verify `copyEnvToWorktree` receives `baseRepoPath`
- `Then the worktree's .env file does not match the ADW repo's .env` — static analysis: verify non-default path used

**Scenario 19 steps:**
- `Given a pull_request_review webhook payload for repository {string}` — context-only
- `Given the review state is {string}` — context-only
- `When the auto-merge handler processes the webhook` — load `autoMergeHandler.ts`
- `Then the worktree is created inside the vestmatic workspace path` — **ALREADY EXISTS** in `wrongRepositoryTargetSteps.ts`
- `Then the worktree is not created inside the ADW repository directory` — static analysis: verify `baseRepoPath`/`targetRepoWorkspacePath` is passed to `ensureWorktree`

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317" --dry-run` — Verify all step definitions are matched (no Undefined steps)
2. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317 and @regression"` — Run regression-tagged @adw-317 scenarios
3. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317"` — Run all @adw-317 scenarios
4. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Full regression suite to verify zero regressions

## Patch Scope
**Lines of code to change:** ~250-350 (single new file)
**Risk level:** low
**Testing required:** BDD scenario execution — all @adw-317 scenarios should transition from Undefined to either Pass (if code changes are applied) or Fail (with meaningful assertion errors, not Undefined)
