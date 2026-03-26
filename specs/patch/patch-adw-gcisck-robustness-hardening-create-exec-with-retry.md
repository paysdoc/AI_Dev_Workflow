# Patch: Create execWithRetry utility and apply to all gh CLI calls

## Metadata
adwId: `gcisck-robustness-hardening`
reviewChangeRequest: `Issue #3: execWithRetry utility not created in adws/core/utils.ts. This is the foundation for all gh CLI retry logic (spec Steps 1-5). Without it, 7 issueApi calls, 7 prApi calls, 1 githubApi call, and 1 githubCodeHost call have no retry on transient failures.`

## Issue Summary
**Original Spec:** specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md
**Issue:** The `execWithRetry` utility does not exist yet. All 16 `gh` CLI calls across `issueApi.ts`, `prApi.ts`, `githubApi.ts`, and `githubCodeHost.ts` use bare `execSync` with no retry logic — a transient GitHub API blip (network hiccup, 502, rate limit) kills the workflow.
**Solution:** Create `execWithRetry(command, options)` in `adws/core/utils.ts` following the exponential backoff pattern from `exchangeRates.ts` (500ms, 1s, 2s). Export from `adws/core/index.ts`. Replace bare `execSync` with `execWithRetry` in all gh CLI calls across the four modules. Leave `git remote get-url origin` (local command) untouched.

## Files to Modify
Use these files to implement the patch:

1. `adws/core/utils.ts` — Add `execWithRetry` function
2. `adws/core/index.ts` — Re-export `execWithRetry`
3. `adws/github/issueApi.ts` — Replace 7 bare `execSync` gh CLI calls with `execWithRetry`
4. `adws/github/prApi.ts` — Replace 7 bare `execSync` gh CLI calls with `execWithRetry`
5. `adws/github/githubApi.ts` — Replace 1 `execSync` (`gh api user`) with `execWithRetry`; leave `git remote get-url origin` untouched
6. `adws/providers/github/githubCodeHost.ts` — Replace 1 `execSync` (`gh pr create`) with `execWithRetry`

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Create `execWithRetry` in `adws/core/utils.ts`
- Read `adws/cost/exchangeRates.ts` as reference for the backoff pattern: `500 * Math.pow(2, attempt)`
- Add imports: `execSync` and `ExecSyncOptions` from `child_process`
- Add a new exported function `execWithRetry(command: string, options?: ExecSyncOptions & { maxAttempts?: number }): string`
- Default `maxAttempts` to 3
- Exponential backoff delays: 500ms, 1000ms, 2000ms (formula: `500 * Math.pow(2, attempt)`)
- Non-transient error classification: if the error message (stderr or message) contains `"not found"`, `"does not exist"`, `"permission denied"`, or `"authentication"` (case-insensitive), throw immediately without retrying
- On each failed transient attempt (except the last), log with `log()` from `./logger`: `"execWithRetry: attempt {n}/{maxAttempts} failed for command, retrying in {delay}ms..."`
- Use synchronous sleep for blocking delay — use `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs)` since this is a sync function and Bun supports `SharedArrayBuffer`
- On final attempt failure, throw the original error
- Return trimmed stdout string (same as `execSync(..., { encoding: 'utf-8' }).trim()`)
- Export from the barrel at the bottom of utils.ts (no re-export needed since it's defined in-file)

### Step 2: Export `execWithRetry` from `adws/core/index.ts`
- Add `execWithRetry` to the existing re-export block from `'./utils'` (line ~58-68)

### Step 3: Apply `execWithRetry` to `adws/github/issueApi.ts`
- Change import: add `execWithRetry` from `'../core'` (alongside existing `log` import)
- Remove `execSync` from `'child_process'` import (it will be used internally by `execWithRetry`)
- Replace 7 `execSync(...)` calls with `execWithRetry(...)`:
  - `fetchGitHubIssue()` (line ~114): `execWithRetry('gh issue view ...', { encoding: 'utf-8' })`
  - `commentOnIssue()` (line ~136): Keep `input` and `stdio` options — pass them through: `execWithRetry('gh issue comment ...', { encoding: 'utf-8', input: body, stdio: ['pipe', 'pipe', 'pipe'] })`
  - `getIssueState()` (line ~175): `execWithRetry('gh issue view ... --json state', { encoding: 'utf-8' })`
  - `closeIssue()` (line ~211): `execWithRetry('gh issue close ...', { encoding: 'utf-8' })`
  - `getIssueTitleSync()` (line ~233): `execWithRetry('gh issue view ... --json title', { encoding: 'utf-8' })`
  - `fetchIssueCommentsRest()` (line ~253): `execWithRetry('gh api repos/...', { encoding: 'utf-8' })`
  - `deleteIssueComment()` (line ~277): `execWithRetry('gh api -X DELETE ...', { encoding: 'utf-8', stdio: [...] })`
- Preserve all existing error handling patterns (try/catch, return gracefully vs throw)

### Step 4: Apply `execWithRetry` to `adws/github/prApi.ts`
- Change import: add `execWithRetry` from `'../core'` (alongside existing `log` import)
- Remove `execSync` from `'child_process'` import
- Replace 7 `execSync(...)` calls with `execWithRetry(...)`:
  - `fetchPRDetails()` (line ~61)
  - `fetchPRReviews()` (line ~95)
  - `fetchPRReviewComments()` (line ~133)
  - `commentOnPR()` (line ~176): Keep `input` and `stdio` options
  - `mergePR()` (line ~195): Keep `stdio` options
  - `approvePR()` (line ~227): Keep `stdio` options
  - `fetchPRList()` (line ~253)
- Preserve all existing error handling patterns

### Step 5: Apply `execWithRetry` to `adws/github/githubApi.ts`
- Change import: add `execWithRetry` from `'../core'`
- Keep `execSync` import from `'child_process'` — still needed for `git remote get-url origin` in `getRepoInfo()`
- Replace ONLY the `gh api user` call in `getAuthenticatedUser()` (line ~72) with `execWithRetry`
- Do NOT touch the `git remote get-url origin` call — it's a local git command, not a network call

### Step 6: Apply `execWithRetry` to `adws/providers/github/githubCodeHost.ts`
- Change import: add `execWithRetry` from `'../../core'`
- Keep `execSync` import from `'child_process'` — may be needed for other uses or future changes
- Actually, check if `execSync` is still used after the replacement. If not, remove it.
- Replace the `execSync` in `createMergeRequest()` (line ~90) for `gh pr create` with `execWithRetry`
- The temp file body pattern stays the same — only the exec call changes

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `bun run lint` — passes with no errors
2. `bun run build` — passes with no build errors
3. `bunx tsc --noEmit` — root TypeScript type checking passes
4. `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type checking passes
5. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-315" --dry-run` — verify no undefined steps or parse errors for retry-related scenarios

## Patch Scope
**Lines of code to change:** ~80 (1 new function ~30 lines, 1 export line, ~50 lines of import/call-site changes across 4 modules)
**Risk level:** low (mechanical replacement of `execSync` → `execWithRetry`; existing error handling preserved; non-transient error classification prevents retrying permanent failures)
**Testing required:** TypeScript compilation, linting, build; BDD scenario dry-run for @adw-315 tag
