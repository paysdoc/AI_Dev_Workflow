# Upgrade Gate — Hash-Check Framework Version Gate

## Overview

The upgrade gate compares the running framework's content hash against the target repo's stored `.adw-version` on the remote default branch. When they diverge, it atomically elects a winner (creates a tracking `#UPG` issue and spawns `adwUpgrade.tsx`) or attaches the current issue as a loser, parking it before any feature worktree is built. On a match it returns `proceed` and normal workflow setup continues.

## Responsibilities

- Read the authoritative stored framework version from `origin/<defaultBranch>:.adw-version` via `readRemoteAdwVersion` (immune to stale local worktrees)
- Compute the current framework content hash via `computeFrameworkHash`
- Elect exactly one upgrade winner per target repo per hash via `claimUpgradeOrFindExisting`
- Create the `#UPG` tracking issue, apply `adw:upgrade` label, spawn `adwUpgrade.tsx` (winner path)
- Register the upgrade issue as a `## Blocked by` dependency in the parked issue's body; move it to Todo on the board
- Return `UpgradeGateOutcome`: `{ action: 'proceed' }` or `{ action: 'parked'; role; upgradeIssueNumber; branch }`
- Run **before worktree setup** in `initializeWorkflow` — losers park without creating a throwaway feature worktree

## Contracts & Invariants

- `shouldTriggerUpgrade(currentHash, null)` is always `true`: absent `.adw-version` collapses "never initialized" into "out of date"
- The claim push targets the **target repo's** branch namespace, not the framework repo — `buildDefaultUpgradeGateDeps(repoId, targetRepoWorkspacePath)` enforces this; callers must pass the target clone root, not a feature worktree path
- `process.exit(0)` is the park exit in `initializeWorkflow`: losers return cleanly before any workflow comment or worktree is created
- The upgrade winner path (claim commit + `adwUpgrade.tsx` regen) still creates its own worktree inside `targetRepoWorkspacePath`; only the cheap version *read* moved earlier
- Self-hosting guard: gate is skipped when `targetRepo` is absent (ADW's own self-hosted runs bypass the gate)

## Configuration

- `UpgradeGateParams.defaultBranch` — resolved from `gitCtx.defaultBranch()` before worktree setup in `initializeWorkflow`
- `UpgradeGateParams.worktreePath` — must be the target repo **clone root** (e.g. `targetRepoWorkspacePath`), not a feature worktree; this is both the cwd for the remote read and the base for the claim push
- `UpgradeGateParams.frameworkRepoRoot` — resolved once at `initializeWorkflow` entry via `path.resolve(dirname(fileURLToPath(import.meta.url)), '../..')`
- `UpgradeGateDeps.readAdwVersion` signature: `(defaultBranch: string, workspacePath: string) => string | null` — wired to `readRemoteAdwVersion` by default

## Gotchas

- **Stale reused worktrees no longer cause false mismatches**: before this feature (#712), the gate read `worktree/.adw-version` which could lag arbitrarily when `ensureWorktree` reused an existing worktree. The remote read (`origin/<default>:.adw-version`) is the fix.
- **Gate ordering matters**: the gate runs after `targetRepoWorkspacePath` is resolved but before `ensureWorktree`. Moving it later (post-worktree) reintroduces the stale-local-file bug.
- **`gateRepoId` before `createRepoContext`**: since the gate now precedes `createRepoContext`, use `options?.repoId ?? { owner, repo, platform: Platform.GitHub }` — `repoIdForContext` is not yet available.
- **Loser race window**: if the winner hasn't created `#UPG` yet when the loser calls `findOpenUpgradeIssue`, it returns `null`. The loser parks with `upgradeIssueNumber: null` (no body edit); the dependency is registered by the next cron sweep once `#UPG` exists.
- **`addDependencyToBody`**: idempotent — inserts `- #N` into the first of `## Dependencies` / `## Blocked by` / `## Depends on` sections (case-insensitive); appends a new `## Blocked by` section if none exists; skips if the reference is already present.
