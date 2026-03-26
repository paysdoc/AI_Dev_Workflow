# Patch: Write skip_reason.txt on auto-merge early exits

## Metadata
adwId: `gcisck-robustness-hardening`
reviewChangeRequest: `Issue #10: Skip reason files (spec Step 13) not implemented. autoMergeHandler.ts and autoMergePhase.ts early exits do not write skip_reason.txt to log directories.`

## Issue Summary
**Original Spec:** `specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md`
**Issue:** `autoMergeHandler.ts` and `autoMergePhase.ts` early exits after `ensureLogsDirectory()` (or when `config.logsDir` is already available) leave empty log directories with zero visibility into why the auto-merge was skipped.
**Solution:** Write a `skip_reason.txt` file to the log directory before each early return, containing the specific reason for skipping.

## Files to Modify

- `adws/triggers/autoMergeHandler.ts` — Add `skip_reason.txt` write before worktree failure early return (line ~233)
- `adws/phases/autoMergePhase.ts` — Add `skip_reason.txt` writes before no-PR-URL (line ~48) and no-repo-context (line ~55) early returns; add `fs` and `path` imports

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add skip_reason.txt write on worktree failure in `autoMergeHandler.ts`
- Add `writeFileSync` import from `'fs'` at the top of the file:
  ```typescript
  import { writeFileSync } from 'fs';
  ```
- `path` is already imported in this file.
- At line 233 (inside the `catch` block after `ensureWorktree` fails), before the `return;` statement, add:
  ```typescript
  writeFileSync(path.join(logsDir, 'skip_reason.txt'), `Worktree creation failed for branch: ${headBranch}\n${error}`);
  ```

### Step 2: Add skip_reason.txt writes on early exits in `autoMergePhase.ts`
- Add imports at the top of the file:
  ```typescript
  import { writeFileSync } from 'fs';
  import * as path from 'path';
  ```
- Before the early return at line ~48 (no PR URL), add:
  ```typescript
  writeFileSync(path.join(logsDir, 'skip_reason.txt'), 'No PR URL found, skipping auto-merge');
  ```
- Before the early return at line ~55 (no repo context), add:
  ```typescript
  writeFileSync(path.join(logsDir, 'skip_reason.txt'), 'No repo context available, skipping auto-merge');
  ```

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors
- `bunx tsc --noEmit` — Root TypeScript type checking
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type checking

## Patch Scope
**Lines of code to change:** ~8 (2 imports + 3 writeFileSync calls + minor formatting)
**Risk level:** low
**Testing required:** TypeScript compilation and linting only (unit tests disabled per `.adw/project.md`)
