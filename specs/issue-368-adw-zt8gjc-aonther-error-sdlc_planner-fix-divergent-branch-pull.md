# Bug: Fix divergent branch pull failure

## Metadata
issueNumber: `368`
adwId: `zt8gjc-aonther-error`
issueJson: `{"number":368,"title":"Aonther error","body":"...git pull origin dev fails with divergent branches...","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-31T06:05:16Z"}`

## Bug Description
When ADW initializes a workflow for a target repository that is already cloned, `pullLatestDefaultBranch` in `adws/core/targetRepoManager.ts` runs `git pull origin "<defaultBranch>"` without specifying a reconciliation strategy. If the local default branch has diverged from origin (e.g. due to a prior failed merge, local commits, or an interrupted rebase), git refuses the pull with:

```
fatal: Need to specify how to reconcile divergent branches.
```

**Expected**: ADW should successfully sync the local default branch to match the remote, even when branches have diverged.

**Actual**: The workflow crashes with exit code 128, preventing any further issue processing.

## Problem Statement
All `git pull` invocations in the codebase lack a reconciliation strategy flag (`--rebase`, `--no-rebase`, or `--ff-only`). When the local branch has diverged from the remote tracking branch, git requires an explicit strategy and aborts with a fatal error. This affects three locations:

1. `adws/core/targetRepoManager.ts:79` — `pullLatestDefaultBranch` (the crash site)
2. `adws/vcs/branchOperations.ts:94` — `checkoutBranch`
3. `adws/vcs/branchOperations.ts:170` — `checkoutDefaultBranch`

A fourth location (`adws/vcs/worktreeOperations.ts:192`) also uses bare `git pull` but is in a cleanup path and should be fixed for consistency.

## Solution Statement
Add `--rebase` to all `git pull` invocations. Rebase is the correct strategy for ADW because:
- ADW always wants to sync to the latest remote state
- Rebase keeps a linear history without merge commits
- For default branch pulls there should be no local commits, but if there are (from interrupted workflows), rebase cleanly replays them on top of remote

## Steps to Reproduce
1. Clone a target repository into the ADW workspace
2. On the default branch, create a local divergence (e.g. `git commit --allow-empty -m "local"` while remote has advanced)
3. Run an ADW workflow targeting that repository
4. `ensureTargetRepoWorkspace` calls `pullLatestDefaultBranch`, which fails at `git pull origin "dev"`

## Root Cause Analysis
`execSync('git pull origin "${defaultBranch}"')` relies on the user's global git config for `pull.rebase` / `pull.ff`. When no global config is set (the default), git v2.27+ requires an explicit strategy when branches diverge. Since ADW is an automation tool running in various environments, it cannot rely on user-level git config and must explicitly specify the strategy.

## Relevant Files
Use these files to fix the bug:

- `adws/core/targetRepoManager.ts` — Contains `pullLatestDefaultBranch` (line 79), the direct crash site. The `git pull` call needs `--rebase`.
- `adws/vcs/branchOperations.ts` — Contains `checkoutBranch` (line 94) and `checkoutDefaultBranch` (line 170), both with bare `git pull` calls that need `--rebase`.
- `adws/vcs/worktreeOperations.ts` — Contains `freeBranchFromMainRepo` (line 192) with a bare `git pull` that needs `--rebase` for consistency.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Fix `pullLatestDefaultBranch` in `targetRepoManager.ts`
- In `adws/core/targetRepoManager.ts` line 79, change:
  ```ts
  execSync(`git pull origin "${defaultBranch}"`, { stdio: 'pipe', cwd: workspacePath });
  ```
  to:
  ```ts
  execSync(`git pull --rebase origin "${defaultBranch}"`, { stdio: 'pipe', cwd: workspacePath });
  ```

### 2. Fix `checkoutBranch` in `branchOperations.ts`
- In `adws/vcs/branchOperations.ts` line 94, change:
  ```ts
  execSync(`git pull origin "${branchName}"`, { stdio: 'pipe', cwd });
  ```
  to:
  ```ts
  execSync(`git pull --rebase origin "${branchName}"`, { stdio: 'pipe', cwd });
  ```

### 3. Fix `checkoutDefaultBranch` in `branchOperations.ts`
- In `adws/vcs/branchOperations.ts` line 170, change:
  ```ts
  execSync(`git pull origin "${defaultBranch}"`, { stdio: 'pipe', cwd });
  ```
  to:
  ```ts
  execSync(`git pull --rebase origin "${defaultBranch}"`, { stdio: 'pipe', cwd });
  ```

### 4. Fix `freeBranchFromMainRepo` in `worktreeOperations.ts`
- In `adws/vcs/worktreeOperations.ts` line 192, change:
  ```ts
  execSync(`git checkout "${defaultBranch}" && git pull`, { stdio: 'pipe', cwd: mainRepoPath });
  ```
  to:
  ```ts
  execSync(`git checkout "${defaultBranch}" && git pull --rebase`, { stdio: 'pipe', cwd: mainRepoPath });
  ```

### 5. Run validation commands

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors
- `bunx tsc --noEmit` — Type check main project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check adws

## Notes
- All four changes are single-word additions (`--rebase`) to existing `git pull` commands — minimal blast radius.
- No new dependencies required.
- The fix makes ADW resilient to any user-level git configuration (or lack thereof) by being explicit about the pull strategy.
