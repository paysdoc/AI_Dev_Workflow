# Patch: Implement all step definitions and source code for retry logic resilience BDD scenarios

## Metadata
adwId: `gcisck-robustness-hardening`
reviewChangeRequest: `Issue #1: @review-proof scenarios FAILED (exit code 1, no output). No step definitions or source implementation exist for any of the 30 BDD scenarios defined in features/retry_logic_resilience.feature.`

## Issue Summary
**Original Spec:** specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md
**Issue:** All 30 BDD scenarios in `features/retry_logic_resilience.feature` fail because (a) no step definitions exist, (b) no source code changes have been applied, and (c) line 75 uses `So that` which is not a valid Gherkin step keyword inside a Scenario body.
**Solution:** Apply all 14 source code changes from the spec, fix the Gherkin parse error, then create a step definition file that verifies each change via source-content assertions (matching the project's established pattern).

## Files to Modify
Use these files to implement the patch:

1. `features/retry_logic_resilience.feature` — Fix `So that` → `And` on line 75
2. `adws/core/utils.ts` — Add `execWithRetry` utility
3. `adws/core/index.ts` — Export `execWithRetry`
4. `adws/github/issueApi.ts` — Replace `execSync` with `execWithRetry` for gh CLI calls
5. `adws/github/prApi.ts` — Replace `execSync` with `execWithRetry` for gh CLI calls
6. `adws/github/githubApi.ts` — Replace `execSync` with `execWithRetry` for `gh api user` call
7. `adws/providers/github/githubCodeHost.ts` — Replace `execSync` with `execWithRetry` for `gh pr create`; add existing PR check
8. `adws/agents/claudeAgent.ts` — Upgrade ENOENT retry to 3 attempts with per-attempt path re-resolution
9. `adws/phases/workflowInit.ts` — Add pre-flight Claude CLI validation
10. `adws/vcs/worktreeCreation.ts` — Use `origin/<defaultBranch>` as base ref
11. `adws/agents/resolutionAgent.ts` — Graceful fallback instead of throw; add retry on non-JSON
12. `adws/agents/validationAgent.ts` — Add retry on non-JSON output in `runValidationAgent()`
13. `adws/agents/reviewRetry.ts` — Filter null/undefined from review issue and screenshot arrays
14. `adws/triggers/autoMergeHandler.ts` — Write `skip_reason.txt` on early exits after `ensureLogsDirectory()`
15. `adws/phases/autoMergePhase.ts` — Write `skip_reason.txt` on early exits
16. `features/step_definitions/retryLogicResilienceSteps.ts` — **New file:** Step definitions for all 30 scenarios

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Fix feature file Gherkin parse error
- In `features/retry_logic_resilience.feature` line 75, change `So that later attempts pick up the new symlink target` to `And later attempts pick up the new symlink target`
- `So that` is not a valid step keyword inside a Scenario body — only `Given`, `When`, `Then`, `And`, `But` are valid

### Step 2: Create `execWithRetry` utility in `adws/core/utils.ts` and export from `adws/core/index.ts`
- Import `execSync` and `type ExecSyncOptions` from `child_process`
- Import `log` from `./logger`
- Add exported function: `export function execWithRetry(command: string, options?: ExecSyncOptions & { maxAttempts?: number }): string`
- Default `maxAttempts` to 3
- Implement retry loop following `exchangeRates.ts` backoff pattern:
  - For each attempt 0..maxAttempts-1:
    - Try `execSync(command, { ...options, encoding: 'utf-8' }).toString().trim()`
    - On success, return immediately
    - On failure: check if error message contains non-transient patterns (`"not found"`, `"does not exist"`, `"permission denied"`, `"authentication"`) — throw immediately for these
    - Otherwise: if last attempt, throw; else log warning `execWithRetry attempt ${attempt + 1}/${maxAttempts} failed for command, retrying...` and sleep `500 * Math.pow(2, attempt)` ms
  - Use synchronous sleep: `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs)` since callers expect synchronous behavior
- Export `execWithRetry` from `adws/core/index.ts` by adding it to the re-export block from `'./utils'` (alongside `ensureLogsDirectory`)

### Step 3: Apply `execWithRetry` to gh CLI callers across 4 files
Replace bare `execSync` calls with `execWithRetry` for `gh` CLI calls only. Leave `git` commands and local operations untouched. Preserve each function's existing error handling.

**`adws/github/issueApi.ts`:**
- Add import: `import { execWithRetry } from '../core/utils';`
- Replace `execSync` → `execWithRetry` in: `fetchGitHubIssue()`, `getIssueState()`, `getIssueTitleSync()`, `fetchIssueCommentsRest()`, `deleteIssueComment()`
- For `commentOnIssue()` and `closeIssue()` — these use `input` in stdio options. `execWithRetry` should pass through all `ExecSyncOptions` including `input` and `stdio` arrays. The `commentOnIssue()` call uses `{ encoding: 'utf-8', input: body, stdio: ['pipe', 'pipe', 'pipe'] }` — pass this through to `execWithRetry`.
- Remove `{ encoding: 'utf-8' }` where it's the only option since `execWithRetry` forces encoding internally

**`adws/github/prApi.ts`:**
- Add import: `import { execWithRetry } from '../core/utils';`
- Replace `execSync` → `execWithRetry` in: `fetchPRDetails()`, `fetchPRReviews()`, `fetchPRReviewComments()`, `commentOnPR()`, `mergePR()`, `approvePR()`, `fetchPRList()`
- For `commentOnPR()` which uses `input` in options — pass through as-is
- For `approvePR()` which uses `stdio` options — pass through as-is

**`adws/github/githubApi.ts`:**
- Add import: `import { execWithRetry } from '../core/utils';`
- Replace `execSync` → `execWithRetry` ONLY for `gh api user` call in `getAuthenticatedUser()` (line 72)
- Do NOT retry `git remote get-url origin` in `getRepoInfo()` — it's local, not network

**`adws/providers/github/githubCodeHost.ts`:**
- Add import: `import { execWithRetry } from '../../core/utils';`
- Replace `execSync` → `execWithRetry` for the `gh pr create` call in `createMergeRequest()`

### Step 4: Add existing PR check in `githubCodeHost.ts` `createMergeRequest()`
- Before calling `gh pr create`, run: `execWithRetry(\`gh pr list --head "${options.sourceBranch}" --repo ${this.repoInfo.owner}/${this.repoInfo.repo} --json url,number --limit 1\`)`
- Parse the JSON result. If array is non-empty, return `{ url: existingPr.url, number: existingPr.number }` directly without creating a new PR
- Log: `log(\`Reusing existing PR #${existingPr.number}: ${existingPr.url}\`, 'info')`
- Import `log` from `../../core/utils`

### Step 5: Upgrade Claude CLI ENOENT retry in `adws/agents/claudeAgent.ts`
- Replace the single ENOENT retry (lines 116-126) with a 3-attempt loop:
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
      if (retryResult.success || !retryResult.output.includes('ENOENT')) {
        return retryResult;
      }
      if (attempt === maxRetries) {
        return retryResult;
      }
    }
  }
  ```
- Key: `clearClaudeCodePathCache()` + `resolveClaudeCodePath()` on EVERY attempt (not just the first)

### Step 6: Add pre-flight Claude CLI validation in `adws/phases/workflowInit.ts`
- Early in `initializeWorkflow()`, before the issue fetch:
  - Import `resolveClaudeCodePath` from `'../core'` (already imported via barrel)
  - Import `accessSync, constants` from `'fs'` (fs already imported in the module)
  - Add:
    ```typescript
    // Pre-flight: verify Claude CLI is available and executable
    try {
      const claudePath = resolveClaudeCodePath();
      fs.accessSync(claudePath, fs.constants.X_OK);
      log(`Pre-flight check passed: Claude CLI found at ${claudePath}`, 'info');
    } catch (error) {
      throw new Error(`Pre-flight check failed: Claude CLI not found or not executable. Ensure 'claude' is installed and in PATH, or set CLAUDE_CODE_PATH in .env. Error: ${error}`);
    }
    ```

### Step 7: Switch worktree creation to use `origin/<defaultBranch>` base ref
In `adws/vcs/worktreeCreation.ts`:
- In `createWorktree()` — when `baseBranch` is provided and the branch doesn't exist (the `} else if (baseBranch) {` block at line 141):
  - Before the `git worktree add` call, run: `execSync(\`git fetch origin "${baseBranch}"\`, gitOpts);`
  - Change the base ref from `"${baseBranch}"` to `"origin/${baseBranch}"`
  - After creation, log a warning if local differs from remote:
    ```typescript
    try {
      const localRef = execSync(`git rev-parse "${baseBranch}"`, gitOpts).toString().trim();
      const remoteRef = execSync(`git rev-parse "origin/${baseBranch}"`, gitOpts).toString().trim();
      if (localRef !== remoteRef) {
        log(`Warning: local '${baseBranch}' (${localRef.substring(0, 8)}) differs from origin (${remoteRef.substring(0, 8)})`, 'warn');
      }
    } catch { /* ignore comparison errors */ }
    ```
- In `createWorktreeForNewBranch()` — when `baseBranch` is provided:
  - Before the `git worktree add` call, run: `execSync(\`git fetch origin "${baseBranch}"\`, { ...gitOpts });`
  - Change `const base = baseBranch || 'HEAD'` to `const base = baseBranch ? \`origin/${baseBranch}\` : 'HEAD'`

### Step 8: Add graceful degradation + retry to resolution and validation agents
**`adws/agents/resolutionAgent.ts`:**
- Change `parseResolutionResult()` to return a fallback instead of throwing:
  ```typescript
  export function parseResolutionResult(agentOutput: string): ResolutionResult {
    const parsed = extractJson<ResolutionResult>(agentOutput);
    if (!parsed || typeof parsed.resolved !== "boolean") {
      const preview = agentOutput.substring(0, 200);
      log(`Resolution agent returned non-JSON output, treating as unresolved: ${preview}`, "warn");
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
    log("Resolution agent returned non-JSON output, retrying once...", "warn");
    const retryResult = await runClaudeAgentWithCommand(/* same args */);
    const retryParsed = parseResolutionResult(retryResult.output);
    return { ...retryResult, resolutionResult: retryParsed };
  }
  return { ...result, resolutionResult };
  ```
- Import `log` from `../core/logger`

**`adws/agents/validationAgent.ts`:**
- In `runValidationAgent()`, after parsing, add retry logic:
  ```typescript
  const validationResult = parseValidationResult(result.output);
  // Retry once if parse fell back to non-JSON handling
  if (!validationResult.aligned && !extractJson(result.output)) {
    log("Validation agent returned non-JSON output, retrying once...", "warn");
    const retryResult = await runClaudeAgentWithCommand(/* same args */);
    const retryParsed = parseValidationResult(retryResult.output);
    return { ...retryResult, validationResult: retryParsed };
  }
  return { ...result, validationResult };
  ```

### Step 9: Guard against undefined review issue array elements in `adws/agents/reviewRetry.ts`
- In `mergeReviewResults()` (line 83-84), add `.filter()` after `.flatMap()`:
  ```typescript
  const mergedIssues = validResults
    .flatMap(r => r.reviewResult!.reviewIssues)
    .filter((issue): issue is ReviewIssue => issue != null)
    .filter(issue => { ... });
  ```
- Same for screenshots (line 94-95):
  ```typescript
  const mergedScreenshots = validResults
    .flatMap(r => r.reviewResult!.screenshots)
    .filter((s): s is string => s != null)
    .filter(screenshot => { ... });
  ```

### Step 10: Write skip reason files on auto-merge early exits
**`adws/triggers/autoMergeHandler.ts`:**
- In `handleApprovedReview()`, after `ensureLogsDirectory()` (line 224), for each subsequent early return:
  - PR already merged/closed (line 217-220): Move `ensureLogsDirectory()` call before the merged check, then write `fs.writeFileSync(path.join(logsDir, 'skip_reason.txt'), 'PR already merged, skipping auto-merge')` before return
  - Worktree creation failure (line 230-235): Write `fs.writeFileSync(path.join(logsDir, 'skip_reason.txt'), \`Worktree creation failed for branch: ${headBranch}: ${error}\`)` before return
- Import `writeFileSync` from `fs` (fs already imported via `path`)
- Note: Early returns BEFORE ensureLogsDirectory (missing prNumber, missing repoFullName) have no log dir yet — no skip file for those

**`adws/phases/autoMergePhase.ts`:**
- On early return for missing PR URL (line 47-49): Write `fs.writeFileSync(path.join(config.logsDir, 'skip_reason.txt'), 'No PR URL found, skipping auto-merge')`
- On early return for missing repo context (line 54-56): Write `fs.writeFileSync(path.join(config.logsDir, 'skip_reason.txt'), 'No repo context available, skipping auto-merge')`
- Import `writeFileSync` from `fs`

### Step 11: Create step definitions file `features/step_definitions/retryLogicResilienceSteps.ts`
Create a new step definition file following the project's established pattern (source-content assertions using `readFileSync` + `assert`). All step definitions verify that the source code changes from Steps 2-10 are present.

The step definitions follow the pattern in `reviewRetryPatchImplementationSteps.ts`:
- `Given` steps load the relevant source file into a shared context
- `When` steps are context-only (no-ops or load a file)
- `Then` steps assert on file content (presence of strings, patterns)

Group step definitions by the 7 feature sections:
1. **execWithRetry utility** (scenarios 1-7): Load `adws/core/utils.ts`, assert `execWithRetry` function exists, exponential backoff pattern, non-transient error handling. Load `issueApi.ts`, `prApi.ts`, `githubApi.ts`, `githubCodeHost.ts` and assert they import/use `execWithRetry`.
2. **Claude CLI ENOENT retry** (scenarios 8-10): Load `claudeAgent.ts`, assert 3-attempt retry loop, `clearClaudeCodePathCache`, `resolveClaudeCodePath` on every attempt, exponential backoff.
3. **Pre-flight CLI validation** (scenarios 11-13): Load `workflowInit.ts`, assert `resolveClaudeCodePath`, `accessSync`, pre-flight error message.
4. **Worktree creation** (scenarios 14-16): Load `worktreeCreation.ts`, assert `origin/` prefix, `git fetch origin`, warning log for divergence.
5. **PR creation dedup** (scenarios 17-19): Load `githubCodeHost.ts`, assert `gh pr list --head`, existing PR reuse logic.
6. **JSON parse retry + graceful degradation** (scenarios 20-26): Load `resolutionAgent.ts` assert graceful fallback (no throw), retry once pattern. Load `validationAgent.ts` assert retry once pattern. Load `reviewRetry.ts` assert `.filter` null guard on review issues and screenshots.
7. **Skip reason logging** (scenarios 27-30 + cross-cutting): Load `autoMergeHandler.ts` and `autoMergePhase.ts`, assert `skip_reason.txt` writes. Load `tsconfig.json` for TypeScript check scenario (run `bunx tsc --noEmit`).

Use unique step text that doesn't conflict with existing step definitions. Prefix Given/When/Then text with specific context (e.g., `Given an execWithRetry utility wrapping execSync` → loads utils.ts).

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-gcisck-robustness-hardening" --dry-run` — Verify 0 undefined steps for all 30 scenarios
2. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-gcisck-robustness-hardening"` — All 30 scenarios pass
3. `bun run lint` — No linting errors
4. `bunx tsc --noEmit` — Root TypeScript type checking passes
5. `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type checking passes

## Patch Scope
**Lines of code to change:** ~450 (source changes ~250, step definitions ~200)
**Risk level:** medium
**Testing required:** BDD scenario execution for @adw-gcisck-robustness-hardening tag, TypeScript compilation, linting
