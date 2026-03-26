# Patch: Fix Gherkin parse error, implement all 14 source changes, and create step definitions

## Metadata
adwId: `gcisck-robustness-hardening`
reviewChangeRequest: `Issue #1: @review-proof BDD scenarios FAILED (exit code 1, no output). Resolution: Implement all 14 spec steps and create step definitions.`

## Issue Summary
**Original Spec:** specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md
**Issue:** All 29 BDD scenarios in `features/retry_logic_resilience.feature` fail with exit code 1 and no output. Root causes: (1) Gherkin parse error on line 75 (`So that` is not a valid Gherkin keyword), preventing ANY scenario from loading; (2) No step definitions exist for the feature file; (3) No source code changes have been implemented (working tree is clean).
**Solution:** Fix the Gherkin parse error first (unblocks parsing), then implement all 14 source code changes from the spec, then create step definitions that verify the source patterns. Step definitions follow the established project pattern: read source files, assert on string content (no runtime mocking).

## Files to Modify
Use these files to implement the patch:

1. `features/retry_logic_resilience.feature` — Fix `So that` → `And` on line 75
2. `adws/core/utils.ts` — Add `execWithRetry` utility function
3. `adws/core/index.ts` — Re-export `execWithRetry`
4. `adws/github/issueApi.ts` — Replace 7 bare `execSync` calls with `execWithRetry` for gh CLI
5. `adws/github/prApi.ts` — Replace 7 bare `execSync` calls with `execWithRetry` for gh CLI
6. `adws/github/githubApi.ts` — Replace `execSync` with `execWithRetry` for `gh api user` call only (NOT the local `git remote` call)
7. `adws/providers/github/githubCodeHost.ts` — Replace `execSync` with `execWithRetry` for `gh pr create`; add existing PR detection before creating
8. `adws/agents/claudeAgent.ts` — Upgrade ENOENT retry from 1 attempt to 3 with exponential backoff and per-attempt path re-resolution
9. `adws/phases/workflowInit.ts` — Add pre-flight Claude CLI validation (resolve path + check executable)
10. `adws/vcs/worktreeCreation.ts` — Use `origin/${baseBranch}` as base ref; fetch before creating; log warning if local differs
11. `adws/agents/resolutionAgent.ts` — Return graceful fallback `{ resolved: false, decisions: [] }` instead of throwing; add retry on non-JSON
12. `adws/agents/validationAgent.ts` — Add retry once on non-JSON output
13. `adws/agents/reviewRetry.ts` — Filter null/undefined from reviewIssues and screenshots arrays in `mergeReviewResults()`
14. `adws/triggers/autoMergeHandler.ts` — Write `skip_reason.txt` on early exits after `ensureLogsDirectory()`
15. `adws/phases/autoMergePhase.ts` — Write `skip_reason.txt` on early exits
16. `features/step_definitions/retryLogicResilienceSteps.ts` — **New file:** Step definitions for all 29 BDD scenarios

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom. Read each target file BEFORE modifying it.

### Step 1: Fix Gherkin parse error
- In `features/retry_logic_resilience.feature` line 75, change `So that later attempts pick up the new symlink target` to `And later attempts pick up the new symlink target`
- This unblocks Cucumber from parsing the entire feature file

### Step 2: Implement all 14 source code changes from the spec
Apply every source change described in the original spec Steps 1–13 (Step 14 is validation):

**2a. Create `execWithRetry` in `adws/core/utils.ts`:**
- Read `adws/cost/exchangeRates.ts` as reference for the backoff pattern: `500 * Math.pow(2, attempt)`
- Add a new exported function `execWithRetry(command: string, options?: ExecSyncOptions & { maxAttempts?: number }): string`
- 3 attempts by default, exponential backoff (500ms, 1000ms, 2000ms)
- Non-transient errors (containing "not found", "does not exist", "permission denied", "authentication") throw immediately without retry
- On each failed attempt, log with attempt number using `log()` from `./logger`
- On final attempt failure, throw the original error
- Use `execSync` under the hood, return trimmed stdout string
- Import `execSync` and `ExecSyncOptions` from `child_process`
- Use synchronous `Bun.sleepSync(delayMs)` or `Atomics.wait` for blocking delay (this is a sync function)
- Export from `adws/core/index.ts`

**2b. Apply `execWithRetry` to `adws/github/issueApi.ts`:**
- Replace all 7 `execSync` calls for `gh` CLI commands with `execWithRetry`
- Preserve existing error handling (some catch and return gracefully, some throw)
- Import `execWithRetry` from `../core`

**2c. Apply `execWithRetry` to `adws/github/prApi.ts`:**
- Replace all 7 `execSync` calls for `gh` CLI commands with `execWithRetry`
- Import `execWithRetry` from `../core`

**2d. Apply `execWithRetry` to `adws/github/githubApi.ts`:**
- Replace ONLY the `gh api user` call in `getAuthenticatedUser()` with `execWithRetry`
- Do NOT touch the `git remote get-url origin` call (local command, not network)
- Import `execWithRetry` from `../core`

**2e. Apply `execWithRetry` to `adws/providers/github/githubCodeHost.ts`:**
- Replace the `execSync` call in `createMergeRequest()` for `gh pr create` with `execWithRetry`
- Import `execWithRetry` from `../../core`

**2f. Add existing PR check in `githubCodeHost.ts` `createMergeRequest()`:**
- Before `gh pr create`, run `gh pr list --head <sourceBranch> --repo <owner/repo> --json url,number --limit 1` via `execWithRetry`
- If a matching PR is found, return its `{ url, number }` directly
- Log that an existing PR was reused

**2g. Upgrade Claude CLI ENOENT retry in `adws/agents/claudeAgent.ts`:**
- Replace single ENOENT retry with 3-attempt loop with exponential backoff (500ms → 1s → 2s)
- On EVERY attempt: call `clearClaudeCodePathCache()` then `resolveClaudeCodePath()` to get fresh path
- Log each retry attempt with resolved path

**2h. Add pre-flight CLI validation in `adws/phases/workflowInit.ts`:**
- Early in `initializeWorkflow()`, before issue fetch:
  - Call `resolveClaudeCodePath()` to verify CLI exists
  - Call `fs.accessSync(path, fs.constants.X_OK)` to verify executable
  - Throw clear error if missing/not-executable
- Import `resolveClaudeCodePath` from `../core`

**2i. Switch worktree creation to `origin/<default>` in `adws/vcs/worktreeCreation.ts`:**
- In `createWorktree()`: use `origin/${baseBranch}` as base ref
- Run `git fetch origin "${baseBranch}"` before creating
- In `createWorktreeForNewBranch()`: same changes
- Log warning if local branch differs from remote

**2j. Add graceful degradation in `adws/agents/resolutionAgent.ts`:**
- `parseResolutionResult()`: return `{ resolved: false, decisions: [] }` instead of throwing on invalid JSON
- `runResolutionAgent()`: retry agent once if `extractJson()` returns null; log "retrying once..."

**2k. Add retry on non-JSON in `adws/agents/validationAgent.ts`:**
- `runValidationAgent()`: if `extractJson()` returns null, re-run agent once before returning fallback

**2l. Filter undefined in `adws/agents/reviewRetry.ts`:**
- In `mergeReviewResults()`: add `.filter((issue): issue is ReviewIssue => issue != null)` after `.flatMap(r => r.reviewResult!.reviewIssues)`
- Same for screenshots: `.filter((s): s is string => s != null)`

**2m. Write skip_reason.txt in `adws/triggers/autoMergeHandler.ts`:**
- After `ensureLogsDirectory()`, on each early return write `skip_reason.txt` with the reason
- Reasons: "PR already merged", "Worktree creation failed for branch: <branch>", "No PR URL available", "No repo context available"

**2n. Write skip_reason.txt in `adws/phases/autoMergePhase.ts`:**
- On early return for missing PR URL: write "No PR URL found, skipping auto-merge"
- On early return for missing repo context: write "No repo context available, skipping auto-merge"

### Step 3: Create step definitions file
- Create `features/step_definitions/retryLogicResilienceSteps.ts`
- Follow the established project pattern:
  - Import `Given`, `When`, `Then` from `@cucumber/cucumber`
  - Import `readFileSync`, `existsSync` from `fs`
  - Import `join` from `path`
  - Import `assert` from `assert`
  - Import `sharedCtx` from `./commonSteps.ts`
  - Import `spawnSync` from `child_process` (for TypeScript compilation scenario)
- Use source-code content assertions: read the file, check for expected string patterns
- Reuse `sharedCtx` for file content when reading files in Given steps
- Group steps by feature section (7 sections in the feature file)
- For the TypeScript compilation scenario, run `bunx tsc --noEmit -p adws/tsconfig.json` and assert exit code 0

Key step definition patterns needed:
- **execWithRetry scenarios:** Read `adws/core/utils.ts`, assert it contains `execWithRetry`, `Math.pow(2, attempt)`, `maxAttempts`, `not found`, logging patterns
- **Module integration scenarios:** Read each module file, assert it contains `execWithRetry` import and usage
- **Claude CLI ENOENT scenarios:** Read `claudeAgent.ts`, assert it has 3-attempt loop, `clearClaudeCodePathCache`, `resolveClaudeCodePath` on each attempt
- **Pre-flight scenarios:** Read `workflowInit.ts`, assert it calls `resolveClaudeCodePath` and `accessSync` with `X_OK`
- **Worktree scenarios:** Read `worktreeCreation.ts`, assert it uses `origin/` prefix and `git fetch origin`
- **PR reuse scenarios:** Read `githubCodeHost.ts`, assert it has `gh pr list --head` check before `gh pr create`
- **JSON parse scenarios:** Read `resolutionAgent.ts` / `validationAgent.ts`, assert graceful fallbacks
- **Review array scenarios:** Read `reviewRetry.ts`, assert `.filter` guard on arrays
- **Auto-merge scenarios:** Read `autoMergeHandler.ts` / `autoMergePhase.ts`, assert `skip_reason.txt` writes
- **TypeScript compilation:** Run `bunx tsc --noEmit -p adws/tsconfig.json` via `spawnSync`, assert status 0

### Step 4: Validate
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-315"` — all 29 scenarios must pass
- Run `bun run lint` — no errors
- Run `bun run build` — no errors
- Run `bunx tsc --noEmit` — no errors
- Run `bunx tsc --noEmit -p adws/tsconfig.json` — no errors

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-315" --dry-run` — verify no undefined steps or parse errors
2. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-315"` — all 29 scenarios pass
3. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — regression scenarios pass (no regressions)
4. `bun run lint` — passes
5. `bun run build` — passes
6. `bunx tsc --noEmit` — passes
7. `bunx tsc --noEmit -p adws/tsconfig.json` — passes

## Patch Scope
**Lines of code to change:** ~500 (across 16 files: 1 feature fix, 13 source files, 1 barrel export, 1 new step defs file)
**Risk level:** medium (touches many files but each change is small and mechanical; non-transient error classification in `execWithRetry` needs care)
**Testing required:** BDD scenarios via Cucumber (`@adw-315` tag), TypeScript compilation, linting, build
