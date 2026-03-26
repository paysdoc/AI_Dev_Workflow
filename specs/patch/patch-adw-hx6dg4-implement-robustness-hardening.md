# Patch: Implement all 14 robustness hardening spec steps

## Metadata
adwId: `hx6dg4-robustness-hardening`
reviewChangeRequest: `Issue #1: @review-proof scenarios FAILED (exit code 1, no output). No source code changes exist in adws/ — the entire feature is unimplemented. The branch only contains BDD feature files and patch spec documents.`

## Issue Summary
**Original Spec:** `specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md`
**Issue:** The robustness hardening feature (#315) is entirely unimplemented. All 14 spec steps need to be coded: `execWithRetry` utility, retry wrapping of `gh` CLI calls, Claude CLI ENOENT retry upgrade, pre-flight validation, worktree origin base ref, existing PR check, graceful degradation, review array guard, and skip reason logging.
**Solution:** Implement all 14 steps from the spec sequentially — create `execWithRetry` in `adws/core/utils.ts`, apply it across GitHub API modules, upgrade `claudeAgent.ts` ENOENT retry, add pre-flight check in `workflowInit.ts`, switch worktree base ref, add existing PR detection, add resolution agent fallback, add validation agent retry, filter undefined review arrays, and write skip reason files.

## Files to Modify

1. `adws/core/utils.ts` — Add `execWithRetry` utility function
2. `adws/core/index.ts` — Export `execWithRetry`
3. `adws/github/issueApi.ts` — Replace `execSync` with `execWithRetry` for `gh` CLI calls
4. `adws/github/prApi.ts` — Replace `execSync` with `execWithRetry` for `gh` CLI calls
5. `adws/github/githubApi.ts` — Replace `execSync` with `execWithRetry` for `gh api user` call only
6. `adws/providers/github/githubCodeHost.ts` — Replace `execSync` with `execWithRetry` in `createMergeRequest()` + add existing PR check
7. `adws/agents/claudeAgent.ts` — Upgrade ENOENT retry to 3 attempts with per-attempt path re-resolution
8. `adws/phases/workflowInit.ts` — Add pre-flight Claude CLI validation
9. `adws/vcs/worktreeCreation.ts` — Use `origin/<defaultBranch>` as base ref with `git fetch` before create
10. `adws/agents/resolutionAgent.ts` — Add graceful degradation fallback on invalid JSON
11. `adws/agents/validationAgent.ts` — Add agent retry on non-JSON output
12. `adws/agents/reviewRetry.ts` — Filter undefined/null from review issue and screenshot arrays
13. `adws/triggers/autoMergeHandler.ts` — Write `skip_reason.txt` on early exits
14. `adws/phases/autoMergePhase.ts` — Write `skip_reason.txt` on early exits

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Create `execWithRetry` utility and export it
Add the `execWithRetry` function to `adws/core/utils.ts` following the exponential backoff pattern from `adws/cost/exchangeRates.ts`. Then export it from `adws/core/index.ts`.

**In `adws/core/utils.ts`:**
- Import `execSync` from `child_process` and `ExecSyncOptions` from `child_process`
- Import `log` from `./logger`
- Add function `execWithRetry(command: string, options?: ExecSyncOptions & { maxAttempts?: number }): string`
  - Default `maxAttempts` to 3
  - Loop from `attempt = 0` to `maxAttempts - 1`
  - Inside try: call `execSync(command, { encoding: 'utf-8', ...options })` and return the trimmed result
  - Inside catch: log `"execWithRetry failed (attempt ${attempt + 1}/${maxAttempts}): ${error}"` at 'error' level
  - If not last attempt: sleep with `const backoff = 500 * Math.pow(2, attempt)` using `Bun.sleep(backoff)` (sync approach: use `execSync(\`sleep ${backoff / 1000}\`)` or the simpler `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, backoff)`)
  - On last attempt failure: re-throw the error
- **Important**: `execWithRetry` is synchronous (matches `execSync` callsites). Use `Atomics.wait` for synchronous sleep since Bun supports SharedArrayBuffer.

**In `adws/core/index.ts`:**
- Add `execWithRetry` to the existing `export { ... } from './utils'` block

### Step 2: Apply `execWithRetry` to GitHub API modules
Replace bare `execSync` calls with `execWithRetry` in `issueApi.ts`, `prApi.ts`, `githubApi.ts`, and `githubCodeHost.ts`.

**In `adws/github/issueApi.ts`:**
- Add `import { execWithRetry } from '../core'` (keep `execSync` import for any non-gh calls if needed — but all 7 calls in this file are `gh` commands, so replace `execSync` import with `execWithRetry` import)
- Replace `execSync` with `execWithRetry` in these functions:
  - `fetchGitHubIssue()` — the `gh issue view` call
  - `commentOnIssue()` — the `gh issue comment` call (note: uses `input: body` option for stdin)
  - `getIssueState()` — the `gh issue view --json state` call
  - `closeIssue()` — the `gh issue close` call
  - `getIssueTitleSync()` — the `gh issue view` call (already has try-catch returning fallback)
  - `fetchIssueCommentsRest()` — the `gh api` call
  - `deleteIssueComment()` — the `gh api -X DELETE` call
- Preserve all existing error handling: functions that catch and return gracefully keep their try-catch; `execWithRetry` retries transparent failures before the outer catch fires

**In `adws/github/prApi.ts`:**
- Add `import { execWithRetry } from '../core'`; remove or keep `execSync` import as needed
- Replace `execSync` with `execWithRetry` in:
  - `fetchPRDetails()` — `gh pr view` call
  - `fetchPRReviews()` — `gh api repos/.../pulls/.../reviews` call
  - `fetchPRReviewComments()` — `gh api repos/.../pulls/.../comments` call
  - `commentOnPR()` — `gh pr comment` call (uses `input: body`)
  - `mergePR()` — `gh pr merge` call
  - `approvePR()` — `gh pr review --approve` call (keep the GH_TOKEN delete/restore in try-finally)
  - `fetchPRList()` — `gh pr list` call
- Preserve all existing error handling patterns (structured error objects, finally blocks for GH_TOKEN)

**In `adws/github/githubApi.ts`:**
- Add `import { execWithRetry } from '../core'`
- Replace `execSync` with `execWithRetry` ONLY in `getAuthenticatedUser()` for the `gh api user` call
- Do NOT change the `git remote get-url origin` call in `getRepoInfo()` — it's a local git command, not a network call

**In `adws/providers/github/githubCodeHost.ts`:**
- Add `import { execWithRetry } from '../../core'`
- Replace the `execSync` call in `createMergeRequest()` for `gh pr create` with `execWithRetry`

### Step 3: Add existing PR check in `githubCodeHost.ts`
Before the `gh pr create` call in `createMergeRequest()`:
- Run `execWithRetry(\`gh pr list --head "${options.sourceBranch}" ${repoFlag} --json url,number --limit 1\`, { encoding: 'utf-8' })`
- Parse the JSON result; if array is non-empty, extract `url` and `number` from the first entry
- Log `"Existing PR #${number} found for branch ${options.sourceBranch}, reusing"` at 'info' level (import `log` from `../../core`)
- Return `{ url, number }` directly, skipping the `gh pr create` call
- Wrap the check in try-catch — if the check fails, fall through to normal PR creation (defensive)

### Step 4: Upgrade Claude CLI ENOENT retry in `claudeAgent.ts`
Replace the single ENOENT retry with a 3-attempt exponential backoff loop:
- Find the ENOENT catch block (currently handles `code === 'ENOENT'`)
- Replace the single retry with a `for (let attempt = 0; attempt < 2; attempt++)` loop (2 additional retries = 3 total attempts including original)
- On each retry: call `clearClaudeCodePathCache()` then `resolveClaudeCodePath()` to get a fresh path
- Wait with exponential backoff: `await delay(500 * Math.pow(2, attempt))` → 500ms, 1000ms
- Log: `"Claude CLI ENOENT retry (attempt ${attempt + 2}/3), re-resolved path: ${newPath}"` at 'warn' level
- Re-spawn with the new resolved path
- If all retries fail, throw the original error

### Step 5: Add pre-flight Claude CLI validation in `workflowInit.ts`
Early in `initializeWorkflow()`, before any agent calls:
- Import `resolveClaudeCodePath` from `../core` (should already be available via core barrel)
- Import `accessSync, constants` from `fs`
- After `setLogAdwId(adwId)` and before the issue fetch:
  - Call `const claudePath = resolveClaudeCodePath()`
  - Call `accessSync(claudePath, constants.X_OK)` wrapped in try-catch
  - On catch: throw `new Error(\`Pre-flight check failed: Claude CLI not found or not executable at ${claudePath}. Ensure 'claude' is installed and in PATH, or set CLAUDE_CODE_PATH in .env.\`)`
  - On success: `log(\`Pre-flight check passed: Claude CLI found at ${claudePath}\`, 'info')`

### Step 6: Switch worktree creation to `origin/<defaultBranch>` base ref
**In `adws/vcs/worktreeCreation.ts`:**

In `createWorktree()`:
- When the function falls through to create from `baseBranch` (the `git worktree add -b` path), prepend `origin/`:
  - Before the worktree add command: `execSync(\`git fetch origin "${baseBranch}"\`, gitOpts)` to ensure remote ref is current
  - Change `"${baseBranch}"` to `"origin/${baseBranch}"` in the `git worktree add -b` command
- Add a warning check: compare `git rev-parse "${baseBranch}"` with `git rev-parse "origin/${baseBranch}"` — if they differ, log a warning: `"Local ${baseBranch} differs from origin/${baseBranch}, using remote ref"` at 'warn' level (wrap in try-catch, non-fatal)

In `createWorktreeForNewBranch()`:
- When `baseBranch` is provided (the `base` variable): prepend `origin/` to the base ref
- Before creating: `execSync(\`git fetch origin "${base}"\`, gitOpts)`
- Change the `git worktree add -b` command to use `"origin/${base}"` instead of `"${base}"`

### Step 7: Add graceful degradation to `resolutionAgent.ts`
In `parseResolutionResult()`:
- Instead of throwing when `extractJson()` returns null or `parsed.resolved` is not boolean:
  - Log a warning: `"Resolution agent returned invalid JSON, falling back to unresolved"` at 'warn' level (import `log` from `../core/logger`)
  - Return `{ resolved: false, decisions: [] }` as the graceful fallback
- This mirrors the existing pattern in `validationAgent.ts`'s `parseValidationResult()`

In `runResolutionAgent()`:
- After calling `parseResolutionResult()`, check if the result is a degraded fallback (resolved === false, decisions.length === 0)
- If so, check if `extractJson()` on the raw agent output returns null (confirming non-JSON output rather than genuine "unresolved")
- If non-JSON confirmed: log `"Resolution agent returned non-JSON output, retrying once..."` at 'warn'
- Re-run the agent (call `runClaudeAgentWithCommand` again with same params)
- Parse the retry output; if it also fails, return the graceful degradation result

### Step 8: Add agent retry on JSON parse failure in `validationAgent.ts`
In `runValidationAgent()`:
- After parsing, check if `validationResult.aligned === false` and the parse was a fallback (detect by checking if `extractJson()` on raw output returns null)
- If non-JSON confirmed: log `"Validation agent returned non-JSON output, retrying once..."` at 'warn'
- Re-run the agent once with the same params
- Parse the retry output; if it also fails, return the existing unaligned fallback

### Step 9: Filter undefined review issue array elements in `reviewRetry.ts`
In `mergeReviewResults()`:
- Change `.flatMap(r => r.reviewResult!.reviewIssues)` to `.flatMap(r => r.reviewResult!.reviewIssues).filter(Boolean)`
  - Use a more precise type guard if needed: `.filter((issue): issue is ReviewIssue => issue != null)`
- Also filter the screenshots array: `.flatMap(r => r.reviewResult!.screenshots).filter((s): s is string => s != null)`
- Import `ReviewIssue` type if not already imported (check existing imports)

### Step 10: Write skip reason files on auto-merge early exits
**In `adws/triggers/autoMergeHandler.ts`:**
In `handleApprovedReview()`, after `ensureLogsDirectory()` creates the log dir, on each early return:
- Import `writeFileSync` from `fs` (if not already imported)
- Before each `return` that exits after the log dir is created, write: `fs.writeFileSync(path.join(logsDir, 'skip_reason.txt'), '<reason>')`
- Reasons:
  - PR already merged: `"PR already merged, skipping auto-merge"`
  - Worktree failure: `"Worktree creation failed for branch: <branch>"`
  - Missing PR URL: `"No PR URL available, skipping auto-merge"`
  - Missing repo context: `"No repo context available, skipping auto-merge"`
- For early returns BEFORE `ensureLogsDirectory()` (webhook payload validation): no change needed

**In `adws/phases/autoMergePhase.ts`:**
In `executeAutoMergePhase()`:
- Import `writeFileSync` from `fs`
- On early return for missing PR URL: `fs.writeFileSync(path.join(config.logsDir, 'skip_reason.txt'), "No PR URL found, skipping auto-merge")`
- On early return for missing repo context: `fs.writeFileSync(path.join(config.logsDir, 'skip_reason.txt'), "No repo context available, skipping auto-merge")`

### Step 11: Run validation commands
- `bun run lint` — Verify no linting errors
- `bun run build` — Verify no build errors
- `bunx tsc --noEmit` — Root TypeScript type check
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type check
- Fix any errors introduced by the implementation before proceeding

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `bun run lint` — Run linter to check for code quality issues
2. `bun run build` — Build the application to verify no build errors
3. `bunx tsc --noEmit` — Root TypeScript type checking
4. `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type checking

## Patch Scope
**Lines of code to change:** ~250-350 lines across 14 files
**Risk level:** medium (touches core execution paths but all changes are additive retry/fallback logic)
**Testing required:** TypeScript compilation + linting (unit tests disabled per `.adw/project.md`). BDD scenarios validate behavioral correctness post-implementation.
