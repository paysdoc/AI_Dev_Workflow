# Patch: Switch worktree creation to origin/<defaultBranch> base ref

## Metadata
adwId: `gcisck-robustness-hardening`
reviewChangeRequest: `Issue #6: Worktree origin base ref (spec Step 9) not implemented. worktreeCreation.ts still uses local baseBranch ref instead of origin/<defaultBranch>. Resolution: Change createWorktree() and createWorktreeForNewBranch() to use origin/${baseBranch} as base ref, adding git fetch origin before creation.`

## Issue Summary
**Original Spec:** specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md
**Issue:** `createWorktree()` (line 143) and `createWorktreeForNewBranch()` (line 182) pass the raw `baseBranch` string (e.g., `main`) to `git worktree add`. If the local default branch is dirty, has unresolved conflicts, or is behind remote, the new worktree inherits dirty state or fails outright.
**Solution:** Add a `fetchAndWarnDivergence()` helper that fetches from origin and warns if local/remote differ. Use `origin/${baseBranch}` as the base ref in both functions so worktrees always start from the clean remote ref.

## Files to Modify
- `adws/vcs/worktreeCreation.ts` — `createWorktree()` and `createWorktreeForNewBranch()`

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add `fetchAndWarnDivergence` helper function
- After the imports in `worktreeCreation.ts` (after line 16), add a helper:
  ```typescript
  function fetchAndWarnDivergence(baseBranch: string, gitOpts: { stdio: 'pipe'; cwd?: string }): void {
    try {
      execSync(`git fetch origin "${baseBranch}"`, gitOpts);
    } catch {
      log(`Warning: could not fetch origin/${baseBranch} — worktree will use last known remote ref`, 'warn');
      return;
    }
    try {
      const local = execSync(`git rev-parse "${baseBranch}"`, gitOpts).toString().trim();
      const remote = execSync(`git rev-parse "origin/${baseBranch}"`, gitOpts).toString().trim();
      if (local !== remote) {
        log(`Local branch '${baseBranch}' (${local.slice(0, 8)}) differs from 'origin/${baseBranch}' (${remote.slice(0, 8)}). Worktree will use remote ref.`, 'warn');
      }
    } catch {
      // Local ref may not exist — not an error
    }
  }
  ```

### Step 2: Update `createWorktree()` to use `origin/${baseBranch}`
- In the `else if (baseBranch)` block (lines 141-144):
  - Before the `git worktree add` call, invoke `fetchAndWarnDivergence(baseBranch, gitOpts)`
  - Change line 143 from:
    `git worktree add -b "${branchName}" "${worktreePath}" "${baseBranch}"`
    to:
    `git worktree add -b "${branchName}" "${worktreePath}" "origin/${baseBranch}"`
  - Update the log message on line 144 to say `from 'origin/${baseBranch}'`

### Step 3: Update `createWorktreeForNewBranch()` to use `origin/${baseBranch}`
- In `createWorktreeForNewBranch()` (lines 179-183):
  - When `baseBranch` is provided, invoke `fetchAndWarnDivergence(baseBranch, gitOpts)` before the `git worktree add` call
  - Change line 180 from:
    `const base = baseBranch || 'HEAD';`
    to:
    `const base = baseBranch ? \`origin/${baseBranch}\` : 'HEAD';`
  - If `baseBranch` is truthy, add `fetchAndWarnDivergence(baseBranch, gitOpts)` before the exec call
  - Update the log message to reflect `origin/${baseBranch}` when baseBranch was provided

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Root TypeScript type checking
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type checking
- `bun run build` — Build the application to verify no build errors

## Patch Scope
**Lines of code to change:** ~25
**Risk level:** low
**Testing required:** TypeScript compilation, linting, build verification. Only affects new worktree creation from a base branch — existing worktrees are unaffected. The `fetchAndWarnDivergence` helper is non-blocking (catches fetch failures and logs warnings instead of throwing).
