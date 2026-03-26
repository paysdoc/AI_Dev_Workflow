# Patch: Implement all undefined @adw-317 BDD step definitions

## Metadata
adwId: `tphvsj-fix-ensure-all-git-o`
reviewChangeRequest: `Issue #1: All @adw-317 BDD scenarios FAILED — every Then step is 'Undefined' because step definitions were never implemented. 8 undefined steps across scenarios testing copyEnvToWorktree, getRepoInfo, githubAppAuth, autoMergeHandler, worktreeCreation, workflowInit, and targetRepoManager.`

## Issue Summary
**Original Spec:** specs/issue-317-adw-tphvsj-fix-ensure-all-git-o-sdlc_planner-fix-git-repo-context.md
**Issue:** All 20 scenarios in `features/fix_git_repo_context.feature` have undefined `Then` (and some `Given`/`When`) steps. No step definition file exists for the @adw-317 feature. The `Given` steps from `commonSteps.ts` match, but every assertion step is `Undefined`.
**Solution:** Create a single new file `features/step_definitions/fixGitRepoContextSteps.ts` implementing all undefined steps as source-code-inspection assertions using `sharedCtx.fileContent`. Three steps are already defined elsewhere and must NOT be re-implemented.

## Files to Modify
- `features/step_definitions/fixGitRepoContextSteps.ts` — **NEW FILE** — all undefined step definitions for @adw-317 scenarios

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Create `features/step_definitions/fixGitRepoContextSteps.ts` with imports
- Import `{ Given, When, Then }` from `@cucumber/cucumber`
- Import `{ readFileSync }` from `fs`, `{ join }` from `path`, `assert` from `assert`
- Import `{ sharedCtx }` from `./commonSteps`
- Define `const ROOT = process.cwd();`

### Step 2: Implement source-code assertion Then steps for scenarios 1-17
Each Then step reads `sharedCtx.fileContent` (populated by `Given "{file}" is read` from commonSteps) and asserts code patterns using `indexOf`, `includes`, or `match`. Follow the established convention from files like `fixPrRoutingAndStatusSteps.ts`.

**Scenarios 1-3 — copyEnvToWorktree (verifies `adws/vcs/worktreeOperations.ts`):**

1. `Then('the copyEnvToWorktree function signature accepts an optional baseRepoPath parameter', ...)`
   - Find `copyEnvToWorktree(` in content, extract ~200 chars, assert contains `baseRepoPath`

2. `Then('copyEnvToWorktree passes baseRepoPath to getMainRepoPath when provided', ...)`
   - Find `function copyEnvToWorktree(`, extract ~500 chars of body, assert contains `getMainRepoPath(baseRepoPath`

3. `Then('copyEnvToWorktree can be called with only worktreePath and defaults to the ADW repo', ...)`
   - Assert signature contains `baseRepoPath?` (optional), assert body still calls `getMainRepoPath(`

**Scenarios 4-6 — getRepoInfo (verifies `adws/github/githubApi.ts`):**

4. `Then('the getRepoInfo function signature accepts an optional cwd parameter', ...)`
   - Find `getRepoInfo(` in content, assert signature slice contains `cwd`

5. `Then('getRepoInfo passes the cwd option to execSync when cwd is provided', ...)`
   - Find `function getRepoInfo(` body, assert execSync options include `cwd`

6. `Then('getRepoInfo called without cwd reads the remote URL from the current working directory', ...)`
   - Assert `cwd?` in signature (optional), assert `git remote get-url origin` present

**Scenario 7 — githubAppAuth (verifies `adws/github/githubAppAuth.ts`):**

7. `Then('the git remote get-url fallback in activateGitHubAppAuth passes cwd to execSync when available', ...)`
   - Find `activateGitHubAppAuth(`, assert signature contains `cwd`
   - Find `git remote get-url origin` execSync call, assert its options include `cwd`

**Scenarios 8-10 — autoMergeHandler (verifies `adws/triggers/autoMergeHandler.ts`):**

8. `Then('the auto-merge handler extracts owner and repo from the webhook payload repository field', ...)`
   - Assert content contains `getRepoInfoFromPayload` and `full_name` or `repoFullName`

9. `Then('the auto-merge handler derives the target repo workspace path before calling ensureWorktree', ...)`
   - Find `getTargetRepoWorkspacePath` or `targetRepoWorkspacePath`, find `ensureWorktree(`, assert workspace derivation index < ensureWorktree index

10. `Then('ensureWorktree is called with baseRepoPath derived from the target repo workspace', ...)`
    - Find `ensureWorktree(` call, extract ~200 chars, assert contains `targetRepoWorkspacePath` or `workspacePath`

**Scenario 11 — worktreeCreation (verifies `adws/vcs/worktreeCreation.ts`):**

11. `Then('every call to copyEnvToWorktree inside ensureWorktree passes the baseRepoPath argument', ...)`
    - Find `function ensureWorktree(`, extract body up to next `export` or end
    - Find ALL `copyEnvToWorktree(` calls within body, assert each includes `baseRepoPath`

**Scenarios 12-13 — workflowInit (verifies `adws/phases/workflowInit.ts`):**

12. `Then('findWorktreeForIssue is called with targetRepoWorkspacePath as the cwd parameter', ...)`
    - Find `findWorktreeForIssue(` call, assert it includes `targetRepoWorkspacePath`

13. `Then('every call to copyEnvToWorktree in workflowInit passes the repo context when targetRepoWorkspacePath is available', ...)`
    - Find `copyEnvToWorktree(` calls, assert at least one includes `targetRepoWorkspacePath`

**Scenarios 14-16 — targetRepoManager SSH URLs (verifies `adws/core/targetRepoManager.ts`):**

14. `Then('HTTPS clone URLs are converted to SSH format before cloning', ...)`
    - Assert content contains `convertToSshUrl` or (`git@github.com:` AND `https://github.com`)

15. `Then('the SSH URL conversion transforms {string} to {string}', ...)`
    - Assert content contains `git@github.com:` (SSH target) and `https://github.com` (HTTPS source)

16. `Then('clone URLs already in SSH format are passed through unchanged', ...)`
    - Assert conversion has conditional logic (regex match returns non-HTTPS unchanged, or `startsWith('git@')` check)

**Scenario 17 — no silent defaults (verifies all three files):**

17. `Then('every git execSync call in repo-specific functions accepts a cwd parameter', ...)`
    - Read all three files explicitly via `readFileSync`:
      - `adws/vcs/worktreeOperations.ts` — `copyEnvToWorktree` passes `baseRepoPath` via `getMainRepoPath`
      - `adws/github/githubApi.ts` — `getRepoInfo` passes `cwd` to execSync
      - `adws/github/githubAppAuth.ts` — `activateGitHubAppAuth` passes `cwd` to execSync

### Step 3: Implement E2E scenario Given/When/Then steps (scenarios 19-20)
These are static-analysis steps disguised as E2E scenarios (codebase convention).

**Scenario 19 — "Worktree for external target repo copies .env from target repo":**

18. `Given('an external target repo exists at a workspace path', ...)` — context-only no-op
19. `Given('the target repo has its own .env file', ...)` — context-only no-op
20. `Given('the ADW repo has a different .env file', ...)` — context-only no-op
21. `When('ensureWorktree is called with the target repo\'s baseRepoPath', ...)` — load `adws/vcs/worktreeCreation.ts` into sharedCtx
22. `Then('the worktree\'s .env file matches the target repo\'s .env', ...)` — assert `copyEnvToWorktree` receives `baseRepoPath` in `ensureWorktree`
23. `Then('the worktree\'s .env file does not match the ADW repo\'s .env', ...)` — assert `copyEnvToWorktree` does NOT use default path when `baseRepoPath` provided

**Scenario 20 — "Auto-merge for external repo PR does not create worktree in ADW directory":**

24. `Given('a pull_request_review webhook payload for repository {string}', ...)` — context-only
25. `Given('the review state is {string}', ...)` — context-only
26. `When('the auto-merge handler processes the webhook', ...)` — load `adws/triggers/autoMergeHandler.ts` into sharedCtx
27. `Then('the worktree is not created inside the ADW repository directory', ...)` — assert `ensureWorktree(` call includes `targetRepoWorkspacePath`

**Steps ALREADY defined elsewhere (DO NOT implement):**
- `When '{string} and '{string}' are run` — defined in `removeUnnecessaryExportsSteps.ts:168`
- `Then 'both type-check commands exit with code {int}'` — defined in `removeUnnecessaryExportsSteps.ts:180`
- `Then 'the worktree is created inside the vestmatic workspace path'` — defined in `wrongRepositoryTargetSteps.ts`

### Step 4: Verify no duplicate step definitions
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317" --dry-run` and confirm 0 undefined steps and 0 ambiguous steps

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317" --dry-run` — Verify 0 undefined steps (all scenarios matched)
2. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317 and @regression"` — Run regression-tagged @adw-317 scenarios
3. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317"` — Run all @adw-317 scenarios
4. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Full regression suite for zero regressions

## Patch Scope
**Lines of code to change:** ~280-350 (single new file)
**Risk level:** low
**Testing required:** BDD scenario execution — all @adw-317 scenarios transition from Undefined to Pass. Zero regressions in full @regression suite.
