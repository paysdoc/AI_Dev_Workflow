# Fix Divergent Branch Pull Failure

**ADW ID:** zt8gjc-aonther-error
**Date:** 2026-03-31
**Specification:** specs/issue-368-adw-zt8gjc-aonther-error-sdlc_planner-fix-divergent-branch-pull.md

## Overview

ADW crashed with `fatal: Need to specify how to reconcile divergent branches` whenever the local default branch of a target repo had diverged from origin. All four `git pull` invocations across the VCS layer now explicitly pass `--rebase`, making ADW resilient to divergent branch state regardless of user-level git configuration.

## What Was Built

- Added `--rebase` flag to `pullLatestDefaultBranch` in `targetRepoManager.ts` (the primary crash site)
- Added `--rebase` flag to `checkoutBranch` in `branchOperations.ts`
- Added `--rebase` flag to `checkoutDefaultBranch` in `branchOperations.ts`
- Added `--rebase` flag to `freeBranchFromMainRepo` in `worktreeOperations.ts` (cleanup path, consistency fix)
- Removed unused `RepoInfo` type import from `trigger_cron.ts`

## Technical Implementation

### Files Modified

- `adws/core/targetRepoManager.ts`: `git pull origin "${defaultBranch}"` → `git pull --rebase origin "${defaultBranch}"` in `pullLatestDefaultBranch`
- `adws/vcs/branchOperations.ts`: Added `--rebase` to `git pull` in both `checkoutBranch` (line 94) and `checkoutDefaultBranch` (line 170)
- `adws/vcs/worktreeOperations.ts`: `git checkout "${defaultBranch}" && git pull` → `git pull --rebase` in `freeBranchFromMainRepo`
- `adws/triggers/trigger_cron.ts`: Removed unused `RepoInfo` type import
- `README.md`: Updated directory tree to reflect new test files (`cronRepoResolver.ts`, unit test dirs)

### Key Changes

- All four `git pull` calls now carry an explicit `--rebase` strategy, eliminating the `fatal: Need to specify how to reconcile divergent branches` abort in git v2.27+
- Rebase was chosen over merge/ff-only: ADW always wants the remote state, and rebase keeps history linear without merge commits
- The fix handles the case where interrupted ADW workflows leave local commits on the default branch — rebase cleanly replays them on top of remote
- Zero new dependencies; each change is a single-word insertion (`--rebase`)

## How to Use

No user-facing configuration change required. ADW automatically handles divergent branches on the next workflow run:

1. Start an ADW workflow targeting a repository where the default branch has diverged from origin
2. `ensureTargetRepoWorkspace` → `pullLatestDefaultBranch` now runs `git pull --rebase` instead of bare `git pull`
3. Workflow proceeds normally without requiring a clean git state on the host machine

## Configuration

None. The fix is self-contained and does not require any environment variable or `.adw/` config changes.

## Testing

```bash
# Reproduce the bug manually before the fix:
cd <target-repo>
git commit --allow-empty -m "local divergence"
# while remote has advanced — then run an ADW workflow and observe the crash

# Validate the fix:
bun run lint
bun run build
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json
```

## Notes

- Root cause: git v2.27+ requires an explicit reconciliation strategy (`--rebase`, `--no-rebase`, or `--ff-only`) when branches diverge; bare `git pull` inherits user-level config which may be unset in CI/automation environments
- All four locations were fixed for consistency even though `freeBranchFromMainRepo` is a cleanup path and less likely to diverge in practice
