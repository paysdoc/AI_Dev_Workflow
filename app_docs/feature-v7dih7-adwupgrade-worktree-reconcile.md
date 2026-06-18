# adwUpgrade: Reconcile Stale Worktree to Remote Claim Tip

**ADW ID:** v7dih7-adwupgrade-reconcile
**Date:** 2026-06-18
**Specification:** specs/issue-628-adw-v7dih7-adwupgrade-reconcile-sdlc_planner-reconcile-stale-worktree.md

## Overview

Before this feature, `adwUpgrade` could reuse a stale `.worktrees/adw-upgrade-<hash>/` worktree that pointed at a superseded nonce commit, causing every regen push to fail as non-fast-forward and `#627`'s `claim_lost` park to fire on every cron tick. The fix inserts a `git fetch + git reset --hard` against the live remote claim tip immediately after `ensureWorktree` and before `.adw/` regen, so the regen commit is always built on the current `origin/<claim-branch>` and the push fast-forwards. The change is scoped entirely to the upgrade path; `ensureWorktree` and all other orchestrators are unmodified.

## What Was Built

- New `reconcileWorktreeToRemote(worktreePath, branch)` field on the `UpgradeDeps` interface
- Production wiring of `reconcileWorktreeToRemote` to `fetchAndResetToRemote(branch, worktreePath)` in `buildDefaultUpgradeDeps`
- Reconcile call inserted in `executeUpgrade` between `ensureWorktree` and regen (`copyInitCommandToWorktree` / `runInitCommand`), inside the existing worktree-setup `try/catch`
- Unit tests for wiring, ordering, failure handling, and the diverged-reuse success path in `adwUpgrade.test.ts`
- New focused unit tests for `fetchAndResetToRemote` covering claim-branch command sequence and both failure modes

## Technical Implementation

### Files Modified

- `adws/adwUpgrade.tsx`: Added `reconcileWorktreeToRemote` to `UpgradeDeps` interface; added `fetchAndResetToRemote` import; added reconcile call in `executeUpgrade` step 3; added production wiring in `buildDefaultUpgradeDeps`
- `adws/__tests__/adwUpgrade.test.ts`: Added `reconcileWorktreeToRemote: vi.fn()` to `makeDeps`; added `describe('executeUpgrade — reconcile-before-regen (stale worktree)')` block with ordering, wiring, success-path, and failure-handling tests

### New Files

- `adws/vcs/__tests__/fetchAndResetToRemote.test.ts`: Focused unit tests for the reconcile primitive — verifies `git fetch origin "<branch>"` then `git reset --hard "origin/<branch>"` order for a claim branch (non-default branch name), and throw-on-failure contracts for both fetch and reset failures

### Key Changes

- **Reconcile is caller-side only:** `ensureWorktree` in `adws/vcs/worktreeCreation.ts` is byte-identical; no shared primitive was widened — the fix lives exclusively in `adwUpgrade.tsx`
- **Reuses proven primitive:** `fetchAndResetToRemote` (already used in `adws/phases/workflowInit.ts:226`) performs `git fetch origin <branch>` + `git reset --hard origin/<branch>` with no `git clean -fdx`, preserving the worktree's gitignored `.env` copied by `ensureWorktree`
- **Reconcile failure routes to `worktree_error`:** the reconcile call is inside the existing `try/catch`, so a transient fetch/reset failure posts a non-ADW comment and returns `{ outcome: 'failed', reason: 'worktree_error' }` — the next cron tick retries cleanly
- **`#627` `claim_lost` park remains the safety net:** if a brand-new claim lands after reconcile but before push, the push is still non-fast-forward and the existing park fires correctly
- **Idempotent on first run:** when `ensureWorktree` creates a fresh worktree it is already at the claim tip, so reconcile is a harmless no-op

## How to Use

This feature is automatic — no operator action is required. When `adwUpgrade` runs:

1. `ensureWorktree` returns the worktree path (existing or newly created)
2. `reconcileWorktreeToRemote` runs `git fetch origin <claim-branch>` + `git reset --hard origin/<claim-branch>` against the returned path
3. Regen (`/adw_init`) builds `.adw/` on top of the live claim commit
4. `pushBranch` fast-forwards — the upgrade PR lands instead of parking as `claim_lost`

To verify reconciliation fired, check the upgrade worktree logs for the fetch and reset commands on the claim branch name (e.g. `adw-upgrade-<hash>`).

## Configuration

No new configuration. The reconcile step uses the same `UpgradeDeps` dependency-injection seam already used by all other upgrade side effects; the production default (`fetchAndResetToRemote`) is wired unconditionally.

## Testing

```bash
# Directly-affected suites
bunx vitest run adws/__tests__/adwUpgrade.test.ts adws/vcs/__tests__/fetchAndResetToRemote.test.ts

# Full unit suite (zero regressions)
bun run test:unit
```

Key test coverage:
- `reconcileWorktreeToRemote` called exactly once with `(worktreePath, buildClaimBranchName(hash))`
- Ordering: `ensureWorktree` → `reconcileWorktreeToRemote` → `copyInitCommandToWorktree` → `runInitCommand`
- Success path still reaches `pr_merged` with reconcile wired in
- Reconcile throw → `worktree_error`, one comment, no regen/commit/push/PR

## Notes

- **Root cause of the original incident:** local worktree at `zgmo37zc`-nonce commit, remote claim branch re-created at `llwvynsy`-nonce commit — neither is an ancestor of the other → diverged → non-ff rejection every run.
- **Manual disarm no longer needed:** before this fix, the workaround was to reset `.adw-version` or `## Cancel` the worktree. This feature removes the need for that recipe.
- **Rejected alternatives:** `resetWorktreeToRemote` (runs `git clean -fdx`, destroys `.env`); adding an opt-in flag to `ensureWorktree` (widens shared primitive, risks other orchestrators).
- **Related docs:** `app_docs/feature-t6m62c-adwupgrade-regen-gate-propagation.md` (the regen/verify gate that reconcile slots before), memory note on ADW self-upgrade no-op loop.
