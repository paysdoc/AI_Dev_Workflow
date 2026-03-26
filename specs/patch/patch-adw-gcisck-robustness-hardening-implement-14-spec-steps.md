# Patch: Implement all 14 spec steps for robustness hardening

## Metadata
adwId: `gcisck-robustness-hardening`
reviewChangeRequest: `specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md`

## Issue Summary
**Original Spec:** `specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md`
**Issue:** No source code implementation exists for any of the 14 spec steps. Only the BDD feature file was written — all acceptance criteria remain unmet. The `execWithRetry` utility was never created, and zero changes were made to any of the target source files.
**Solution:** Implement all 14 steps from the spec in order: create `execWithRetry`, apply it to GitHub CLI callers, add existing PR check, upgrade Claude CLI ENOENT retry, add pre-flight validation, switch worktree base to `origin/<default>`, add graceful degradation to resolution agent, add agent retry on JSON parse failure, guard undefined review issues, write skip reason files, and run validation commands.

## Files to Modify

1. `adws/core/utils.ts` — Add `execWithRetry` utility function
2. `adws/core/index.ts` — Re-export `execWithRetry`
3. `adws/github/issueApi.ts` — Replace 7 `execSync` calls with `execWithRetry`
4. `adws/github/prApi.ts` — Replace 7 `execSync` calls with `execWithRetry`
5. `adws/github/githubApi.ts` — Replace `gh api user` `execSync` with `execWithRetry` (NOT `git remote get-url`)
6. `adws/providers/github/githubCodeHost.ts` — Replace `gh pr create` with `execWithRetry` + add existing PR check
7. `adws/agents/claudeAgent.ts` — Upgrade ENOENT retry to 3 attempts with per-attempt path re-resolution
8. `adws/phases/workflowInit.ts` — Add pre-flight Claude CLI validation
9. `adws/vcs/worktreeCreation.ts` — Switch to `origin/<defaultBranch>` base ref with `git fetch`
10. `adws/agents/resolutionAgent.ts` — Add graceful degradation fallback on invalid JSON
11. `adws/agents/validationAgent.ts` — Add retry on non-JSON agent output
12. `adws/agents/reviewRetry.ts` — Filter undefined/null from review issues and screenshots arrays
13. `adws/triggers/autoMergeHandler.ts` — Write `skip_reason.txt` on early exits after `ensureLogsDirectory()`
14. `adws/phases/autoMergePhase.ts` — Write `skip_reason.txt` on early exits

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Create `execWithRetry` utility and export it (Spec Steps 1)
- In `adws/core/utils.ts`, add a new exported function:
  ```typescript
  export function execWithRetry(
    command: string,
    options?: ExecSyncOptions & { maxAttempts?: number }
  ): string {
    const maxAttempts = options?.maxAttempts ?? 3;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return execSync(command, { encoding: "utf-8", ...options }).toString().trim();
      } catch (error) {
        if (attempt < maxAttempts - 1) {
          const delayMs = 500 * Math.pow(2, attempt); // 500ms, 1000ms, 2000ms
          log("warn", `execWithRetry: attempt ${attempt + 1}/${maxAttempts} failed for command, retrying in ${delayMs}ms...`);
          const start = Date.now();
          while (Date.now() - start < delayMs) {} // sync sleep
        } else {
          throw error;
        }
      }
    }
    throw new Error("execWithRetry: unreachable");
  }
  ```
- Import `execSync` and `ExecSyncOptions` from `child_process` at the top of `utils.ts`
- Import `log` from `./logger` (already re-exported but may need direct import)
- In `adws/core/index.ts`, add `execWithRetry` to the re-exports from `./utils`

### Step 2: Apply `execWithRetry` to GitHub CLI callers (Spec Steps 2-5)
- **`adws/github/issueApi.ts`**: Replace all 7 `execSync` calls for `gh` commands with `execWithRetry`. Preserve existing error handling (try-catch patterns remain, `execWithRetry` handles transient retries before the error propagates).
- **`adws/github/prApi.ts`**: Replace all 7 `execSync` calls for `gh` commands with `execWithRetry`. Note: `approvePR()` temporarily unsets `GH_TOKEN` — ensure the env manipulation still works with `execWithRetry`.
- **`adws/github/githubApi.ts`**: Replace only the `gh api user` `execSync` call in `getAuthenticatedUser()` (~line 72). Do NOT change the `git remote get-url origin` call (local git, not network).
- **`adws/providers/github/githubCodeHost.ts`**: Replace the `gh pr create` `execSync` call in `createMergeRequest()` (~line 90) with `execWithRetry`.
- Update imports in all four files: add `execWithRetry` import from `../../core/utils` (or appropriate relative path).

### Step 3: Add existing PR check + ENOENT retry upgrade + pre-flight + worktree origin (Spec Steps 6-9)
- **Step 6 — Existing PR check** in `githubCodeHost.ts` `createMergeRequest()`: Before the `gh pr create` call, run `execWithRetry('gh pr list --head ${sourceBranch} --repo ${owner}/${repo} --json url,number --limit 1')`. If result is a non-empty JSON array, return the existing PR's url and number. Log reuse.
- **Step 7 — Claude CLI ENOENT retry** in `claudeAgent.ts`: Replace the single ENOENT retry block (~lines 116-126) with a 3-attempt loop. On each attempt: call `clearClaudeCodePathCache()`, then `resolveClaudeCodePath()` to get fresh path, then `await delay(500 * Math.pow(2, attempt))`, then re-run agent. Log each attempt with resolved path.
- **Step 8 — Pre-flight validation** in `workflowInit.ts` `initializeWorkflow()`: After `ensureLogsDirectory()` (~line 145) and before workspace setup, call `resolveClaudeCodePath()` and verify with `fs.accessSync(path, fs.constants.X_OK)`. Throw clear error if not found/not executable. Import `resolveClaudeCodePath` from `../core` and `accessSync, constants` from `fs`.
- **Step 9 — Worktree origin base** in `worktreeCreation.ts`: In both `createWorktree()` and `createWorktreeForNewBranch()`, run `execSync('git fetch origin "${baseBranch}"')` before worktree creation, then use `origin/${baseBranch}` as the base ref instead of `baseBranch`. Log warning if local differs from remote.

### Step 4: Agent graceful degradation + review guards + skip reason files (Spec Steps 10-13)
- **Step 10 — Resolution agent degradation** in `resolutionAgent.ts` `parseResolutionResult()`: Instead of throwing on invalid JSON, return `{ resolved: false, decisions: [] }` with a warning log. Mirror the `validationAgent.ts` fallback pattern.
- **Step 11 — Agent retry on JSON parse failure**: In `resolutionAgent.ts` `runResolutionAgent()`, if parse returns the fallback (resolved=false, decisions empty) and `extractJson()` returned null, re-run the agent once. Log the retry. In `validationAgent.ts` `runValidationAgent()`, if parse returns fallback and output contains "did not return valid JSON", re-run agent once.
- **Step 12 — Guard undefined review issues** in `reviewRetry.ts` `mergeReviewResults()`: Change `.flatMap(r => r.reviewResult!.reviewIssues)` to `.flatMap(r => r.reviewResult!.reviewIssues).filter((issue): issue is ReviewIssue => issue != null)`. Same for screenshots: `.filter((s): s is string => s != null)`.
- **Step 13 — Skip reason files**: In `autoMergeHandler.ts`, after `ensureLogsDirectory()`, write `skip_reason.txt` to the log directory before each early return (PR merged, worktree failure, missing PR URL, missing repo context). In `autoMergePhase.ts`, write `skip_reason.txt` to `config.logsDir` on early returns for missing PR URL and missing repo context. Use `fs.writeFileSync(path.join(logsDir, 'skip_reason.txt'), reason)`.

### Step 5: Run validation commands (Spec Step 14)
- `bun run lint` — verify no code quality issues
- `bun run build` — verify no build errors
- `bunx tsc --noEmit` — root TypeScript type checking
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type checking
- Fix any issues found until all commands pass cleanly

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `bun run lint` — Code quality check passes
2. `bun run build` — Build succeeds with no errors
3. `bunx tsc --noEmit` — Root TypeScript type checking passes
4. `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type checking passes
5. `grep -r "execWithRetry" adws/ --include="*.ts" | wc -l` — Verify `execWithRetry` is used in at least 5 files (utils.ts, index.ts, issueApi.ts, prApi.ts, githubApi.ts, githubCodeHost.ts)

## Patch Scope
**Lines of code to change:** ~350-450 lines across 14 files
**Risk level:** medium (touches many files but each change is small and follows established patterns)
**Testing required:** TypeScript compilation + linting (unit tests disabled per `.adw/project.md`). BDD scenarios exist but require mock infrastructure. The `exchangeRates.ts` retry pattern is the proven reference implementation.
