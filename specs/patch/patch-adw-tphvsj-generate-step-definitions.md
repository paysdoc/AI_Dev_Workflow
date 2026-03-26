# Patch: Generate step definitions for fix_git_repo_context.feature

## Metadata
adwId: `tphvsj-fix-ensure-all-git-o`
reviewChangeRequest: `Issue #2: All @adw-317 step definitions are undefined. The feature file defines 20 scenarios but no matching step definition file was created (e.g., fixGitRepoContextSteps.ts). Resolution: Generate step definitions for features/fix_git_repo_context.feature that verify the source code changes via AST/regex inspection of the modified files.`

## Issue Summary
**Original Spec:** `specs/issue-317-adw-tphvsj-fix-ensure-all-git-o-sdlc_planner-fix-git-repo-context.md`
**Issue:** The feature file `features/fix_git_repo_context.feature` defines 20 scenarios tagged `@adw-317` but no step definition file exists. All 20 scenarios report `Undefined` steps (17 unique Then steps, 2 unique When steps, and 6 unique Given steps for e2e scenarios), causing the BDD regression suite to fail.
**Solution:** Create `features/step_definitions/fixGitRepoContextSteps.ts` with step definitions that verify the source code changes via regex/string inspection of `sharedCtx.fileContent`, plus `spawnSync`-based TypeScript compilation checks, following the established patterns from `cacheInstallContextSteps.ts`, `fixBddScenariosFailureSteps.ts`, and `removeUnitTestsSteps.ts`.

## Dependency
The source code changes from the original spec (steps 1-7) must be applied first. Those changes modify 7 files to thread `baseRepoPath`/`cwd` through git operations. The step definitions verify those changes exist. Without them, the steps will fail with assertion errors (not Undefined — which is still an improvement).

## Files to Modify

1. `features/step_definitions/fixGitRepoContextSteps.ts` — **New file**: step definitions for all 20 `@adw-317` BDD scenarios

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Create the step definitions file scaffold

Create `features/step_definitions/fixGitRepoContextSteps.ts` with:

```typescript
import { Given, When, Then } from '@cucumber/cucumber';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';

const ROOT = process.cwd();
```

All static analysis Then steps read from `sharedCtx.fileContent`, which is populated by the shared `Given "{file}" is read` step in `commonSteps.ts`.

### Step 2: Implement scenarios 1-3 (copyEnvToWorktree — `adws/vcs/worktreeOperations.ts`)

- **`Then the copyEnvToWorktree function signature accepts an optional baseRepoPath parameter`**
  - Find `copyEnvToWorktree(` in `sharedCtx.fileContent`
  - Extract ~200 chars after the match for the signature
  - Assert the signature contains `baseRepoPath` using regex: `/copyEnvToWorktree\([^)]*baseRepoPath/`

- **`Then copyEnvToWorktree passes baseRepoPath to getMainRepoPath when provided`**
  - Assert `sharedCtx.fileContent.includes('getMainRepoPath(baseRepoPath)')`

- **`Then copyEnvToWorktree can be called with only worktreePath and defaults to the ADW repo`**
  - Assert the `baseRepoPath` parameter has `?` (optional marker): regex `/baseRepoPath\?\s*:/`
  - Assert `getMainRepoPath` is called (default still works)

### Step 3: Implement scenarios 4-6 (getRepoInfo — `adws/github/githubApi.ts`)

- **`Then the getRepoInfo function signature accepts an optional cwd parameter`**
  - Regex: `/getRepoInfo\([^)]*cwd/` on `sharedCtx.fileContent`

- **`Then getRepoInfo passes the cwd option to execSync when cwd is provided`**
  - Find the `getRepoInfo` function body (slice from `function getRepoInfo` ~500 chars)
  - Assert it contains `cwd` in the `execSync` options (check for `{ encoding: 'utf-8', cwd }` or similar)

- **`Then getRepoInfo called without cwd reads the remote URL from the current working directory`**
  - Assert `cwd` parameter is optional (`cwd?` in signature)
  - Assert `git remote get-url origin` is present (backward compatibility)

### Step 4: Implement scenario 7 (githubAppAuth — `adws/github/githubAppAuth.ts`)

- **`Then the git remote get-url fallback in activateGitHubAppAuth passes cwd to execSync when available`**
  - Find `activateGitHubAppAuth` function signature
  - Assert it includes `cwd` parameter
  - Find `git remote get-url origin` in the function body
  - Assert the nearby `execSync` call includes `cwd` in options

### Step 5: Implement scenarios 8-10 (auto-merge handler — `adws/triggers/autoMergeHandler.ts`)

- **`Then the auto-merge handler extracts owner and repo from the webhook payload repository field`**
  - Assert content contains `repoFullName` or `repository` (webhook payload field)
  - Assert content contains `getRepoInfoFromPayload` or equivalent extraction

- **`Then the auto-merge handler derives the target repo workspace path before calling ensureWorktree`**
  - Assert content contains `getTargetRepoWorkspacePath` or `targetRepoWorkspacePath`
  - Use `indexOf` to verify the derivation appears before the `ensureWorktree(` call

- **`Then ensureWorktree is called with baseRepoPath derived from the target repo workspace`**
  - Find `ensureWorktree(` calls in `sharedCtx.fileContent`
  - Assert at least one call includes `targetRepoWorkspacePath` as an argument
  - Regex: `/ensureWorktree\([^)]*targetRepoWorkspacePath/`

### Step 6: Implement scenario 11 (worktreeCreation — `adws/vcs/worktreeCreation.ts`)

- **`Then every call to copyEnvToWorktree inside ensureWorktree passes the baseRepoPath argument`**
  - Find `ensureWorktree` function body (from `function ensureWorktree` to end of function)
  - Use regex to find ALL `copyEnvToWorktree(` calls within that scope
  - Assert each call includes `baseRepoPath` as second argument
  - Pattern: match all `copyEnvToWorktree(` calls, assert each match includes `, baseRepoPath`

### Step 7: Implement scenarios 12-13 (workflowInit — `adws/phases/workflowInit.ts`)

- **`Then findWorktreeForIssue is called with targetRepoWorkspacePath as the cwd parameter`**
  - Find `findWorktreeForIssue(` calls in content
  - Assert at least one includes `targetRepoWorkspacePath` as an argument

- **`Then every call to copyEnvToWorktree in workflowInit passes the repo context when targetRepoWorkspacePath is available`**
  - Find all `copyEnvToWorktree(` calls in content
  - Assert each call includes `targetRepoWorkspacePath` as second argument

### Step 8: Implement scenarios 14-16 (targetRepoManager — `adws/core/targetRepoManager.ts`)

- **`Then HTTPS clone URLs are converted to SSH format before cloning`**
  - Assert content contains `convertToSshUrl` or inline SSH conversion logic
  - Assert the conversion is applied before/at the `git clone` call

- **`Then the SSH URL conversion transforms "https://github.com/owner/repo" to "git@github.com:owner/repo.git"`**
  - Assert content contains `git@github.com:` pattern
  - Assert content contains the HTTPS-to-SSH conversion regex (e.g., `https://github.com/` match)

- **`Then clone URLs already in SSH format are passed through unchanged`**
  - Assert the conversion logic has a guard (conditional) that returns non-HTTPS URLs unchanged
  - Check for: regex match test (returns original if no match), or explicit `git@` check

### Step 9: Implement scenario 17 (cross-cutting — no silent process.cwd defaults)

- **`Then every git execSync call in repo-specific functions accepts a cwd parameter`**
  - NOTE: This scenario has three Given steps reading three different files. Only `sharedCtx` holds the last-read file. Must read all three files explicitly via `readFileSync`.
  - Read `adws/vcs/worktreeOperations.ts`, `adws/github/githubApi.ts`, `adws/github/githubAppAuth.ts`
  - For each file: find `execSync('git ` calls in repo-specific functions, assert each has `cwd` in its options object

### Step 10: Implement scenario 18 (TypeScript integrity)

This scenario uses steps not defined elsewhere:

- **`When "bunx tsc --noEmit" and "bunx tsc --noEmit -p adws/tsconfig.json" are run`**
  - Use `spawnSync('bunx', ['tsc', '--noEmit'], { cwd: ROOT, encoding: 'utf-8', timeout: 120_000 })` for the first command
  - Use `spawnSync('bunx', ['tsc', '--noEmit', '-p', 'adws/tsconfig.json'], { cwd: ROOT, encoding: 'utf-8', timeout: 120_000 })` for the second
  - Store both results on `this` (Cucumber World): `this.tscResult1`, `this.tscResult2`

- **`Then both type-check commands exit with code 0`**
  - Assert `this.tscResult1.status === 0` with stderr output in error message
  - Assert `this.tscResult2.status === 0` with stderr output in error message

### Step 11: Implement scenario 19 (e2e — external target repo .env)

Context-only Given/When steps + static analysis Then steps:

- **`Given an external target repo exists at a workspace path`** — context-only no-op (pass-through)
- **`Given the target repo has its own .env file`** — context-only no-op
- **`Given the ADW repo has a different .env file`** — context-only no-op
- **`When ensureWorktree is called with the target repo's baseRepoPath`** — load `adws/vcs/worktreeCreation.ts` via `readFileSync` into `this.fileContent` and `sharedCtx`
- **`Then the worktree's .env file matches the target repo's .env`** — static analysis: verify `copyEnvToWorktree` receives `baseRepoPath` in `ensureWorktree`, asserting `getMainRepoPath(baseRepoPath)` pattern exists in `worktreeOperations.ts`
- **`Then the worktree's .env file does not match the ADW repo's .env`** — static analysis: verify `baseRepoPath` overrides the default `process.cwd()` behavior

### Step 12: Implement scenario 20 (e2e — auto-merge external repo)

- **`Given a pull_request_review webhook payload for repository {string}`** — context-only, store repo name on `this.webhookRepo`
- **`Given the review state is {string}`** — context-only, store on `this.reviewState`
- **`When the auto-merge handler processes the webhook`** — load `adws/triggers/autoMergeHandler.ts` via `readFileSync` into `this.fileContent` and `sharedCtx`
- **`Then the worktree is created inside the vestmatic workspace path`** — static analysis: verify `getTargetRepoWorkspacePath` is called with owner/repo from the payload, and the result is passed to `ensureWorktree`
- **`Then the worktree is not created inside the ADW repository directory`** — static analysis: verify `ensureWorktree` receives a non-null `baseRepoPath`/`targetRepoWorkspacePath` (not `undefined` and not `process.cwd()`)

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317" --dry-run` — Verify 0 undefined steps across all 20 scenarios
2. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317 and @regression"` — Run regression-tagged @adw-317 scenarios
3. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317"` — Run all 20 @adw-317 scenarios
4. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Full regression suite to verify zero regressions

## Patch Scope
**Lines of code to change:** ~280 (1 new step definitions file)
**Risk level:** low — new file only, no existing code modified
**Testing required:** All 20 `@adw-317` BDD scenarios must have defined steps (0 Undefined in `--dry-run`). All pass when source code changes from the original spec are applied.
