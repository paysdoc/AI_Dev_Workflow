# Patch: Implement all 14 spec steps and BDD step definitions for retry logic resilience

## Metadata
adwId: `gcisck-robustness-hardening`
reviewChangeRequest: `Issue #1: @review-proof scenarios FAILED (exit code 1, no output). All regression-tagged BDD scenarios fail because no implementation or step definitions exist. The entire feature (execWithRetry, Claude CLI retry upgrade, pre-flight validation, worktree origin base ref, PR reuse, JSON parse retry, review issue null guards, auto-merge skip logging) is unimplemented. Resolution: Execute all 14 implementation steps from the spec: create execWithRetry in adws/core/utils.ts, apply it to issueApi/prApi/githubApi/githubCodeHost, upgrade Claude CLI ENOENT retry, add pre-flight validation, switch worktree base ref, add PR reuse check, add resolution agent graceful degradation, add agent JSON retry, guard review issue arrays, and write auto-merge skip reasons. Then generate step definitions for the BDD scenarios.`

## Issue Summary
**Original Spec:** specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md
**Issue:** All 30 BDD scenarios in `features/retry_logic_resilience.feature` fail with exit code 1 and no output. No source code changes have been applied (git diff is clean) and no step definitions exist. Additionally, line 75 has `So that` which is invalid Gherkin in a Scenario body.
**Solution:** Fix the Gherkin error, apply all 14 source code changes from the spec, then create a step definition file that verifies each change via source-content assertions (matching the project's established `sharedCtx`/`readFileSync`/`assert` pattern).

## Files to Modify
Use these files to implement the patch:

1. `features/retry_logic_resilience.feature` -- Fix `So that` -> `And` on line 75
2. `adws/core/utils.ts` -- Add `execWithRetry` utility function
3. `adws/core/index.ts` -- Re-export `execWithRetry`
4. `adws/github/issueApi.ts` -- Replace `execSync` with `execWithRetry` for all gh CLI calls
5. `adws/github/prApi.ts` -- Replace `execSync` with `execWithRetry` for all gh CLI calls
6. `adws/github/githubApi.ts` -- Replace `execSync` with `execWithRetry` for `gh api user` call only
7. `adws/providers/github/githubCodeHost.ts` -- Replace `execSync` with `execWithRetry` for `gh pr create`; add existing PR check
8. `adws/agents/claudeAgent.ts` -- Upgrade ENOENT retry to 3 attempts with per-attempt path re-resolution
9. `adws/phases/workflowInit.ts` -- Add pre-flight Claude CLI validation
10. `adws/vcs/worktreeCreation.ts` -- Use `origin/<defaultBranch>` as base ref
11. `adws/agents/resolutionAgent.ts` -- Graceful fallback instead of throwing; add retry once on non-JSON
12. `adws/agents/validationAgent.ts` -- Add retry once on non-JSON output
13. `adws/agents/reviewRetry.ts` -- Filter null/undefined from review issue and screenshot arrays
14. `adws/triggers/autoMergeHandler.ts` -- Write `skip_reason.txt` on early exits after `ensureLogsDirectory()`
15. `adws/phases/autoMergePhase.ts` -- Write `skip_reason.txt` on early exits
16. `features/step_definitions/retryLogicResilienceSteps.ts` -- **New file:** Step definitions for all 30 BDD scenarios

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom. Read each target file BEFORE modifying it.

### Step 1: Fix Gherkin parse error and create `execWithRetry` foundation

**1a. Fix feature file:**
- In `features/retry_logic_resilience.feature` line 75, change `So that later attempts pick up the new symlink target` to `And later attempts pick up the new symlink target`

**1b. Create `execWithRetry` in `adws/core/utils.ts`:**
- Add imports: `import { execSync, type ExecSyncOptions } from 'child_process';`
- Add import for `log` if not already present (it's re-exported from `./logger`)
- Add a new exported function following the `exchangeRates.ts` backoff pattern (`500 * Math.pow(2, attempt)`):
```typescript
/**
 * Executes a shell command with retry logic and exponential backoff.
 * Retries transient failures up to maxAttempts times (default 3).
 * Non-transient errors (not found, permission denied, authentication) throw immediately.
 */
export function execWithRetry(command: string, options?: ExecSyncOptions & { maxAttempts?: number }): string {
  const { maxAttempts = 3, ...execOptions } = options ?? {};
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return execSync(command, { ...execOptions, encoding: 'utf-8' }).toString().trim();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      if (/not found|does not exist|permission denied|authentication/i.test(msg)) throw error;
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
- Add `execWithRetry` to the existing re-export from `'./utils'` line (alongside `ensureLogsDirectory`).

### Step 2: Apply `execWithRetry` to GitHub API modules (spec steps 2-5)

Replace bare `execSync` with `execWithRetry` for `gh` CLI calls only. Leave `git` and local commands untouched. Preserve each function's existing error handling (try/catch blocks, return values).

**2a. `adws/github/issueApi.ts`:**
- Add import: `import { execWithRetry } from '../core/utils';`
- Replace `execSync` -> `execWithRetry` in all 7 functions that call `gh` CLI: `fetchGitHubIssue()`, `commentOnIssue()`, `getIssueState()`, `closeIssue()`, `getIssueTitleSync()`, `fetchIssueCommentsRest()`, `deleteIssueComment()`
- Pass through all existing options (`input`, `stdio`, etc.) -- `execWithRetry` accepts `ExecSyncOptions`
- Keep `{ encoding: 'utf-8' }` in the options if there are OTHER options alongside it (like `input`, `stdio`). Remove it ONLY if it was the sole option, since `execWithRetry` sets encoding internally
- Remove `.toString().trim()` calls since `execWithRetry` already returns a trimmed string

**2b. `adws/github/prApi.ts`:**
- Add import: `import { execWithRetry } from '../core/utils';`
- Replace `execSync` -> `execWithRetry` in all 7 functions: `fetchPRDetails()`, `fetchPRReviews()`, `fetchPRReviewComments()`, `commentOnPR()`, `mergePR()`, `approvePR()`, `fetchPRList()`
- Same rules: preserve error handling, pass through options, remove redundant `.toString().trim()`

**2c. `adws/github/githubApi.ts`:**
- Add import: `import { execWithRetry } from '../core/utils';`
- Replace ONLY the `gh api user` call in `getAuthenticatedUser()` with `execWithRetry`
- Do NOT touch the `git remote get-url origin` call in `getRepoInfo()` -- it's a local git command, not a network call

**2d. `adws/providers/github/githubCodeHost.ts`:**
- Add import: `import { execWithRetry } from '../../core/utils';`
- Replace the `execSync` call for `gh pr create` in `createMergeRequest()` with `execWithRetry`

### Step 3: Add existing PR check, Claude CLI retry upgrade, pre-flight validation, and worktree origin base ref (spec steps 6-9)

**3a. Existing PR check in `githubCodeHost.ts` `createMergeRequest()`:**
- Before the `gh pr create` call, check for existing PRs:
```typescript
// Check for existing PR before creating
try {
  const existingPrJson = execWithRetry(
    `gh pr list --head "${options.sourceBranch}" --repo "${this.repoInfo.owner}/${this.repoInfo.repo}" --json url,number --limit 1`
  );
  const existingPrs = JSON.parse(existingPrJson || '[]');
  if (existingPrs.length > 0) {
    log(`Reusing existing PR #${existingPrs[0].number}: ${existingPrs[0].url}`);
    return { url: existingPrs[0].url, number: existingPrs[0].number };
  }
} catch {
  // If check fails, proceed with PR creation
}
```
- Import `log` from `'../../core/utils'` if not already imported

**3b. Upgrade Claude CLI ENOENT retry in `adws/agents/claudeAgent.ts`:**
- Replace the single ENOENT retry block with a 3-attempt loop:
```typescript
if (!result.success && result.output.includes('ENOENT')) {
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const backoffMs = 500 * Math.pow(2, attempt - 1);
    log(`Claude CLI ENOENT retry attempt ${attempt}/${maxRetries}, re-resolving path in ${backoffMs}ms...`, 'warn');
    clearClaudeCodePathCache();
    await delay(backoffMs);
    const retryPath = resolveClaudeCodePath();
    log(`  Re-resolved Claude CLI path: ${retryPath}`, 'info');
    const retryProcess = spawn(retryPath, cliArgs, spawnOptions);
    const retryResult = await handleAgentProcess(retryProcess, agentName, outputFile, onProgress, statePath, model);
    if (retryResult.success || !retryResult.output.includes('ENOENT')) return retryResult;
    if (attempt === maxRetries) return retryResult;
  }
}
```
- Key: `clearClaudeCodePathCache()` + `resolveClaudeCodePath()` on EVERY attempt (not just the first)

**3c. Pre-flight Claude CLI validation in `adws/phases/workflowInit.ts`:**
- Add import for `resolveClaudeCodePath` from `'../core'` (if not already imported via barrel)
- `fs` is likely already imported; if not, import `accessSync` and `constants` from `'fs'`
- Early in `initializeWorkflow()`, before the issue fetch:
```typescript
// Pre-flight: verify Claude CLI is available and executable
try {
  const claudePath = resolveClaudeCodePath();
  accessSync(claudePath, constants.X_OK);
  log(`Pre-flight check passed: Claude CLI found at ${claudePath}`, 'info');
} catch (error) {
  throw new Error(
    `Pre-flight check failed: Claude CLI not found or not executable. Ensure 'claude' is installed and in PATH, or set CLAUDE_CODE_PATH in .env.`
  );
}
```

**3d. Worktree creation with `origin/<defaultBranch>` in `adws/vcs/worktreeCreation.ts`:**
- In `createWorktree()`, when `baseBranch` is provided:
  - Before `git worktree add`, add: `execSync(\`git fetch origin "${baseBranch}"\`, { cwd: repoPath, stdio: 'pipe' });`
  - Change the base ref from `"${baseBranch}"` to `"origin/${baseBranch}"`
- In `createWorktreeForNewBranch()`, when `baseBranch` is provided:
  - Add `git fetch origin "${baseBranch}"` before worktree add
  - Change base from `baseBranch` to `origin/${baseBranch}`
- After creation, log a warning if local and remote HEADs differ:
```typescript
try {
  const localRef = execSync(`git rev-parse "${baseBranch}"`, { cwd: repoPath, encoding: 'utf-8' }).toString().trim();
  const remoteRef = execSync(`git rev-parse "origin/${baseBranch}"`, { cwd: repoPath, encoding: 'utf-8' }).toString().trim();
  if (localRef !== remoteRef) {
    log(`Warning: local '${baseBranch}' (${localRef.substring(0, 8)}) differs from origin (${remoteRef.substring(0, 8)})`, 'warn');
  }
} catch { /* ignore comparison errors */ }
```

### Step 4: JSON parse graceful degradation, review array guards, and skip reason logging (spec steps 10-13)

**4a. Graceful degradation in `adws/agents/resolutionAgent.ts`:**
- Change `parseResolutionResult()` to return a fallback instead of throwing when JSON is invalid:
```typescript
export function parseResolutionResult(agentOutput: string): ResolutionResult {
  const parsed = extractJson<ResolutionResult>(agentOutput);
  if (!parsed || typeof parsed.resolved !== 'boolean') {
    const preview = agentOutput.substring(0, 200);
    log(`Resolution agent returned non-JSON output, treating as unresolved: ${preview}`, 'warn');
    return { resolved: false, decisions: [] };
  }
  return {
    resolved: parsed.resolved,
    decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
  };
}
```
- In `runResolutionAgent()`, after parsing, add retry logic:
```typescript
const resolutionResult = parseResolutionResult(result.output);
// Retry once if parse returned graceful fallback (non-JSON output)
if (!resolutionResult.resolved && resolutionResult.decisions.length === 0 && !extractJson(result.output)) {
  log('Resolution agent returned non-JSON output, retrying once...', 'warn');
  const retryResult = await runClaudeAgentWithCommand(/* same args as original call */);
  const retryParsed = parseResolutionResult(retryResult.output);
  return { ...retryResult, resolutionResult: retryParsed };
}
```

**4b. Retry on non-JSON in `adws/agents/validationAgent.ts`:**
- In `runValidationAgent()`, after parsing, if the result is the fallback unaligned result and `extractJson()` returned null from the raw output, re-run the agent once:
```typescript
const validationResult = parseValidationResult(result.output);
if (!validationResult.aligned && !extractJson(result.output)) {
  log('Validation agent returned non-JSON output, retrying once...', 'warn');
  const retryResult = await runClaudeAgentWithCommand(/* same args */);
  const retryParsed = parseValidationResult(retryResult.output);
  return { ...retryResult, validationResult: retryParsed };
}
```

**4c. Array guards in `adws/agents/reviewRetry.ts`:**
- In `mergeReviewResults()`, add `.filter()` after `.flatMap()` for review issues:
```typescript
.flatMap(r => r.reviewResult!.reviewIssues)
.filter((issue): issue is ReviewIssue => issue != null)
```
- Same for screenshots:
```typescript
.flatMap(r => r.reviewResult!.screenshots)
.filter((s): s is string => s != null)
```

**4d. Skip reason logging in `adws/triggers/autoMergeHandler.ts`:**
- Import `writeFileSync` from `'fs'` and `join` from `'path'` if not already imported
- After `ensureLogsDirectory()`, before each early return, write `skip_reason.txt`:
  - PR already merged: `writeFileSync(join(logsDir, 'skip_reason.txt'), 'PR already merged, skipping auto-merge')`
  - Worktree failure: `writeFileSync(join(logsDir, 'skip_reason.txt'), \`Worktree creation failed for branch: \${headBranch}\`)`
  - Missing PR URL: `writeFileSync(join(logsDir, 'skip_reason.txt'), 'No PR URL available, skipping auto-merge')`
  - Missing repo context: `writeFileSync(join(logsDir, 'skip_reason.txt'), 'No repo context available, skipping auto-merge')`

**4e. Skip reason logging in `adws/phases/autoMergePhase.ts`:**
- Import `writeFileSync` from `'fs'` and `join` from `'path'` if not already imported
- Before early return for missing PR URL: `writeFileSync(join(config.logsDir, 'skip_reason.txt'), 'No PR URL found, skipping auto-merge')`
- Before early return for missing repo context: `writeFileSync(join(config.logsDir, 'skip_reason.txt'), 'No repo context available, skipping auto-merge')`

### Step 5: Create step definitions file

Create `features/step_definitions/retryLogicResilienceSteps.ts` following the project's established source-content assertion pattern.

The step definitions verify source code changes by reading file contents with `readFileSync` and asserting patterns with `assert`. Use the `sharedCtx` from `commonSteps.ts` where the scenarios match the `'{string}' is read` Given step. For scenarios with unique Given/When/Then text, define new steps.

Group by feature section:

**1. execWithRetry utility (scenarios 1-3):**
- `Given('an execWithRetry utility wrapping execSync', ...)` -- Load `adws/core/utils.ts`, assert it contains `export function execWithRetry`
- `When('a gh CLI command fails on the first two attempts with a transient error')` -- Context only (source-level verification)
- `When('a gh CLI command fails on all 3 attempts with a transient error')` -- Context only
- `When('a gh CLI command fails with a non-transient error such as {string}')` -- Context only
- `Then('the command is executed exactly 3 times')` -- Assert `maxAttempts` default is 3
- `Then('the delays between attempts follow exponential backoff of 500ms, 1000ms')` -- Assert `500 * Math.pow(2, attempt)` pattern in source
- `Then('the utility throws the last error after 3 attempts')` -- Assert `if (attempt === maxAttempts - 1) throw error`
- `Then('all 3 attempts are logged with their attempt number')` -- Assert `log(\`execWithRetry attempt` in source
- `Then('the utility throws immediately without retrying')` -- Assert non-transient error check pattern in source
- `And('succeeds on the third attempt')` -- Context only

**2. gh CLI retry in API modules (scenarios 4-7):**
- `Given('the issueApi module')` -- Load `adws/github/issueApi.ts`
- `Given('the prApi module')` -- Load `adws/github/prApi.ts`
- `Given('the githubApi module')` -- Load `adws/github/githubApi.ts`
- `Given('the githubCodeHost module')` -- Load `adws/providers/github/githubCodeHost.ts`
- `When('any gh CLI call is made through issueApi')` / `prApi` / `githubApi` / `githubCodeHost` -- Context only
- `Then('the call is routed through execWithRetry')` -- Assert `execWithRetry(` present in loaded file
- `Then('transient failures are retried up to 3 times')` -- Assert `execWithRetry` import present

**3. Claude CLI ENOENT retry (scenarios 8-10):**
- `Given('the claudeAgent spawns a Claude CLI process')` -- Load `adws/agents/claudeAgent.ts`
- `When('the spawn fails with ENOENT on the first two attempts')` / related -- Context only
- `Then('the agent retries up to 3 times with exponential backoff of 500ms, 1000ms')` -- Assert `maxRetries = 3` or loop with 3 iterations
- `Then('resolveClaudeCodePath is called again before the second attempt')` -- Assert `resolveClaudeCodePath()` inside retry loop
- `Then('the agent throws an error indicating the Claude CLI was not found')` -- Assert error handling after retry exhaustion

**4. Pre-flight CLI validation (scenarios 11-13):**
- `Given('initializeWorkflow is called')` -- Load `adws/phases/workflowInit.ts`
- `When('resolveClaudeCodePath returns no valid path')` / `When('the binary at that path is not executable')` -- Context only
- `Then('the workflow fails immediately with a clear error message')` -- Assert `Pre-flight check failed` in source
- `Then('no pipeline phases are started')` -- Assert pre-flight check is early in function
- `Then('the pre-flight CLI validation passes')` / `Then('the workflow continues to the next phase')` -- Assert `Pre-flight check passed` log message

**5. Worktree creation (scenarios 14-16):**
- `Given('a repository with a default branch {string}')` -- Load `adws/vcs/worktreeCreation.ts`
- `When('a new worktree is created for a feature branch')` -- Context only
- `Then('the git worktree add command uses {string} as the base ref')` -- Assert `origin/` prefix in worktree add
- `Then('the worktree starts clean from the remote state')` -- Assert `git fetch origin` before worktree add
- `Then('a warning is logged indicating the local branch differs from remote')` -- Assert divergence warning log
- `Then('the worktree creation still succeeds using {string}')` -- Context only (verified by origin prefix)

**6. PR creation reuse (scenarios 17-19):**
- `Given('a feature branch {string} already has an open PR')` / `Given('a feature branch {string} has no open PR')` -- Load `githubCodeHost.ts`
- `When('the workflow attempts to create a PR for that branch')` / `When('checking for an existing PR for branch {string}')` -- Context only
- `Then('the existing PR URL and number are returned')` / `Then('no new PR is created')` -- Assert `gh pr list --head` check in source
- `Then('a new PR is created via gh pr create')` -- Assert `gh pr create` still present
- `Then('the command {string} is executed')` -- Assert the quoted command string in source
- `Then('the result determines whether to create or reuse a PR')` -- Assert conditional logic

**7. JSON parse retry + graceful degradation (scenarios 20-26):**
- `Given('the resolution agent receives free-text output instead of JSON')` / both attempts -- Load `adws/agents/resolutionAgent.ts`
- `Given('the validation agent receives free-text output instead of JSON')` / both -- Load `adws/agents/validationAgent.ts`
- `Given('the reviewRetry module processes review results')` -- Load `adws/agents/reviewRetry.ts`
- `When('extractJson returns null on the first attempt')` / `When('extractJson returns null on both the first and retry attempts')` -- Context only
- `Then('the agent is re-run once')` -- Assert `retrying once` log message in source
- `Then('the second output is parsed for JSON')` -- Assert retry parse call
- `Then('the agent returns a fallback result with resolved=false and decisions=[]')` -- Assert `resolved: false, decisions: []` in source
- `Then('the validation retry loop handles the unresolved result')` -- Context only
- `Then('the agent returns a failed validation result')` -- Assert fallback in validationAgent
- `Then('the orchestrator retries up to MAX_VALIDATION_RETRY_ATTEMPTS')` -- Context only
- `Then('undefined and null entries are filtered out before processing')` -- Assert `.filter(` after `.flatMap(` in reviewRetry.ts
- `Then('no TypeError is thrown when accessing issueDescription')` -- Assert null guard filter
- `Then('all entries are processed normally')` / `Then('the filter has no effect on the result')` -- Context only

**8. Auto-merge skip reason logging (scenarios 27-30):**
- `Given('the auto-merge handler creates a log directory')` / `Given('the auto-merge phase is invoked')` -- Load respective file
- `When('the handler detects the PR is already merged and exits early')` / `When('the handler fails to create a worktree...')` / etc. -- Context only
- `Then('a skip_reason.txt file is written to the log directory')` -- Assert `skip_reason.txt` in source
- `Then('the file contains the reason {string}')` -- Assert the quoted reason string in source

**9. Cross-cutting TypeScript compilation (scenario 30):**
- `Given('all robustness hardening changes are applied')` -- No-op (verified by preceding scenarios)
- `When('the TypeScript compiler runs with --noEmit')` -- Execute `bunx tsc --noEmit` via `spawnSync`
- `Then('the compilation succeeds with zero errors')` -- Assert exit code 0

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-gcisck-robustness-hardening" --dry-run` -- Verify 0 undefined steps
2. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-gcisck-robustness-hardening"` -- All 30 scenarios pass
3. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` -- All regression-tagged scenarios pass (no regressions)
4. `bun run lint` -- No linting errors
5. `bunx tsc --noEmit` -- Root TypeScript type checking passes
6. `bunx tsc --noEmit -p adws/tsconfig.json` -- ADW-specific TypeScript type checking passes

## Patch Scope
**Lines of code to change:** ~500 (source changes ~300 across 14 files, step definitions ~200 in 1 new file)
**Risk level:** medium (touches many files but each change is small and mechanical; all changes follow established patterns in the codebase)
**Testing required:** BDD scenario execution for @adw-gcisck-robustness-hardening tag, regression suite, TypeScript compilation, linting
