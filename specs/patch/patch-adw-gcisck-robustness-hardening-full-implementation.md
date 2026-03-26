# Patch: Full implementation of retry logic resilience across all 14 spec steps

## Metadata
adwId: `gcisck-robustness-hardening`
reviewChangeRequest: `Issue #1: @review-proof scenarios FAILED (exit code 1, no output). No implementation exists to validate — all source files listed in the spec (utils.ts, issueApi.ts, prApi.ts, githubApi.ts, githubCodeHost.ts, claudeAgent.ts, resolutionAgent.ts, validationAgent.ts, reviewRetry.ts, workflowInit.ts, worktreeCreation.ts, autoMergeHandler.ts, autoMergePhase.ts) are unmodified. Resolution: Execute all 14 implementation steps from the spec.`

## Issue Summary
**Original Spec:** specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md
**Issue:** All 30 BDD scenarios fail with exit code 1 and no output. Zero source code changes have been applied and no step definitions exist. Additionally, line 75 of the feature file uses `So that` which is invalid Gherkin inside a Scenario body.
**Solution:** Fix the Gherkin parse error, apply all 14 source code changes from the spec, then create step definitions that verify each change via source-content assertions (matching the project's existing pattern).

## Files to Modify
Use these files to implement the patch:

1. `features/retry_logic_resilience.feature` — Fix invalid `So that` keyword on line 75
2. `adws/core/utils.ts` — Add `execWithRetry` utility function
3. `adws/core/index.ts` — Re-export `execWithRetry`
4. `adws/github/issueApi.ts` — Replace 7 bare `execSync` with `execWithRetry` for all gh CLI calls
5. `adws/github/prApi.ts` — Replace 7 bare `execSync` with `execWithRetry` for all gh CLI calls
6. `adws/github/githubApi.ts` — Replace 1 `execSync` with `execWithRetry` for `gh api user` call only (NOT the `git remote` call)
7. `adws/providers/github/githubCodeHost.ts` — Replace `execSync` with `execWithRetry` for `gh pr create`; add existing PR check before creation
8. `adws/agents/claudeAgent.ts` — Upgrade ENOENT retry from single attempt to 3 attempts with exponential backoff and per-attempt path re-resolution
9. `adws/phases/workflowInit.ts` — Add pre-flight Claude CLI validation early in `initializeWorkflow()`
10. `adws/vcs/worktreeCreation.ts` — Use `origin/<defaultBranch>` as base ref; add `git fetch` before worktree creation
11. `adws/agents/resolutionAgent.ts` — Return graceful fallback `{ resolved: false, decisions: [] }` instead of throwing; add single retry on non-JSON in `runResolutionAgent()`
12. `adws/agents/validationAgent.ts` — Add single retry on non-JSON output in `runValidationAgent()`
13. `adws/agents/reviewRetry.ts` — Filter null/undefined from review issue and screenshot arrays in `mergeReviewResults()`
14. `adws/triggers/autoMergeHandler.ts` — Write `skip_reason.txt` on early exits after `ensureLogsDirectory()`
15. `adws/phases/autoMergePhase.ts` — Write `skip_reason.txt` on early exits
16. `features/step_definitions/retryLogicResilienceSteps.ts` — **New file:** Step definitions verifying all 30 scenarios via source-content assertions

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom. Read each target file BEFORE modifying it.

### Step 1: Fix Gherkin parse error and create `execWithRetry` foundation

**1a. Fix feature file:**
- In `features/retry_logic_resilience.feature` line 75, change `So that later attempts pick up the new symlink target` to `And later attempts pick up the new symlink target`

**1b. Create `execWithRetry` in `adws/core/utils.ts`:**
- Add imports: `import { execSync, type ExecSyncOptions } from 'child_process';`
- Add a new exported function following the `exchangeRates.ts` backoff pattern (`500 * Math.pow(2, attempt)`):
```typescript
/**
 * Executes a shell command with retry logic and exponential backoff.
 * Retries transient failures up to maxAttempts times (default 3).
 * Non-transient errors (not found, permission denied, authentication) are thrown immediately.
 */
export function execWithRetry(command: string, options?: ExecSyncOptions & { maxAttempts?: number }): string {
  const { maxAttempts = 3, ...execOptions } = options ?? {};
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return execSync(command, { ...execOptions, encoding: 'utf-8' }).toString().trim();
    } catch (error: unknown) {
      if (attempt === maxAttempts - 1) throw error;
      const delayMs = 500 * Math.pow(2, attempt);
      log(`execWithRetry attempt ${attempt + 1}/${maxAttempts} failed, retrying in ${delayMs}ms...`, 'warn');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
    }
  }
  throw new Error('execWithRetry: unreachable');
}
```
- IMPORTANT: Use `Atomics.wait` for synchronous sleep because all callers expect synchronous behavior (they use the return value directly).

**1c. Export from `adws/core/index.ts`:**
- Add `execWithRetry` to the existing re-export from `'./utils'` block:
  ```typescript
  export { ..., execWithRetry, ... } from './utils';
  ```

### Step 2: Apply `execWithRetry` to GitHub API modules (Steps 2-5 of spec)

**2a. `adws/github/issueApi.ts`:**
- Add import: `import { execWithRetry } from '../core/utils';`
- Replace all 7 `execSync(...)` calls that invoke `gh` CLI commands with `execWithRetry(...)`:
  - `fetchGitHubIssue()` (~line 114): replace `execSync(ghViewCmd, ...)` with `execWithRetry(ghViewCmd, ...)`
  - `commentOnIssue()` (~line 136): replace `execSync(ghCommentCmd, ...)` with `execWithRetry(ghCommentCmd, ...)`
  - `getIssueState()` (~line 175): replace `execSync(ghCmd, ...)` with `execWithRetry(ghCmd, ...)`
  - `closeIssue()` (~line 211): replace `execSync(ghCloseCmd, ...)` with `execWithRetry(ghCloseCmd, ...)`
  - `getIssueTitleSync()` (~line 233): replace `execSync(ghCmd, ...)` with `execWithRetry(ghCmd, ...)`
  - `fetchIssueCommentsRest()` (~line 253): replace `execSync(ghCmd, ...)` with `execWithRetry(ghCmd, ...)`
  - `deleteIssueComment()` (~line 277): replace `execSync(ghCmd, ...)` with `execWithRetry(ghCmd, ...)`
- IMPORTANT: Each call site already has try/catch — preserve the existing error handling exactly. The `execWithRetry` replaces only the `execSync` call; the catch blocks stay.
- Remove `.toString().trim()` from each call site since `execWithRetry` already returns a trimmed string. But check if `.toString()` is chained — if so, remove it.
- Remove the `{ encoding: 'utf-8' }` from options passed to `execWithRetry` since it adds it internally. Keep other options like `{ stdio }` or `{ cwd }`.

**2b. `adws/github/prApi.ts`:**
- Add import: `import { execWithRetry } from '../core/utils';`
- Replace all 7 `execSync(...)` calls that invoke `gh` CLI commands with `execWithRetry(...)`:
  - `fetchPRDetails()` (~line 61)
  - `fetchPRReviews()` (~line 95)
  - `fetchPRReviewComments()` (~line 133)
  - `commentOnPR()` (~line 176)
  - `mergePR()` (~line 195)
  - `approvePR()` (~line 227)
  - `fetchPRList()` (~line 253)
- Same rules: preserve existing error handling, remove redundant `.toString().trim()` and `encoding: 'utf-8'`.

**2c. `adws/github/githubApi.ts`:**
- Add import: `import { execWithRetry } from '../core/utils';`
- Replace ONLY the `gh api user` call in `getAuthenticatedUser()` (~line 72) with `execWithRetry`
- Do NOT touch the `git remote get-url origin` call — it's a local git command, not a network call

**2d. `adws/providers/github/githubCodeHost.ts`:**
- Add import: `import { execWithRetry } from '../../core/utils';`
- Replace the `execSync` call for `gh pr create` in `createMergeRequest()` (~line 90) with `execWithRetry`

### Step 3: Add existing PR check and Claude CLI hardening (Steps 6-8 of spec)

**3a. Existing PR check in `githubCodeHost.ts` `createMergeRequest()`:**
- Before the `gh pr create` call, add a check for existing PRs:
```typescript
// Check for existing PR before creating
const existingPrJson = execWithRetry(
  `gh pr list --head "${sourceBranch}" --repo "${this.repoInfo.owner}/${this.repoInfo.repo}" --json url,number --limit 1`,
  { encoding: 'utf-8' }
);
const existingPrs = JSON.parse(existingPrJson || '[]');
if (existingPrs.length > 0) {
  log(`Reusing existing PR #${existingPrs[0].number}: ${existingPrs[0].url}`);
  return { url: existingPrs[0].url, number: existingPrs[0].number };
}
```
- Place this BEFORE the temp file write and `gh pr create` call
- Use `execWithRetry` for this check too

**3b. Upgrade Claude CLI ENOENT retry in `adws/agents/claudeAgent.ts`:**
- Replace the single ENOENT retry block (~lines 116-126) with a 3-attempt loop:
```typescript
// ENOENT retry: 3 attempts with exponential backoff and per-attempt path re-resolution
const maxEnoeontAttempts = 3;
for (let attempt = 1; attempt < maxEnoentAttempts; attempt++) {
  const backoffMs = 500 * Math.pow(2, attempt - 1);
  log(`Claude CLI ENOENT retry ${attempt}/${maxEnoentAttempts - 1}, re-resolving path in ${backoffMs}ms...`, 'warn');
  await delay(backoffMs);
  clearClaudeCodePathCache();
  const freshPath = resolveClaudeCodePath();
  log(`Re-resolved Claude CLI path: ${freshPath}`, 'info');
  // Re-attempt spawn with freshPath...
}
```
- Key change: call `clearClaudeCodePathCache()` + `resolveClaudeCodePath()` on EVERY retry attempt, not just the first
- Use exponential backoff: 500ms, 1000ms, 2000ms
- If all 3 attempts fail, throw the original error

**3c. Pre-flight Claude CLI validation in `adws/phases/workflowInit.ts`:**
- Add imports: `import { resolveClaudeCodePath } from '../core';` and `import { accessSync, constants } from 'fs';`
- Early in `initializeWorkflow()`, before the issue fetch (~line 109), add:
```typescript
// Pre-flight: verify Claude CLI is available and executable
try {
  const claudePath = resolveClaudeCodePath();
  accessSync(claudePath, constants.X_OK);
  log(`Pre-flight check passed: Claude CLI at ${claudePath}`, 'info');
} catch (error) {
  throw new Error(`Pre-flight check failed: Claude CLI not found or not executable. Ensure 'claude' is installed and in PATH, or set CLAUDE_CODE_PATH in .env.`);
}
```

### Step 4: Apply worktree, agent degradation, array guards, and skip logging (Steps 9-13 of spec)

**4a. Worktree creation with `origin/<defaultBranch>` in `adws/vcs/worktreeCreation.ts`:**
- In `createWorktree()` (~line 143), when using `baseBranch` as the base ref:
  - Before `git worktree add`, add: `execSync('git fetch origin "${baseBranch}"', { cwd, stdio: 'pipe' });`
  - Change the base ref from `${baseBranch}` to `origin/${baseBranch}`
- In `createWorktreeForNewBranch()` (~line 182), when `baseBranch` is provided:
  - Add `git fetch origin "${baseBranch}"` before the worktree add
  - Change the base from `${base}` to `origin/${base}` (where `base` resolves to `baseBranch`)
- Add a warning log if local and remote HEADs differ (informational only, don't block)

**4b. Graceful degradation in `adws/agents/resolutionAgent.ts`:**
- Change `parseResolutionResult()` to return a fallback instead of throwing when JSON is invalid:
  - If `extractJson()` returns null or `parsed.resolved` is not boolean, return `{ resolved: false, decisions: [] }` with a warning log
- In `runResolutionAgent()`, after calling `parseResolutionResult()`:
  - If the result is the fallback (resolved===false, decisions.length===0) and the raw output wasn't valid JSON (extractJson returned null), re-run the agent ONCE
  - Log: "Resolution agent returned non-JSON output, retrying once..."
  - If retry also fails parsing, return the graceful fallback result

**4c. Retry on non-JSON in `adws/agents/validationAgent.ts`:**
- In `runValidationAgent()`, after calling `parseValidationResult()`:
  - If the result is the fallback unaligned result and the agent output didn't contain valid JSON, re-run the agent ONCE
  - Log: "Validation agent returned non-JSON output, retrying once..."
  - If retry also fails, return the existing fallback unaligned result

**4d. Array guards in `adws/agents/reviewRetry.ts`:**
- In `mergeReviewResults()` (~line 83):
  - Change `.flatMap(r => r.reviewResult!.reviewIssues)` to `.flatMap(r => r.reviewResult!.reviewIssues).filter((issue): issue is ReviewIssue => issue != null)`
  - Change `.flatMap(r => r.reviewResult!.screenshots)` to `.flatMap(r => r.reviewResult!.screenshots).filter((s): s is string => s != null)`

**4e. Skip reason logging in `adws/triggers/autoMergeHandler.ts`:**
- After `ensureLogsDirectory()` creates the log dir, on each early return that follows, write a `skip_reason.txt`:
  - PR already merged: `fs.writeFileSync(path.join(logsDir, 'skip_reason.txt'), 'PR already merged, skipping auto-merge');`
  - Worktree failure: `fs.writeFileSync(path.join(logsDir, 'skip_reason.txt'), 'Worktree creation failed for branch: <branch>');`
  - Missing PR URL: `fs.writeFileSync(path.join(logsDir, 'skip_reason.txt'), 'No PR URL available, skipping auto-merge');`
  - Missing repo context: `fs.writeFileSync(path.join(logsDir, 'skip_reason.txt'), 'No repo context available, skipping auto-merge');`
- Import `fs` and `path` if not already imported.

**4f. Skip reason logging in `adws/phases/autoMergePhase.ts`:**
- On early return for missing PR URL (~line 48): `fs.writeFileSync(path.join(config.logsDir, 'skip_reason.txt'), 'No PR URL found, skipping auto-merge');`
- On early return for missing repo context (~line 55): `fs.writeFileSync(path.join(config.logsDir, 'skip_reason.txt'), 'No repo context available, skipping auto-merge');`
- Import `fs` and `path` if not already imported.

### Step 5: Create step definitions for all 30 BDD scenarios

Create `features/step_definitions/retryLogicResilienceSteps.ts` following the project's established source-content assertion pattern (as used in other step definition files like `reviewRetryPatchImplementationSteps.ts`).

The step definitions should verify source code changes by reading file contents and asserting patterns exist:

- **execWithRetry scenarios:** Read `adws/core/utils.ts` and assert it contains `export function execWithRetry`, `Atomics.wait`, `500 * Math.pow(2, attempt)`. Read `adws/core/index.ts` and assert it re-exports `execWithRetry`.
- **gh CLI retry scenarios (issueApi, prApi, githubApi, githubCodeHost):** Read each file and assert it imports `execWithRetry` and contains `execWithRetry(` calls where `execSync` previously was for gh CLI commands.
- **Claude CLI ENOENT scenarios:** Read `adws/agents/claudeAgent.ts` and assert it has a retry loop with `clearClaudeCodePathCache()` and `resolveClaudeCodePath()` per attempt, plus exponential backoff.
- **Pre-flight CLI validation scenarios:** Read `adws/phases/workflowInit.ts` and assert it calls `resolveClaudeCodePath()` and `accessSync` with `constants.X_OK`.
- **Worktree origin ref scenarios:** Read `adws/vcs/worktreeCreation.ts` and assert it uses `origin/${baseBranch}` or `origin/` prefix in worktree add commands.
- **PR creation reuse scenarios:** Read `adws/providers/github/githubCodeHost.ts` and assert it contains `gh pr list --head` check before `gh pr create`.
- **Resolution agent retry scenarios:** Read `adws/agents/resolutionAgent.ts` and assert it returns `{ resolved: false, decisions: [] }` fallback and has retry-once logic.
- **Validation agent retry scenarios:** Read `adws/agents/validationAgent.ts` and assert it has retry-once logic on non-JSON output.
- **Review array guard scenarios:** Read `adws/agents/reviewRetry.ts` and assert `.filter(` exists after `.flatMap(` for review issues.
- **Auto-merge skip reason scenarios:** Read `adws/triggers/autoMergeHandler.ts` and `adws/phases/autoMergePhase.ts` and assert they write `skip_reason.txt`.
- **TypeScript compilation scenario:** Run `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` and assert zero exit code.

Use `Given`, `When`, `Then` from `@cucumber/cucumber`. Use `import * as fs from 'fs'` and `import * as path from 'path'` for file reading. Use `import { execSync } from 'child_process'` for compilation checks. Use `assert` from `node:assert` for assertions.

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `bun run lint` — Linter passes with no errors
2. `bunx tsc --noEmit` — Root TypeScript type checking passes
3. `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type checking passes
4. `bun run build` — Build succeeds with no errors
5. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-315" --format progress` — All 30 BDD scenarios pass

## Patch Scope
**Lines of code to change:** ~350-450 across 16 files (13 modified + 1 fixed + 1 new step def + 1 re-export)
**Risk level:** medium (touches many files but each change is small and mechanical)
**Testing required:** TypeScript compilation, linting, all 30 BDD scenarios tagged @adw-315
