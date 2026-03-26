# Patch: Implement all source changes (Steps 1-13) and generate step definitions

## Metadata
adwId: `gcisck-robustness-hardening`
reviewChangeRequest: `Issue #1: @review-proof scenarios FAILED with exit code 1 and no output. Step definitions for retry_logic_resilience.feature are not implemented, so no BDD scenarios could execute. Resolution: Implement step definitions for all 30 scenarios in features/retry_logic_resilience.feature and implement the corresponding source code changes (Steps 1-13 of the spec).`

## Issue Summary
**Original Spec:** specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md
**Issue:** BDD scenarios in `features/retry_logic_resilience.feature` all fail because (a) `features/step_definitions/retryLogicResilienceSteps.ts` does not exist, and (b) the source code changes the step definitions assert against are not implemented (only 1 of 8 changes is done — the `reviewResult !== null` filter in reviewRetry.ts — but even that one doesn't filter undefined elements within the `reviewIssues` array itself).
**Solution:** Implement all 13 source code steps from the spec, then create the step definition file using source-code-inspection assertions (matching the project's existing pattern). Run `/generate_step_definitions` to produce the step definition file, then validate with BDD scenario execution.

## Files to Modify
Use these files to implement the patch:

- `adws/core/utils.ts` — Add `execWithRetry` utility
- `adws/core/index.ts` — Export `execWithRetry`
- `adws/github/issueApi.ts` — Replace `execSync` with `execWithRetry` for gh CLI calls
- `adws/github/prApi.ts` — Replace `execSync` with `execWithRetry` for gh CLI calls
- `adws/github/githubApi.ts` — Replace `execSync` with `execWithRetry` for `gh api user` call only
- `adws/providers/github/githubCodeHost.ts` — Replace `execSync` with `execWithRetry`, add existing PR check
- `adws/agents/claudeAgent.ts` — Upgrade ENOENT retry to 3 attempts with exponential backoff
- `adws/phases/workflowInit.ts` — Add pre-flight Claude CLI validation
- `adws/vcs/worktreeCreation.ts` — Use `origin/<defaultBranch>` as base ref
- `adws/agents/resolutionAgent.ts` — Graceful degradation on JSON parse failure + retry
- `adws/agents/validationAgent.ts` — Add retry on JSON parse failure
- `adws/agents/reviewRetry.ts` — Filter undefined/null from reviewIssues and screenshots arrays
- `adws/triggers/autoMergeHandler.ts` — Write `skip_reason.txt` on early exits
- `adws/phases/autoMergePhase.ts` — Write `skip_reason.txt` on early exits
- `features/step_definitions/retryLogicResilienceSteps.ts` — NEW: step definitions for all 32 scenarios

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Create `execWithRetry` utility and wire exports
- In `adws/core/utils.ts`, add a new exported function `execWithRetry(command: string, options?: ExecSyncOptions & { maxAttempts?: number }): string`
  - Default 3 attempts, exponential backoff: `500 * Math.pow(2, attempt)` ms (500ms, 1000ms, 2000ms) — matching `exchangeRates.ts` pattern
  - On each failed attempt, log the error and attempt number via `log()` from `./logger`
  - On final attempt failure, throw the original error
  - Use `execSync` under the hood, return trimmed `stdout` string
  - Import `execSync` from `child_process` and `ExecSyncOptions` from `child_process`
- In `adws/core/index.ts`, add `execWithRetry` to the Utilities re-export block from `./utils`

### Step 2: Apply `execWithRetry` to all gh CLI modules
- **`adws/github/issueApi.ts`**: Replace bare `execSync` calls with `execWithRetry` for all 7 `gh` CLI commands (`fetchGitHubIssue`, `commentOnIssue`, `getIssueState`, `closeIssue`, `getIssueTitleSync`, `fetchIssueCommentsRest`, `deleteIssueComment`). Preserve existing error handling (try/catch patterns stay the same, just swap the inner call). Import `execWithRetry` from `../core/utils`.
- **`adws/github/prApi.ts`**: Replace bare `execSync` calls with `execWithRetry` for all 7 `gh` CLI commands (`fetchPRDetails`, `fetchPRReviews`, `fetchPRReviewComments`, `commentOnPR`, `mergePR`, `approvePR`, `fetchPRList`). Import `execWithRetry` from `../core/utils`.
- **`adws/github/githubApi.ts`**: Replace `execSync` with `execWithRetry` ONLY for the `gh api user` call in `getAuthenticatedUser()`. Do NOT change the `git remote get-url origin` call (local git command, not network). Import `execWithRetry` from `../core/utils`.
- **`adws/providers/github/githubCodeHost.ts`**: Replace `execSync` with `execWithRetry` in `createMergeRequest()` for the `gh pr create` call. Import `execWithRetry` from `../../core/utils`.

### Step 3: Add existing PR check in `githubCodeHost.ts`
- In `createMergeRequest()`, BEFORE the `gh pr create` call:
  - Run `execWithRetry('gh pr list --head <sourceBranch> --repo <owner/repo> --json url,number --limit 1')`
  - Parse the JSON result; if an array with at least one entry is returned, return `{ url, number }` directly
  - Log "Existing PR found for branch <sourceBranch>, reusing PR #<number>"
  - Only proceed to `gh pr create` if no existing PR found

### Step 4: Upgrade Claude CLI ENOENT retry in `claudeAgent.ts`
- Replace the single ENOENT retry block (currently lines ~116-126) with a 3-attempt loop:
  - Use exponential backoff: 500ms, 1000ms, 2000ms via `delay(500 * Math.pow(2, attempt))`
  - On EVERY attempt: call `clearClaudeCodePathCache()` then `resolveClaudeCodePath()` to get a fresh path
  - Log each retry attempt with the resolved path and attempt number
  - If all 3 attempts fail, throw the ENOENT error

### Step 5: Add pre-flight CLI validation in `workflowInit.ts`
- Early in `initializeWorkflow()`, before the issue fetch:
  - Import `resolveClaudeCodePath` from `../core`
  - Import `accessSync, constants` from `fs`
  - Call `resolveClaudeCodePath()` and verify the path is executable via `accessSync(path, constants.X_OK)`
  - If not found or not executable, throw: `"Pre-flight check failed: Claude CLI not found or not executable at <path>. Ensure 'claude' is installed and in PATH, or set CLAUDE_CODE_PATH in .env."`

### Step 6: Switch worktree creation to `origin/<defaultBranch>`
- In `adws/vcs/worktreeCreation.ts`:
  - In `createWorktree()`: before creating, run `execSync('git fetch origin "${baseBranch}"')`, then use `origin/${baseBranch}` as the base ref in the `git worktree add` command
  - In `createWorktreeForNewBranch()`: same change — fetch and use `origin/${baseBranch}`
  - Log a warning if local `baseBranch` HEAD differs from `origin/${baseBranch}` (informational only)

### Step 7: Add graceful degradation and retry to agents
- **`adws/agents/resolutionAgent.ts`**: In `parseResolutionResult()`, replace the `throw new Error(...)` with a warning log and return `{ resolved: false, decisions: [] }`. In `runResolutionAgent()`, if the parse returned the fallback (resolved=false, empty decisions, and extractJson was null), re-run the agent once. If retry also fails parsing, return the fallback.
- **`adws/agents/validationAgent.ts`**: In `runValidationAgent()`, after parsing, if the result is a fallback (output was non-JSON), re-run the agent once. If retry also fails, return the existing fallback unaligned result.

### Step 8: Filter undefined elements in `reviewRetry.ts`
- In `mergeReviewResults()`:
  - Change `.flatMap(r => r.reviewResult!.reviewIssues)` to `.flatMap(r => r.reviewResult!.reviewIssues).filter((issue): issue is ReviewIssue => issue != null)`
  - Change `.flatMap(r => r.reviewResult!.screenshots)` to `.flatMap(r => r.reviewResult!.screenshots).filter((s): s is string => s != null)`

### Step 9: Write skip reason files on auto-merge early exits
- **`adws/triggers/autoMergeHandler.ts`**: After `ensureLogsDirectory()`, on each early return write `fs.writeFileSync(path.join(logsDir, 'skip_reason.txt'), '<reason>')`:
  - PR already merged: "PR already merged, skipping auto-merge"
  - Worktree failure: "Worktree creation failed for branch: <branch>"
  - Missing PR URL: "No PR URL available, skipping auto-merge"
  - Missing repo context: "No repo context available, skipping auto-merge"
- **`adws/phases/autoMergePhase.ts`**: On early returns for missing PR URL and missing repo context, write `skip_reason.txt` to `config.logsDir` with the appropriate reason.

### Step 10: Generate step definitions using `/generate_step_definitions`
- Run `/generate_step_definitions` targeting `features/retry_logic_resilience.feature` to create `features/step_definitions/retryLogicResilienceSteps.ts`
- The step definitions should follow the project's existing source-code-inspection pattern (read files, assert patterns exist) using `sharedCtx` from `commonSteps.ts`
- Key patterns to assert in step definitions:
  - `execWithRetry` function exists and is exported from `utils.ts`
  - `execWithRetry` is imported/used in issueApi, prApi, githubApi, githubCodeHost
  - ENOENT retry loop has 3 attempts with `clearClaudeCodePathCache` + `resolveClaudeCodePath` per attempt
  - Pre-flight check calls `resolveClaudeCodePath` and `accessSync` in workflowInit
  - Worktree creation uses `origin/` prefix for base ref
  - Existing PR check uses `gh pr list --head`
  - Resolution agent returns fallback `{ resolved: false, decisions: [] }`
  - Validation agent has retry logic
  - reviewRetry filters null/undefined from arrays
  - Auto-merge handlers write `skip_reason.txt`
  - TypeScript compilation scenario: run `bunx tsc --noEmit --project adws/tsconfig.json`

### Step 11: Run validation commands
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-gcisck-robustness-hardening"` to verify all 32 BDD scenarios pass
- Run `bun run lint` to check for code quality issues
- Run `bun run build` to verify no build errors
- Run `bunx tsc --noEmit` for root TypeScript type checking
- Run `bunx tsc --noEmit -p adws/tsconfig.json` for ADW-specific TypeScript type checking
- Fix any failures before completing

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-gcisck-robustness-hardening"` — All 32 BDD scenarios pass
2. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — No regression in existing scenarios
3. `bun run lint` — No lint errors
4. `bun run build` — Build succeeds
5. `bunx tsc --noEmit` — Root TypeScript type check passes
6. `bunx tsc --noEmit -p adws/tsconfig.json` — ADW TypeScript type check passes

## Patch Scope
**Lines of code to change:** ~350-450 across 15 files (14 source modifications + 1 new step definition file)
**Risk level:** medium (touches many modules but each change is small and well-isolated; existing error handling is preserved)
**Testing required:** BDD scenario execution for all 32 scenarios tagged `@adw-gcisck-robustness-hardening`, plus full regression suite
