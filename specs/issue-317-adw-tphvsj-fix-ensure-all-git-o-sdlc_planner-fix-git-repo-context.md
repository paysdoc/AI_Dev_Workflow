# Bug: Ensure all git operations target the correct repository context

## Metadata
issueNumber: `317`
adwId: `tphvsj-fix-ensure-all-git-o`
issueJson: `{"number":317,"title":"Fix: ensure all git operations target the correct repository context","body":"## Problem\n\nMultiple git operations in the ADW codebase default to `process.cwd()` (the ADW repo) when they should target an external repo. This is a systemic issue — the ADW processes issues for both itself and external target repos (e.g., vestmatic/vestmatic), but several code paths don't thread the target repo path through to git commands.\n\nThis causes recurring failures such as:\n- Auto-merge handler creating worktrees in the wrong repo\n- `git fetch origin` failing with \"could not read Username\" because it's fetching from the wrong remote\n- Branch not found errors when the branch exists in the target repo but not in the ADW repo\n- `.env` files copied from the ADW repo into target repo worktrees\n\n## Affected Call Sites\n\n| Severity | File | Line | Function | Problem |\n|---|---|---|---|---|\n| CRITICAL | `autoMergeHandler.ts` | 231 | `ensureWorktree(headBranch)` | No `baseRepoPath` — target repo PRs create worktrees in ADW repo |\n| HIGH | `worktreeOperations.ts` | 81-106 | `copyEnvToWorktree()` | Function doesn't accept `baseRepoPath` at all — always copies `.env` from ADW repo |\n| HIGH | `worktreeCreation.ts` | 209 | `copyEnvToWorktree()` call | Called without repo context even when parent received `baseRepoPath` |\n| MEDIUM | `githubApi.ts` | 18 | `getRepoInfo()` | `git remote get-url origin` hardcoded to `process.cwd()` |\n| MEDIUM | `githubAppAuth.ts` | 180 | Git remote read | `git remote get-url origin` hardcoded to `process.cwd()` |\n| MEDIUM | `workflowInit.ts` | 181 | `findWorktreeForIssue()` | Missing `cwd` parameter (correct today but fragile) |\n\n## Root Cause\n\nInconsistent API design: some VCS functions accept `baseRepoPath`/`cwd`, others don't. Callers sometimes forget to pass the parameter, and the silent fallback to `process.cwd()` makes the bug invisible until it hits a target repo.\n\n## Solution\n\n**Design principle: every git operation must explicitly receive its repo context. No silent defaults to `process.cwd()`.**\n\n### 1. Add `baseRepoPath`/`cwd` parameter to functions that lack it\n\n- `copyEnvToWorktree(worktreePath, baseRepoPath?)` — copy `.env` from the correct source repo\n- `getRepoInfo(cwd?)` — read remote URL from the correct repo\n- `githubAppAuth.ts` git remote read — accept `cwd`\n\n### 2. Fix auto-merge handler\n\n- Extract target repo info from the webhook payload (the `repository` field contains owner/repo)\n- Derive the target repo workspace path via `getTargetRepoWorkspacePath()`\n- Pass `baseRepoPath` to `ensureWorktree()` — same pattern already used in `webhookHandlers.ts` and `prReviewPhase.ts`\n\n### 3. Thread repo context through all callers\n\n- `worktreeCreation.ts:209` — pass `baseRepoPath` to `copyEnvToWorktree()` when available\n- `workflowInit.ts:181` — pass `targetRepoWorkspacePath` to `findWorktreeForIssue()` (defensive)\n- `workflowInit.ts:186,201` — pass repo context to `copyEnvToWorktree()`\n\n### 4. Convert target repo clone URLs to SSH\n\nIn `targetRepoManager.ts`, when cloning a new target repo, convert HTTPS URLs (`https://github.com/owner/repo`) to SSH format (`git@github.com:owner/repo.git`). This prevents `git fetch` from failing with \"could not read Username\" in non-interactive contexts (cron/webhook triggers).\n\nExisting repos with HTTPS remotes are left as-is (manual conversion by operator).\n\n## Acceptance Criteria\n\n- [ ] `copyEnvToWorktree()` accepts and uses `baseRepoPath` parameter\n- [ ] `getRepoInfo()` accepts `cwd` parameter\n- [ ] Auto-merge handler passes target repo path to `ensureWorktree()`\n- [ ] All VCS function callers in `workflowInit.ts` pass repo context when available\n- [ ] New target repo clones use SSH URLs\n- [ ] No git operations silently default to `process.cwd()` for repo-specific operations","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-26T07:45:33Z","comments":[],"actionableComment":null}`

## Bug Description
Multiple git operations in the ADW codebase default to `process.cwd()` (the ADW repo) when they should target an external target repository. ADW processes issues for both itself and external repos (e.g., vestmatic/vestmatic), but several code paths don't thread the target repo path through to git commands. This causes:

- **Auto-merge handler** creates worktrees in the ADW repo instead of the target repo
- **`git fetch origin`** fails with "could not read Username" because it fetches from the wrong remote (HTTPS URL in non-interactive context)
- **Branch not found** errors when the branch exists in the target repo but not in the ADW repo
- **`.env` files** copied from the ADW repo into target repo worktrees (wrong configuration)

## Problem Statement
Inconsistent API design: some VCS/GitHub functions accept `baseRepoPath`/`cwd`, others don't. Callers sometimes forget to pass the parameter. The silent fallback to `process.cwd()` makes the bug invisible until it hits a target repo workflow. Six call sites across four files need fixing, plus one URL format issue.

## Solution Statement
Thread explicit repository context (`baseRepoPath`/`cwd`) through every git operation that currently defaults to `process.cwd()`. The fix adds optional `cwd`/`baseRepoPath` parameters to three functions (`copyEnvToWorktree`, `getRepoInfo`, `activateGitHubAppAuth`), fixes the auto-merge handler to derive target repo workspace path from the webhook payload, threads repo context through all callers in `worktreeCreation.ts` and `workflowInit.ts`, and converts HTTPS clone URLs to SSH format in `targetRepoManager.ts`.

## Steps to Reproduce
1. Configure ADW to process issues from an external repository (e.g., vestmatic/vestmatic)
2. Create a PR in the external repo and get it approved (triggers auto-merge webhook)
3. Observe: `ensureWorktree(headBranch)` at `autoMergeHandler.ts:231` runs without `baseRepoPath`, creating the worktree under the ADW repo's `.worktrees/` directory instead of the target repo's
4. Observe: `copyEnvToWorktree()` copies the ADW repo's `.env` into the worktree instead of the target repo's `.env`
5. Observe: `git fetch origin` may fail with "could not read Username" if the target repo was cloned via HTTPS

## Root Cause Analysis
The root cause is an inconsistent API design pattern across the VCS and GitHub modules:

1. **`copyEnvToWorktree(worktreePath)`** — accepts only the worktree path, calls `getMainRepoPath()` without `cwd`, which always resolves to the ADW repo's main path. The sibling function `getWorktreesDir(baseRepoPath?)` correctly accepts the parameter, but `copyEnvToWorktree` was never updated to match.

2. **`ensureWorktree(branchName, baseBranch?, baseRepoPath?)`** — correctly accepts `baseRepoPath` and passes it to `getWorktreeForBranch()` and `createWorktree()`, but fails to pass it through to `copyEnvToWorktree()` calls at lines 203 and 209.

3. **`getRepoInfo()`** — no parameters at all, always runs `git remote get-url origin` against `process.cwd()`. Callers use `repoInfo ?? getRepoInfo()` fallback, which silently reads the ADW repo's remote when no explicit `repoInfo` is provided.

4. **`activateGitHubAppAuth(owner?, repo?)`** — when called without explicit `owner`/`repo`, falls back to `git remote get-url origin` without `cwd`, resolving to the ADW repo.

5. **`handleApprovedReview(body)`** — correctly extracts `repoFullName` from the webhook payload and derives `repoInfo`, but never derives the target repo workspace path. Calls `ensureWorktree(headBranch)` without `baseRepoPath`, creating the worktree in the wrong repo.

6. **`workflowInit.ts`** — the `targetRepoWorkspacePath` variable is correctly set up (line 148-154) but not threaded through to `findWorktreeForIssue()` (line 181), `copyEnvToWorktree()` (lines 186, 201).

7. **`targetRepoManager.ts`** — clones repos using whatever URL is provided (usually HTTPS from GitHub webhooks). In non-interactive contexts, HTTPS URLs fail with "could not read Username" because there's no terminal for credential prompts.

## Relevant Files
Use these files to fix the bug:

- `guidelines/coding_guidelines.md` — Coding guidelines that must be followed. Read before making changes.
- `adws/vcs/worktreeOperations.ts` — Contains `copyEnvToWorktree()` (line 81) and `getMainRepoPath()` (line 55). The `copyEnvToWorktree` function needs a `baseRepoPath` parameter to pass to `getMainRepoPath()`.
- `adws/vcs/worktreeCreation.ts` — Contains `ensureWorktree()` (line 198). Two `copyEnvToWorktree()` calls at lines 203 and 209 need to pass `baseRepoPath`.
- `adws/github/githubApi.ts` — Contains `getRepoInfo()` (line 16). Needs optional `cwd` parameter passed to `execSync`.
- `adws/github/githubAppAuth.ts` — Contains `activateGitHubAppAuth()` (line 172). The git remote fallback at line 180 needs `cwd` support.
- `adws/triggers/autoMergeHandler.ts` — Contains `handleApprovedReview()` (line 184). Needs to derive target repo workspace path and pass `baseRepoPath` to `ensureWorktree()` at line 231.
- `adws/phases/workflowInit.ts` — Contains `initializeWorkflow()`. Lines 181, 186, 201 need to pass `targetRepoWorkspacePath` to VCS functions.
- `adws/core/targetRepoManager.ts` — Contains `cloneTargetRepo()` (line 34). Needs to convert HTTPS clone URLs to SSH format before cloning.
- `adws/vcs/index.ts` — VCS barrel export. No signature changes expected but verify `copyEnvToWorktree` export stays consistent.
- `adws/github/index.ts` — GitHub barrel export. Verify exports stay consistent.
- `adws/triggers/webhookHandlers.ts` — Reference file showing the correct pattern for deriving target repo workspace path from webhook payloads (lines 69-71).
- `adws/phases/prReviewPhase.ts` — Reference file showing the correct pattern for passing `baseRepoPath` to `ensureWorktree()` (line 99).
- `features/fix_git_repo_context.feature` — Existing BDD scenarios for this issue. Do not modify.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add `baseRepoPath` parameter to `copyEnvToWorktree()`
- Read `adws/vcs/worktreeOperations.ts`
- Change the function signature from `copyEnvToWorktree(worktreePath: string): void` to `copyEnvToWorktree(worktreePath: string, baseRepoPath?: string): void`
- Update the JSDoc comment to document the new `baseRepoPath` parameter
- Change line 83 from `const mainRepoPath = getMainRepoPath();` to `const mainRepoPath = getMainRepoPath(baseRepoPath);`
- This threads the repo context to `getMainRepoPath(cwd?)` which already accepts the parameter

### Step 2: Thread `baseRepoPath` through `ensureWorktree()` to `copyEnvToWorktree()`
- Read `adws/vcs/worktreeCreation.ts`
- At line 203, change `copyEnvToWorktree(existingPath)` to `copyEnvToWorktree(existingPath, baseRepoPath)`
- At line 209, change `copyEnvToWorktree(worktreePath)` to `copyEnvToWorktree(worktreePath, baseRepoPath)`
- This ensures that when `ensureWorktree` is called with a `baseRepoPath`, it propagates to the `.env` copy operation

### Step 3: Add `cwd` parameter to `getRepoInfo()`
- Read `adws/github/githubApi.ts`
- Change the function signature from `getRepoInfo(): RepoInfo` to `getRepoInfo(cwd?: string): RepoInfo`
- Update the JSDoc comment to document the new `cwd` parameter
- Change line 18 from `execSync('git remote get-url origin', { encoding: 'utf-8' })` to `execSync('git remote get-url origin', { encoding: 'utf-8', cwd })`
- All existing callers pass no arguments, so backward compatibility is preserved

### Step 4: Add `cwd` parameter to `activateGitHubAppAuth()` git remote fallback
- Read `adws/github/githubAppAuth.ts`
- Change the function signature from `activateGitHubAppAuth(owner?: string, repo?: string): boolean` to `activateGitHubAppAuth(owner?: string, repo?: string, cwd?: string): boolean`
- Update the JSDoc to document the new `cwd` parameter
- At line 180, change `execSync('git remote get-url origin', { encoding: 'utf-8' })` to `execSync('git remote get-url origin', { encoding: 'utf-8', cwd })`
- All existing callers either pass explicit `owner`/`repo` (so the fallback is never reached) or run from the ADW repo's `process.cwd()` (where the default is correct), so no caller changes are needed for this parameter

### Step 5: Fix auto-merge handler to pass `baseRepoPath` to `ensureWorktree()`
- Read `adws/triggers/autoMergeHandler.ts`
- Read `adws/triggers/webhookHandlers.ts` lines 69-71 for the correct pattern
- Import `getTargetRepoWorkspacePath` from `'../core'` and `existsSync` from `'fs'`
- After line 226 (after `const adwId = ...`), add logic to derive the target repo workspace path from the webhook payload:
  ```typescript
  // Derive target repo workspace path from webhook payload
  const targetRepoWorkspacePath = (() => {
    const workspacePath = getTargetRepoWorkspacePath(repoInfo.owner, repoInfo.repo);
    return existsSync(workspacePath) ? workspacePath : undefined;
  })();
  ```
- At line 231, change `worktreePath = ensureWorktree(headBranch);` to `worktreePath = ensureWorktree(headBranch, undefined, targetRepoWorkspacePath);`
- The `repoInfo` is already extracted from the webhook payload at line 201 via `getRepoInfoFromPayload(repoFullName)`, so `repoInfo.owner` and `repoInfo.repo` are correct

### Step 6: Thread `targetRepoWorkspacePath` through `workflowInit.ts` callers
- Read `adws/phases/workflowInit.ts`
- At line 181, change `findWorktreeForIssue(issueType, issueNumber)` to `findWorktreeForIssue(issueType, issueNumber, targetRepoWorkspacePath)` — this is a defensive change; the `else` block at line 179 only executes when `targetRepoWorkspacePath` is falsy today, but threading the parameter prevents future regressions if the control flow changes
- At line 186, change `copyEnvToWorktree(worktreePath)` to `copyEnvToWorktree(worktreePath, targetRepoWorkspacePath)`
- At line 201, change `copyEnvToWorktree(existingWorktree)` to `copyEnvToWorktree(existingWorktree, targetRepoWorkspacePath)`
- Note: the `targetRepoWorkspacePath` variable is already defined at line 148 and available in scope

### Step 7: Convert HTTPS clone URLs to SSH in `targetRepoManager.ts`
- Read `adws/core/targetRepoManager.ts`
- Add a pure helper function `convertToSshUrl(cloneUrl: string): string` that:
  - Matches HTTPS GitHub URLs: `https://github.com/{owner}/{repo}` (with optional `.git` suffix)
  - Converts them to SSH format: `git@github.com:{owner}/{repo}.git`
  - Returns non-HTTPS URLs (already SSH or other formats) unchanged
- In `cloneTargetRepo()`, before the `execSync` call at line 39, convert the URL: `const sshUrl = convertToSshUrl(cloneUrl);` and use `sshUrl` instead of `cloneUrl` in the git clone command
- Also update the log messages to show the original URL and the converted URL when they differ
- In `ensureTargetRepoWorkspace()`, pass the converted URL to `cloneTargetRepo()` — or let `cloneTargetRepo()` handle the conversion internally (preferred, single responsibility)

### Step 8: Run validation commands
- Run `bun run lint` to check for code quality issues
- Run `bunx tsc --noEmit` to verify no type errors in root config
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify no type errors in adws config
- Run `bun run build` to verify no build errors
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317 and @regression"` to verify BDD scenarios pass

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type-check root TypeScript config
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check adws-specific TypeScript config
- `bun run build` — Build the application to verify no build errors
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-317 and @regression"` — Run issue-specific regression BDD scenarios
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run full regression suite to verify zero regressions

## Notes
- Strictly adhere to `guidelines/coding_guidelines.md` — clarity over cleverness, modularity, type safety, meaningful error messages.
- All parameter additions are optional (`?`), preserving backward compatibility. No existing callers need changes unless they should be passing repo context (the bug).
- The `convertToSshUrl()` helper is a pure function (same input → same output, no side effects) consistent with the functional programming guidelines.
- The `findWorktreeForIssue` already accepts `cwd?: string` as its third parameter (line 58-61 of `worktreeQuery.ts`), so no signature change is needed there — just pass the argument from the caller.
- The `getRepoInfo(cwd?)` change does not affect `trigger_cron.ts` line 37 (`const cronRepoInfo = getRepoInfo()`) because the cron process runs with its `cwd` already set to the correct repo.
- Reference patterns for the correct approach already exist in `webhookHandlers.ts` (lines 69-71) and `prReviewPhase.ts` (line 99) — this fix applies the same pattern consistently.
- Existing repos cloned via HTTPS are left as-is (the SSH conversion only applies to new clones). Operators can manually convert existing HTTPS remotes if needed.
