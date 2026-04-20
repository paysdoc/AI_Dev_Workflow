# SpawnGate Lifetime Extension — Orchestrator-Lifetime Lock

**ADW ID:** yxo18t-orchestrator-resilie
**Date:** 2026-04-20
**Specification:** specs/issue-463-adw-yxo18t-orchestrator-resilie-sdlc_planner-spawngate-lifetime-pid-liveness.md

## Overview

Extends the per-issue spawn gate lock (introduced in #449) from the trigger's narrow classify-to-spawn window to the orchestrator's full lifetime. Each of the twelve orchestrator entrypoints now acquires the lock immediately after state init and releases it in a `finally` block on normal exit. Abnormal-exit handlers (`handleWorkflowError`, `handleWorkflowDiscarded`, `handleRateLimitPause`) call `process.exit` synchronously, so the lock stays on disk and is reclaimed by the next caller via PID+start-time liveness check.

## What Was Built

- **`adws/phases/orchestratorLock.ts`** — new thin helper module exporting `acquireOrchestratorLock(config)` and `releaseOrchestratorLock(config)`
- **Wiring in 11 standard orchestrators** — `adwSdlc`, `adwPlan`, `adwPlanBuild`, `adwPlanBuildTest`, `adwPlanBuildReview`, `adwPlanBuildTestReview`, `adwPlanBuildDocument`, `adwBuild`, `adwTest`, `adwChore`, `adwPatch`, `adwInit`
- **Wiring in `adwMerge`** — uses raw `acquireIssueSpawnLock`/`releaseIssueSpawnLock` directly (no `initializeWorkflow`)
- **BDD feature file** — `features/spawngate_lifetime_pid_liveness.feature` with `@adw-463` scenarios covering helper surface, wiring, and spawnGate regression
- **Step definitions** — `features/step_definitions/spawnGateLifetimeSteps.ts`
- **Heartbeat removal** — removed the `startHeartbeat`/`stopHeartbeat` calls from `adwSdlc` (heartbeat module deleted as superseded)
- **`adwMerge` stage cleanup** — `'discarded'` → `'abandoned'` stage writes for closed/failed-merge paths

## Technical Implementation

### Files Modified

- `adws/phases/orchestratorLock.ts`: new helper; resolves `RepoInfo` from `config.targetRepo ?? getRepoInfo()`, delegates to `acquireIssueSpawnLock`/`releaseIssueSpawnLock`
- `adws/phases/index.ts`: re-exports `acquireOrchestratorLock`, `releaseOrchestratorLock`
- `adws/adwSdlc.tsx`: added acquire/release wiring; removed heartbeat calls
- `adws/adwBuild.tsx`: acquire placed after plan-file existence check, before `CostTracker`
- `adws/adwMerge.tsx`: uses raw spawnGate primitives; `executeMerge` wrapped in `try/finally`; `'discarded'` → `'abandoned'`
- `adws/adwPlan.tsx`, `adwPlanBuild.tsx`, `adwPlanBuildTest.tsx`, `adwPlanBuildReview.tsx`, `adwPlanBuildTestReview.tsx`, `adwPlanBuildDocument.tsx`, `adwTest.tsx`, `adwChore.tsx`, `adwPatch.tsx`, `adwInit.tsx`: standard acquire/release wiring
- `adws/core/heartbeat.ts`, `adws/core/__tests__/heartbeat.test.ts`: deleted (heartbeat superseded by orchestrator-lifetime lock)
- `adws/triggers/webhookHandlers.ts`, `adws/__tests__/adwMerge.test.ts`: minor updates
- `features/spawngate_lifetime_pid_liveness.feature`: new BDD scenarios
- `features/step_definitions/spawnGateLifetimeSteps.ts`: new step definitions

### Key Changes

- **`orchestratorLock.ts` contract**: acquire immediately after `initializeWorkflow`; release in `finally`. Abnormal exits (via `process.exit`) intentionally skip `finally` — the lock file is the "last known alive" signal recovered by staleness check.
- **Exit-on-contention**: if `acquireOrchestratorLock` returns `false`, the orchestrator logs a warning and exits 0, deferring to the existing lock holder.
- **`adwBuild` ordering exception**: acquire goes *after* the plan-file existence guard — no coordination is needed if the orchestrator cannot start at all.
- **`adwMerge` divergence**: bypasses `orchestratorLock.ts` because it does not call `initializeWorkflow`; acquires/releases directly with `repoInfo` + `issueNumber` already in scope.
- **Stale-lock recovery**: crash survivors leave the lock on disk; `processLiveness.isProcessLive(pid, pidStartedAt)` detects dead PID or PID reuse and force-reclaims.

## How to Use

The orchestrator-lifetime lock is automatic — no operator action required. For developers adding a new orchestrator:

1. Import `acquireOrchestratorLock`, `releaseOrchestratorLock` from `./phases/orchestratorLock`.
2. After `initializeWorkflow` returns, call:
   ```ts
   if (!acquireOrchestratorLock(config)) {
     log(`Issue #${issueNumber}: spawn lock already held by another orchestrator; exiting.`, 'warn');
     process.exit(0);
   }
   ```
3. Wrap the phase-execution block:
   ```ts
   try {
     ...phases...
   } catch (error) {
     handleWorkflowError(config, error, tracker.totalCostUsd, tracker.totalModelUsage);
   } finally {
     releaseOrchestratorLock(config);
   }
   ```

## Configuration

No new configuration required. The lock file path is derived from `RepoInfo` + `issueNumber` (same key as the trigger-side lock from #449). Falls back to `getRepoInfo()` when `config.targetRepo` is undefined.

## Testing

- `bun run test:unit` — spawnGate unit tests (fresh acquire, live-holder contention, dead-holder reclaim, PID-reuse reclaim) remain in `adws/triggers/__tests__/spawnGate.test.ts`
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-463"` — BDD scenarios for helper surface, wiring assertions, and spawnGate regression
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — full regression suite

## Notes

- **No trigger-side changes**: `webhookGatekeeper.classifyAndSpawnWorkflow` continues to hold the short-lived classify-to-spawn lock from #449. The orchestrator-lifetime lock is a second, longer-lived layer over the same file path.
- **Brief gap between trigger-release and orchestrator-acquire** is acceptable; if a second trigger sneaks in, its spawned orchestrator races and exactly one wins via `wx` exclusive-create.
- **Cosmetic artifact on contention loss**: the losing orchestrator's `agents/<adwId>/state.json` carries `workflowStage: 'starting'`; cleanup is deferred to the takeoverHandler slice (user story 9).
- **Heartbeat removal**: `adws/core/heartbeat.ts` was removed in this branch; the orchestrator-lifetime lock renders the periodic heartbeat redundant for the coordination primitive role it was filling.
