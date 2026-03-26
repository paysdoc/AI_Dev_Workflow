# Patch: Implement all 14 spec steps and generate step definitions to fix scenario proof

## Metadata
adwId: `gcisck-robustness-hardening`
reviewChangeRequest: `Issue #1: @review-proof scenarios FAILED (exit code 1, no output). No step definition files exist for retry_logic_resilience.feature — cucumber cannot execute any scenarios. Root cause: implementation steps 1-14 from the spec have not been executed, so neither source code nor step definitions exist.`

## Issue Summary
**Original Spec:** `specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md`
**Issue:** BDD scenario proof fails with exit code 1 and no output because (a) none of the 14 source code implementation steps from the spec have been executed — `execWithRetry` does not exist, `gh` CLI calls are still bare `execSync`, ENOENT retry is single-attempt, etc. — and (b) no step definition file exists for `features/retry_logic_resilience.feature`, so cucumber has no steps to match.
**Solution:** Execute all 14 implementation steps from the spec in order (creating `execWithRetry`, applying it across modules, upgrading ENOENT retry, adding pre-flight check, switching worktree base ref, adding existing PR check, adding graceful degradation, filtering undefined arrays, writing skip reason files), then generate step definitions for all 31 scenarios in the feature file.

## Files to Modify

### Source implementation (Steps 1-13)
- `adws/core/utils.ts` — Add `execWithRetry` utility
- `adws/core/index.ts` — Export `execWithRetry`
- `adws/github/issueApi.ts` — Replace bare `execSync` with `execWithRetry` for `gh` CLI calls
- `adws/github/prApi.ts` — Replace bare `execSync` with `execWithRetry` for `gh` CLI calls
- `adws/github/githubApi.ts` — Replace `execSync` with `execWithRetry` for `gh api user` call only (not local git calls)
- `adws/providers/github/githubCodeHost.ts` — Replace `execSync` with `execWithRetry` for `gh pr create`, add existing PR check before creating
- `adws/agents/claudeAgent.ts` — Upgrade ENOENT retry from 1 attempt to 3 with exponential backoff and per-attempt path re-resolution
- `adws/phases/workflowInit.ts` — Add pre-flight Claude CLI validation (resolve path + check executable)
- `adws/vcs/worktreeCreation.ts` — Switch base ref to `origin/<defaultBranch>`, add `git fetch origin` before worktree creation
- `adws/agents/resolutionAgent.ts` — Add graceful fallback in `parseResolutionResult()`, add retry-once on non-JSON in `runResolutionAgent()`
- `adws/agents/validationAgent.ts` — Add retry-once on non-JSON in `runValidationAgent()`
- `adws/agents/reviewRetry.ts` — Filter undefined/null entries from review issue and screenshot arrays in `mergeReviewResults()`
- `adws/triggers/autoMergeHandler.ts` — Write `skip_reason.txt` on early exits after `ensureLogsDirectory()`
- `adws/phases/autoMergePhase.ts` — Write `skip_reason.txt` on early exits

### Step definitions (new file)
- `features/step_definitions/retryLogicResilienceSteps.ts` — Step definitions for all 31 scenarios in `features/retry_logic_resilience.feature`

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Create `execWithRetry` utility and export it
- In `adws/core/utils.ts`, add an exported function `execWithRetry(command: string, options?: ExecSyncOptions & { maxAttempts?: number }): string`
- 3 attempts default, exponential backoff: `500 * Math.pow(2, attempt)` (500ms, 1000ms, 2000ms) — matching `exchangeRates.ts` pattern
- Log each failed attempt with attempt number using `log()` from `./logger`
- On final attempt failure, throw the original error
- Use `execSync` under the hood, return trimmed stdout string
- In `adws/core/index.ts`, add `execWithRetry` to the utils re-export block

### Step 2: Apply `execWithRetry` to all `gh` CLI calls across GitHub modules
- **`adws/github/issueApi.ts`**: Replace `execSync` with `execWithRetry` in `fetchGitHubIssue()`, `commentOnIssue()`, `getIssueState()`, `closeIssue()`, `getIssueTitleSync()`, `fetchIssueCommentsRest()`, `deleteIssueComment()` — preserve existing try/catch patterns
- **`adws/github/prApi.ts`**: Replace `execSync` with `execWithRetry` in `fetchPRDetails()`, `fetchPRReviews()`, `fetchPRReviewComments()`, `commentOnPR()`, `mergePR()`, `approvePR()`, `fetchPRList()` — preserve existing try/catch patterns
- **`adws/github/githubApi.ts`**: Replace `execSync` with `execWithRetry` for the `gh api user` call in `getAuthenticatedUser()` only. Do NOT wrap the local `git remote get-url origin` call.
- **`adws/providers/github/githubCodeHost.ts`**: Replace `execSync` with `execWithRetry` for the `gh pr create` call in `createMergeRequest()`
- Add import `import { execWithRetry } from '../../core'` (or relative path as appropriate) to each file

### Step 3: Add existing PR check + upgrade ENOENT retry + pre-flight validation + worktree origin base ref
- **`adws/providers/github/githubCodeHost.ts`** — In `createMergeRequest()`, before `gh pr create`, run `gh pr list --head <sourceBranch> --repo <owner/repo> --json url,number --limit 1` via `execWithRetry`. If a PR is found, return its `{ url, number }` directly. Log reuse.
- **`adws/agents/claudeAgent.ts`** — Replace single ENOENT retry (lines ~116-126) with 3-attempt loop: on every attempt, call `clearClaudeCodePathCache()` then `resolveClaudeCodePath()` for a fresh path. Use exponential backoff (500ms, 1000ms, 2000ms). Log each retry with resolved path.
- **`adws/phases/workflowInit.ts`** — Early in `initializeWorkflow()`, before agent calls: call `resolveClaudeCodePath()`, verify executable via `fs.accessSync(path, fs.constants.X_OK)`. Throw clear error if not found/not executable.
- **`adws/vcs/worktreeCreation.ts`** — In `createWorktree()` and `createWorktreeForNewBranch()`: prepend `origin/` to base ref, add `git fetch origin "${baseBranch}"` before worktree creation. Log warning if local differs from remote.

### Step 4: Add graceful degradation, retry-on-JSON-failure, filter undefined arrays, skip reason files
- **`adws/agents/resolutionAgent.ts`** — In `parseResolutionResult()`: return `{ resolved: false, decisions: [] }` with warning log instead of throwing on invalid JSON. In `runResolutionAgent()`: if parse returns fallback (extractJson returned null), re-run agent once.
- **`adws/agents/validationAgent.ts`** — In `runValidationAgent()`: if parse was a fallback (output didn't contain valid JSON), re-run agent once. If retry also fails, return existing fallback.
- **`adws/agents/reviewRetry.ts`** — In `mergeReviewResults()`: add `.filter((issue): issue is ReviewIssue => issue != null)` after `.flatMap(r => r.reviewResult!.reviewIssues)`. Also filter screenshots: `.filter((s): s is string => s != null)`.
- **`adws/triggers/autoMergeHandler.ts`** — After `ensureLogsDirectory()`, on each early return write `skip_reason.txt` with the appropriate reason (PR merged, worktree failure, missing PR URL, missing repo context).
- **`adws/phases/autoMergePhase.ts`** — On early returns for missing PR URL and missing repo context: write `skip_reason.txt` to `config.logsDir`.

### Step 5: Generate step definitions and validate
- Generate `features/step_definitions/retryLogicResilienceSteps.ts` with step definitions for all 31 scenarios in `features/retry_logic_resilience.feature`
- Step definitions should verify source code patterns (e.g., grep for `execWithRetry` in source files, check function signatures, verify import patterns) following the project's existing step definition conventions (source-scanning approach using `findFiles()` and `spawnSync`)
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-315" --dry-run` to verify all steps are defined
- Run validation commands (Step 14 from spec)

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `bun run lint` — Verify no linting errors
2. `bun run build` — Verify build passes
3. `bunx tsc --noEmit` — Root TypeScript type checking
4. `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type checking
5. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-315" --dry-run` — Verify all step definitions resolve (no undefined steps)
6. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-gcisck-robustness-hardening and @regression"` — Run regression-tagged scenarios
7. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-315"` — Run all issue scenarios

## Patch Scope
**Lines of code to change:** ~400-500 (across 15 files: 14 source modifications + 1 new step definition file)
**Risk level:** medium (touches multiple modules but each change is isolated and follows existing patterns)
**Testing required:** TypeScript compilation, lint, cucumber dry-run for step resolution, full BDD scenario run for all @adw-315 tagged scenarios
