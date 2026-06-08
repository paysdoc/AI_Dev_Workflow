# upgradeClaim Deep Module — Atomic Upgrade-Claim Primitive

**ADW ID:** m45h0x-upgradeclaim-deep-mo
**Date:** 2026-06-08
**Specification:** specs/issue-539-adw-m45h0x-upgradeclaim-deep-mo-sdlc_planner-upgrade-claim-primitive.md

## Overview

Delivers the `upgradeClaim` deep module: a single atomic primitive that lets concurrent ADW orchestrators detecting the same `.adw-version` hash mismatch on a target repo elect exactly one winner to perform the upgrade, with all others discovering the existing upgrade work via PR→branch→issue linkage. Atomicity is borrowed from the GitHub branch namespace — winner creates and pushes an empty commit on `adw-upgrade-<hash>`; any subsequent push is rejected, unambiguously identifying the loser.

## What Was Built

- `adws/core/upgradeClaim.ts` — the deep module with injectable I/O boundary (`UpgradeClaimDeps`), public orchestration function, default implementation factory, and pure helpers
- `adws/core/__tests__/upgradeClaim.test.ts` — unit tests covering winner/loser logic with `vi.fn()` doubles (no network)
- `adws/core/__tests__/upgradeClaim.integration.test.ts` — integration tests exercising real push-race atomicity against a local bare-repo sandbox (CI-runnable, no GitHub credentials)
- `features/per-issue/feature-539.feature` — BDD acceptance scenarios for the claim primitive
- `features/per-issue/step_definitions/feature-539.steps.ts` — Cucumber step definitions
- Barrel exports added to `adws/core/index.ts`

## Technical Implementation

### Files Modified

- `adws/core/upgradeClaim.ts`: New deep module — `UpgradeClaimResult` discriminated union, `UpgradeClaimDeps` interface, `buildClaimBranchName()`, `buildClaimResult()`, `claimUpgradeOrFindExisting()`, and `buildDefaultUpgradeClaimDeps()` with temp-worktree push implementation
- `adws/core/index.ts`: Added `// Upgrade claim` barrel section exposing all public exports alongside the `remoteReconcile` exports
- `adws/core/__tests__/upgradeClaim.test.ts`: New — `makeDeps(overrides)` factory pattern, winner/loser/edge-case unit tests
- `adws/core/__tests__/upgradeClaim.integration.test.ts`: New — local bare-repo sandbox (`git init --bare`), real push with stubbed PR/issue layer
- `features/per-issue/feature-539.feature`: BDD scenarios for AC coverage
- `features/per-issue/step_definitions/feature-539.steps.ts`: Step definitions for feature-539

### Key Changes

- **Nonce in empty commit message** (`ADW upgrade in progress: <hash> [<nonce>]`) ensures two racing orchestrators produce distinct SHAs even within the same wall-clock second, so the second push is always a genuine non-fast-forward rejection — preventing the "two winners" failure mode.
- **Temp detached worktree** pattern (mirror of `commitAndPushKpiFile`) keeps the claim fully isolated: the caller's active worktree index/HEAD is never mutated; cleanup runs in `finally`.
- **Rejection-vs-error classification** (`isRejectionError`) maps `rejected`, `non-fast-forward`, `failed to push some refs`, and `already exists` patterns in push stderr to `false` (loser); anything else propagates as a throw, never silently misclassified.
- **Loser path** reuses existing `defaultFindPRByBranch` + `fetchPRDetails().issueNumber` helpers from `adws/github/prApi.ts` for PR→branch→issue resolution; degrades to `existingIssueNumber: null` (not an error) when the winner's PR does not yet exist.
- **DI pattern** mirrors `remoteReconcile.ts` exactly: `UpgradeClaimDeps` interface + `buildDefaultUpgradeClaimDeps(baseRepoPath)` factory + optional `deps?` third parameter on the main function.

## How to Use

```ts
import { claimUpgradeOrFindExisting, buildDefaultUpgradeClaimDeps } from 'adws/core';

// Two-argument form (uses process.cwd() as baseRepoPath):
const result = await claimUpgradeOrFindExisting(hash, repoInfo);

// Three-argument form (explicit worktree path):
const deps = buildDefaultUpgradeClaimDeps(worktreePath);
const result = await claimUpgradeOrFindExisting(hash, repoInfo, deps);

if (result.won) {
  // This orchestrator is the winner — proceed with upgrade PR creation
  console.log(`Won claim on branch ${result.branch}`);
} else {
  // This orchestrator is the loser — register dependency and park
  console.log(`Upgrade already in progress on ${result.existingBranch}`);
  if (result.existingIssueNumber) {
    // Register dependency on result.existingIssueNumber
  }
}
```

**Branch naming:** `buildClaimBranchName(hash)` → `adw-upgrade-<hash>`. Throws on empty/whitespace hash.

**Result types:**
- Winner: `{ won: true; branch: string }`
- Loser: `{ won: false; existingIssueNumber: number | null; existingBranch: string }`

## Configuration

No new environment variables. `buildDefaultUpgradeClaimDeps(baseRepoPath)` defaults to `process.cwd()`. Pass the target-repo worktree path explicitly so the claim push runs against the correct remote.

## Testing

```bash
# Unit tests only:
bunx vitest run adws/core/__tests__/upgradeClaim.test.ts

# Integration test (local bare-repo sandbox, no credentials):
bunx vitest run adws/core/__tests__/upgradeClaim.integration.test.ts

# Full suite:
bun run test:unit
```

The integration test creates a bare repo in `os.tmpdir()`, seeds it with an initial commit, and runs two sequential push attempts from separate clones — asserting exactly one winner and one loser.

## Notes

- **Out of scope for this issue:** creating the `adw:upgrade` tracking issue on win, registering the dependency, returning the issue to the Todo lane, and invoking `adwUpgrade.tsx`. This module ships only the claim primitive.
- **Why empty commit, not a bare ref:** the downstream `adwUpgrade.tsx` orchestrator must open a PR for `adw-upgrade-<hash>`, which requires the branch to be at least one commit ahead of base. A ref at exactly the base tip cannot back a PR.
- **Alternative atomic primitive (documented, not chosen):** `gh api -X POST repos/{owner}/{repo}/git/refs` returns `422 Reference already exists` server-side. Not chosen because the PRD specifies the empty-commit-plus-`git push` mechanism and the commit is needed for the downstream PR.
- **`existingIssueNumber: null` is not an error** — it represents the race window where the loser observes the claim branch before the winner has opened its PR/issue.
- See `app_docs/feature-djtyv4-remote-reconcile-module.md` for the `ReconcileDeps` DI pattern this module mirrors, and `app_docs/feature-hk12ct-kpi-commits-land-on-default-branch.md` for the temp-worktree contract.
