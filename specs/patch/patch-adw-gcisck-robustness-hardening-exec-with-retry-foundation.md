# Patch: Implement execWithRetry utility and apply to all gh CLI calls

## Metadata
adwId: `gcisck-robustness-hardening`
reviewChangeRequest: `Issue #3: Core implementation missing: execWithRetry utility not created in adws/core/utils.ts. This is the foundation for all gh CLI retry logic (spec steps 1-5). Without it, all 7 execSync calls in issueApi.ts, 7 in prApi.ts, 1 in githubApi.ts, and 1 in githubCodeHost.ts remain bare with no retry on transient failures.`

## Issue Summary
**Original Spec:** specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md
**Issue:** The `execWithRetry` utility does not exist in `adws/core/utils.ts`. All 16 `gh` CLI `execSync` calls across four modules have zero retry logic — any transient GitHub API failure (network hiccup, 502, rate limit) crashes the workflow immediately.
**Solution:** Create `execWithRetry(command, options)` in `adws/core/utils.ts` with 3 attempts, exponential backoff (500ms -> 1s -> 2s), attempt logging, and final error rethrow. Follow the proven pattern from `adws/cost/exchangeRates.ts`. Export from `adws/core/index.ts`. Replace bare `execSync` with `execWithRetry` in all `gh` CLI calls across `issueApi.ts`, `prApi.ts`, `githubApi.ts`, and `githubCodeHost.ts`. Leave the local `git remote get-url origin` call in `githubApi.ts` untouched.

## Files to Modify
Use these files to implement the patch:

1. `adws/core/utils.ts` — Add `execWithRetry` function (new code)
2. `adws/core/index.ts` — Add `execWithRetry` to the re-export block from `'./utils'`
3. `adws/github/issueApi.ts` — Replace 7 `execSync` gh CLI calls with `execWithRetry`
4. `adws/github/prApi.ts` — Replace 7 `execSync` gh CLI calls with `execWithRetry`
5. `adws/github/githubApi.ts` — Replace 1 `execSync` (`gh api user`) with `execWithRetry`; keep `execSync` for `git remote get-url origin`
6. `adws/providers/github/githubCodeHost.ts` — Replace 1 `execSync` (`gh pr create`) with `execWithRetry`

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Create `execWithRetry` in `adws/core/utils.ts`
- Add imports at the top: `import { execSync, type ExecSyncOptions } from 'child_process';`
- Add a new exported function after the `ensureLogsDirectory` function:
  ```typescript
  export function execWithRetry(command: string, options?: ExecSyncOptions & { maxAttempts?: number }): string {
    const { maxAttempts = 3, ...execOptions } = options ?? {};
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return execSync(command, { encoding: 'utf-8', ...execOptions }).trim();
      } catch (error) {
        const message = String((error as { stderr?: string }).stderr || error);
        const isNonTransient = /not found|does not exist|permission denied|authentication/i.test(message);
        if (isNonTransient || attempt >= maxAttempts - 1) throw error;
        const delay = 500 * Math.pow(2, attempt);
        log(`execWithRetry: attempt ${attempt + 1}/${maxAttempts} failed for command, retrying in ${delay}ms...`, 'info');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
      }
    }
    throw new Error('execWithRetry: unreachable');
  }
  ```
- Key design decisions matching `exchangeRates.ts` backoff pattern: `500 * Math.pow(2, attempt)` = 500ms, 1000ms, 2000ms
- Non-transient errors (not found, permission denied, authentication) throw immediately without retry
- Uses `Atomics.wait` for synchronous sleep (this is a sync function, Bun supports SharedArrayBuffer)
- Returns trimmed stdout string

### Step 2: Export `execWithRetry` from `adws/core/index.ts`
- Add `execWithRetry` to the existing utilities re-export block (line ~58-68) alongside `ensureLogsDirectory`:
  ```typescript
  export {
    generateAdwId,
    slugify,
    log,
    setLogAdwId,
    getLogAdwId,
    resetLogAdwId,
    ensureLogsDirectory,
    execWithRetry,
    parseTargetRepoArgs,
    type LogLevel,
  } from './utils';
  ```

### Step 3: Apply `execWithRetry` to `adws/github/issueApi.ts` (7 calls)
- Change imports: replace `import { execSync } from 'child_process';` with nothing (remove the line)
- Add `execWithRetry` to the `'../core'` import: `import { GitHubIssue, IssueCommentSummary, log, execWithRetry } from '../core';`
- Replace each `execSync(...)` call with `execWithRetry(...)`, preserving all existing options (`encoding`, `input`, `stdio`):
  - `fetchGitHubIssue()` line ~114: `execWithRetry('gh issue view ...', { encoding: 'utf-8' })`
  - `commentOnIssue()` line ~136: `execWithRetry('gh issue comment ...', { encoding: 'utf-8', input: body, stdio: ['pipe', 'pipe', 'pipe'] })`
  - `getIssueState()` line ~175: `execWithRetry('gh issue view ...', { encoding: 'utf-8' })`
  - `closeIssue()` line ~211: `execWithRetry('gh issue close ...', { encoding: 'utf-8' })`
  - `getIssueTitleSync()` line ~233: `execWithRetry('gh issue view ...', { encoding: 'utf-8' })`
  - `fetchIssueCommentsRest()` line ~253: `execWithRetry('gh api repos/...', { encoding: 'utf-8' })`
  - `deleteIssueComment()` line ~277: `execWithRetry('gh api -X DELETE ...', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })`
- Note: `execWithRetry` already trims output, so remove any `.trim()` calls on the return value
- Preserve all existing try/catch error handling patterns unchanged

### Step 4: Apply `execWithRetry` to `adws/github/prApi.ts` (7 calls)
- Change imports: replace `import { execSync } from 'child_process';` with nothing (remove the line)
- Add `execWithRetry` to the `'../core'` import: `import { PRDetails, PRReviewComment, PRListItem, log, execWithRetry } from '../core';`
- Replace each `execSync(...)` call with `execWithRetry(...)`:
  - `fetchPRDetails()` line ~61
  - `fetchPRReviews()` line ~95
  - `fetchPRReviewComments()` line ~133
  - `commentOnPR()` line ~176: preserve `input` and `stdio` options
  - `mergePR()` line ~195: preserve `stdio` options
  - `approvePR()` line ~227: preserve `stdio` options
  - `fetchPRList()` line ~253
- Preserve all existing error handling patterns

### Step 5: Apply `execWithRetry` to `adws/github/githubApi.ts` (1 call)
- Add `execWithRetry` import: `import { execWithRetry } from '../core';`
- Keep `import { execSync } from 'child_process';` — still needed for `git remote get-url origin` in `getRepoInfo()`
- Replace ONLY the `gh api user` call in `getAuthenticatedUser()` line ~72:
  ```typescript
  const login = execWithRetry('gh api user --jq .login', { encoding: 'utf-8' });
  ```
- Do NOT touch the `git remote get-url origin` call — it's a local git command, not a transient network failure

### Step 6: Apply `execWithRetry` to `adws/providers/github/githubCodeHost.ts` (1 call)
- Remove `import { execSync } from 'child_process';` (no longer needed after replacement)
- Add import: `import { execWithRetry } from '../../core';`
- Replace the `execSync` in `createMergeRequest()` line ~90 for `gh pr create`:
  ```typescript
  const prUrl = execWithRetry(
    `gh pr create --title "${options.title.replace(/"/g, '\\"')}" --body-file "${tempFilePath}" --base "${options.targetBranch}" --head "${options.sourceBranch}" ${repoFlag}`,
    { encoding: 'utf-8', shell: '/bin/bash' },
  );
  ```
- Note: `execWithRetry` already trims, so remove the `.trim()` call

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `bun run lint` — passes with no errors
2. `bun run build` — passes with no build errors
3. `bunx tsc --noEmit` — root TypeScript type checking passes
4. `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type checking passes

## Patch Scope
**Lines of code to change:** ~80 (1 new function ~25 lines in utils.ts, 1 export addition in index.ts, ~50 lines of import/call-site changes across 4 modules)
**Risk level:** low (mechanical `execSync` -> `execWithRetry` replacement; existing error handling preserved; non-transient errors skip retry; proven backoff pattern from exchangeRates.ts)
**Testing required:** TypeScript compilation, linting, build verification
