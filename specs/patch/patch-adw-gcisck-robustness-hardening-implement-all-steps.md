# Patch: Implement all 14 robustness hardening steps from spec

## Metadata
adwId: `gcisck-robustness-hardening`
reviewChangeRequest: `specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md`

## Issue Summary
**Original Spec:** specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md
**Issue:** All 30 BDD scenarios fail because zero source files were modified. The branch only contains planning artifacts (spec, feature file, cost CSVs). No implementation exists.
**Solution:** Implement all 14 steps from the spec: create `execWithRetry` utility, apply it to gh CLI callers, upgrade Claude CLI ENOENT retry, add pre-flight validation, switch worktree to `origin/<default>`, add existing PR check, add JSON parse graceful degradation, filter undefined review issues, and write auto-merge skip reasons.

## Files to Modify

1. `adws/core/utils.ts` — Add `execWithRetry` utility function
2. `adws/core/index.ts` — Export `execWithRetry`
3. `adws/github/issueApi.ts` — Replace `execSync` with `execWithRetry` for gh CLI calls
4. `adws/github/prApi.ts` — Replace `execSync` with `execWithRetry` for gh CLI calls
5. `adws/github/githubApi.ts` — Replace `execSync` with `execWithRetry` for `gh api user` call
6. `adws/providers/github/githubCodeHost.ts` — Replace `execSync` with `execWithRetry` for `gh pr create`, add existing PR check
7. `adws/agents/claudeAgent.ts` — Upgrade ENOENT retry to 3 attempts with per-attempt path re-resolution
8. `adws/phases/workflowInit.ts` — Add pre-flight Claude CLI validation
9. `adws/vcs/worktreeCreation.ts` — Use `origin/<defaultBranch>` as base ref, fetch before create
10. `adws/agents/resolutionAgent.ts` — Graceful degradation on invalid JSON (return fallback instead of throw)
11. `adws/agents/validationAgent.ts` — Verify existing graceful degradation stays correct (no changes expected)
12. `adws/agents/reviewRetry.ts` — Filter undefined/null entries from review issue and screenshot arrays
13. `adws/triggers/autoMergeHandler.ts` — Write `skip_reason.txt` on early exits after `ensureLogsDirectory()`
14. `adws/phases/autoMergePhase.ts` — Write `skip_reason.txt` on early exits

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Create `execWithRetry` in `adws/core/utils.ts` and export from `adws/core/index.ts`

Add a new exported function to `adws/core/utils.ts`:

```typescript
import { execSync, type ExecSyncOptions } from 'child_process';

export function execWithRetry(
  command: string,
  options?: ExecSyncOptions & { maxAttempts?: number }
): string {
  const { maxAttempts = 3, ...execOptions } = options ?? {};
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return execSync(command, { encoding: 'utf-8', ...execOptions }).trim();
    } catch (error) {
      lastError = error;
      log(`execWithRetry: attempt ${attempt + 1}/${maxAttempts} failed for command: ${command.substring(0, 80)}`, 'error');

      if (attempt < maxAttempts - 1) {
        const delayMs = 500 * Math.pow(2, attempt);
        log(`execWithRetry: retrying in ${delayMs}ms (attempt ${attempt + 2}/${maxAttempts})...`, 'info');
        const start = Date.now();
        while (Date.now() - start < delayMs) { /* sync spin-wait */ }
      }
    }
  }

  throw lastError;
}
```

- Import `execSync` and `ExecSyncOptions` from `child_process` (already imported in utils.ts scope, but add to this function's context)
- Use synchronous spin-wait for delay (matches the synchronous nature of `execSync` callers)
- Follow exponential backoff: 500ms, 1000ms (matching `exchangeRates.ts` pattern)
- Export from `adws/core/index.ts` alongside existing utils exports

### Step 2: Apply `execWithRetry` to `issueApi.ts`, `prApi.ts`, `githubApi.ts`, and `githubCodeHost.ts`

**`adws/github/issueApi.ts`:**
- Replace `import { execSync } from 'child_process'` with `import { execWithRetry } from '../core/utils'`
- Replace all 7 `execSync(` calls that invoke `gh` CLI commands with `execWithRetry(`
- Remove `{ encoding: 'utf-8' }` from the options since `execWithRetry` defaults to utf-8
- For calls that use `input` or custom `stdio`, pass those as options to `execWithRetry`
- Preserve all existing error handling patterns (try/catch returns vs throws)

**`adws/github/prApi.ts`:**
- Replace `import { execSync } from 'child_process'` with `import { execWithRetry } from '../core/utils'`
- Replace all 7 `execSync(` gh CLI calls with `execWithRetry(`
- For `approvePR()`: keep the `GH_TOKEN` swap logic; replace the inner `execSync` with `execWithRetry`
- For calls with `input`/`stdio` options, pass through to `execWithRetry`

**`adws/github/githubApi.ts`:**
- Add `import { execWithRetry } from './issueApi'` or directly from `'../core/utils'`
- Replace `execSync('gh api user --jq .login', ...)` with `execWithRetry('gh api user --jq .login')`
- Do NOT change the `git remote get-url origin` call (local git command, not a network call)

**`adws/providers/github/githubCodeHost.ts`:**
- Add `import { execWithRetry } from '../../core/utils'`
- Replace the `execSync` in `createMergeRequest()` for `gh pr create` with `execWithRetry`

### Step 3: Add existing PR check in `githubCodeHost.ts` `createMergeRequest()`

Before calling `gh pr create`, check for an existing PR:

```typescript
// Check for existing PR before creating a new one
const existingPrJson = execWithRetry(
  `gh pr list --head "${options.sourceBranch}" --repo ${this.repoInfo.owner}/${this.repoInfo.repo} --json url,number --limit 1`,
);
const existingPrs = JSON.parse(existingPrJson) as { url: string; number: number }[];
if (existingPrs.length > 0) {
  log(`Reusing existing PR #${existingPrs[0].number} for branch '${options.sourceBranch}'`, 'info');
  return { url: existingPrs[0].url, number: existingPrs[0].number };
}
```

- Import `log` from `'../../core/utils'`
- Place this check at the top of the `try` block in `createMergeRequest()`, before writing the temp file

### Step 4: Upgrade Claude CLI ENOENT retry in `claudeAgent.ts`

Replace the single ENOENT retry block (lines 116-126) with a 3-attempt loop:

```typescript
if (!result.success && result.output.includes('ENOENT')) {
  const maxEnoentAttempts = 3;
  for (let attempt = 1; attempt < maxEnoentAttempts; attempt++) {
    const delayMs = 500 * Math.pow(2, attempt - 1);
    log(`Claude CLI ENOENT: retrying (attempt ${attempt + 1}/${maxEnoentAttempts}) after ${delayMs}ms...`, 'warn');
    clearClaudeCodePathCache();
    await delay(delayMs);

    const retryPath = resolveClaudeCodePath();
    log(`Claude CLI ENOENT: re-resolved path to ${retryPath}`, 'info');
    const retryProcess = spawn(retryPath, cliArgs, spawnOptions);
    const retryResult = await handleAgentProcess(retryProcess, agentName, outputFile, onProgress, statePath, model);

    if (retryResult.success || !retryResult.output.includes('ENOENT')) {
      return retryResult;
    }
  }
  // All ENOENT retries exhausted
  log(`Claude CLI not found after ${maxEnoentAttempts} attempts`, 'error');
  return result;
}
```

- Call `clearClaudeCodePathCache()` then `resolveClaudeCodePath()` on every attempt
- Use exponential backoff: 500ms, 1000ms
- If a retry succeeds or fails with a non-ENOENT error, return immediately

### Step 5: Add pre-flight Claude CLI validation in `workflowInit.ts`

Early in `initializeWorkflow()`, before the issue fetch (before line ~109):

```typescript
import { accessSync, constants } from 'fs';
import { resolveClaudeCodePath } from '../core';

// Pre-flight: verify Claude CLI is available and executable
try {
  const claudePath = resolveClaudeCodePath();
  accessSync(claudePath, constants.X_OK);
  log(`Pre-flight check: Claude CLI found at ${claudePath}`, 'info');
} catch (error) {
  throw new Error(
    `Pre-flight check failed: Claude CLI not found or not executable. Ensure 'claude' is installed and in PATH, or set CLAUDE_CODE_PATH in .env. Error: ${error}`
  );
}
```

- `resolveClaudeCodePath` is already imported from `'../core'`
- Add `accessSync` and `constants` imports from `'fs'` (fs is already imported indirectly via other modules, but add explicit import)

### Step 6: Switch worktree creation to use `origin/<defaultBranch>`

In `adws/vcs/worktreeCreation.ts`:

**In `createWorktree()`** — when creating a new branch from baseBranch (the `else if (baseBranch)` block at line ~141):
- Before creating, fetch the remote ref: `execSync(\`git fetch origin "${baseBranch}"\`, gitOpts)`
- Change the worktree add command to use `origin/${baseBranch}`: `git worktree add -b "${branchName}" "${worktreePath}" "origin/${baseBranch}"`
- Log a warning if local differs from remote (informational only)

**In `createWorktreeForNewBranch()`** — when baseBranch is provided (line ~180):
- Change `const base = baseBranch || 'HEAD'` to `const base = baseBranch ? \`origin/${baseBranch}\` : 'HEAD'`
- Before creating, if baseBranch is provided, fetch: `execSync(\`git fetch origin "${baseBranch}"\`, gitOpts)`

### Step 7: Add graceful degradation to `parseResolutionResult()` in `resolutionAgent.ts`

Replace the `throw` with a graceful fallback matching `validationAgent.ts` pattern:

```typescript
export function parseResolutionResult(agentOutput: string): ResolutionResult {
  const parsed = extractJson<ResolutionResult>(agentOutput);
  if (!parsed || typeof parsed.resolved !== "boolean") {
    const preview = agentOutput.substring(0, 200);
    log(`Resolution agent returned non-JSON output, treating as unresolved: ${preview}`, "warn");
    return {
      resolved: false,
      decisions: [],
    };
  }
  return {
    resolved: parsed.resolved,
    decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
  };
}
```

- Import `log` from `"../core/logger"` (add import if not already present)

### Step 8: Filter undefined review issue array elements in `reviewRetry.ts`

In `mergeReviewResults()`, add null/undefined filters:

```typescript
// Change line 84:
.flatMap(r => r.reviewResult!.reviewIssues)
// To:
.flatMap(r => r.reviewResult!.reviewIssues).filter((issue): issue is ReviewIssue => issue != null)

// Change line 95:
.flatMap(r => r.reviewResult!.screenshots)
// To:
.flatMap(r => r.reviewResult!.screenshots).filter((s): s is string => s != null)
```

- Import `ReviewIssue` type if not already imported (it is already imported from `'./reviewAgent'`)

### Step 9: Write skip reason files on auto-merge early exits

**`adws/triggers/autoMergeHandler.ts`:**

After `ensureLogsDirectory(adwId)` creates the log directory (line ~224), each subsequent early return should write a reason file. The early returns that happen AFTER `ensureLogsDirectory` are:
- PR already merged/closed (line ~218): write `skip_reason.txt` before returning
- Worktree failure (line ~233): write `skip_reason.txt` before returning

Add at each early return:
```typescript
import { writeFileSync } from 'fs';
// ... at each early return after logsDir is created:
writeFileSync(path.join(logsDir, 'skip_reason.txt'), '<reason text>', 'utf-8');
```

Note: The PR state check (line ~217-219) happens BEFORE `ensureLogsDirectory` in the current code. Reorder so `ensureLogsDirectory` happens earlier, or only add skip_reason.txt to the returns that happen after logsDir exists.

**`adws/phases/autoMergePhase.ts`:**

At the early return for missing PR URL (line ~48) and missing repo context (line ~55):
```typescript
import * as fs from 'fs';
import * as path from 'path';
// ... at each early return:
fs.writeFileSync(path.join(logsDir, 'skip_reason.txt'), '<reason text>', 'utf-8');
```

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `bun run lint` — Run linter to check for code quality issues
2. `bun run build` — Build the application to verify no build errors
3. `bunx tsc --noEmit` — Root TypeScript type checking
4. `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type checking
5. `bunx cucumber-js --tags '@adw-gcisck-robustness-hardening and @regression' --dry-run` — Verify BDD scenarios have matching step definitions (dry run)

## Patch Scope
**Lines of code to change:** ~250-350
**Risk level:** medium
**Testing required:** TypeScript compilation, linting, BDD scenario dry-run. No unit tests (disabled per project config). Full BDD scenario execution will be validated by the review proof phase.
