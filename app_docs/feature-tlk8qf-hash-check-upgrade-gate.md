# Hash Check Upgrade Gate in `initializeWorkflow()`

**ADW ID:** tlk8qf-hash-check-upgrade-t
**Date:** 2026-06-08
**Specification:** specs/issue-544-adw-tlk8qf-hash-check-upgrade-t-sdlc_planner-hash-check-upgrade-trigger-init.md

## Overview

This feature inserts a framework version check (upgrade gate) into `initializeWorkflow()` that runs after worktree setup and before state initialization. When the target repo's `.adw/` directory is stale (hash mismatch) or has never been initialized (missing `.adw-version`), the gate atomically elects a single winner, parks the current issue in Todo with a dependency on a new `#UPG` tracking issue, and exits before any concurrency-counted workflow comment is posted.

## What Was Built

- `adws/phases/upgradeGate.ts` — new deep module with pure helpers (`shouldTriggerUpgrade`, `addDependencyToBody`), orchestration function (`runUpgradeGate`), DI interface (`UpgradeGateDeps`), and default deps factory (`buildDefaultUpgradeGateDeps`)
- Integration of `runUpgradeGate` into `adws/phases/workflowInit.ts` behind a self-hosting guard (`if (targetRepo)`)
- Three new GitHub primitives in `adws/github/issueApi.ts`: `createIssue`, `updateIssueBody`, `findOpenUpgradeIssue`
- Named constant `ADW_UPGRADE_LABEL = 'adw:upgrade'` exported from `adws/github/labelManager.ts`
- All new symbols re-exported via `adws/github/index.ts`
- 232-line unit test suite `adws/phases/__tests__/upgradeGate.test.ts` covering all gate paths
- Mock added to `adws/phases/__tests__/workflowInit.test.ts` to keep existing determinism tests green

## Technical Implementation

### Files Modified

- `adws/phases/upgradeGate.ts`: new file — the complete upgrade gate deep module
- `adws/phases/workflowInit.ts`: `RepoContext` creation relocated earlier; guarded gate call inserted after worktree setup, before `AgentStateManager.initializeState`
- `adws/github/issueApi.ts`: added `createIssue`, `updateIssueBody`, `findOpenUpgradeIssue`
- `adws/github/labelManager.ts`: added `export const ADW_UPGRADE_LABEL = 'adw:upgrade'`
- `adws/github/index.ts`: re-exported the three new issue functions and `ADW_UPGRADE_LABEL`
- `adws/phases/__tests__/upgradeGate.test.ts`: new unit test file
- `adws/phases/__tests__/workflowInit.test.ts`: added `vi.mock('../upgradeGate', ...)` returning `{ action: 'proceed' }`

### Key Changes

- **Hash match (common path):** `shouldTriggerUpgrade(currentHash, storedVersion)` returns `false` → gate returns `{ action: 'proceed' }` → execution falls through unchanged. Zero behavioral difference for up-to-date repos.
- **First-bootstrap unification:** `readAdwVersion` returns `null` for a missing `.adw-version`; `null !== anyHash` so `shouldTriggerUpgrade` returns `true` — identical code path to an out-of-date repo. No separate bootstrap branch.
- **Winner path:** `claimUpgradeOrFindExisting` wins the atomic election → creates `#UPG` issue, applies `adw:upgrade` label, spawns `adwUpgrade.tsx` detached, registers dependency in issue body, moves issue to Todo, returns `{ action: 'parked', role: 'winner' }`.
- **Loser path:** loses the election → resolves existing `#UPG` (from claim result or `findOpenUpgradeIssue` fallback), registers dependency in issue body, moves to Todo, returns `{ action: 'parked', role: 'loser' }`. No duplicate `#UPG`, no duplicate spawn.
- **No slot leak:** `process.exit(0)` is called **before** `AgentStateManager.initializeState` and before `postIssueStageComment(..., 'starting', ...)`, so no state file and no concurrency-counted comment exist. The cron dependency-closure loop unblocks the parked issue once `#UPG` closes.
- **Self-hosting guard:** gate runs only when `options.targetRepo` is set; ADW operating on its own repo skips the gate entirely.
- **`addDependencyToBody`** is idempotent: if `#<upgNumber>` already appears in a `## Dependencies` / `## Blocked by` / `## Depends on` section, the body is returned unchanged. Uses the same heading regex as `parseDependencies` so `findOpenDependencies` recognizes the result.

## How to Use

This feature is automatic — no operator action required:

1. An orchestrator calls `initializeWorkflow()` for a target-repo issue.
2. After worktree setup, the gate computes `computeFrameworkHash(frameworkRepoRoot)` and reads `readAdwVersion(worktreePath)`.
3. If they match, the workflow proceeds normally.
4. If they differ (or `.adw-version` is absent), the gate parks the issue and exits. The cron loop re-queues the issue automatically once the upgrade PR merges and `#UPG` closes.

To verify the gate is active, check that `adws/phases/workflowInit.ts` contains the `if (targetRepo) { ... runUpgradeGate(...) }` block immediately after the `repoContext` creation block and before `AgentStateManager.initializeState`.

## Configuration

No new configuration. The gate is controlled by:

- `options.targetRepo` (set by orchestrator callers via `--target-repo`) — gate is a no-op when absent
- `ADW_UPGRADE_LABEL = 'adw:upgrade'` — label applied to `#UPG` issues; `applyLabel` lazy-creates it if missing
- `frameworkRepoRoot` — derived from `import.meta.url` (`path.resolve(dirname, '../..')`) in `workflowInit.ts`

## Testing

```bash
# Unit tests (pure helpers + all gate orchestration paths)
bun run test:unit -- upgradeGate

# All unit tests (regression check)
bun run test:unit

# Type check
bunx tsc --noEmit -p adws/tsconfig.json

# BDD scenarios for this feature
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-544"
```

Key unit test cases in `adws/phases/__tests__/upgradeGate.test.ts`:
- `shouldTriggerUpgrade`: `null` stored → `true`; equal hashes → `false`; differing hashes → `true`
- `addDependencyToBody`: empty body, existing section, idempotent, all three heading variants
- `runUpgradeGate`: proceed (no claim call), winner (createIssue/applyLabel/spawn/park), loser-resolvable, loser-fallback, loser-unresolved-race

## Notes

- **Classifier still runs on mismatch.** `classifyGitHubIssue()` runs before worktree setup (branch naming needs `issueType`), so the gate cannot sit before it without an out-of-scope refactor. The binding "no slot leak" constraint (exit before the `'starting'` comment) is fully met. The cheap Haiku classification call for a soon-to-be-parked issue is an accepted, documented cost.
- **`adwMerge.tsx` is exempt.** It does not call `initializeWorkflow()` and is not modified.
- **`process.exit(0)` inside `initializeWorkflow()` is safe** because the function runs before `runWithOrchestratorLifecycle(...)` acquires the spawn lock and heartbeat — nothing is held at exit time.
- **Recursive churn is accepted** (User Story 27): if the framework hash advances again during a slow upgrade, re-queued issues open a follow-on `#UPG`. No linearization machinery is added.
- **`moveToStatus` is best-effort.** The body dependency (parsed by `findOpenDependencies`) drives the cron unblock; the board move is cosmetic and errors are swallowed.
- **Loser race edge case:** if `existingIssueNumber` is null and `findOpenUpgradeIssue` also returns null (winner hasn't created `#UPG` yet), the gate parks to Todo without a body edit. The cron re-scan re-runs the gate and resolves the dependency on the next pass.
