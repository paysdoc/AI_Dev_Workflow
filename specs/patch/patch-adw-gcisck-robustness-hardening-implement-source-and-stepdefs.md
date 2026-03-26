# Patch: Implement 14 source changes and step definitions for retry logic resilience

## Metadata
adwId: `gcisck-robustness-hardening`
reviewChangeRequest: `Issue #1: @review-proof scenarios FAILED (exit code 1, no output). All 19 regression-tagged BDD scenarios could not execute — step definitions are missing or broken for the retry_logic_resilience.feature file. Resolution: Implement step definitions for all scenarios in features/retry_logic_resilience.feature, then implement the 14 source code changes described in the spec so scenarios pass.`

## Issue Summary
**Original Spec:** `specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md`
**Issue:** BDD scenario proof fails with exit code 1 and no output because (a) none of the 14 source code changes from the spec have been executed — `execWithRetry` does not exist, `gh` CLI calls use bare `execSync`, ENOENT retry is single-attempt, no pre-flight check, worktrees use local branch ref, no existing PR check, no graceful degradation, no undefined array filter, no skip reason files — and (b) no step definition file exists for `features/retry_logic_resilience.feature`.
**Solution:** Execute all 14 source code implementation steps from the spec, then create a step definition file (`retryLogicResilienceSteps.ts`) that verifies the source code patterns using the project's source-scanning convention.

## Files to Modify

### Source implementation (14 files)
1. `adws/core/utils.ts` — Add `execWithRetry` utility function
2. `adws/core/index.ts` — Export `execWithRetry`
3. `adws/github/issueApi.ts` — Replace 7 bare `execSync` calls with `execWithRetry`
4. `adws/github/prApi.ts` — Replace 7 bare `execSync` calls with `execWithRetry`
5. `adws/github/githubApi.ts` — Replace 1 `execSync` call with `execWithRetry` (only `gh api user`, NOT local `git remote`)
6. `adws/providers/github/githubCodeHost.ts` — Replace `execSync` with `execWithRetry` for `gh pr create`; add existing PR check before creating
7. `adws/agents/claudeAgent.ts` — Upgrade ENOENT retry from 1 attempt to 3 with exponential backoff + per-attempt path re-resolution
8. `adws/phases/workflowInit.ts` — Add pre-flight Claude CLI validation (resolve path + check executable)
9. `adws/vcs/worktreeCreation.ts` — Use `origin/<defaultBranch>` as base ref; add `git fetch origin` before worktree creation
10. `adws/agents/resolutionAgent.ts` — Graceful fallback in `parseResolutionResult()`; retry-once on non-JSON in `runResolutionAgent()`
11. `adws/agents/validationAgent.ts` — Retry-once on non-JSON in `runValidationAgent()`
12. `adws/agents/reviewRetry.ts` — Filter undefined/null entries from review issue and screenshot arrays
13. `adws/triggers/autoMergeHandler.ts` — Write `skip_reason.txt` on early exits after `ensureLogsDirectory()`
14. `adws/phases/autoMergePhase.ts` — Write `skip_reason.txt` on early exits

### Step definitions (1 new file)
15. `features/step_definitions/retryLogicResilienceSteps.ts` — Step definitions for all 32 scenarios

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Create `execWithRetry` utility and export it
- In `adws/core/utils.ts`, add an exported function:
  ```typescript
  export function execWithRetry(command: string, options?: ExecSyncOptions & { maxAttempts?: number }): string
  ```
- Default `maxAttempts` to 3. Exponential backoff: `500 * Math.pow(2, attempt)` ms (500ms, 1000ms, 2000ms) — matching `exchangeRates.ts` pattern
- Import `execSync` from `child_process` and `log` from `./logger`
- Log each failed attempt: `log(\`execWithRetry: attempt ${attempt + 1}/${maxAttempts} failed: ${error.message}\`)`
- On final attempt failure, throw the original error (don't swallow)
- Return `execSync(command, options).toString().trim()`
- In `adws/core/index.ts`, add `execWithRetry` to the re-exports from `./utils`

### Step 2: Apply `execWithRetry` to all `gh` CLI calls
- **`adws/github/issueApi.ts`**: Replace `execSync` with `execWithRetry` in: `fetchGitHubIssue()`, `commentOnIssue()`, `getIssueState()`, `closeIssue()`, `getIssueTitleSync()`, `fetchIssueCommentsRest()`, `deleteIssueComment()`. Add `import { execWithRetry } from '../core'`. Preserve existing try/catch error handling patterns.
- **`adws/github/prApi.ts`**: Replace `execSync` with `execWithRetry` in: `fetchPRDetails()`, `fetchPRReviews()`, `fetchPRReviewComments()`, `commentOnPR()`, `mergePR()`, `approvePR()`, `fetchPRList()`. Add `import { execWithRetry } from '../core'`. Preserve existing try/catch patterns.
- **`adws/github/githubApi.ts`**: Replace `execSync` with `execWithRetry` for the `gh api user` call in `getAuthenticatedUser()` only. Do NOT wrap the local `git remote get-url origin` call — it's not a network call.
- **`adws/providers/github/githubCodeHost.ts`**: Replace `execSync` with `execWithRetry` for the `gh pr create` call in `createMergeRequest()`. Import from `../../core`.

### Step 3: Add existing PR check in `githubCodeHost.ts`
- In `createMergeRequest()`, before `gh pr create`, run:
  ```
  gh pr list --head <sourceBranch> --repo <owner/repo> --json url,number --limit 1
  ```
  via `execWithRetry`. Parse the JSON result. If a PR is found, return its `{ url, number }` directly. Log: `log(\`Reusing existing PR #${number}: ${url}\`)`.

### Step 4: Upgrade Claude CLI ENOENT retry in `claudeAgent.ts`
- Replace the single ENOENT retry (lines ~116-126) with a 3-attempt loop with exponential backoff (500ms, 1000ms, 2000ms)
- On **every** attempt: call `clearClaudeCodePathCache()` then `resolveClaudeCodePath()` for a fresh path
- Use the existing `delay()` helper for backoff
- Log each retry: `log(\`ENOENT retry ${attempt}/${maxAttempts}: re-resolved path to ${newPath}\`)`
- If all 3 attempts fail, throw the error

### Step 5: Add pre-flight CLI validation in `workflowInit.ts`
- Early in `initializeWorkflow()`, before the issue fetch (~line 110):
  - Call `resolveClaudeCodePath()` to get the path
  - Verify with `fs.accessSync(path, fs.constants.X_OK)`
  - If not found or not executable, throw: `"Pre-flight check failed: Claude CLI not found or not executable at <path>"`
- Import `resolveClaudeCodePath` from `../core` and `accessSync, constants` from `fs`

### Step 6: Switch worktree creation to `origin/<defaultBranch>`
- In `adws/vcs/worktreeCreation.ts`:
  - In `createWorktree()`: before `git worktree add`, run `execSync(\`git fetch origin "${baseBranch}"\`)`. Use `origin/${baseBranch}` as base ref.
  - In `createWorktreeForNewBranch()`: same pattern — fetch + use `origin/${baseBranch}`.
  - Log warning if local HEAD differs from `origin/<defaultBranch>` (informational, don't block).

### Step 7: Add graceful degradation and JSON retry
- **`adws/agents/resolutionAgent.ts`**: In `parseResolutionResult()`, return `{ resolved: false, decisions: [] }` with warning log when `extractJson()` returns null (instead of throwing). In `runResolutionAgent()`, if parse returns the fallback (extractJson was null), re-run agent once. Log: `"Resolution agent returned non-JSON output, retrying once..."`
- **`adws/agents/validationAgent.ts`**: In `runValidationAgent()`, if parse was a fallback (output didn't contain valid JSON), re-run agent once. Log: `"Validation agent returned non-JSON output, retrying once..."`. If retry also fails, return existing fallback.

### Step 8: Filter undefined arrays and write skip reason files
- **`adws/agents/reviewRetry.ts`**: In `mergeReviewResults()`, add `.filter((issue): issue is ReviewIssue => issue != null)` after `.flatMap(r => r.reviewResult!.reviewIssues)`. Also filter screenshots: `.filter((s): s is string => s != null)`.
- **`adws/triggers/autoMergeHandler.ts`**: After `ensureLogsDirectory()`, on each early return write `skip_reason.txt` via `writeFileSync(join(logsDir, 'skip_reason.txt'), reason)` with appropriate messages: "PR already merged", "Worktree creation failed for branch: <branch>", "No PR URL available", "No repo context available".
- **`adws/phases/autoMergePhase.ts`**: On early returns for missing PR URL and missing repo context: write `skip_reason.txt` to `config.logsDir`.

### Step 9: Create step definitions file
- Create `features/step_definitions/retryLogicResilienceSteps.ts` with step definitions for all 32 scenarios in `features/retry_logic_resilience.feature`
- Follow existing project conventions from `commonSteps.ts` and `reviewRetryPatchImplementationSteps.ts`:
  - Import `{ Given, When, Then }` from `@cucumber/cucumber`
  - Import `{ readFileSync, existsSync }` from `fs`, `{ join }` from `path`, `assert` from `assert`
  - Import `{ sharedCtx }` from `./commonSteps.ts`
  - Use `const ROOT = process.cwd()` for file resolution
  - Use source-scanning approach: read source files and assert patterns exist (e.g., `assert.ok(content.includes('execWithRetry'))`)
  - Use `spawnSync` for commands like `tsc --noEmit`
  - Context-only steps (Given/When that set up narrative context) should be no-ops or load files
- Key step definition groups:
  1. **execWithRetry utility** (scenarios 1-7): Read `adws/core/utils.ts`, assert `execWithRetry` function exists with backoff pattern. Read `issueApi.ts`, `prApi.ts`, `githubApi.ts`, `githubCodeHost.ts` and assert they import/use `execWithRetry`.
  2. **Claude CLI ENOENT** (scenarios 8-10): Read `adws/agents/claudeAgent.ts`, assert 3-attempt retry loop, `clearClaudeCodePathCache` + `resolveClaudeCodePath` per attempt, exponential backoff.
  3. **Pre-flight CLI** (scenarios 11-13): Read `adws/phases/workflowInit.ts`, assert `resolveClaudeCodePath` call and `accessSync` / `X_OK` check.
  4. **Worktree origin** (scenarios 14-16): Read `adws/vcs/worktreeCreation.ts`, assert `origin/` prefix in base ref and `git fetch origin` call.
  5. **Existing PR check** (scenarios 17-19): Read `adws/providers/github/githubCodeHost.ts`, assert `gh pr list --head` check before `gh pr create`.
  6. **JSON retry + graceful degradation** (scenarios 20-25): Read `resolutionAgent.ts`, `validationAgent.ts`, `reviewRetry.ts`. Assert fallback patterns, retry logic, and `.filter` on arrays.
  7. **Skip reason files** (scenarios 26-31): Read `autoMergeHandler.ts` and `autoMergePhase.ts`, assert `skip_reason.txt` writes.
  8. **TypeScript compilation** (scenario 32): Run `bunx tsc --noEmit` via `spawnSync` and assert exit code 0.

### Step 10: Run validation commands
- `bun run lint` — Verify no linting errors
- `bun run build` — Verify build passes
- `bunx tsc --noEmit` — Root TypeScript type checking
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type checking
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-gcisck-robustness-hardening and @regression" --dry-run` — Verify all step definitions resolve (no undefined steps)
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-gcisck-robustness-hardening and @regression"` — Run 19 regression-tagged scenarios
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-315"` — Run all 32 scenarios

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `bun run lint` — Verify no linting errors
2. `bun run build` — Verify build passes
3. `bunx tsc --noEmit` — Root TypeScript type checking
4. `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type checking
5. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-gcisck-robustness-hardening and @regression" --dry-run` — Verify 0 undefined steps
6. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-gcisck-robustness-hardening and @regression"` — All 19 regression scenarios pass
7. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-315"` — All 32 scenarios pass

## Patch Scope
**Lines of code to change:** ~450 (14 source files ~350 LOC + 1 step definition file ~100 LOC)
**Risk level:** medium
**Testing required:** TypeScript compilation, lint, build, all 32 BDD scenarios pass including 19 regression-tagged ones
