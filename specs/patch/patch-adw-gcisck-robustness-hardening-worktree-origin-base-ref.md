# Patch: Use origin/<defaultBranch> as base ref for worktree creation

## Metadata
adwId: `gcisck-robustness-hardening`
reviewChangeRequest: `Issue #6: Worktree creation still uses local branch ref instead of origin/<defaultBranch> in adws/vcs/worktreeCreation.ts. Dirty local branches can cause worktree creation failures.`

## Issue Summary
**Original Spec:** specs/issue-315-adw-gcisck-robustness-hardening-sdlc_planner-retry-logic-resilience.md
**Issue:** `createWorktree()` (line 143) and `createWorktreeForNewBranch()` (line 182) pass the raw `baseBranch` string (e.g., `main`) to `git worktree add`. If the local `main` is dirty, has unresolved conflicts, or is behind remote, the new worktree inherits that dirty state or fails outright.
**Solution:** Prepend `origin/` to `baseBranch` so worktrees always start from the clean remote ref. Run `git fetch origin` before creation to ensure the remote ref is current. Log a warning if local and remote HEADs differ.

## Files to Modify
- `adws/vcs/worktreeCreation.ts` — Both `createWorktree()` and `createWorktreeForNewBranch()` functions

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add helper to fetch and warn on local/remote divergence
- At the top of `worktreeCreation.ts` (after imports), add a helper function `fetchAndWarnDivergence(baseBranch: string, gitOpts: object)`:
  - Runs `git fetch origin "${baseBranch}"` to update the remote tracking ref
  - Compares local `git rev-parse "${baseBranch}"` with `git rev-parse "origin/${baseBranch}"` (both wrapped in try/catch — local ref may not exist)
  - If both exist and differ, logs a warning: `Local branch '${baseBranch}' differs from 'origin/${baseBranch}'. Worktree will use remote ref.`
  - If fetch fails, log warning but don't throw — let the worktree add command surface the real error

### Step 2: Update `createWorktree()` to use `origin/<baseBranch>`
- In the `else if (baseBranch)` block (line 141–144):
  - Before the `git worktree add` call, invoke `fetchAndWarnDivergence(baseBranch, gitOpts)`
  - Change the git command from:
    `git worktree add -b "${branchName}" "${worktreePath}" "${baseBranch}"`
    to:
    `git worktree add -b "${branchName}" "${worktreePath}" "origin/${baseBranch}"`
  - Update the log message to reflect it's from `origin/${baseBranch}`

### Step 3: Update `createWorktreeForNewBranch()` to use `origin/<baseBranch>`
- In `createWorktreeForNewBranch()` (line 180–182):
  - When `baseBranch` is provided, invoke `fetchAndWarnDivergence(baseBranch, gitOpts)` before creating
  - Change `const base = baseBranch || 'HEAD'` to `const base = baseBranch ? \`origin/${baseBranch}\` : 'HEAD'`
  - Update the log message to reflect the origin ref when baseBranch was provided

### Step 4: Run validation commands
- Run `bun run lint` to check for code quality issues
- Run `bunx tsc --noEmit` to verify TypeScript type checking passes
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify adws-specific type checking passes
- Run `bun run build` to verify no build errors

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Root TypeScript type checking
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type checking
- `bun run build` — Build the application to verify no build errors

## Patch Scope
**Lines of code to change:** ~30
**Risk level:** low
**Testing required:** TypeScript compilation, linting, build verification. The change only affects the base ref argument passed to `git worktree add` and adds a pre-fetch + divergence warning. No behavioral change for existing worktrees — only new worktree creation from a base branch is affected.
