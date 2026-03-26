# Patch: Implement step definitions and source code for retry logic resilience

## Metadata
adwId: `gcisck-robustness-hardening`
reviewChangeRequest: `specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md`

## Issue Summary
**Original Spec:** specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md
**Issue:** Both `@review-proof` and `@adw-315` BDD scenario suites fail with exit code 1 and no output. No step definitions exist for the 32 scenarios in `retry_logic_resilience.feature`, and none of the 14 spec implementation steps have been applied to source code.
**Solution:** Implement all source code changes (execWithRetry utility, gh CLI retry wrappers, Claude CLI ENOENT upgrade, pre-flight validation, origin-based worktrees, existing PR check, JSON parse graceful degradation, review issue null guards, auto-merge skip reason logging), then create a comprehensive step definition file that verifies these changes via source content assertions. Fix the Gherkin parse error on line 75 (`So that` is not a valid step keyword inside a scenario body).

## Files to Modify
Use these files to implement the patch:

1. `features/retry_logic_resilience.feature` — Fix `So that` parse error (line 75 → `And`)
2. `adws/core/utils.ts` — Add `execWithRetry` utility function
3. `adws/core/index.ts` — Export `execWithRetry`
4. `adws/github/issueApi.ts` — Replace `execSync` with `execWithRetry` for all `gh` CLI calls
5. `adws/github/prApi.ts` — Replace `execSync` with `execWithRetry` for all `gh` CLI calls
6. `adws/github/githubApi.ts` — Replace `execSync` with `execWithRetry` for `gh api user` call only (NOT `git remote`)
7. `adws/providers/github/githubCodeHost.ts` — Replace `execSync` with `execWithRetry` for `gh pr create`; add existing PR check via `gh pr list --head`
8. `adws/agents/claudeAgent.ts` — Upgrade ENOENT retry from 1 attempt to 3 with exponential backoff and per-attempt path re-resolution
9. `adws/phases/workflowInit.ts` — Add pre-flight Claude CLI validation (resolve path + check executable)
10. `adws/vcs/worktreeCreation.ts` — Use `origin/<defaultBranch>` as base ref with prior `git fetch`; log warning when local differs from remote
11. `adws/agents/resolutionAgent.ts` — Return graceful fallback `{ resolved: false, decisions: [] }` instead of throwing; add single retry in `runResolutionAgent()`
12. `adws/agents/validationAgent.ts` — Add single retry on non-JSON output in `runValidationAgent()`
13. `adws/agents/reviewRetry.ts` — Filter null/undefined from `reviewIssues` and `screenshots` flatMaps in `mergeReviewResults()`
14. `adws/triggers/autoMergeHandler.ts` — Write `skip_reason.txt` on early exits after `ensureLogsDirectory()`
15. `adws/phases/autoMergePhase.ts` — Write `skip_reason.txt` on early exits
16. `features/step_definitions/retryLogicResilienceSteps.ts` — **New file:** Step definitions for all 32 scenarios

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Fix feature file Gherkin parse error
- In `features/retry_logic_resilience.feature` line 75, change `So that later attempts pick up the new symlink target` to `And later attempts pick up the new symlink target`
- `So that` is only valid in the Feature description block, not inside a Scenario body

### Step 2: Create `execWithRetry` utility in `adws/core/utils.ts`
- Import `execSync` and `type ExecSyncOptions` from `child_process`
- Import `log` from `./logger`
- Add exported function with signature: `export function execWithRetry(command: string, options?: ExecSyncOptions & { maxAttempts?: number }): string`
- Default `maxAttempts` to 3
- Implement retry loop following the `exchangeRates.ts` pattern:
  - For each attempt 0..maxAttempts-1:
    - Try `execSync(command, options).toString().trim()`
    - On success, return immediately
    - On failure: if last attempt, throw the error; otherwise log with `log(\`execWithRetry attempt ${attempt + 1}/${maxAttempts} failed: ${error}, retrying...\`, 'warn')` and sleep `500 * Math.pow(2, attempt)` ms
  - Use a sync sleep: `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs)` (since `execSync` callers expect synchronous behavior)
- **Non-transient error handling**: Check if the error message contains known non-transient patterns (`"not found"`, `"not a valid"`, `"permission denied"`, `"authentication"`) and throw immediately without retrying for these
- Export from `adws/core/index.ts` by adding `execWithRetry` to the re-export block from `'./utils'` (line 58-68)

### Step 3: Apply `execWithRetry` to gh CLI callers
Replace bare `execSync` calls with `execWithRetry` in these files. Preserve each function's existing error handling (try/catch patterns, return values on failure). Only replace `gh` CLI calls — leave `git` commands and local operations untouched.

**`adws/github/issueApi.ts`:**
- Add import: `import { execWithRetry } from '../core/utils';`
- Replace `execSync` with `execWithRetry` in: `fetchGitHubIssue()` (line 114), `commentOnIssue()` (line 136), `getIssueState()` (line 175), `closeIssue()` (line 211), `getIssueTitleSync()` (line 233), `fetchIssueCommentsRest()` (line 253), `deleteIssueComment()` (line 277)
- Keep `{ encoding: 'utf-8' }` option, remove `encoding` since `execWithRetry` returns string already — or pass it through and let `execWithRetry` handle it
- For functions that use `input` in stdio options (e.g. `commentOnIssue`), these pipe stdin and cannot use `execWithRetry` as-is — keep `execSync` for stdin-piping calls OR extend `execWithRetry` to pass through all `ExecSyncOptions` including `input` and `stdio`

**`adws/github/prApi.ts`:**
- Add import: `import { execWithRetry } from '../core/utils';`
- Replace `execSync` with `execWithRetry` in: `fetchPRDetails()` (line 61), `fetchPRReviews()` (line 95), `fetchPRReviewComments()` (line 133), `commentOnPR()` (line 176 — uses `input`, same note as above), `mergePR()` (line 195), `approvePR()` (line 227), `fetchPRList()` (line 253)

**`adws/github/githubApi.ts`:**
- Add import: `import { execWithRetry } from '../core/utils';`
- Replace `execSync` with `execWithRetry` in `getAuthenticatedUser()` (line 72) for the `gh api user` call
- Do NOT touch `getRepoInfo()` — it uses `git remote get-url origin` (local git, not network)

**`adws/providers/github/githubCodeHost.ts`:**
- Add import: `import { execWithRetry } from '../../core/utils';`
- Replace `execSync` with `execWithRetry` in `createMergeRequest()` for the `gh pr create` call (line 90)

### Step 4: Add existing PR check in `githubCodeHost.ts` `createMergeRequest()`
- Before the `gh pr create` call, run: `execWithRetry(\`gh pr list --head "${options.sourceBranch}" --repo ${this.repoInfo.owner}/${this.repoInfo.repo} --json url,number --limit 1\`, { encoding: 'utf-8' })`
- Parse the result as JSON array. If non-empty (length > 0), extract `url` and `number` from the first element and return `{ url, number }` immediately without creating a new PR
- Log: `log(\`Reusing existing PR #${number} for branch ${options.sourceBranch}\`, 'info')`
- Import `log` from `../../core/utils`

### Step 5: Upgrade Claude CLI ENOENT retry in `adws/agents/claudeAgent.ts`
- Replace the single ENOENT retry block (lines 116-126) with a 3-attempt loop:
  ```
  const MAX_ENOENT_RETRIES = 3;
  if (!result.success && result.output.includes('ENOENT')) {
    for (let attempt = 1; attempt <= MAX_ENOENT_RETRIES; attempt++) {
      log(`Claude CLI ENOENT retry attempt ${attempt}/${MAX_ENOENT_RETRIES}...`, 'warn');
      clearClaudeCodePathCache();
      const backoffMs = 500 * Math.pow(2, attempt - 1);
      await delay(backoffMs);
      const retryPath = resolveClaudeCodePath();
      log(`Re-resolved Claude CLI path: ${retryPath}`, 'info');
      const retryProcess = spawn(retryPath, cliArgs, spawnOptions);
      const retryResult = await handleAgentProcess(retryProcess, agentName, outputFile, onProgress, statePath, model);
      if (retryResult.success || !retryResult.output.includes('ENOENT')) {
        return retryResult;
      }
    }
    // All retries exhausted
    log(`Claude CLI not found after ${MAX_ENOENT_RETRIES} ENOENT retries`, 'error');
  }
  ```
- This ensures `resolveClaudeCodePath()` is called fresh on every attempt (picking up new symlink targets)

### Step 6: Add pre-flight Claude CLI validation in `adws/phases/workflowInit.ts`
- Add imports: `import { resolveClaudeCodePath } from '../core';` and `import { accessSync, constants } from 'fs';`
- Early in `initializeWorkflow()`, before the issue fetch (before line 109), add:
  ```
  // Pre-flight: verify Claude CLI is available and executable
  const claudePath = resolveClaudeCodePath();
  if (!claudePath) {
    throw new Error('Pre-flight check failed: Claude CLI not found. Ensure "claude" is installed and in PATH, or set CLAUDE_CODE_PATH in .env.');
  }
  try {
    accessSync(claudePath, constants.X_OK);
  } catch {
    throw new Error(`Pre-flight check failed: Claude CLI not executable at ${claudePath}. Check file permissions.`);
  }
  log('Pre-flight: Claude CLI validated', 'info');
  ```

### Step 7: Switch worktree creation to `origin/<defaultBranch>` base ref
- In `adws/vcs/worktreeCreation.ts` `createWorktree()`:
  - When `baseBranch` is provided and creating a new branch (line 143), prepend `origin/` to the base ref: change `"${baseBranch}"` to `"origin/${baseBranch}"`
  - Before the worktree creation command, add: `execSync(\`git fetch origin "${baseBranch}"\`, gitOpts);`
  - After fetch, compare local vs remote HEAD and log warning if they differ:
    ```
    try {
      const localRef = execSync(`git rev-parse "${baseBranch}"`, gitOpts).toString().trim();
      const remoteRef = execSync(`git rev-parse "origin/${baseBranch}"`, gitOpts).toString().trim();
      if (localRef !== remoteRef) {
        log(`Warning: local '${baseBranch}' (${localRef.substring(0, 7)}) differs from 'origin/${baseBranch}' (${remoteRef.substring(0, 7)}). Using remote ref.`, 'warn');
      }
    } catch { /* local branch may not exist — no warning needed */ }
    ```
- In `createWorktreeForNewBranch()`: same changes — when `baseBranch` is provided, fetch and use `origin/${baseBranch}`

### Step 8: Add graceful degradation and retry to resolution/validation agents
**`adws/agents/resolutionAgent.ts`:**
- In `parseResolutionResult()`: replace `throw new Error(...)` with a graceful fallback:
  ```
  log(`Resolution agent returned non-JSON output, treating as unresolved: ${agentOutput.substring(0, 200)}`, 'warn');
  return { resolved: false, decisions: [] };
  ```
- In `runResolutionAgent()`: after parsing, if `extractJson()` returned null (indicated by `resolutionResult.resolved === false && resolutionResult.decisions.length === 0`), re-run the agent once:
  - Check the raw output with `extractJson()` — if null, log and re-run
  - If retry also fails parsing, return the graceful degradation result

**`adws/agents/validationAgent.ts`:**
- In `runValidationAgent()`: after parsing, if the result indicates a parse failure (description contains "did not return valid JSON"), re-run the agent once
- Log: `log('Validation agent returned non-JSON output, retrying once...', 'warn')`
- If retry also fails, return the existing fallback unaligned result

### Step 9: Guard review issue arrays in `adws/agents/reviewRetry.ts`
- In `mergeReviewResults()` (line 83-84), add `.filter()` after `.flatMap()`:
  - Change: `.flatMap(r => r.reviewResult!.reviewIssues)`
  - To: `.flatMap(r => r.reviewResult!.reviewIssues).filter((issue): issue is ReviewIssue => issue != null)`
- Similarly for screenshots (line 94-95):
  - Change: `.flatMap(r => r.reviewResult!.screenshots)`
  - To: `.flatMap(r => r.reviewResult!.screenshots).filter((s): s is string => s != null)`

### Step 10: Write skip reason files on auto-merge early exits
**`adws/triggers/autoMergeHandler.ts`:**
- Import `writeFileSync` from `fs` and `join` from `path` (already imported)
- After `ensureLogsDirectory()` call (line 224), on subsequent early returns, write `skip_reason.txt`:
  - After PR state check (line 217-219): `writeFileSync(join(logsDir, 'skip_reason.txt'), 'PR already merged, skipping auto-merge');`
    - Note: this early return happens AFTER `ensureLogsDirectory()`, so `logsDir` exists
  - After worktree failure (line 232-234): `writeFileSync(join(logsDir, 'skip_reason.txt'), \`Worktree creation failed for branch: ${headBranch}\`);`
    - Note: this early return also happens after `ensureLogsDirectory()`

**`adws/phases/autoMergePhase.ts`:**
- Import `writeFileSync` from `fs` and `join` from `path`
- On the early return for missing PR URL (line 47-49): `writeFileSync(join(logsDir, 'skip_reason.txt'), 'No PR URL found, skipping auto-merge');`
- On the early return for missing repo context (line 54-56): `writeFileSync(join(logsDir, 'skip_reason.txt'), 'No repo context available, skipping auto-merge');`

### Step 11: Create step definitions — `features/step_definitions/retryLogicResilienceSteps.ts`
Create a new file with step definitions for all 32 scenarios. Follow the existing pattern from `commonSteps.ts` and `autoMergeApprovedPrSteps.ts`: use source content verification (read files, assert on content).

**Pattern for each step:**
- `Given` steps: read source files, store content in `this` context
- `When` steps: context-only (setup for assertions) or assert intermediate state
- `Then` steps: assert file content contains expected patterns

**Key content checks per scenario group:**

1. **execWithRetry utility (scenarios 1-3):** Read `adws/core/utils.ts`, assert contains `execWithRetry`, `Math.pow(2`, `maxAttempts`, and non-transient error check patterns
2. **Module usage (scenarios 4-7):** Read each module file (`issueApi.ts`, `prApi.ts`, `githubApi.ts`, `githubCodeHost.ts`), assert contains `execWithRetry` import/usage
3. **Claude CLI ENOENT (scenarios 8-10):** Read `claudeAgent.ts`, assert contains ENOENT retry loop with `resolveClaudeCodePath` called per attempt
4. **Pre-flight (scenarios 11-13):** Read `workflowInit.ts`, assert contains `resolveClaudeCodePath`, `accessSync`, `X_OK`, and pre-flight error messages
5. **Worktree (scenarios 14-16):** Read `worktreeCreation.ts`, assert contains `origin/${baseBranch}`, `git fetch origin`, and divergence warning log
6. **PR creation (scenarios 17-19):** Read `githubCodeHost.ts`, assert contains `gh pr list --head`, existing PR reuse logic
7. **JSON parse retry (scenarios 20-24):** Read `resolutionAgent.ts`, assert graceful fallback (no `throw`); read `validationAgent.ts`, assert retry logic
8. **Review arrays (scenarios 24-25):** Read `reviewRetry.ts`, assert `.filter` before `.issueDescription` access
9. **Auto-merge skip (scenarios 26-31):** Read `autoMergeHandler.ts` and `autoMergePhase.ts`, assert `skip_reason.txt` writes
10. **TypeScript compilation (scenario 32):** Run `bunx tsc --noEmit` via `spawnSync`

**Implementation notes for the step definition file:**
- Use `function()` syntax (not arrow functions) for Cucumber `this` binding
- Define a `World` interface with `fileContent: string`, `filePath: string`, and any additional context fields
- Reuse `sharedCtx` from `commonSteps.ts` for cross-step context where needed
- For the TypeScript compilation scenario, use `spawnSync('bunx', ['tsc', '--noEmit'], { encoding: 'utf-8' })` and assert exit code 0

### Step 12: Run validation commands
- `NODE_OPTIONS='--import tsx' bunx cucumber-js --tags '@adw-315'` — Verify all 32 scenarios pass
- `bun run lint` — Check for code quality issues
- `bun run build` — Verify no build errors
- `bunx tsc --noEmit` — Root TypeScript type checking
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type checking

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `NODE_OPTIONS='--import tsx' bunx cucumber-js --tags '@adw-315'` — All 32 BDD scenarios pass
2. `bun run lint` — No lint errors
3. `bun run build` — Build succeeds
4. `bunx tsc --noEmit` — Root TypeScript type checking passes
5. `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific type checking passes

## Patch Scope
**Lines of code to change:** ~450 (source changes) + ~400 (step definitions) ≈ 850
**Risk level:** medium
**Testing required:** Full BDD scenario suite (`@adw-315`), TypeScript compilation, lint, build. No unit tests (disabled per `.adw/project.md`).
