# Shared Orchestrator Lifecycle Wrapper

**ADW ID:** 6wnymj-orchestrator-resilie
**Date:** 2026-04-20
**Specification:** specs/issue-464-adw-6wnymj-orchestrator-resilie-sdlc_planner-shared-orchestrator-lifecycle-wrapper.md

## Overview

All thirteen orchestrator entrypoints now go through a shared lifecycle wrapper that encapsulates spawn-lock acquisition, heartbeat start, heartbeat stop, and lock release in a single `finally`-guarded call. Previously, `adwChore`, `adwInit`, `adwPatch`, and `adwMerge` hand-rolled their own lock acquire/release without starting a heartbeat, making them invisible to the hung-orchestrator detector. This slice closes that coverage gap and pins the call-order contract with a unit test.

## What Was Built

- `adws/phases/orchestratorLock.ts` — two wrapper helpers: `runWithOrchestratorLifecycle` (for `WorkflowConfig`-based orchestrators) and `runWithRawOrchestratorLifecycle` (for `adwMerge` which lacks `WorkflowConfig`)
- `adws/phases/__tests__/orchestratorLock.test.ts` — unit tests pinning the exact lifecycle call order `['acquire', 'startHeartbeat', 'fn', 'stopHeartbeat', 'release']` for both wrappers in happy-path, contention, and throw scenarios
- Migration of `adwChore`, `adwInit`, `adwPatch` from manual `acquireOrchestratorLock`/`releaseOrchestratorLock` + try/finally to `runWithOrchestratorLifecycle`
- Migration of `adwMerge` from raw `acquireIssueSpawnLock`/`releaseIssueSpawnLock` (no heartbeat) to `runWithRawOrchestratorLifecycle` — first time `adwMerge` gets heartbeat coverage
- Fix of `adwTest.tsx` import drift (imported `runWithOrchestratorLifecycle` but called `acquireOrchestratorLock`/`releaseOrchestratorLock` which are not imported)

## Technical Implementation

### Files Modified

- `adws/phases/orchestratorLock.ts`: new file — `runWithOrchestratorLifecycle` and `runWithRawOrchestratorLifecycle` wrappers; `acquireOrchestratorLock` and `releaseOrchestratorLock` helpers remain exported for downstream use
- `adws/phases/__tests__/orchestratorLock.test.ts`: new file — vitest tests covering 7 scenarios across both wrappers
- `adws/adwChore.tsx`: replaced manual lock+try/finally with `runWithOrchestratorLifecycle`; gains heartbeat coverage
- `adws/adwInit.tsx`: same migration; body uses raw `totalCostUsd`/`totalModelUsage` accumulators (no `CostTracker`) — moved unchanged inside wrapper closure
- `adws/adwPatch.tsx`: same migration; uses `CostTracker`
- `adws/adwMerge.tsx`: replaced `acquireIssueSpawnLock`/`releaseIssueSpawnLock` with `runWithRawOrchestratorLifecycle`; `result` captured in enclosing scope to preserve exit-code logic
- `adws/adwTest.tsx`: completed incomplete migration (fixed import drift)
- `adws/phases/index.ts`: re-exports `runWithOrchestratorLifecycle` and `runWithRawOrchestratorLifecycle` via the phases barrel

### Key Changes

- **Lifecycle contract**: `acquire → startHeartbeat → fn → stopHeartbeat → release` is now the single enforced pattern across all orchestrators, with cleanup guaranteed by `finally`
- **Heartbeat coverage for 4 previously-uncovered orchestrators**: `adwChore`, `adwInit`, `adwPatch`, `adwMerge` now emit `lastSeenAt` ticks while running — the hung-orchestrator detector can see them
- **`adwMerge` exits with code preservation**: `result` is declared in the enclosing scope, assigned inside the wrapper closure, and used post-wrapper to produce the correct exit code (`merge_failed → 1`, all other outcomes → 0)
- **`process.exit` inside fn skips `finally`**: this is documented and intentional — `handleWorkflowError`, `handleWorkflowDiscarded`, `handleRateLimitPause` all call `process.exit` synchronously; the lock file stays on disk and is reclaimed by the next caller via `processLiveness.isProcessLive`
- **No new runtime dependencies**: the wrappers compose `acquireIssueSpawnLock`/`releaseIssueSpawnLock` (from `spawnGate`) and `startHeartbeat`/`stopHeartbeat` (from `core/heartbeat`) that were already present

## How to Use

The wrappers are consumed by orchestrator `main()` functions only. There are two variants:

**For `WorkflowConfig`-typed orchestrators (12 of 13):**
```ts
import { runWithOrchestratorLifecycle } from './phases/orchestratorLock';

const acquired = await runWithOrchestratorLifecycle(config, async () => {
  // phase body: try { ... } catch (error) { handleWorkflowError(...) }
});
if (!acquired) {
  log(`Issue #${issueNumber}: spawn lock already held; exiting.`, 'warn');
  process.exit(0);
}
```

**For `adwMerge` (raw primitives, no `WorkflowConfig`):**
```ts
import { runWithRawOrchestratorLifecycle } from './phases/orchestratorLock';

let result: MergeRunResult | undefined;
const acquired = await runWithRawOrchestratorLifecycle(repoInfo, issueNumber, adwId, async () => {
  result = await executeMerge(...);
});
if (!acquired) { log(...); process.exit(0); }
if (!result) process.exit(1); // unreachable guard
process.exit(result.outcome === 'abandoned' && result.reason === 'merge_failed' ? 1 : 0);
```

## Configuration

- `HEARTBEAT_TICK_INTERVAL_MS` (default `30_000` ms) from `adws/core/config.ts` — controls how frequently the heartbeat writes `lastSeenAt` to top-level state

## Testing

Run the unit test:
```
bun run test:unit
```

The test file `adws/phases/__tests__/orchestratorLock.test.ts` verifies:
1. Contention path: lock not acquired → returns `false`, heartbeat never started
2. Happy path: fn resolves → call order is `['acquire', 'startHeartbeat', 'fn', 'stopHeartbeat', 'release']`, returns `true`
3. Throw path: fn rejects → same call order, error propagates out of wrapper
4. Argument wiring: `acquireIssueSpawnLock` receives the right `RepoInfo`, `issueNumber`, `process.pid`; `startHeartbeat` receives `adwId` and the interval constant

Verify no entrypoint directly calls lock primitives:
```
# Expect zero matches in adw*.tsx entrypoints
grep -r "acquireOrchestratorLock\|releaseOrchestratorLock\|acquireIssueSpawnLock\|releaseIssueSpawnLock" adws/adw*.tsx
```

## Notes

- `adwMerge` gains heartbeat coverage for the first time. The `awaiting_merge` stage is not a `*_running` stage, so no spurious hung-orchestrator detection is expected.
- `adwPrReview`, `adwClearComments`, and `adwDocument` are explicitly out of scope (per PRD section "Out of Scope"). They remain un-migrated.
- The `acquireOrchestratorLock` and `releaseOrchestratorLock` helpers remain exported from `orchestratorLock.ts` — removing them would be premature, even though no entrypoint `main()` calls them directly post-migration.
- This is slice #8 of the orchestrator-coordination-resilience PRD, completing PRD user stories 13 (lock held for full orchestrator lifetime) and 14 (shared wrapper eliminates boilerplate in 12 places).
