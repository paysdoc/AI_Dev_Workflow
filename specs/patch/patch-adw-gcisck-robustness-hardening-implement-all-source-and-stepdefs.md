# Patch: Implement all 14 spec steps + step definitions for retry logic resilience

## Metadata
adwId: `gcisck-robustness-hardening`
reviewChangeRequest: `Issue #2: @adw-315 scenarios FAILED (exit code 1, no output). All feature-specific scenarios fail because neither source code implementation nor step definitions exist. Resolution: Implement all 14 spec steps and their corresponding step definitions.`

## Issue Summary
**Original Spec:** `specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md`
**Issue:** All 33 BDD scenarios in `features/retry_logic_resilience.feature` fail with exit code 1 and no output because: (a) no source code changes from the spec have been implemented, and (b) no step definition file exists.
**Solution:** Two-phase patch: (1) Implement all 14 spec steps in source code across 14 existing files, (2) Generate step definitions file `features/step_definitions/retryLogicResilienceSteps.ts` using static source-code verification matching the project convention.

## Files to Modify

**Source code (14 existing files):**
1. `adws/core/utils.ts` — Add `execWithRetry` utility
2. `adws/core/index.ts` — Re-export `execWithRetry`
3. `adws/github/issueApi.ts` — Replace 7 bare `execSync` gh calls with `execWithRetry`
4. `adws/github/prApi.ts` — Replace 7 bare `execSync` gh calls with `execWithRetry`
5. `adws/github/githubApi.ts` — Replace `gh api user` `execSync` with `execWithRetry`
6. `adws/providers/github/githubCodeHost.ts` — Add existing PR check + use `execWithRetry`
7. `adws/agents/claudeAgent.ts` — Upgrade ENOENT retry to 3 attempts with per-attempt path re-resolution
8. `adws/phases/workflowInit.ts` — Add pre-flight Claude CLI validation
9. `adws/vcs/worktreeCreation.ts` — Switch to `origin/<defaultBranch>` base ref
10. `adws/agents/resolutionAgent.ts` — Graceful degradation fallback on invalid JSON
11. `adws/agents/validationAgent.ts` — Add retry on non-JSON agent output
12. `adws/agents/reviewRetry.ts` — Filter undefined/null from review issues and screenshots arrays
13. `adws/triggers/autoMergeHandler.ts` — Write `skip_reason.txt` on early exits
14. `adws/phases/autoMergePhase.ts` — Write `skip_reason.txt` on early exits

**Step definitions (1 new file):**
15. `features/step_definitions/retryLogicResilienceSteps.ts` — **NEW** — All 33 scenario step definitions using static source verification

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom. Read each target file BEFORE editing it. Follow the coding guidelines in `guidelines/coding_guidelines.md`.

### Step 1: Create `execWithRetry` utility and export it

Read `adws/core/utils.ts`. Add at the end of the file:

```typescript
import { execSync, type ExecSyncOptions } from 'child_process';
import { log } from './logger';

/**
 * Executes a shell command with retry and exponential backoff.
 * Designed for transient network failures (gh CLI calls to GitHub API).
 * 3 attempts by default, backoff: 500ms, 1000ms, 2000ms.
 */
export function execWithRetry(
  command: string,
  options?: ExecSyncOptions & { maxAttempts?: number },
): string {
  const { maxAttempts = 3, ...execOptions } = options ?? {};
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return execSync(command, { encoding: 'utf-8', ...execOptions }).toString().trim();
    } catch (error) {
      lastError = error as Error;
      log(`execWithRetry attempt ${attempt + 1}/${maxAttempts} failed: ${(error as Error).message?.slice(0, 120)}`, 'warn');
      if (attempt < maxAttempts - 1) {
        const delayMs = 500 * Math.pow(2, attempt);
        // Synchronous backoff for CLI retry
        const start = Date.now();
        while (Date.now() - start < delayMs) { /* sync backoff */ }
      }
    }
  }
  throw lastError!;
}
```

Note: Verify `log()` signature in `adws/core/logger.ts` before using (it's `log(message: string, level: LogLevel)`).

Then read `adws/core/index.ts`. Add `execWithRetry` to the re-exports from `./utils` in the Utilities block.

### Step 2: Apply `execWithRetry` to all GitHub CLI callers

Read each file before editing.

**`adws/github/issueApi.ts`**: Import `execWithRetry` from `'../core/utils'`. Replace all 7 bare `execSync` calls for `gh` CLI commands with `execWithRetry`. Preserve existing try-catch patterns.
- `fetchGitHubIssue()`, `commentOnIssue()`, `getIssueState()`, `closeIssue()`, `getIssueTitleSync()`, `fetchIssueCommentsRest()`, `deleteIssueComment()`

**`adws/github/prApi.ts`**: Replace all 7 `gh` CLI `execSync` calls. Preserve `approvePR()` env var manipulation.
- `fetchPRDetails()`, `fetchPRReviews()`, `fetchPRReviewComments()`, `commentOnPR()`, `mergePR()`, `approvePR()`, `fetchPRList()`

**`adws/github/githubApi.ts`**: Replace ONLY the `gh api user` `execSync` in `getAuthenticatedUser()`. Do NOT touch `git remote get-url origin` (local command).

**`adws/providers/github/githubCodeHost.ts`**: Replace `gh pr create` `execSync` in `createMergeRequest()` with `execWithRetry`.

### Step 3: Add existing PR check + Claude CLI retry upgrade + pre-flight validation + worktree origin base

**Existing PR check** (`githubCodeHost.ts`): Before `gh pr create`, run `execWithRetry('gh pr list --head "${sourceBranch}" --repo "${owner}/${repo}" --json url,number --limit 1')`. If non-empty JSON array, return existing PR url/number with log message.

**Claude CLI ENOENT retry** (`claudeAgent.ts`): Replace single ENOENT retry (lines ~116-126) with 3-attempt loop:
```typescript
if (!result.success && result.output.includes('ENOENT')) {
  const maxEnoentAttempts = 3;
  for (let attempt = 1; attempt < maxEnoentAttempts; attempt++) {
    log(`Claude CLI ENOENT retry ${attempt + 1}/${maxEnoentAttempts}...`, 'warn');
    clearClaudeCodePathCache();
    await delay(500 * Math.pow(2, attempt - 1));
    const retryPath = resolveClaudeCodePath();
    log(`  Re-resolved path: ${retryPath}`, 'info');
    const retryProcess = spawn(retryPath, cliArgs, spawnOptions);
    const retryResult = await handleAgentProcess(retryProcess, agentName, outputFile, onProgress, statePath, model);
    if (retryResult.success || !retryResult.output.includes('ENOENT')) return retryResult;
    if (attempt === maxEnoentAttempts - 1) {
      log(`Claude CLI ENOENT: all ${maxEnoentAttempts} attempts failed`, 'error');
      return retryResult;
    }
  }
}
```

**Pre-flight validation** (`workflowInit.ts`): Early in `initializeWorkflow()`, before issue fetch:
```typescript
import { accessSync, constants } from 'fs';
// ...
const cliPath = resolveClaudeCodePath();
if (!cliPath) throw new Error('Pre-flight check failed: Claude CLI not found. Ensure "claude" is installed and in PATH, or set CLAUDE_CODE_PATH in .env.');
try { accessSync(cliPath, constants.X_OK); } catch {
  throw new Error(`Pre-flight check failed: Claude CLI not executable at ${cliPath}.`);
}
log('Pre-flight check passed: Claude CLI found and executable', 'info');
```

**Worktree origin base** (`worktreeCreation.ts`): In both `createWorktree()` and `createWorktreeForNewBranch()`:
1. Before `git worktree add`, run `execSync(\`git fetch origin "${baseBranch}"\`, { stdio: 'pipe', cwd: baseRepoPath })`
2. Use `origin/${baseBranch}` as base ref in the `git worktree add` command
3. Log warning if local branch HEAD differs from remote

### Step 4: Agent graceful degradation + review guards + skip reason files

**Resolution agent** (`resolutionAgent.ts`): Change `parseResolutionResult()` to return `{ resolved: false, decisions: [] }` instead of throwing. In `runResolutionAgent()`, if parse returned fallback and `extractJson()` was null, re-run agent once.

**Validation agent** (`validationAgent.ts`): In `runValidationAgent()`, if parse returns fallback (non-JSON output), re-run agent once.

**Review guards** (`reviewRetry.ts`): In `mergeReviewResults()`:
- `.flatMap(r => r.reviewResult!.reviewIssues).filter((issue): issue is ReviewIssue => issue != null)`
- `.flatMap(r => r.reviewResult!.screenshots).filter((s): s is string => s != null)`

**Skip reason files** (`autoMergeHandler.ts`): After `ensureLogsDirectory()`, on each early return write `skip_reason.txt`:
- PR merged: `"PR already merged, skipping auto-merge"`
- Worktree failure: `"Worktree creation failed for branch: <branch>"`
- Missing PR URL: `"No PR URL available, skipping auto-merge"`
- Missing repo: `"No repo context available, skipping auto-merge"`

**Skip reason files** (`autoMergePhase.ts`): Write to `config.logsDir`:
- `"No PR URL found, skipping auto-merge"`
- `"No repo context available, skipping auto-merge"`

### Step 5: Generate step definitions file

Create `features/step_definitions/retryLogicResilienceSteps.ts` implementing all step patterns from `features/retry_logic_resilience.feature`.

Use the project convention: **static source-code verification**:
- Read source files with `fs.readFileSync()`
- Assert patterns exist using `assert.ok()`, `assert.match()`, `String.includes()`
- Group by feature area: execWithRetry, module usage, ENOENT retry, pre-flight, worktree, PR check, JSON parse, review guards, skip reason, TypeScript compilation
- TypeScript compilation scenario should run `bunx tsc --noEmit -p adws/tsconfig.json` via `execSync`
- Reference existing step defs (`costCommentFormatterSteps.ts`, `cacheInstallContextSteps.ts`) for conventions

### Step 6: Run validation and fix issues

Execute all validation commands. Fix any issues until all pass cleanly:
1. `bun run lint`
2. `bunx tsc --noEmit`
3. `bunx tsc --noEmit -p adws/tsconfig.json`
4. `bun run build`
5. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-gcisck-robustness-hardening"` — all scenarios pass
6. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — no regressions

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `bun run lint` — Code quality check passes
2. `bun run build` — Build succeeds
3. `bunx tsc --noEmit -p adws/tsconfig.json` — TypeScript type checking passes
4. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-gcisck-robustness-hardening"` — All 33 BDD scenarios pass
5. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — No regressions

## Patch Scope
**Lines of code to change:** ~500 (source across 14 files) + ~500 (step definitions) = ~1000 total
**Risk level:** medium — touches many files but each change is isolated; `exchangeRates.ts` is the proven retry pattern
**Testing required:** BDD scenarios (`@adw-gcisck-robustness-hardening` + `@regression` tags), TypeScript compilation, linting
