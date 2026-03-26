# Patch: Fix feature parse error and implement all 14 robustness hardening steps

## Metadata
adwId: `gcisck-robustness-hardening`
reviewChangeRequest: `specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md`

## Issue Summary
**Original Spec:** specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md
**Issue:** All 30 BDD scenarios fail with exit code 1 and no output. Two root causes: (1) Gherkin parse error — `So that` on line 75 of `features/retry_logic_resilience.feature` is not a valid step keyword inside a scenario, causing cucumber-js to abort; (2) No implementation code exists — the branch only contains planning artifacts (spec + BDD feature file). All 14 steps from the spec are unstarted.
**Solution:** Fix the feature file parse error, then implement all 14 steps from the spec to add: `execWithRetry` utility, gh CLI retry across 4 modules, Claude CLI ENOENT multi-retry, pre-flight CLI validation, worktree origin ref, PR duplicate check, JSON parse graceful degradation, undefined array guard, and auto-merge skip logging.

## Files to Modify
Use these files to implement the patch:

### Feature file fix
1. `features/retry_logic_resilience.feature` — Remove invalid `So that` step keyword on line 75

### Implementation (13 source files, per spec Steps 1–13)
2. `adws/core/utils.ts` — Add `execWithRetry` utility function
3. `adws/core/index.ts` — Re-export `execWithRetry`
4. `adws/github/issueApi.ts` — Replace 7 bare `execSync` calls with `execWithRetry`
5. `adws/github/prApi.ts` — Replace 7 bare `execSync` calls with `execWithRetry`
6. `adws/github/githubApi.ts` — Replace `execSync` with `execWithRetry` for `gh api user` call only (NOT `git remote get-url`)
7. `adws/providers/github/githubCodeHost.ts` — Replace `execSync` with `execWithRetry` for `gh pr create`; add existing PR check before creating
8. `adws/agents/claudeAgent.ts` — Upgrade ENOENT retry to 3 attempts with per-attempt `clearClaudeCodePathCache()` + `resolveClaudeCodePath()`
9. `adws/phases/workflowInit.ts` — Add pre-flight Claude CLI validation (`resolveClaudeCodePath` + `accessSync` X_OK check)
10. `adws/vcs/worktreeCreation.ts` — Use `origin/<defaultBranch>` as base ref; `git fetch origin` before worktree add
11. `adws/agents/resolutionAgent.ts` — Return `{ resolved: false, decisions: [] }` fallback instead of throwing on invalid JSON; add single retry in `runResolutionAgent()`
12. `adws/agents/validationAgent.ts` — Add single retry on non-JSON output in `runValidationAgent()`
13. `adws/agents/reviewRetry.ts` — Add `.filter((issue): issue is ReviewIssue => issue != null)` to reviewIssues and screenshots flatMaps
14. `adws/triggers/autoMergeHandler.ts` — Write `skip_reason.txt` on early exits after `ensureLogsDirectory()`
15. `adws/phases/autoMergePhase.ts` — Write `skip_reason.txt` on early exits

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Fix feature file parse error
- In `features/retry_logic_resilience.feature`, line 75: change `So that later attempts pick up the new symlink target` to `And later attempts pick up the new symlink target`
- `So that` is valid in a Feature background description but is NOT a valid Gherkin step keyword inside a Scenario — cucumber-js aborts with a parse error, producing zero output for all 30 scenarios

### Step 2: Create `execWithRetry` utility and apply to all gh CLI callers (Spec Steps 1–6)
This step implements the foundation utility and immediately applies it to all 4 gh CLI modules.

**Create `execWithRetry` in `adws/core/utils.ts`:**
- Add `import { execSync, type ExecSyncOptions } from 'child_process';` at top
- Add exported function `execWithRetry(command: string, options?: ExecSyncOptions & { maxAttempts?: number }): string`
- Default `maxAttempts` to 3
- Loop with exponential backoff: `500 * Math.pow(2, attempt)` ms (matching `exchangeRates.ts` pattern: 500ms, 1000ms, 2000ms)
- On each failed attempt except the last, log with `log()`: `"execWithRetry: attempt ${attempt + 1}/${maxAttempts} failed for command, retrying in ${delay}ms..."`
- On the final failed attempt, re-throw the original error
- On success, return `execSync(command, options)?.toString().trim() ?? ''`
- Export from `adws/core/index.ts` by adding `execWithRetry` to the `'./utils'` export block

**Apply `execWithRetry` to `adws/github/issueApi.ts`:**
- Import `execWithRetry` from `'../core'` (replace or supplement existing `execSync` import)
- Replace all 7 `execSync(...)` calls for `gh` CLI commands with `execWithRetry(...)`:
  - `fetchGitHubIssue()` (~line 114)
  - `commentOnIssue()` (~line 136)
  - `getIssueState()` (~line 175)
  - `closeIssue()` (~line 211)
  - `getIssueTitleSync()` (~line 233)
  - `fetchIssueCommentsRest()` (~line 253)
  - `deleteIssueComment()` (~line 277)
- Preserve existing error handling (some functions catch and return gracefully, some throw)
- `execWithRetry` returns a trimmed string, so remove any `.toString().trim()` chains on the call sites

**Apply `execWithRetry` to `adws/github/prApi.ts`:**
- Import `execWithRetry` from `'../core'`
- Replace all 7 `execSync(...)` calls for `gh` CLI commands:
  - `fetchPRDetails()` (~line 61)
  - `fetchPRReviews()` (~line 95)
  - `fetchPRReviewComments()` (~line 133)
  - `commentOnPR()` (~line 176)
  - `mergePR()` (~line 195)
  - `approvePR()` (~line 227)
  - `fetchPRList()` (~line 253)
- Preserve existing error handling patterns

**Apply `execWithRetry` to `adws/github/githubApi.ts`:**
- Import `execWithRetry` from `'../core'`
- Replace only the `gh api user` call in `getAuthenticatedUser()` (~line 72) with `execWithRetry`
- Do NOT change `git remote get-url origin` in `getRepoInfo()` — it's a local git command, not a network call

**Apply `execWithRetry` to `adws/providers/github/githubCodeHost.ts`:**
- Import `execWithRetry` from `'../../core'`
- Replace `execSync` for `gh pr create` in `createMergeRequest()` (~line 90) with `execWithRetry`

### Step 3: Add existing PR check before `gh pr create` (Spec Step 6)
- In `adws/providers/github/githubCodeHost.ts` `createMergeRequest()`:
- Before the `gh pr create` call, add a check:
  ```typescript
  const existingPrJson = execWithRetry(
    `gh pr list --head "${sourceBranch}" --repo "${owner}/${repo}" --json url,number --limit 1`,
    { encoding: 'utf-8' }
  );
  const existingPrs = JSON.parse(existingPrJson || '[]');
  if (existingPrs.length > 0) {
    log(`Existing PR found for branch ${sourceBranch}: ${existingPrs[0].url}`);
    return { url: existingPrs[0].url, number: existingPrs[0].number };
  }
  ```
- If a PR already exists for the branch, return its URL and number without creating a duplicate

### Step 4: Upgrade Claude CLI ENOENT retry (Spec Step 7)
- In `adws/agents/claudeAgent.ts`, replace the single ENOENT retry (~lines 116-126) with a 3-attempt loop:
  ```typescript
  const MAX_ENOENT_RETRIES = 3;
  const enoentBackoff = [500, 1000, 2000];
  for (let attempt = 0; attempt < MAX_ENOENT_RETRIES; attempt++) {
    clearClaudeCodePathCache();
    const freshPath = resolveClaudeCodePath();
    log(`ENOENT retry attempt ${attempt + 1}/${MAX_ENOENT_RETRIES}, resolved path: ${freshPath}`);
    await delay(enoentBackoff[attempt]);
    // re-spawn with freshPath...
  }
  ```
- On **every** attempt: call `clearClaudeCodePathCache()` then `resolveClaudeCodePath()` to get a fresh path
- Use the existing `delay()` helper for backoff
- If all 3 attempts fail, let the error propagate to the caller

### Step 5: Add pre-flight Claude CLI validation (Spec Step 8)
- In `adws/phases/workflowInit.ts` `initializeWorkflow()`:
- Early in the function (before issue fetch at ~line 109), add:
  ```typescript
  import { resolveClaudeCodePath } from '../core';
  import { accessSync, constants } from 'fs';

  const claudePath = resolveClaudeCodePath();
  try {
    accessSync(claudePath, constants.X_OK);
  } catch {
    throw new Error(`Pre-flight check failed: Claude CLI not found or not executable at ${claudePath}. Ensure 'claude' is installed and in PATH, or set CLAUDE_CODE_PATH in .env.`);
  }
  log(`Pre-flight check passed: Claude CLI found at ${claudePath}`);
  ```
- Fail fast with a clear message before any agent work begins

### Step 6: Switch worktree creation to `origin/<defaultBranch>` (Spec Step 9)
- In `adws/vcs/worktreeCreation.ts`:
- In `createWorktree()` (~line 143): when building the `git worktree add` command with `baseBranch`, prepend `origin/`:
  - Before the worktree add, run `execSync(\`git fetch origin "${baseBranch}"\`, { cwd: baseRepoPath })` to ensure remote ref is current
  - Use `origin/${baseBranch}` as the start point instead of bare `baseBranch`
- In `createWorktreeForNewBranch()` (~line 182): same pattern — fetch then use `origin/${baseBranch}`
- Add a warning log if the local branch HEAD differs from `origin/<defaultBranch>`:
  ```typescript
  try {
    const localHead = execSync(`git rev-parse ${baseBranch}`, { encoding: 'utf-8' }).trim();
    const remoteHead = execSync(`git rev-parse origin/${baseBranch}`, { encoding: 'utf-8' }).trim();
    if (localHead !== remoteHead) {
      log(`Warning: local ${baseBranch} (${localHead.slice(0,7)}) differs from origin/${baseBranch} (${remoteHead.slice(0,7)})`, 'warn');
    }
  } catch { /* ignore — informational only */ }
  ```

### Step 7: Add graceful degradation and retry for JSON parse failures (Spec Steps 10–11)
**In `adws/agents/resolutionAgent.ts`:**
- Modify `parseResolutionResult()` to return a fallback instead of throwing when JSON is invalid:
  - If `extractJson()` returns null or `parsed.resolved` is not boolean, return `{ resolved: false, decisions: [] }` with a warning log
  - Mirror the `validationAgent.ts` graceful degradation pattern
- In `runResolutionAgent()`: after parsing, if the result is the fallback (resolved=false, decisions empty) and the raw output doesn't look like JSON, re-run the agent once:
  - Log: `"Resolution agent returned non-JSON output, retrying once..."`
  - If retry also fails parsing, return the graceful degradation result

**In `adws/agents/validationAgent.ts`:**
- In `runValidationAgent()`: after parsing, if the result is the fallback unaligned result and the raw output doesn't contain valid JSON, re-run the agent once:
  - Log: `"Validation agent returned non-JSON output, retrying once..."`
  - If retry also fails, return the existing fallback unaligned result

### Step 8: Guard undefined review issue array elements (Spec Step 12)
- In `adws/agents/reviewRetry.ts` `mergeReviewResults()` (~line 83):
- Add null filter to reviewIssues flatMap:
  ```typescript
  .flatMap(r => r.reviewResult!.reviewIssues)
  .filter((issue): issue is ReviewIssue => issue != null)
  ```
- Add null filter to screenshots flatMap:
  ```typescript
  .flatMap(r => r.reviewResult!.screenshots)
  .filter((s): s is string => s != null)
  ```

### Step 9: Write skip reason files on auto-merge early exits (Spec Step 13)
**In `adws/triggers/autoMergeHandler.ts` `handleApprovedReview()`:**
- After `ensureLogsDirectory()` creates the log directory, on each subsequent early return, write a `skip_reason.txt`:
  - PR already merged: `"PR already merged, skipping auto-merge"`
  - Worktree failure: `"Worktree creation failed for branch: <branch>"`
  - Missing PR URL: `"No PR URL available, skipping auto-merge"`
  - Missing repo context: `"No repo context available, skipping auto-merge"`
- Use `fs.writeFileSync(path.join(logDir, 'skip_reason.txt'), reason)`

**In `adws/phases/autoMergePhase.ts` `executeAutoMergePhase()`:**
- On early return for missing PR URL (~line 48): write `skip_reason.txt` to `config.logsDir` with `"No PR URL found, skipping auto-merge"`
- On early return for missing repo context (~line 55): write `skip_reason.txt` to `config.logsDir` with `"No repo context available, skipping auto-merge"`

### Step 10: Run validation commands (Spec Step 14)
- `bun run lint` — verify no linting errors
- `bun run build` — verify no build errors
- `bunx tsc --noEmit` — root TypeScript type checking
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type checking

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `bun run lint` — Run linter to check for code quality issues
2. `bun run build` — Build the application to verify no build errors
3. `bunx tsc --noEmit` — Root TypeScript type checking
4. `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type checking
5. `bunx cucumber-js --dry-run --tags "@adw-315"` — Verify feature file parses without errors (dry run, no step execution)

## Patch Scope
**Lines of code to change:** ~250-350 lines across 15 files
**Risk level:** medium — touches many modules but each change is small and follows existing patterns
**Testing required:** TypeScript compilation, linting, BDD feature file parse validation. Unit tests are disabled for this project.
