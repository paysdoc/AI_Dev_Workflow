# Patch: Implement all undefined @adw-317 BDD step definitions

## Metadata
adwId: `tphvsj-fix-ensure-all-git-o`
reviewChangeRequest: `Issue #1: All @adw-317 BDD scenarios fail with 'Undefined' step definitions. The feature file (fix_git_repo_context.feature) defines ~22 scenarios but no step definition implementations exist in features/step_definitions/. Every Then step is undefined, meaning no scenario validates the implementation.`

## Issue Summary
**Original Spec:** specs/issue-317-adw-tphvsj-fix-ensure-all-git-o-sdlc_planner-fix-git-repo-context.md
**Issue:** All 20 scenarios in `features/fix_git_repo_context.feature` have undefined `Then` steps — no step definition file exists for the @adw-317 feature. The `Given` steps work (handled by `commonSteps.ts`), but every assertion step is undefined. Two steps for the TypeScript integrity scenario (#18) are already defined in `removeUnnecessaryExportsSteps.ts`, and one step for E2E scenario #20 exists in `wrongRepositoryTargetSteps.ts`.
**Solution:** Create a single new file `features/step_definitions/fixGitRepoContextSteps.ts` implementing all 22 undefined steps as source-code-inspection assertions (reading `sharedCtx.fileContent` and asserting patterns). E2E scenarios (19-20) use context-only Given/When steps with static-analysis Then steps, consistent with codebase convention.

## Files to Modify
Use these files to implement the patch:

- `features/step_definitions/fixGitRepoContextSteps.ts` — **NEW FILE** — all undefined step definitions for @adw-317 scenarios

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Create the step definitions file with imports and helpers
- Create `features/step_definitions/fixGitRepoContextSteps.ts`
- Import `{ Given, When, Then }` from `@cucumber/cucumber`
- Import `{ readFileSync }` from `fs`, `{ join }` from `path`, `assert` from `assert`
- Import `{ sharedCtx }` from `./commonSteps.ts`
- Define `const ROOT = process.cwd();`
- Add a helper to load a file into `sharedCtx`:
  ```typescript
  function loadFile(relPath: string): string {
    const content = readFileSync(join(ROOT, relPath), 'utf-8');
    sharedCtx.fileContent = content;
    sharedCtx.filePath = relPath;
    return content;
  }
  ```

### Step 2: Implement scenarios 1-3 (copyEnvToWorktree baseRepoPath) — 3 Then steps
These verify `adws/vcs/worktreeOperations.ts` (loaded by the Background `Given "adws/vcs/worktreeOperations.ts" is read`):

1. **`Then('the copyEnvToWorktree function signature accepts an optional baseRepoPath parameter', ...)`**
   - Find `function copyEnvToWorktree(` in `sharedCtx.fileContent`
   - Extract ~200 chars of the signature
   - Assert signature contains `baseRepoPath`

2. **`Then('copyEnvToWorktree passes baseRepoPath to getMainRepoPath when provided', ...)`**
   - Find `function copyEnvToWorktree(` and extract ~500 chars of function body
   - Assert body contains `getMainRepoPath(baseRepoPath)` or `getMainRepoPath(baseRepoPath`

3. **`Then('copyEnvToWorktree can be called with only worktreePath and defaults to the ADW repo', ...)`**
   - Find `function copyEnvToWorktree(`
   - Assert signature contains `baseRepoPath?` (optional marker)
   - Assert body contains `getMainRepoPath(` (still called — default behavior preserved)

### Step 3: Implement scenarios 4-6 (getRepoInfo cwd) — 3 Then steps
These verify `adws/github/githubApi.ts`:

4. **`Then('the getRepoInfo function signature accepts an optional cwd parameter', ...)`**
   - Find `function getRepoInfo(` in content
   - Assert signature slice contains `cwd`

5. **`Then('getRepoInfo passes the cwd option to execSync when cwd is provided', ...)`**
   - Find `function getRepoInfo(` body
   - Assert the execSync call options include `cwd` (look for `{ encoding: 'utf-8', cwd }` or `, cwd`)

6. **`Then('getRepoInfo called without cwd reads the remote URL from the current working directory', ...)`**
   - Assert `cwd` parameter is optional (`cwd?` in signature)
   - Assert `git remote get-url origin` is present (backward compatibility)

### Step 4: Implement scenario 7 (githubAppAuth cwd) — 1 Then step
Verifies `adws/github/githubAppAuth.ts`:

7. **`Then('the git remote get-url fallback in activateGitHubAppAuth passes cwd to execSync when available', ...)`**
   - Find `function activateGitHubAppAuth(` or `activateGitHubAppAuth(`
   - Assert the function signature contains `cwd`
   - Find the `git remote get-url origin` execSync call within the function body
   - Assert the execSync options include `cwd`

### Step 5: Implement scenarios 8-10 (auto-merge handler) — 3 Then steps
Verifies `adws/triggers/autoMergeHandler.ts`:

8. **`Then('the auto-merge handler extracts owner and repo from the webhook payload repository field', ...)`**
   - Assert content contains both `repository` field access and `repoFullName` or `full_name`
   - Assert `getRepoInfoFromPayload` is called

9. **`Then('the auto-merge handler derives the target repo workspace path before calling ensureWorktree', ...)`**
   - Find `getTargetRepoWorkspacePath` or `targetRepoWorkspacePath` in content
   - Find `ensureWorktree(` in content
   - Assert the workspace path derivation appears BEFORE the `ensureWorktree(` call (index comparison)

10. **`Then('ensureWorktree is called with baseRepoPath derived from the target repo workspace', ...)`**
    - Find `ensureWorktree(` call in `sharedCtx.fileContent`
    - Extract ~200 chars of the call
    - Assert the call contains `targetRepoWorkspacePath` or `workspacePath` or `baseRepoPath`
    - NOTE: This step text is different from `wrongRepositoryTargetSteps.ts` ("with **a** baseRepoPath") — no conflict

### Step 6: Implement scenario 11 (worktreeCreation threads baseRepoPath) — 1 Then step
Verifies `adws/vcs/worktreeCreation.ts`:

11. **`Then('every call to copyEnvToWorktree inside ensureWorktree passes the baseRepoPath argument', ...)`**
    - Find `function ensureWorktree(` in content
    - Extract the function body (up to the closing function boundary or next export)
    - Find ALL `copyEnvToWorktree(` calls within the body
    - Assert EACH call includes `baseRepoPath` as a second argument

### Step 7: Implement scenarios 12-13 (workflowInit repo context) — 2 Then steps
Verifies `adws/phases/workflowInit.ts`:

12. **`Then('findWorktreeForIssue is called with targetRepoWorkspacePath as the cwd parameter', ...)`**
    - Find `findWorktreeForIssue(` calls in content
    - Assert at least one call includes `targetRepoWorkspacePath`

13. **`Then('every call to copyEnvToWorktree in workflowInit passes the repo context when targetRepoWorkspacePath is available', ...)`**
    - Find all `copyEnvToWorktree(` calls in content
    - Assert at least one call includes `targetRepoWorkspacePath` as a second argument

### Step 8: Implement scenarios 14-16 (SSH URL conversion) — 3 Then steps
Verifies `adws/core/targetRepoManager.ts`:

14. **`Then('HTTPS clone URLs are converted to SSH format before cloning', ...)`**
    - Assert content contains a function or logic that converts HTTPS to SSH (e.g., `convertToSshUrl`, `git@github.com:`, or an HTTPS-to-SSH regex)
    - Assert this conversion is referenced in or before the `git clone` call

15. **`Then('the SSH URL conversion transforms "https://github.com/owner/repo" to "git@github.com:owner/repo.git"', ...)`**
    - Assert content contains `git@github.com:` pattern (SSH format target)
    - Assert content contains `https://github.com` pattern (HTTPS format source)
    - Assert content contains conversion logic (regex replace or string manipulation)

16. **`Then('clone URLs already in SSH format are passed through unchanged', ...)`**
    - Assert the conversion function has conditional logic that checks for existing SSH format
    - Look for patterns like `startsWith('git@')`, `includes('git@')`, or a regex match that only converts HTTPS

### Step 9: Implement scenario 17 (no silent process.cwd defaults) — 1 Then step
Verifies `adws/vcs/worktreeOperations.ts`, `adws/github/githubApi.ts`, `adws/github/githubAppAuth.ts` — the Background reads files sequentially; `sharedCtx` holds only the last one read. This step must read all three files explicitly.

17. **`Then('every git execSync call in repo-specific functions accepts a cwd parameter', ...)`**
    - Read all three files using `readFileSync`:
      - `adws/vcs/worktreeOperations.ts` — verify `copyEnvToWorktree` body passes `baseRepoPath` (via `getMainRepoPath`)
      - `adws/github/githubApi.ts` — verify `getRepoInfo` passes `cwd` to execSync
      - `adws/github/githubAppAuth.ts` — verify `activateGitHubAppAuth` passes `cwd` to execSync
    - For each file, find the `execSync('git ` calls in repo-specific functions and assert `cwd` is in the options

### Step 10: Implement E2E scenario 19 steps — 6 Given/When/Then steps
Scenario: "Worktree for external target repo copies .env from target repo not ADW repo" — implement as context-only Given/When + static-analysis Then steps (codebase convention).

18. **`Given('an external target repo exists at a workspace path', ...)`** — context-only pass-through
19. **`Given('the target repo has its own .env file', ...)`** — context-only pass-through
20. **`Given('the ADW repo has a different .env file', ...)`** — context-only pass-through
21. **`When('ensureWorktree is called with the target repo\'s baseRepoPath', ...)`** — load `adws/vcs/worktreeCreation.ts` into `sharedCtx`
22. **`Then('the worktree\'s .env file matches the target repo\'s .env', ...)`** — static analysis: verify `copyEnvToWorktree` receives `baseRepoPath` in the `ensureWorktree` function body, ensuring the correct source .env is used
23. **`Then('the worktree\'s .env file does not match the ADW repo\'s .env', ...)`** — static analysis: verify `copyEnvToWorktree` does NOT use the default (no-arg) path when `baseRepoPath` is provided

### Step 11: Implement E2E scenario 20 steps — 4 steps (1 already exists)
Scenario: "Auto-merge for external repo PR does not create worktree in ADW directory"

24. **`Given('a pull_request_review webhook payload for repository {string}', ...)`** — context-only; parameter captured but not used (static analysis)
25. **`Given('the review state is {string}', ...)`** — context-only pass-through
26. **`When('the auto-merge handler processes the webhook', ...)`** — load `adws/triggers/autoMergeHandler.ts` into `sharedCtx`
- `Then('the worktree is created inside the vestmatic workspace path', ...)` — **ALREADY DEFINED** in `wrongRepositoryTargetSteps.ts:143` — DO NOT redefine
27. **`Then('the worktree is not created inside the ADW repository directory', ...)`** — static analysis: assert `ensureWorktree(` call in content includes `targetRepoWorkspacePath` or `baseRepoPath`, ensuring the worktree is NOT created in the default ADW directory

**Steps already defined elsewhere (DO NOT implement — they will be matched automatically):**
- `When '{string} and {string} are run'` — defined in `removeUnnecessaryExportsSteps.ts:168`
- `Then 'both type-check commands exit with code {int}'` — defined in `removeUnnecessaryExportsSteps.ts:180`
- `Then 'the worktree is created inside the vestmatic workspace path'` — defined in `wrongRepositoryTargetSteps.ts:143`

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317" --dry-run` — Verify 0 undefined steps (all 20 scenarios matched)
2. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317 and @regression"` — Run regression-tagged @adw-317 scenarios
3. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317"` — Run all @adw-317 scenarios
4. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Full regression suite to verify zero regressions

## Patch Scope
**Lines of code to change:** ~280-350 (single new file: `features/step_definitions/fixGitRepoContextSteps.ts`)
**Risk level:** low
**Testing required:** BDD scenario execution — all @adw-317 scenarios should transition from Undefined to Pass (source code changes were applied in prior patch). Zero regressions in full @regression suite.
