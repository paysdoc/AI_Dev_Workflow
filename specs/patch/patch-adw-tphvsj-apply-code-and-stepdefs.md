# Patch: Execute all 8 spec implementation steps and implement BDD step definitions

## Metadata
adwId: `tphvsj`
reviewChangeRequest: `specs/issue-317-adw-tphvsj-fix-ensure-all-git-o-sdlc_planner-fix-git-repo-context.md`

## Issue Summary
**Original Spec:** `specs/issue-317-adw-tphvsj-fix-ensure-all-git-o-sdlc_planner-fix-git-repo-context.md`
**Issue:** The spec defines 8 implementation steps across 7 production files, but git diff confirms zero production code was changed. The 4 commits labeled "fix #317" only added patch spec documents, the feature file, and the spec itself. Additionally, all @adw-317 BDD scenarios fail with undefined step definitions (no step definition file exists).
**Solution:** Execute all 8 implementation steps from the spec (modify 7 production files) and create the step definition file for the BDD scenarios.

## Files to Modify

1. `adws/vcs/worktreeOperations.ts` — Add `baseRepoPath` param to `copyEnvToWorktree()`
2. `adws/vcs/worktreeCreation.ts` — Thread `baseRepoPath` to `copyEnvToWorktree()` calls in `ensureWorktree()`
3. `adws/github/githubApi.ts` — Add `cwd` param to `getRepoInfo()`
4. `adws/github/githubAppAuth.ts` — Add `cwd` param to `activateGitHubAppAuth()` git remote fallback
5. `adws/triggers/autoMergeHandler.ts` — Derive target repo workspace path, pass `baseRepoPath` to `ensureWorktree()`
6. `adws/phases/workflowInit.ts` — Thread `targetRepoWorkspacePath` to `findWorktreeForIssue()` and `copyEnvToWorktree()`
7. `adws/core/targetRepoManager.ts` — Add `convertToSshUrl()` helper, use it in `cloneTargetRepo()`
8. `features/step_definitions/fixGitRepoContextSteps.ts` — **New file**: implement all undefined BDD step definitions

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add `baseRepoPath` parameter to `copyEnvToWorktree()`
- In `adws/vcs/worktreeOperations.ts`:
  - Change function signature at line 81 from `copyEnvToWorktree(worktreePath: string): void` to `copyEnvToWorktree(worktreePath: string, baseRepoPath?: string): void`
  - Change line 83 from `const mainRepoPath = getMainRepoPath();` to `const mainRepoPath = getMainRepoPath(baseRepoPath);`
  - `getMainRepoPath(cwd?)` already accepts the parameter — this just threads it through

### Step 2: Thread `baseRepoPath` through `ensureWorktree()` to `copyEnvToWorktree()`
- In `adws/vcs/worktreeCreation.ts`:
  - Line 203 (existing worktree reuse path): change `copyEnvToWorktree(existingPath)` to `copyEnvToWorktree(existingPath, baseRepoPath)`
  - Line 209 (new worktree creation path): change `copyEnvToWorktree(worktreePath)` to `copyEnvToWorktree(worktreePath, baseRepoPath)`
  - `ensureWorktree` already has `baseRepoPath` as its 3rd parameter — no signature change needed

### Step 3: Add `cwd` parameter to `getRepoInfo()`
- In `adws/github/githubApi.ts`:
  - Change signature at line 16 from `getRepoInfo(): RepoInfo` to `getRepoInfo(cwd?: string): RepoInfo`
  - Line 18: change `execSync('git remote get-url origin', { encoding: 'utf-8' })` to `execSync('git remote get-url origin', { encoding: 'utf-8', cwd })`
  - All existing callers pass no arguments — backward compatible

### Step 4: Add `cwd` parameter to `activateGitHubAppAuth()` git remote fallback
- In `adws/github/githubAppAuth.ts`:
  - Change signature at line 172 from `activateGitHubAppAuth(owner?: string, repo?: string): boolean` to `activateGitHubAppAuth(owner?: string, repo?: string, cwd?: string): boolean`
  - Line 180: change `execSync('git remote get-url origin', { encoding: 'utf-8' })` to `execSync('git remote get-url origin', { encoding: 'utf-8', cwd })`
  - All existing callers either pass explicit owner/repo or run from correct cwd — backward compatible

### Step 5: Fix auto-merge handler to pass `baseRepoPath` to `ensureWorktree()`
- In `adws/triggers/autoMergeHandler.ts`:
  - Add `existsSync` to the existing `fs` import (note: `fs` is not currently imported — add `import { existsSync } from 'fs';`)
  - Add `getTargetRepoWorkspacePath` to the `'../core'` import
  - After line 226 (`log(...Auto-merge: head=...)`), add:
    ```typescript
    // Derive target repo workspace path from webhook payload
    const targetRepoWorkspacePath = (() => {
      const workspacePath = getTargetRepoWorkspacePath(repoInfo.owner, repoInfo.repo);
      return existsSync(workspacePath) ? workspacePath : undefined;
    })();
    ```
  - Line 231: change `worktreePath = ensureWorktree(headBranch);` to `worktreePath = ensureWorktree(headBranch, undefined, targetRepoWorkspacePath);`
  - Reference pattern: `adws/triggers/webhookHandlers.ts` lines 69-71

### Step 6: Thread `targetRepoWorkspacePath` through `workflowInit.ts` callers
- In `adws/phases/workflowInit.ts`:
  - Line 181: change `findWorktreeForIssue(issueType, issueNumber)` to `findWorktreeForIssue(issueType, issueNumber, targetRepoWorkspacePath)` — defensive; `findWorktreeForIssue` already accepts `cwd?` as 3rd param
  - Line 186: change `copyEnvToWorktree(worktreePath)` to `copyEnvToWorktree(worktreePath, targetRepoWorkspacePath)`
  - Line 201: change `copyEnvToWorktree(existingWorktree)` to `copyEnvToWorktree(existingWorktree, targetRepoWorkspacePath)`
  - `targetRepoWorkspacePath` is already defined at line 148 and in scope

### Step 7: Convert HTTPS clone URLs to SSH in `targetRepoManager.ts`
- In `adws/core/targetRepoManager.ts`:
  - Add a pure helper function before `cloneTargetRepo()`:
    ```typescript
    /** Converts HTTPS GitHub URLs to SSH format for non-interactive contexts. Non-HTTPS URLs pass through unchanged. */
    export function convertToSshUrl(cloneUrl: string): string {
      const match = cloneUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
      return match ? `git@github.com:${match[1]}/${match[2]}.git` : cloneUrl;
    }
    ```
  - In `cloneTargetRepo()`, before the `execSync` git clone call (line 39):
    - Add `const sshUrl = convertToSshUrl(cloneUrl);`
    - Replace `cloneUrl` with `sshUrl` in the git clone command: `git clone "${sshUrl}" "${workspacePath}"`
    - Log the conversion when URLs differ: `if (sshUrl !== cloneUrl) log(\`Converted clone URL to SSH: ${sshUrl}\`, 'info');`

### Step 8: Create BDD step definitions
- Create **new file** `features/step_definitions/fixGitRepoContextSteps.ts`
- Follow existing patterns from `commonSteps.ts`: use `this.fileContent` (populated by `Given "{file}" is read` step)
- Implement all undefined Then steps from `features/fix_git_repo_context.feature`:
  - Source-code verification steps: use regex/string matching on `this.fileContent` to verify function signatures contain expected parameters, function bodies pass parameters to downstream calls, and import statements exist
  - TypeScript integrity scenario: use `execSync('bunx tsc --noEmit', ...)` and assert exit code 0
  - End-to-end scenarios (external repo .env, auto-merge directory): verify via source-code structural patterns that the code paths exist
  - No silent `process.cwd()` defaults: verify that the relevant functions accept cwd/baseRepoPath params

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `bun run lint` — Verify no linting errors across all modified files
2. `bunx tsc --noEmit` — Type-check root TypeScript config
3. `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check adws-specific config
4. `bun run build` — Verify no build errors
5. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317 and @regression"` — Run issue-specific regression BDD scenarios
6. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run full regression suite to verify zero regressions

## Patch Scope
**Lines of code to change:** ~250 (7 production files ~50 LOC changes + 1 new step definitions file ~200 LOC)
**Risk level:** low — all parameter additions are optional (`?`), preserving backward compatibility. No existing callers need changes unless they should be passing repo context (the bug).
**Testing required:** BDD scenarios tagged `@adw-317` and `@regression`, TypeScript type-check, lint, build
