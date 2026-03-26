# Patch: Write skip_reason.txt on auto-merge early exits

## Metadata
adwId: `gcisck-robustness-hardening`
reviewChangeRequest: `Issue #10: Auto-merge early exits in autoMergeHandler.ts and autoMergePhase.ts do not write skip_reason.txt files, leaving empty log directories with no visibility into what happened. Resolution: Write skip_reason.txt to log directory before each early return in handleApprovedReview() and executeAutoMergePhase() with descriptive reason strings.`

## Issue Summary
**Original Spec:** specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md
**Issue:** After `ensureLogsDirectory()` creates a log directory, early returns in `handleApprovedReview()` and `executeAutoMergePhase()` exit without writing any files — leaving empty directories with zero visibility into why the auto-merge was skipped.
**Solution:** Write a `skip_reason.txt` file to the log directory before each early return that occurs after the log directory exists. Only 3 early returns qualify: worktree failure in `handleApprovedReview()`, and missing PR URL / missing repo context in `executeAutoMergePhase()`.

## Files to Modify

- `adws/triggers/autoMergeHandler.ts` — Add `skip_reason.txt` write before worktree failure early return (line 234)
- `adws/phases/autoMergePhase.ts` — Add `skip_reason.txt` writes before no-PR-URL (line 48) and no-repo-context (line 55) early returns

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add skip_reason.txt write on worktree failure in `autoMergeHandler.ts`
- Add `import * as fs from 'fs';` to the existing imports
- Before the `return;` at line 234 (worktree creation failed), add:
  ```ts
  fs.writeFileSync(path.join(logsDir, 'skip_reason.txt'), `Worktree creation failed for branch: ${headBranch}\n`, 'utf-8');
  ```
- Note: `path` is already imported. The `logsDir` variable is assigned at line 224 (before this early return). `headBranch` is from `prDetails` at line 222.

### Step 2: Add skip_reason.txt writes on early returns in `autoMergePhase.ts`
- Add `import * as fs from 'fs';` and `import * as path from 'path';` to the existing imports
- Before the `return` at line 49 (no PR URL), add:
  ```ts
  fs.writeFileSync(path.join(logsDir, 'skip_reason.txt'), 'No PR URL found, skipping auto-merge\n', 'utf-8');
  ```
- Before the `return` at line 56 (no repo context), add:
  ```ts
  fs.writeFileSync(path.join(logsDir, 'skip_reason.txt'), 'No repo context available, skipping auto-merge\n', 'utf-8');
  ```

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `bun run lint` — Run linter to check for code quality issues
2. `bun run build` — Build the application to verify no build errors
3. `bunx tsc --noEmit` — Root TypeScript type checking
4. `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type checking

## Patch Scope
**Lines of code to change:** ~8 (2 imports + 3 writeFileSync calls + 1 import in second file)
**Risk level:** low
**Testing required:** TypeScript compilation and linting. No runtime behavior changes for the happy path — only adds file writes on early-exit paths.
