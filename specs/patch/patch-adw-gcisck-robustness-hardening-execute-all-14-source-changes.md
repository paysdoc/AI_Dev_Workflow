# Patch: Execute all 14 robustness hardening source code changes

## Metadata
adwId: `gcisck-robustness-hardening`
reviewChangeRequest: `specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md`

## Issue Summary
**Original Spec:** specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md
**Issue:** Zero of 14 spec implementation steps completed. No `execWithRetry` utility, no gh CLI retry wrapping, no ENOENT retry upgrade, no pre-flight validation, no origin-based worktree creation, no existing PR check, no graceful degradation, no null guards, no skip reason files.
**Solution:** Execute all 14 implementation steps from the spec, starting with the `execWithRetry` foundation and building outward to all consumers. Each change follows the existing `exchangeRates.ts` retry pattern and `validationAgent.ts` graceful fallback pattern.

## Files to Modify

1. `adws/core/utils.ts` — Add `execWithRetry` utility function
2. `adws/core/index.ts` — Re-export `execWithRetry`
3. `adws/github/issueApi.ts` — Replace 7 `execSync` calls with `execWithRetry`
4. `adws/github/prApi.ts` — Replace 7 `execSync` calls with `execWithRetry`
5. `adws/github/githubApi.ts` — Replace 1 `execSync` call with `execWithRetry` (only `gh api user`, NOT `git remote`)
6. `adws/providers/github/githubCodeHost.ts` — Replace `gh pr create` with `execWithRetry`, add existing PR check before create
7. `adws/agents/claudeAgent.ts` — Upgrade ENOENT retry to 3 attempts with per-attempt path re-resolution
8. `adws/agents/resolutionAgent.ts` — Graceful degradation in `parseResolutionResult()`, agent retry on JSON parse failure in `runResolutionAgent()`
9. `adws/agents/validationAgent.ts` — Agent retry on JSON parse failure in `runValidationAgent()`
10. `adws/agents/reviewRetry.ts` — Filter undefined/null entries from review issue and screenshot arrays
11. `adws/phases/workflowInit.ts` — Add pre-flight Claude CLI validation
12. `adws/vcs/worktreeCreation.ts` — Switch to `origin/<defaultBranch>` base ref with fetch
13. `adws/triggers/autoMergeHandler.ts` — Write `skip_reason.txt` on early exits after logsDir exists
14. `adws/phases/autoMergePhase.ts` — Write `skip_reason.txt` on early exits

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Create `execWithRetry` utility in `adws/core/utils.ts` and export from `adws/core/index.ts`

In `adws/core/utils.ts`:
- Add import at top: `import { execSync, type ExecSyncOptions } from 'child_process';`
- The file already re-exports `log` from `./logger`, so add a direct import: `import { log } from './logger';`
- Add after the `ensureLogsDirectory` function (after line 38):

```typescript
// ---------------------------------------------------------------------------
// Retry wrapper for transient CLI failures (exponential backoff)
// ---------------------------------------------------------------------------

/**
 * Executes a shell command with retry logic and exponential backoff.
 * Retries up to maxAttempts times (default 3) with delays of 500ms, 1000ms, 2000ms.
 * Follows the same backoff pattern as exchangeRates.ts.
 *
 * @param command - The shell command to execute
 * @param options - ExecSyncOptions plus optional maxAttempts override
 * @returns Trimmed stdout string
 * @throws The original error after all attempts are exhausted
 */
export function execWithRetry(
  command: string,
  options?: ExecSyncOptions & { maxAttempts?: number },
): string {
  const { maxAttempts = 3, ...execOptions } = options ?? {};

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return execSync(command, { encoding: 'utf-8', ...execOptions }).toString().trim();
    } catch (error) {
      if (attempt < maxAttempts - 1) {
        const delayMs = 500 * Math.pow(2, attempt);
        log(`execWithRetry: attempt ${attempt + 1}/${maxAttempts} failed, retrying in ${delayMs}ms...`, 'warn');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
      } else {
        throw error;
      }
    }
  }
  throw new Error('execWithRetry: unreachable');
}
```

In `adws/core/index.ts`, add `execWithRetry` to the re-export from `'./utils'` (line 58-68):
- Add `execWithRetry,` after `ensureLogsDirectory,` in the export block

### Step 2: Apply `execWithRetry` to `adws/github/issueApi.ts` (Spec Step 2)

- Remove `import { execSync } from 'child_process';` (line 5)
- Add `execWithRetry` to the import from `'../core'`: change line 6 to `import { GitHubIssue, IssueCommentSummary, log, execWithRetry } from '../core';`
- Replace every `execSync(` with `execWithRetry(` for all 7 gh CLI calls:
  1. `fetchGitHubIssue()` line 114: `execSync(...)` to `execWithRetry(...)`
  2. `commentOnIssue()` line 136: `execSync(...)` to `execWithRetry(...)` — keep `{ encoding: 'utf-8', input: body, stdio: [...] }` options
  3. `getIssueState()` line 175: `execSync(...)` to `execWithRetry(...)`
  4. `closeIssue()` line 211: `execSync(...)` to `execWithRetry(...)`
  5. `getIssueTitleSync()` line 233: `execSync(...)` to `execWithRetry(...)`
  6. `fetchIssueCommentsRest()` line 253: `execSync(...)` to `execWithRetry(...)`
  7. `deleteIssueComment()` line 277: `execSync(...)` to `execWithRetry(...)`
- All existing try/catch blocks remain unchanged — `execWithRetry` handles transient retries internally, and if all retries fail it throws, which the existing catch blocks handle
- Note: `execWithRetry` already passes `{ encoding: 'utf-8' }` by default, so callers that only passed `{ encoding: 'utf-8' }` can omit the options. Callers with additional options (like `input`, `stdio`) must keep passing those.

### Step 3: Apply `execWithRetry` to `adws/github/prApi.ts` (Spec Step 3)

- Remove `import { execSync } from 'child_process';` (line 5)
- Add `execWithRetry` to the import from `'../core'`: change line 6 to `import { PRDetails, PRReviewComment, PRListItem, log, execWithRetry } from '../core';`
- Replace every `execSync(` with `execWithRetry(` for all 7 gh CLI calls:
  1. `fetchPRDetails()` line 61
  2. `fetchPRReviews()` line 95
  3. `fetchPRReviewComments()` line 133
  4. `commentOnPR()` line 176
  5. `mergePR()` line 195
  6. `approvePR()` line 227
  7. `fetchPRList()` line 253
- All existing try/catch blocks and error handling patterns remain

### Step 4: Apply `execWithRetry` to `adws/github/githubApi.ts` (Spec Step 4)

- Keep `import { execSync } from 'child_process';` (still needed for `getRepoInfo()` — local git command, not a network call)
- Add: `import { execWithRetry } from '../core';`
- Replace ONLY the `execSync` call in `getAuthenticatedUser()` line 72:
  - Change: `const login = execSync('gh api user --jq .login', { encoding: 'utf-8' }).trim();`
  - To: `const login = execWithRetry('gh api user --jq .login');`

### Step 5: Apply `execWithRetry` to `adws/providers/github/githubCodeHost.ts` and add existing PR check (Spec Steps 5-6)

- Remove `import { execSync } from 'child_process';` (line 6)
- Add: `import { execWithRetry, log } from '../../core';`
- In `createMergeRequest()`, add existing PR check immediately after `refreshTokenIfNeeded()` (before the temp file creation):

```typescript
// Check for existing PR before creating a new one
try {
  const existingPrs = execWithRetry(
    `gh pr list --head "${options.sourceBranch}" --repo ${this.repoInfo.owner}/${this.repoInfo.repo} --json url,number --limit 1`,
  );
  const parsed = JSON.parse(existingPrs) as { url: string; number: number }[];
  if (parsed.length > 0) {
    log(`Existing PR found for branch '${options.sourceBranch}': ${parsed[0].url}, reusing`, 'info');
    return { url: parsed[0].url, number: parsed[0].number };
  }
} catch {
  // If listing fails, proceed with creation
}
```

- Replace the `execSync(gh pr create ...)` call (lines 90-93) with `execWithRetry`:
  - Change: `const prUrl = execSync(\`gh pr create ...\`, { encoding: 'utf-8', shell: '/bin/bash' }).trim();`
  - To: `const prUrl = execWithRetry(\`gh pr create ...\`, { shell: '/bin/bash' });`

### Step 6: Upgrade Claude CLI ENOENT retry in `adws/agents/claudeAgent.ts` (Spec Step 7)

- Replace the single ENOENT retry block (lines 116-126) with a 3-attempt loop:

```typescript
// Retry up to 3 times on ENOENT (CLI auto-update replaces symlink target)
if (!result.success && result.output.includes('ENOENT')) {
  const maxEnoentAttempts = 3;
  let lastResult = result;
  for (let attempt = 1; attempt <= maxEnoentAttempts; attempt++) {
    const backoffMs = 500 * Math.pow(2, attempt - 1);
    log(`Claude CLI ENOENT retry ${attempt}/${maxEnoentAttempts}: re-resolving path after ${backoffMs}ms...`, 'warn');
    clearClaudeCodePathCache();
    await delay(backoffMs);
    const retryPath = resolveClaudeCodePath();
    log(`  Resolved CLI path: ${retryPath}`, 'info');
    const retryProcess = spawn(retryPath, cliArgs, spawnOptions);
    lastResult = await handleAgentProcess(retryProcess, agentName, outputFile, onProgress, statePath, model);
    if (lastResult.success || !lastResult.output.includes('ENOENT')) {
      return lastResult;
    }
  }
  log(`Claude CLI ENOENT persisted after ${maxEnoentAttempts} retries`, 'error');
  return lastResult;
}
```

### Step 7: Add pre-flight Claude CLI validation in `adws/phases/workflowInit.ts` (Spec Step 8)

- Add `resolveClaudeCodePath` to the import from `'../core'` (add to the existing import block at lines 7-26)
- Add `import { accessSync, constants as fsConstants } from 'fs';`
- After the `ensureLogsDirectory` call (after line 145) and before the target repo workspace setup (before line 148), add:

```typescript
// Pre-flight check: verify Claude CLI is accessible before running any agents
try {
  const claudePath = resolveClaudeCodePath();
  accessSync(claudePath, fsConstants.X_OK);
  log(`Pre-flight check passed: Claude CLI at ${claudePath}`, 'info');
} catch (error) {
  throw new Error(
    `Pre-flight check failed: Claude CLI not found or not executable. Ensure 'claude' is installed and in PATH, or set CLAUDE_CODE_PATH in .env. Error: ${error}`
  );
}
```

### Step 8: Switch worktree creation to use `origin/<defaultBranch>` (Spec Step 9)

In `adws/vcs/worktreeCreation.ts`:

**In `createWorktree()`** at lines 141-144, when creating a new branch from baseBranch:
- Before the `git worktree add -b` command, add a fetch:
  ```typescript
  execSync(`git fetch origin "${baseBranch}"`, gitOpts);
  ```
- Change the base ref from `"${baseBranch}"` to `"origin/${baseBranch}"`:
  ```typescript
  execSync(`git worktree add -b "${branchName}" "${worktreePath}" "origin/${baseBranch}"`, gitOpts);
  ```
- After creation, log a warning if local and remote differ:
  ```typescript
  try {
    const localRef = execSync(`git rev-parse "${baseBranch}"`, gitOpts).toString().trim();
    const remoteRef = execSync(`git rev-parse "origin/${baseBranch}"`, gitOpts).toString().trim();
    if (localRef !== remoteRef) {
      log(`Warning: local '${baseBranch}' (${localRef.slice(0, 8)}) differs from origin/${baseBranch} (${remoteRef.slice(0, 8)}). Worktree uses remote.`, 'warn');
    }
  } catch { /* non-blocking comparison */ }
  ```

**In `createWorktreeForNewBranch()`** at lines 179-182:
- Change to fetch and use `origin/${baseBranch}` when a baseBranch is provided:
  ```typescript
  const gitOpts = baseRepoPath ? { stdio: 'pipe' as const, cwd: baseRepoPath } : { stdio: 'pipe' as const };
  let base = baseBranch || 'HEAD';
  if (baseBranch) {
    try {
      execSync(`git fetch origin "${baseBranch}"`, gitOpts);
      base = `origin/${baseBranch}`;
    } catch {
      log(`Warning: could not fetch origin/${baseBranch}, falling back to local ref`, 'warn');
    }
  }
  execSync(`git worktree add -b "${branchName}" "${worktreePath}" "${base}"`, gitOpts);
  ```

### Step 9: Add graceful degradation to `parseResolutionResult()` (Spec Step 10)

In `adws/agents/resolutionAgent.ts`:
- Add import: `import { log } from "../core/logger";`
- Replace the `parseResolutionResult()` function body (lines 39-49):

Change from throwing to returning a fallback:
```typescript
export function parseResolutionResult(agentOutput: string): ResolutionResult {
  const parsed = extractJson<ResolutionResult>(agentOutput);
  if (!parsed || typeof parsed.resolved !== "boolean") {
    const preview = agentOutput.substring(0, 200);
    log(`Resolution agent returned non-JSON output, treating as unresolved: ${preview}`, "warn");
    return { resolved: false, decisions: [] };
  }
  return {
    resolved: parsed.resolved,
    decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
  };
}
```

### Step 10: Add agent retry on JSON parse failure (Spec Step 11)

**In `adws/agents/resolutionAgent.ts` `runResolutionAgent()`:**
- Replace lines 82-83 with retry logic:

```typescript
let resolutionResult = parseResolutionResult(result.output);

// Retry once if the agent returned non-JSON output
if (!resolutionResult.resolved && resolutionResult.decisions.length === 0 && extractJson(result.output) === null) {
  log("Resolution agent returned non-JSON output, retrying once...", "warn");
  const retryResult = await runClaudeAgentWithCommand(
    "/resolve_plan_scenarios",
    formatResolutionArgs(adwId, issueNumber, planFilePath, scenarioGlob, issueJson, mismatches),
    "resolution-agent",
    outputFile,
    model,
    effort,
    undefined,
    statePath,
    cwd,
  );
  resolutionResult = parseResolutionResult(retryResult.output);
}

return { ...result, resolutionResult };
```

**In `adws/agents/validationAgent.ts` `runValidationAgent()`:**
- Add import: `import { extractJson } from "../core/jsonParser";`
- Replace lines 140-141 with retry logic:

```typescript
let validationResult = parseValidationResult(result.output);

// Retry once if the agent returned non-JSON output
if (!validationResult.aligned && extractJson(result.output) === null) {
  log("Validation agent returned non-JSON output, retrying once...", "warn");
  const retryResult = await runClaudeAgentWithCommand(
    "/validate_plan_scenarios",
    formatValidationArgs(adwId, issueNumber, planFilePath, scenarioGlob),
    "validation-agent",
    outputFile,
    model,
    effort,
    undefined,
    statePath,
    cwd,
  );
  validationResult = parseValidationResult(retryResult.output);
}

return { ...result, validationResult };
```

### Step 11: Guard against undefined review issue array elements (Spec Step 12)

In `adws/agents/reviewRetry.ts` `mergeReviewResults()`:
- Add a null guard filter after `.flatMap()` for review issues (line 84):
  ```typescript
  const mergedIssues = validResults
    .flatMap(r => r.reviewResult!.reviewIssues)
    .filter((issue): issue is ReviewIssue => issue != null)
    .filter(issue => {
  ```
- Add a null guard filter for screenshots (line 95):
  ```typescript
  const mergedScreenshots = validResults
    .flatMap(r => r.reviewResult!.screenshots)
    .filter((screenshot): screenshot is string => screenshot != null)
    .filter(screenshot => {
  ```

### Step 12: Write skip reason files on auto-merge early exits (Spec Step 13)

**In `adws/triggers/autoMergeHandler.ts` `handleApprovedReview()`:**
- Add import: `import { writeFileSync } from 'fs';`
- Move `adwId` and `logsDir` creation (lines 223-224) to just after `prDetails` is fetched (after line 215), before the PR state check:

```typescript
const { headBranch, baseBranch } = prDetails;
const adwId = generateAdwId(`auto-merge-pr-${prNumber}`);
const logsDir = ensureLogsDirectory(adwId);
```

- Add `skip_reason.txt` writes before existing early returns:
  - After the PR state check (lines 217-219):
    ```typescript
    if (prDetails.state === 'CLOSED' || prDetails.state === 'MERGED') {
      writeFileSync(path.join(logsDir, 'skip_reason.txt'), `PR already ${prDetails.state}, skipping auto-merge`, 'utf-8');
      log(`PR #${prNumber} is already ${prDetails.state}, skipping auto-merge`, 'info');
      return;
    }
    ```
  - After worktree failure (lines 232-235):
    ```typescript
    } catch (error) {
      writeFileSync(path.join(logsDir, 'skip_reason.txt'), `Worktree creation failed for branch: ${headBranch}`, 'utf-8');
      log(`handleApprovedReview: failed to ensure worktree for '${headBranch}': ${error}`, 'error');
      return;
    }
    ```

**In `adws/phases/autoMergePhase.ts` `executeAutoMergePhase()`:**
- Add imports: `import { writeFileSync } from 'fs';` and `import * as path from 'path';`
- On the missing PR URL early return (lines 47-49), add before return:
  ```typescript
  writeFileSync(path.join(logsDir, 'skip_reason.txt'), 'No PR URL found, skipping auto-merge', 'utf-8');
  ```
- On the missing repo context early return (lines 54-56), add before return:
  ```typescript
  writeFileSync(path.join(logsDir, 'skip_reason.txt'), 'No repo context available, skipping auto-merge', 'utf-8');
  ```

### Step 13: Run validation commands (Spec Step 14)

Execute every validation command to verify zero regressions:
- `bun run lint`
- `bun run build`
- `bunx tsc --noEmit`
- `bunx tsc --noEmit -p adws/tsconfig.json`
- Fix any issues found until all commands pass cleanly

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `bun run lint` — Code quality check passes
2. `bun run build` — Build succeeds with no errors
3. `bunx tsc --noEmit` — Root TypeScript type checking passes
4. `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type checking passes

## Patch Scope
**Lines of code to change:** ~300-350 lines across 14 files
**Risk level:** medium (many files touched but each change is mechanical and follows established patterns)
**Testing required:** TypeScript compilation + linting (unit tests disabled per `.adw/project.md`). The `execWithRetry` utility follows the proven `exchangeRates.ts` retry pattern. Each change preserves existing error handling semantics.
