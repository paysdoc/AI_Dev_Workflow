# Feature: Robustness hardening — retry logic, pre-flight checks, and graceful degradation

## Metadata
issueNumber: `315`
adwId: `gcisck-robustness-hardening`
issueJson: `{"number":315,"title":"Robustness hardening: retry logic, pre-flight checks, and graceful degradation","body":"## Problem\n\nMultiple classes of transient failures crash ADW workflows unnecessarily. Analysis of all logs in `/logs/` found recurring patterns where simple retry logic, pre-flight validation, or graceful degradation would prevent workflow crashes.\n\n## Solution\n\n### 1. `execWithRetry` utility for `gh` CLI calls\n\n**New utility:** Generic `execWithRetry(command, options)` wrapper for `execSync` calls.\n- 3 attempts, exponential backoff (500ms → 1s → 2s) — same pattern as `exchangeRates.ts`\n- Apply to all `gh` CLI calls in `issueApi.ts`, `prApi.ts`, `githubApi.ts`, `githubCodeHost.ts`\n- Currently these are bare `execSync` with no retry — a transient GitHub API blip (network hiccup, 502, rate limit) kills the workflow\n\n### 2. Claude CLI ENOENT retry upgrade\n\n**Current:** Single retry with 1-second delay after clearing path cache.\n**Problem:** Claude auto-updates replace the symlink target (`~/.local/bin/claude` → `~/.local/share/claude/versions/X.Y.Z`). During the update window the old version directory is deleted before the new symlink is written. 1 second isn't enough.\n\n**Fix in `claudeAgent.ts`:**\n- Upgrade to 3 attempts with exponential backoff (500ms → 1s → 2s)\n- Re-resolve the Claude CLI path on **every** attempt (not just the first retry), so later attempts pick up the new symlink target\n- Currently the path is resolved once, then reused — if the symlink changes between resolve and spawn, ENOENT persists\n\n### 3. Pre-flight CLI validation\n\n**In `initializeWorkflow()` (or pipeline runner init):**\n- Call `resolveClaudeCodePath()` and verify the binary is executable before starting any phase\n- Fail fast with a clear error message instead of failing mid-phase\n\n### 4. Worktree creation from `origin/<default>`\n\n**Problem:** If the local default branch is dirty or has unresolved conflicts, `git worktree add -b <branch> <path> <defaultBranch>` can fail or create a worktree from dirty state.\n\n**Fix:** Pass `origin/<defaultBranch>` as the base ref to `git worktree add`, so worktree creation uses the clean remote ref regardless of local state. Log a warning if the local default branch differs from remote — this alerts to local branch problems without blocking new issues.\n\n### 5. PR creation: check for existing PR\n\n**Problem:** When a workflow re-runs for the same issue (after error/resume), `gh pr create` fails with \"a pull request for branch X already exists.\"\n\n**Fix in `githubCodeHost.ts`:** Before `gh pr create`, run `gh pr list --head <branch> --json url,number`. If a PR exists, return its URL and number instead of creating a new one.\n\n### 6. JSON parse retry + graceful degradation\n\n**Problem:** Agents instructed to return JSON sometimes return free-text reasoning instead. `resolutionAgent` and `validationAgent` throw on parse failure, crashing the workflow. This happens frequently.\n\n**Fix:**\n- **Retry:** If `extractJson()` returns null, re-run the agent once (2 attempts total)\n- **Graceful degradation:** If retry also fails:\n  - `resolutionAgent`: return `{ resolved: false, decisions: [] }` — validation retry loop handles it\n  - `validationAgent`: return failed validation — orchestrator retries up to `MAX_VALIDATION_RETRY_ATTEMPTS`\n- **Guard against undefined array elements:** In `reviewRetry.ts`, filter out undefined/null entries from review issue arrays before accessing `.issueDescription` (fixes recurring `TypeError: Cannot read properties of undefined`)\n\n### 7. Empty log directory logging\n\n**Problem:** Auto-merge handler creates a log directory via `ensureLogsDirectory()` then exits early on no-op conditions (PR already merged, worktree failure, missing PR URL/repo context) without writing any files. This leaves 39+ empty directories with zero visibility into what happened.\n\n**Fix:** Write a one-line reason file (e.g., `skip_reason.txt`) before each early return in `autoMergeHandler.ts` and `autoMergePhase.ts`.\n\n## Acceptance Criteria\n\n- [ ] `gh` CLI calls retry on transient failures (3 attempts, exponential backoff)\n- [ ] Claude CLI ENOENT retries 3 times with path re-resolution on every attempt\n- [ ] Workflow fails fast if Claude CLI is not found at startup\n- [ ] New worktrees always start clean from `origin/<default>` regardless of local branch state\n- [ ] PR creation reuses existing PR instead of crashing on duplicate\n- [ ] Resolution and validation agents retry once on JSON parse failure, then degrade gracefully\n- [ ] No `TypeError` crashes from undefined review issue array elements\n- [ ] Auto-merge early exits leave a reason in the log directory","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-25T23:29:19Z","comments":[],"actionableComment":null}`

## Feature Description
This feature adds robustness hardening across the ADW workflow system by introducing retry logic for transient failures, pre-flight validation, and graceful degradation paths. Currently, bare `execSync` calls to `gh` CLI, single-attempt Claude CLI retries, unguarded JSON parsing, and missing early-exit logging cause unnecessary workflow crashes. This feature addresses seven distinct failure classes identified from production log analysis.

## User Story
As an ADW workflow operator
I want transient failures to be retried automatically and non-recoverable failures to degrade gracefully
So that workflows complete successfully despite network hiccups, CLI updates, and non-JSON agent responses

## Problem Statement
Multiple classes of transient failures crash ADW workflows unnecessarily. GitHub API blips (502s, rate limits, network hiccups) kill workflows because `gh` CLI calls have no retry. Claude CLI auto-updates cause ENOENT errors that the single retry can't recover from. Agents returning free-text instead of JSON crash the resolution/validation loop. Re-runs fail on duplicate PR creation. Empty log directories provide zero visibility into early exits.

## Solution Statement
Introduce a centralized `execWithRetry` utility (3 attempts, exponential backoff) for all `gh` CLI calls. Upgrade the Claude CLI ENOENT retry to 3 attempts with path re-resolution on every attempt. Add pre-flight Claude CLI validation in `initializeWorkflow()`. Use `origin/<default>` as the base ref for worktree creation. Check for existing PRs before creating new ones. Add agent retry on JSON parse failure with graceful degradation fallbacks. Filter undefined review issue array elements. Write skip reason files on auto-merge early exits.

## Relevant Files
Use these files to implement the feature:

- `guidelines/coding_guidelines.md` — Coding guidelines to follow (clarity, modularity, type safety, functional style)
- `adws/core/utils.ts` — Where the new `execWithRetry` utility should live (alongside `ensureLogsDirectory`)
- `adws/core/environment.ts` — Contains `resolveClaudeCodePath()` and `clearClaudeCodePathCache()` (ENOENT retry depends on these)
- `adws/core/index.ts` — Re-exports from core; needs to export `execWithRetry`
- `adws/core/jsonParser.ts` — Contains `extractJson()` used by resolution and validation agents
- `adws/github/issueApi.ts` — All `gh issue` CLI calls (7 `execSync` calls, no retry)
- `adws/github/prApi.ts` — All `gh pr` CLI calls (7 `execSync` calls, no retry)
- `adws/github/githubApi.ts` — `gh api user` call and `git remote get-url` (2 `execSync` calls)
- `adws/providers/github/githubCodeHost.ts` — `gh pr create` call in `createMergeRequest()` and existing PR check
- `adws/agents/claudeAgent.ts` — ENOENT retry logic (currently single attempt with 1s delay)
- `adws/agents/resolutionAgent.ts` — `parseResolutionResult()` throws on invalid JSON (needs graceful fallback)
- `adws/agents/validationAgent.ts` — `parseValidationResult()` already has graceful fallback (validate it stays correct)
- `adws/agents/reviewRetry.ts` — `mergeReviewResults()` accesses `.issueDescription` without null guard
- `adws/phases/workflowInit.ts` — `initializeWorkflow()` where pre-flight CLI check should go
- `adws/vcs/worktreeCreation.ts` — `createWorktree()` and `createWorktreeForNewBranch()` use local baseBranch ref
- `adws/triggers/autoMergeHandler.ts` — `handleApprovedReview()` has early returns after `ensureLogsDirectory()` without logging
- `adws/phases/autoMergePhase.ts` — `executeAutoMergePhase()` has early returns without logging
- `adws/cost/exchangeRates.ts` — Reference for existing retry pattern (exponential backoff with graceful fallback)

### New Files
- No new files needed. All changes are modifications to existing files. The `execWithRetry` utility goes in `adws/core/utils.ts`.

## Implementation Plan
### Phase 1: Foundation — `execWithRetry` utility
Create the centralized retry utility in `adws/core/utils.ts` following the exponential backoff pattern from `exchangeRates.ts`. This is the foundation that all subsequent `gh` CLI retry changes depend on. Export it from `adws/core/index.ts`.

### Phase 2: Core Implementation — Apply retry and hardening across modules
1. Replace bare `execSync` calls in `issueApi.ts`, `prApi.ts`, `githubApi.ts`, and `githubCodeHost.ts` with `execWithRetry`.
2. Upgrade Claude CLI ENOENT retry to 3 attempts with exponential backoff and per-attempt path re-resolution.
3. Add pre-flight Claude CLI validation in `initializeWorkflow()`.
4. Switch worktree creation to use `origin/<defaultBranch>` as base ref.
5. Add existing PR detection before `gh pr create`.
6. Add graceful degradation to `parseResolutionResult()`.
7. Filter undefined array elements in `mergeReviewResults()`.

### Phase 3: Integration — Logging and observability
1. Write skip reason files in auto-merge early exits.
2. Verify all retry paths log clearly with attempt numbers and backoff delays.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1: Create `execWithRetry` utility in `adws/core/utils.ts`
<!-- ADW-WARNING: The issue acceptance criteria say "retry on transient failures" but the referenced exchangeRates.ts pattern retries ALL errors indiscriminately. The BDD scenario expects non-transient errors (e.g., "not found") to throw immediately without retrying. The issue is internally contradictory on this point — implementation must decide whether to classify errors or retry all. -->
- Add a new exported function `execWithRetry(command: string, options?: ExecSyncOptions & { maxAttempts?: number }): string`
- Default to 3 attempts with exponential backoff: 500ms, 1000ms, 2000ms (matching `exchangeRates.ts` pattern)
- On each failed attempt, log the error and attempt number using `log()` from `../core/logger`
- On the final attempt, throw the original error (don't swallow it)
- Use `execSync` under the hood, returning the trimmed `stdout` string
- Export from `adws/core/index.ts`

### Step 2: Apply `execWithRetry` to `adws/github/issueApi.ts`
- Replace bare `execSync` calls with `execWithRetry` for all `gh` CLI calls:
  - `fetchGitHubIssue()` (line ~114)
  - `commentOnIssue()` (line ~136)
  - `getIssueState()` (line ~175)
  - `closeIssue()` (line ~211)
  - `getIssueTitleSync()` (line ~233)
  - `fetchIssueCommentsRest()` (line ~253)
  - `deleteIssueComment()` (line ~277)
- Preserve existing error handling patterns (some catch and return gracefully, some throw)

### Step 3: Apply `execWithRetry` to `adws/github/prApi.ts`
- Replace bare `execSync` calls with `execWithRetry` for all `gh` CLI calls:
  - `fetchPRDetails()` (line ~61)
  - `fetchPRReviews()` (line ~95)
  - `fetchPRReviewComments()` (line ~133)
  - `commentOnPR()` (line ~176)
  - `mergePR()` (line ~195)
  - `approvePR()` (line ~227)
  - `fetchPRList()` (line ~253)
- Preserve existing error handling patterns

### Step 4: Apply `execWithRetry` to `adws/github/githubApi.ts`
- Replace `execSync` with `execWithRetry` for the `gh api user` call in `getAuthenticatedUser()` (line ~72)
- The `git remote get-url origin` call in `getRepoInfo()` is a local git command — do NOT retry it (not a transient network failure)

### Step 5: Apply `execWithRetry` to `adws/providers/github/githubCodeHost.ts`
- Replace `execSync` with `execWithRetry` in `createMergeRequest()` for the `gh pr create` call (line ~90)

### Step 6: Add existing PR check in `githubCodeHost.ts` `createMergeRequest()`
- Before calling `gh pr create`, run `gh pr list --head <sourceBranch> --repo <owner/repo> --json url,number --limit 1`
- If a matching PR is found, return its `{ url, number }` directly without creating a new one
- Log that an existing PR was found and reused
- Use `execWithRetry` for this new `gh pr list` call

### Step 7: Upgrade Claude CLI ENOENT retry in `adws/agents/claudeAgent.ts`
- Replace the single ENOENT retry (lines 116-126) with a 3-attempt loop with exponential backoff (500ms → 1s → 2s)
- On **every** attempt: call `clearClaudeCodePathCache()` then `resolveClaudeCodePath()` to get a fresh path
- The current code resolves the path once before the initial spawn (line 102) and only re-resolves on the first retry — change this so every retry attempt re-resolves
- Use the existing `delay()` helper for backoff
- Log each retry attempt with the resolved path

### Step 8: Add pre-flight Claude CLI validation in `adws/phases/workflowInit.ts`
- Early in `initializeWorkflow()`, before any agent calls (before issue fetch at line ~109):
  - Call `resolveClaudeCodePath()` to verify the Claude CLI binary can be found
  - Verify the resolved path is executable using `fs.accessSync(path, fs.constants.X_OK)`
  - If the path is not found or not executable, throw a clear error: `"Pre-flight check failed: Claude CLI not found or not executable at <path>. Ensure 'claude' is installed and in PATH, or set CLAUDE_CODE_PATH in .env."`
- Import `resolveClaudeCodePath` from `../core`
- Import `accessSync, constants` from `fs`

### Step 9: Switch worktree creation to use `origin/<defaultBranch>` base ref
- In `adws/vcs/worktreeCreation.ts`:
  - In `createWorktree()` (line ~143): when creating a worktree from `baseBranch`, prepend `origin/` to the base ref: `origin/${baseBranch}`
  - Before creating, run `git fetch origin "${baseBranch}"` to ensure the remote ref is up to date
  - In `createWorktreeForNewBranch()` (line ~182): when `baseBranch` is provided, use `origin/${baseBranch}` as the base
  - Before creating, run `git fetch origin "${baseBranch}"` to ensure remote ref is current
  - Log a warning if the local default branch HEAD differs from `origin/<defaultBranch>` (informational, don't block)

### Step 10: Add graceful degradation to `parseResolutionResult()` in `adws/agents/resolutionAgent.ts`
- Change `parseResolutionResult()` to return a fallback instead of throwing when JSON is invalid
- If `extractJson()` returns null or `parsed.resolved` is not boolean, return `{ resolved: false, decisions: [] }` with a warning log (matching `validationAgent.ts` pattern)
- This allows the plan validation phase's retry loop (`planValidationPhase.ts`) to handle the failure gracefully

### Step 11: Add agent retry on JSON parse failure in `runResolutionAgent()` and `runValidationAgent()`
- In `runResolutionAgent()` (`resolutionAgent.ts`):
  - After parsing, if `resolutionResult.resolved === false` and `resolutionResult.decisions.length === 0` and the agent output doesn't look like valid JSON (i.e. `extractJson()` returned null from the raw output), re-run the agent once
  - Log: "Resolution agent returned non-JSON output, retrying once..."
  - If retry also fails parsing, return the graceful degradation result
- In `runValidationAgent()` (`validationAgent.ts`):
  - After parsing, if `validationResult.aligned === false` and the parse was a fallback (the output preview in mismatches contains "did not return valid JSON"), re-run the agent once
  - Log: "Validation agent returned non-JSON output, retrying once..."
  - If retry also fails, return the fallback unaligned result (existing behavior)

### Step 12: Guard against undefined review issue array elements in `adws/agents/reviewRetry.ts`
- In `mergeReviewResults()` (line ~83), add a filter before accessing `.issueDescription`:
  - Change `.flatMap(r => r.reviewResult!.reviewIssues)` to `.flatMap(r => r.reviewResult!.reviewIssues).filter((issue): issue is ReviewIssue => issue != null)`
  - This prevents `TypeError: Cannot read properties of undefined` when an agent returns a sparse or corrupted array
- Also filter screenshots array: `.flatMap(r => r.reviewResult!.screenshots).filter((s): s is string => s != null)`

### Step 13: Write skip reason files on auto-merge early exits
- In `adws/triggers/autoMergeHandler.ts` `handleApprovedReview()`:
  - After `ensureLogsDirectory()`, on each subsequent early return write a `skip_reason.txt` file to the log directory:
    - PR already merged: write "PR already merged, skipping auto-merge"
    - Worktree failure: write "Worktree creation failed for branch: <branch>"
    - Missing PR URL: write "No PR URL available, skipping auto-merge"
    - Missing repo context: write "No repo context available, skipping auto-merge"
  - For early returns BEFORE `ensureLogsDirectory()` that guard webhook payload fields: no log dir exists yet, so no change needed for those
- In `adws/phases/autoMergePhase.ts` `executeAutoMergePhase()`:
  - On the early return for missing PR URL (line ~48): write `skip_reason.txt` to `config.logsDir` with "No PR URL found, skipping auto-merge"
  - On the early return for missing repo context (line ~55): write `skip_reason.txt` to `config.logsDir` with "No repo context available, skipping auto-merge"

### Step 14: Run validation commands
- Run `bun run lint` to check for code quality issues
- Run `bun run build` to verify no build errors
- Run `bunx tsc --noEmit` to verify TypeScript type checking passes
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify adws-specific type checking passes

## Testing Strategy
### Edge Cases
- `execWithRetry`: all 3 attempts fail → original error is thrown (not swallowed)
- `execWithRetry`: first attempt succeeds → no delay, no retry logged
- `execWithRetry`: transient 502 on first attempt, success on second → single retry with 500ms backoff
- Claude CLI ENOENT: symlink changes between resolve and spawn → each retry re-resolves fresh
- Claude CLI ENOENT: all 3 attempts fail → error propagates to caller
- Pre-flight check: Claude CLI missing entirely → clear error before any agent work
- Pre-flight check: Claude CLI path exists but not executable → clear error
- Worktree creation: `origin/<defaultBranch>` fetch fails → error propagates (don't fall back to local)
- Worktree creation: local branch diverged from remote → warning logged, worktree still created from remote
- PR creation: existing PR found → reuse URL and number, skip `gh pr create`
- PR creation: no existing PR → proceed with `gh pr create` as before
- Resolution agent: non-JSON output → graceful fallback `{ resolved: false, decisions: [] }`
- Resolution agent: retry returns JSON → uses retry result
- Validation agent: non-JSON output → existing graceful fallback (already handles this)
- Review issues array: contains `undefined` elements → filtered out before `.issueDescription` access
- Auto-merge skip: PR already merged → `skip_reason.txt` written with reason
- Auto-merge skip: worktree failure → `skip_reason.txt` written with failure details
- Auto-merge skip: missing PR URL → `skip_reason.txt` written with reason
- Auto-merge skip: missing repo context → `skip_reason.txt` written with reason

## Acceptance Criteria
- [ ] New `execWithRetry` utility in `adws/core/utils.ts` with 3 attempts and exponential backoff (500ms → 1s → 2s)
- [ ] All `gh` CLI calls in `issueApi.ts`, `prApi.ts`, `githubApi.ts`, `githubCodeHost.ts` use `execWithRetry`
- [ ] Claude CLI ENOENT retry upgraded to 3 attempts with path re-resolution on every attempt
- [ ] `initializeWorkflow()` validates Claude CLI path is found and executable before any phase
- [ ] `createWorktree()` and `createWorktreeForNewBranch()` use `origin/<defaultBranch>` as base ref
- [ ] `createMergeRequest()` checks for existing PR before `gh pr create` and reuses if found
- [ ] `parseResolutionResult()` returns graceful fallback instead of throwing on invalid JSON
- [ ] `runResolutionAgent()` and `runValidationAgent()` retry agent once on non-JSON output
- [ ] `mergeReviewResults()` filters undefined/null entries from review issue and screenshot arrays
- [ ] Auto-merge early exits write `skip_reason.txt` to log directory
- [ ] `bun run lint` passes with no errors
- [ ] `bun run build` passes with no errors
- [ ] `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` pass with no errors

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors
- `bunx tsc --noEmit` — Root TypeScript type checking
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type checking

## Notes
- The `exchangeRates.ts` retry pattern (exponential backoff: `500 * Math.pow(2, attempt)`) is the proven model for `execWithRetry`. The new utility uses the same backoff math.
- `validationAgent.ts` already has graceful degradation on parse failure (returns unaligned result). The `resolutionAgent.ts` fix mirrors this pattern.
- Unit tests are disabled for this project (`.adw/project.md` has `## Unit Tests: disabled`). Validation is via TypeScript compilation and linting.
- The `git remote get-url origin` call in `githubApi.ts` should NOT use `execWithRetry` — it's a local git command, not a network call.
- The `git fetch` and `git merge` calls in `autoMergeHandler.ts` are deliberate conflict-detection commands with their own retry loop — don't wrap them in `execWithRetry`.
- Coding guidelines require: clarity over cleverness, single responsibility per function, immutable data, type safety with strict null checks, functional style (filter/map over loops).
