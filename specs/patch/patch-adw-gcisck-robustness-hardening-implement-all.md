# Patch: Implement all robustness hardening — retry, pre-flight, graceful degradation

## Metadata
adwId: `gcisck-robustness-hardening`
reviewChangeRequest: `Issue #1: No implementation code exists. None of the 14 spec steps have been implemented.`

## Issue Summary
**Original Spec:** specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md
**Issue:** The branch contains only planning artifacts (spec, feature file, cost CSVs). Zero source files were modified. All 30+ BDD scenarios fail. Additionally, the feature file has a Gherkin parse error (`So that` on line 75 is not a valid step keyword inside a scenario).
**Solution:** Fix the feature file parse error, then implement all 14 spec steps: `execWithRetry` utility, gh CLI retry wrappers, Claude CLI ENOENT upgrade, pre-flight validation, origin-based worktree creation, existing PR check, JSON parse graceful degradation, review issue null guards, and auto-merge skip reason logging.

## Files to Modify
Use these files to implement the patch:

1. `features/retry_logic_resilience.feature` — Fix `So that` parse error on line 75
2. `adws/core/utils.ts` — Add `execWithRetry` utility
3. `adws/core/index.ts` — Export `execWithRetry`
4. `adws/github/issueApi.ts` — Replace 7 `execSync` gh CLI calls with `execWithRetry`
5. `adws/github/prApi.ts` — Replace 7 `execSync` gh CLI calls with `execWithRetry`
6. `adws/github/githubApi.ts` — Replace 1 `execSync` gh CLI call with `execWithRetry` (NOT the `git remote` call)
7. `adws/providers/github/githubCodeHost.ts` — Replace `execSync` with `execWithRetry` for `gh pr create`; add existing PR check
8. `adws/agents/claudeAgent.ts` — Upgrade ENOENT retry to 3 attempts with per-attempt path re-resolution
9. `adws/phases/workflowInit.ts` — Add pre-flight Claude CLI validation
10. `adws/vcs/worktreeCreation.ts` — Use `origin/<defaultBranch>` as base ref with fetch
11. `adws/agents/resolutionAgent.ts` — Return graceful fallback instead of throwing; add single retry in `runResolutionAgent()`
12. `adws/agents/validationAgent.ts` — Add single retry on non-JSON output in `runValidationAgent()`
13. `adws/agents/reviewRetry.ts` — Filter null/undefined from reviewIssues and screenshots flatMaps
14. `adws/triggers/autoMergeHandler.ts` — Write `skip_reason.txt` on early exits after `ensureLogsDirectory()`
15. `adws/phases/autoMergePhase.ts` — Write `skip_reason.txt` on early exits

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Fix feature file parse error
- In `features/retry_logic_resilience.feature` line 75, remove or rephrase the `So that` line inside the scenario. `So that` is not a valid Gherkin step keyword inside a scenario body. Change it to an `And` step or remove it entirely.
- The line reads: `So that later attempts pick up the new symlink target`
- Replace with: `And later attempts pick up the new symlink target`

### Step 2: Create `execWithRetry` utility and apply to all gh CLI callers
- **In `adws/core/utils.ts`:** Add a new exported function `execWithRetry(command: string, options?: ExecSyncOptions & { maxAttempts?: number }): string`
  - Import `execSync` and `ExecSyncOptions` from `child_process`
  - Default to 3 attempts with exponential backoff: `500 * Math.pow(2, attempt)` ms (matching `exchangeRates.ts` pattern)
  - On each failed attempt, log the error and attempt number using `log()` from `./logger`
  - On the final attempt, throw the original error
  - Use `execSync` under the hood, returning `stdout.toString().trim()`
- **In `adws/core/index.ts`:** Add `execWithRetry` to the re-export block from `'./utils'` (around line 58-68)

### Step 3: Apply `execWithRetry` to `adws/github/issueApi.ts`
- Add import: `import { execWithRetry } from '../core';` (alongside existing `log` import)
- Replace `execSync` with `execWithRetry` in these 7 functions:
  - `fetchGitHubIssue()` (~line 114)
  - `commentOnIssue()` (~line 136)
  - `getIssueState()` (~line 175)
  - `closeIssue()` (~line 211)
  - `getIssueTitleSync()` (~line 233)
  - `fetchIssueCommentsRest()` (~line 253)
  - `deleteIssueComment()` (~line 277)
- Keep `import { execSync } from 'child_process'` ONLY if there are non-gh calls still using it. If all calls are now `execWithRetry`, remove the `execSync` import.
- Preserve existing error handling patterns (try/catch blocks, return values)

### Step 4: Apply `execWithRetry` to `adws/github/prApi.ts`
- Add import: `import { execWithRetry } from '../core';`
- Replace `execSync` with `execWithRetry` in these 7 functions:
  - `fetchPRDetails()` (~line 61)
  - `fetchPRReviews()` (~line 95)
  - `fetchPRReviewComments()` (~line 133)
  - `commentOnPR()` (~line 176)
  - `mergePR()` (~line 195)
  - `approvePR()` (~line 227) — note: this function manipulates `GH_TOKEN` env var; `execWithRetry` must pass through the same env
  - `fetchPRList()` (~line 253)
- Keep `execSync` import only if needed for non-gh calls

### Step 5: Apply `execWithRetry` to `adws/github/githubApi.ts` and `adws/providers/github/githubCodeHost.ts`
- **In `githubApi.ts`:** Replace `execSync` with `execWithRetry` for `getAuthenticatedUser()` `gh api user` call (~line 72). Do NOT replace the `git remote get-url origin` call in `getRepoInfo()` — it's a local git command.
- **In `githubCodeHost.ts`:** Replace `execSync` with `execWithRetry` for the `gh pr create` call in `createMergeRequest()` (~line 90)

### Step 6: Add existing PR check in `githubCodeHost.ts` `createMergeRequest()`
- Before the `gh pr create` call, run: `execWithRetry(\`gh pr list --head "${options.sourceBranch}" --repo ${repoFlag value} --json url,number --limit 1\`, { encoding: 'utf-8' })`
- Parse the JSON response. If the array is non-empty, extract the first PR's `url` and `number`
- Log: `"Existing PR found for branch ${options.sourceBranch}: #${number}"`
- Return the existing PR's `{ url, number }` directly without calling `gh pr create`
- If no existing PR, proceed with `gh pr create` as before

### Step 7: Upgrade Claude CLI ENOENT retry in `adws/agents/claudeAgent.ts`
- Replace the single ENOENT retry block (~lines 116-126) with a 3-attempt loop
- Exponential backoff: 500ms, 1000ms, 2000ms using existing `delay()` helper (lines 40-43)
- On **every** retry attempt: call `clearClaudeCodePathCache()` then `resolveClaudeCodePath()` to get a fresh path
- Log each retry attempt with the attempt number and resolved path
- If all 3 attempts fail, throw the ENOENT error (don't swallow it)

### Step 8: Add pre-flight Claude CLI validation in `adws/phases/workflowInit.ts`
- Early in `initializeWorkflow()`, before the issue fetch (~before line 108):
  - Import `resolveClaudeCodePath` from `../core` (already available via core exports)
  - Import `accessSync, constants` from `fs`
  - Call `resolveClaudeCodePath()` to get the Claude CLI path
  - Call `accessSync(path, constants.X_OK)` to verify it's executable
  - If path is null/undefined or `accessSync` throws, throw: `"Pre-flight check failed: Claude CLI not found or not executable at ${path || 'unknown'}. Ensure 'claude' is installed and in PATH, or set CLAUDE_CODE_PATH in .env."`
  - Log success: `"Pre-flight check passed: Claude CLI found at ${path}"`

### Step 9: Switch worktree creation to use `origin/<defaultBranch>` base ref
- **In `adws/vcs/worktreeCreation.ts`:**
  - In `createWorktree()` (~line 143): when creating a new branch with `baseBranch`, change the command to use `origin/${baseBranch}` instead of `${baseBranch}`. Before this line, add `execSync(\`git fetch origin "${baseBranch}"\`, { stdio: 'pipe' as const })` to ensure the remote ref is current.
  - In `createWorktreeForNewBranch()` (~line 182): when `baseBranch` is provided (not 'HEAD'), use `origin/${baseBranch}` as the base. Add `execSync(\`git fetch origin "${baseBranch}"\`, { stdio: 'pipe' as const })` before creation.
  - After each fetch, log a warning if local branch HEAD differs from `origin/<branch>` (informational only)

### Step 10: Add graceful degradation to `parseResolutionResult()` and agent retry
- **In `adws/agents/resolutionAgent.ts`:**
  - Change `parseResolutionResult()` (~lines 39-50): instead of throwing when JSON is invalid or `resolved` is not boolean, return `{ resolved: false, decisions: [] }` with a warning log. Mirror the pattern in `validationAgent.ts` `parseValidationResult()`.
  - In `runResolutionAgent()` (~lines 55-84): after parsing, if the result is the fallback (resolved === false, decisions empty) and `extractJson()` returned null from raw output, log "Resolution agent returned non-JSON output, retrying once..." and re-run the agent. If retry also fails parsing, return the graceful degradation result.

### Step 11: Add agent retry on JSON parse failure in `runValidationAgent()`
- **In `adws/agents/validationAgent.ts`:**
  - In `runValidationAgent()` (~lines 115-142): after parsing, if the result is the fallback unaligned result (the parse fallback path was taken — `aligned === false` and mismatch description contains "did not return valid JSON"), log "Validation agent returned non-JSON output, retrying once..." and re-run the agent.
  - If retry also fails parsing, return the fallback unaligned result (existing behavior).

### Step 12: Guard against undefined review issue array elements
- **In `adws/agents/reviewRetry.ts`:**
  - In `mergeReviewResults()` (~lines 83-84): after the `.flatMap(r => r.reviewResult!.reviewIssues)`, add `.filter((issue): issue is ReviewIssue => issue != null)` before the dedup filter.
  - Similarly for screenshots (~lines 94-95): after `.flatMap(r => r.reviewResult!.screenshots)`, add `.filter((s): s is string => s != null)`.

### Step 13: Write skip reason files on auto-merge early exits
- **In `adws/triggers/autoMergeHandler.ts` `handleApprovedReview()`:**
  - Import `writeFileSync` from `fs` (if not already imported)
  - After `ensureLogsDirectory()` creates `logsDir` (~line 207), on each subsequent early return, write `skip_reason.txt`:
    - PR already merged/closed (~line 217-219): `writeFileSync(path.join(logsDir, 'skip_reason.txt'), 'PR already merged, skipping auto-merge')`
    - Worktree failure (~line 231-235): `writeFileSync(path.join(logsDir, 'skip_reason.txt'), \`Worktree creation failed for branch: ${branchName}\`)`
  - For early returns BEFORE `ensureLogsDirectory()` (~lines 187, 194): no logsDir exists yet, so no change needed.
- **In `adws/phases/autoMergePhase.ts` `executeAutoMergePhase()`:**
  - Import `writeFileSync` from `fs`
  - On early return for missing PR number (~line 46-49): `writeFileSync(path.join(config.logsDir, 'skip_reason.txt'), 'No PR URL found, skipping auto-merge')`
  - On early return for missing repo context (~line 52-56): `writeFileSync(path.join(config.logsDir, 'skip_reason.txt'), 'No repo context available, skipping auto-merge')`

### Step 14: Run validation commands
- `bun run lint` — verify code quality
- `bun run build` — verify no build errors
- `bunx tsc --noEmit` — root TypeScript type checking
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type checking

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `bunx tsc --noEmit` — Root TypeScript type checking passes
2. `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type checking passes
3. `bun run lint` — Linter passes with no errors
4. `bun run build` — Build completes successfully
5. `bunx cucumber-js --dry-run --tags @adw-315` — Feature file parses without errors (dry run)

## Patch Scope
**Lines of code to change:** ~300-400 lines across 15 files
**Risk level:** medium (touches many modules but each change is mechanical — replacing execSync with execWithRetry, adding null guards, adding log writes)
**Testing required:** TypeScript compilation, linting, build, and BDD scenario dry-run to validate feature file syntax. Full BDD scenario execution requires mock infrastructure.
