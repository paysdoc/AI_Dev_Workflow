# Patch: Implement all source changes and step definitions for retry logic resilience

## Metadata
adwId: `gcisck-robustness-hardening`
reviewChangeRequest: `Issue #2: @adw-315 scenarios FAILED (exit code 1, no output). All 30 scenarios tagged @adw-315 fail because no implementation code or step definitions were written. Resolution: Complete the full implementation per the spec's 14-step task list, then re-run scenarios with 'NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-315"' to verify.`

## Issue Summary
**Original Spec:** specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md
**Issue:** All 30 BDD scenarios in `features/retry_logic_resilience.feature` fail with exit code 1 and no output. No source code changes (the 14-step task list) and no step definitions exist. Additionally, line 75 has `So that` which is an invalid Gherkin keyword in a Scenario body, causing a parse error.
**Solution:** Fix the Gherkin error, apply all 14 source code changes from the spec, then create step definitions that verify each change via source-content assertions (matching the project's established pattern in `reviewRetryPatchImplementationSteps.ts`).

## Files to Modify
Use these files to implement the patch:

1. `features/retry_logic_resilience.feature` — Fix `So that` → `And` on line 75
2. `adws/core/utils.ts` — Add `execWithRetry` utility function
3. `adws/core/index.ts` — Re-export `execWithRetry`
4. `adws/github/issueApi.ts` — Replace 7 `execSync` → `execWithRetry` for gh CLI calls
5. `adws/github/prApi.ts` — Replace 7 `execSync` → `execWithRetry` for gh CLI calls
6. `adws/github/githubApi.ts` — Replace 1 `execSync` → `execWithRetry` for `gh api user` call only
7. `adws/providers/github/githubCodeHost.ts` — Replace `execSync` → `execWithRetry` for `gh pr create`; add existing PR check before creation
8. `adws/agents/claudeAgent.ts` — Upgrade ENOENT retry from 1 attempt to 3 with exponential backoff and per-attempt path re-resolution
9. `adws/phases/workflowInit.ts` — Add pre-flight Claude CLI validation (resolve + executable check)
10. `adws/vcs/worktreeCreation.ts` — Use `origin/<defaultBranch>` as base ref; fetch before worktree creation
11. `adws/agents/resolutionAgent.ts` — Return graceful fallback instead of throwing on non-JSON; add retry once
12. `adws/agents/validationAgent.ts` — Add retry once on non-JSON output in `runValidationAgent()`
13. `adws/agents/reviewRetry.ts` — Filter null/undefined from review issue and screenshot arrays in `mergeReviewResults()`
14. `adws/triggers/autoMergeHandler.ts` — Write `skip_reason.txt` on early exits after `ensureLogsDirectory()`
15. `adws/phases/autoMergePhase.ts` — Write `skip_reason.txt` on early exits
16. `features/step_definitions/retryLogicResilienceSteps.ts` — **New file:** Step definitions for all 30 scenarios

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Fix Gherkin parse error and create `execWithRetry` utility
- In `features/retry_logic_resilience.feature` line 75, change `So that later attempts pick up the new symlink target` to `And later attempts pick up the new symlink target`
- In `adws/core/utils.ts`, add a new exported function:
  ```typescript
  export function execWithRetry(command: string, options?: ExecSyncOptions & { maxAttempts?: number }): string {
    const { maxAttempts = 3, ...execOptions } = options ?? {};
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return execSync(command, { ...execOptions, encoding: 'utf-8' }).toString().trim();
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        // Don't retry non-transient errors
        if (/not found|does not exist|permission denied|authentication/i.test(msg)) throw error;
        if (attempt === maxAttempts - 1) throw error;
        const delayMs = 500 * Math.pow(2, attempt);
        log(`execWithRetry attempt ${attempt + 1}/${maxAttempts} failed for command, retrying in ${delayMs}ms...`, 'warn');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
      }
    }
    throw new Error('execWithRetry: unreachable');
  }
  ```
  - Import `execSync` and `type ExecSyncOptions` from `child_process`
  - Follow the backoff pattern from `adws/cost/exchangeRates.ts`: `500 * Math.pow(2, attempt)` → 500ms, 1000ms
  - Use synchronous sleep via `Atomics.wait` since callers expect synchronous behavior
- In `adws/core/index.ts`, add `execWithRetry` to the re-export from `'./utils'`

### Step 2: Apply `execWithRetry` to gh CLI callers (4 files)
Replace bare `execSync` with `execWithRetry` for gh CLI calls only. Leave `git` and local commands untouched. Preserve existing error handling (try/catch, return values).

**`adws/github/issueApi.ts`** — Add `import { execWithRetry } from '../core/utils'`. Replace `execSync` → `execWithRetry` in 7 functions: `fetchGitHubIssue()`, `commentOnIssue()`, `getIssueState()`, `closeIssue()`, `getIssueTitleSync()`, `fetchIssueCommentsRest()`, `deleteIssueComment()`. Pass through all existing options (`input`, `stdio`, etc.).

**`adws/github/prApi.ts`** — Add `import { execWithRetry } from '../core/utils'`. Replace `execSync` → `execWithRetry` in 7 functions: `fetchPRDetails()`, `fetchPRReviews()`, `fetchPRReviewComments()`, `commentOnPR()`, `mergePR()`, `approvePR()`, `fetchPRList()`. Pass through all existing options.

**`adws/github/githubApi.ts`** — Add `import { execWithRetry } from '../core/utils'`. Replace `execSync` → `execWithRetry` ONLY for `gh api user` call in `getAuthenticatedUser()`. Do NOT retry `git remote get-url origin` in `getRepoInfo()` (local command).

**`adws/providers/github/githubCodeHost.ts`** — Add `import { execWithRetry } from '../../core/utils'`. Replace `execSync` → `execWithRetry` for `gh pr create` in `createMergeRequest()`.

### Step 3: Add existing PR check + upgrade Claude CLI retry + pre-flight validation + worktree origin base ref
**`githubCodeHost.ts` — existing PR check:** Before `gh pr create`, run `execWithRetry(\`gh pr list --head "${options.sourceBranch}" --repo ... --json url,number --limit 1\`)`. If non-empty array, return existing PR URL/number. Log reuse.

**`claudeAgent.ts` — ENOENT retry upgrade:** Replace single ENOENT retry (lines 116-126) with 3-attempt loop:
```typescript
if (!result.success && result.output.includes('ENOENT')) {
  const maxRetries = 3;
  const backoffMs = [500, 1000, 2000];
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    log(`Claude CLI ENOENT retry attempt ${attempt}/${maxRetries}, re-resolving path...`, 'warn');
    clearClaudeCodePathCache();
    await delay(backoffMs[attempt - 1]);
    const retryPath = resolveClaudeCodePath();
    log(`  Resolved path: ${retryPath}`, 'info');
    const retryProcess = spawn(retryPath, cliArgs, spawnOptions);
    const retryResult = await handleAgentProcess(retryProcess, agentName, outputFile, onProgress, statePath, model);
    if (retryResult.success || !retryResult.output.includes('ENOENT')) return retryResult;
    if (attempt === maxRetries) return retryResult;
  }
}
```
Key: `clearClaudeCodePathCache()` + `resolveClaudeCodePath()` on EVERY attempt.

**`workflowInit.ts` — pre-flight check:** Early in `initializeWorkflow()`, before issue fetch:
```typescript
try {
  const claudePath = resolveClaudeCodePath();
  fs.accessSync(claudePath, fs.constants.X_OK);
  log(`Pre-flight check passed: Claude CLI found at ${claudePath}`, 'info');
} catch (error) {
  throw new Error(`Pre-flight check failed: Claude CLI not found or not executable. Ensure 'claude' is installed and in PATH, or set CLAUDE_CODE_PATH in .env. Error: ${error}`);
}
```
Import `resolveClaudeCodePath` from `'../core'`.

**`worktreeCreation.ts` — origin base ref:** In `createWorktree()` and `createWorktreeForNewBranch()`:
- Before `git worktree add`, run `execSync(\`git fetch origin "${baseBranch}"\`, gitOpts)`
- Change base ref from `"${baseBranch}"` to `"origin/${baseBranch}"`
- After creation, log warning if local differs from remote ref

### Step 4: JSON parse graceful degradation + review array guards + skip reason logging
**`resolutionAgent.ts` — graceful fallback:** Change `parseResolutionResult()` to return `{ resolved: false, decisions: [] }` instead of throwing on invalid JSON. In `runResolutionAgent()`, retry agent once if parse returned the fallback and `extractJson()` returned null.

**`validationAgent.ts` — retry on non-JSON:** In `runValidationAgent()`, after parsing, if `!validationResult.aligned && !extractJson(result.output)`, retry agent once.

**`reviewRetry.ts` — null guards:** In `mergeReviewResults()`, add `.filter((issue): issue is ReviewIssue => issue != null)` after `.flatMap(r => r.reviewResult!.reviewIssues)`. Same for screenshots: `.filter((s): s is string => s != null)`.

**`autoMergeHandler.ts` — skip reasons:** After `ensureLogsDirectory()`, before each early return, write `fs.writeFileSync(path.join(logsDir, 'skip_reason.txt'), '<reason>')` for: PR already merged, worktree failure, missing PR URL, missing repo context.

**`autoMergePhase.ts` — skip reasons:** Before early returns for missing PR URL and missing repo context, write `fs.writeFileSync(path.join(config.logsDir, 'skip_reason.txt'), '<reason>')`.

### Step 5: Create step definitions and validate
Create `features/step_definitions/retryLogicResilienceSteps.ts` following the project pattern (source-content assertions using `readFileSync` + `assert` + `sharedCtx` from `commonSteps.ts`).

Step definitions grouped by the 7 feature sections + cross-cutting:
1. **execWithRetry** (scenarios 1-7): Load `utils.ts`, assert `execWithRetry` exists with exponential backoff. Load `issueApi.ts`, `prApi.ts`, `githubApi.ts`, `githubCodeHost.ts` and assert they import/use `execWithRetry`.
2. **Claude CLI ENOENT** (scenarios 8-10): Load `claudeAgent.ts`, assert 3-attempt loop, `clearClaudeCodePathCache` + `resolveClaudeCodePath` on every attempt.
3. **Pre-flight validation** (scenarios 11-13): Load `workflowInit.ts`, assert `resolveClaudeCodePath`, `accessSync`, pre-flight error message.
4. **Worktree creation** (scenarios 14-16): Load `worktreeCreation.ts`, assert `origin/` prefix, `git fetch origin`, warning for divergence.
5. **PR dedup** (scenarios 17-19): Load `githubCodeHost.ts`, assert `gh pr list --head`, existing PR reuse.
6. **JSON parse** (scenarios 20-26): Load `resolutionAgent.ts` (no throw, fallback). Load `validationAgent.ts` (retry). Load `reviewRetry.ts` (`.filter` null guard).
7. **Skip reason** (scenarios 27-30): Load `autoMergeHandler.ts` and `autoMergePhase.ts`, assert `skip_reason.txt`.
8. **Cross-cutting** (scenario 30): Run `bunx tsc --noEmit` via `spawnSync`.

Use unique Given/When/Then step text prefixed with specific context to avoid conflicts with existing step defs.

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-315" --dry-run` — Verify 0 undefined steps for all 30 scenarios
2. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-315"` — All 30 scenarios pass
3. `bun run lint` — No linting errors
4. `bunx tsc --noEmit` — Root TypeScript type checking passes
5. `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type checking passes

## Patch Scope
**Lines of code to change:** ~500 (source changes ~300, step definitions ~200)
**Risk level:** medium
**Testing required:** BDD scenario execution for all 30 @adw-315 scenarios, TypeScript compilation, linting
