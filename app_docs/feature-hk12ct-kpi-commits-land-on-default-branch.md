# KPI Commits Land on Default Branch

**ADW ID:** hk12ct-kpi-commits-land-on
**Date:** 2026-04-21
**Specification:** specs/issue-486-adw-hk12ct-kpi-commits-land-on-sdlc_planner-kpi-commits-default-branch.md

## Overview

Fixes a bug where `commitAndPushKpiFile()` pushed `app_docs/agentic_kpis.md` to whichever branch ADW was currently checked out on instead of the repo's default branch. The fix rewrites the function to use a temporary detached worktree on `origin/<defaultBranch>`, ensuring KPI commits always land on the default branch without ever touching the active working tree's index or `HEAD`.

## What Was Built

- Rewritten `commitAndPushKpiFile()` in `adws/vcs/commitOperations.ts` that uses a temp detached worktree
- Three file-local helpers: `hasKpiFileChanges`, `createKpiTempWorktree` (inlined into main fn), `cleanupKpiTempWorktree`
- New unit test suite `adws/vcs/__tests__/commitOperations.test.ts` covering the full command sequence, cleanup, non-fatal contract, and the regression gate (push target correctness)
- New BDD feature file `features/kpi_commits_land_on_default_branch.feature` with `@adw-486 @regression` scenarios verifying source-shape invariants

## Technical Implementation

### Files Modified

- `adws/vcs/commitOperations.ts`: Rewrote `commitAndPushKpiFile()` to use a temp detached worktree; replaced `getCurrentBranch` import with `getDefaultBranch`; added `fs`, `os`, `path` imports; added `hasKpiFileChanges` and `cleanupKpiTempWorktree` helpers
- `features/push_adw_kpis.feature`: Added `@adw-486` tag to the push-to-remote and non-fatal-failure scenarios so they participate in the regression run

### New Files

- `adws/vcs/__tests__/commitOperations.test.ts`: Unit tests for the rewritten `commitAndPushKpiFile()` using the `vi.mock('child_process')` + `vi.mock('fs')` pattern from `worktreeReset.test.ts`
- `features/kpi_commits_land_on_default_branch.feature`: BDD regression coverage for the default-branch targeting invariants

### Key Changes

- **Default branch resolution**: replaced `getCurrentBranch(cwd)` with `getDefaultBranch(cwd)` (calls `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`)
- **Detached worktree isolation**: `git worktree add --detach <tmpdir> origin/<defaultBranch>` creates an isolated index and `HEAD` so the active worktree is never mutated mid-workflow
- **Push by refspec**: `git push origin HEAD:"<defaultBranch>"` explicitly targets the remote default branch from a detached `HEAD` (no upstream tracking branch needed)
- **Cleanup in `finally`**: `cleanupKpiTempWorktree` runs in a `finally` block; both `git worktree remove --force` and `fs.rmSync` are each wrapped in their own try/catch so cleanup never throws
- **Non-fatal contract preserved**: the outer try/catch returns `false` and logs a warning for every failure mode; nothing propagates to the orchestrator

## How to Use

The KPI phase (`adws/phases/kpiPhase.ts`) calls `commitAndPushKpiFile()` with no arguments — no caller changes are needed. The function now:

1. Checks if `app_docs/agentic_kpis.md` has uncommitted changes via `git status --porcelain`; returns `false` immediately if not
2. Resolves the default branch via `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`
3. Fetches `origin/<defaultBranch>` in the source worktree
4. Creates a temp detached worktree on `origin/<defaultBranch>`
5. Copies `app_docs/agentic_kpis.md` into the temp worktree and commits + pushes via `git push origin HEAD:"<defaultBranch>"`
6. Removes the temp worktree in a `finally` block

## Configuration

No configuration changes. The default branch is resolved at runtime via `gh`; whatever `gh repo view --json defaultBranchRef -q .defaultBranchRef.name` returns is the push target.

## Testing

```bash
# Unit tests (command-sequence regression gate)
bun run test:unit adws/vcs/__tests__/commitOperations.test.ts

# BDD regression for this issue
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-486"

# Full regression suite
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"

# Type check
bunx tsc --noEmit
```

**Manual gate**: run any SDLC orchestrator from a non-default branch. After the KPI phase, `git log --oneline -3` on the feature branch must NOT include a `kpis: update agentic_kpis` commit. `git log --oneline -3 origin/<default-branch>` must include it.

## Notes

- **Concurrent-run race**: if two ADW orchestrators push KPI commits simultaneously, one push may fail with "non-fast-forward". This is accepted as non-fatal — the next workflow run re-pushes the up-to-date file.
- **Default branch already checked out**: `--detach` sidesteps `git worktree add`'s "already checked out" error, which fires when the default branch is checked out in another worktree (e.g. the main ADW repo root tracks `dev`).
- **`getCurrentBranch` import removed**: `commitOperations.ts` no longer imports `getCurrentBranch`. Other callers across the codebase are unaffected — the symbol remains exported from `branchOperations.ts` and `vcs/index.ts`.
