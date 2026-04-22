# Takeover Handler Integration

**ADW ID:** i4m1uk-orchestrator-resilie
**Date:** 2026-04-21
**Specification:** specs/issue-467-adw-i4m1uk-orchestrator-resilie-sdlc_planner-takeover-handler-integration.md

## Overview

Introduces `adws/triggers/takeoverHandler.ts`, the deep module that encodes the full orchestrator takeover decision tree from the coordination-resilience PRD. Its single public entry point `evaluateCandidate({ issueNumber, repoInfo }) → CandidateDecision` is now the mandatory gate before every standard (non-merge) spawn in both the cron and webhook trigger paths. This replaces the prior ad-hoc pattern where cron and webhook each independently acquired a spawn lock and checked `isAdwRunningForIssue`, which could not distinguish a fresh start from a takeover of an abandoned or dead orchestrator.

## What Was Built

- `adws/triggers/takeoverHandler.ts` — new deep module exporting `evaluateCandidate`, `CandidateDecision`, `TakeoverDeps`, and `buildDefaultTakeoverDeps`
- `adws/triggers/__tests__/takeoverHandler.test.ts` — unit test suite (359 lines) covering every decision-tree branch with injected doubles
- `adws/triggers/__tests__/takeoverHandler.integration.test.ts` — integration test (133 lines) exercising the abandoned-state takeover path end-to-end against a fixture state file
- `adws/triggers/spawnGate.ts` — gained `readSpawnLockRecord` read-only helper and `pidStartedAt` field in lock records
- `adws/triggers/trigger_cron.ts` — calls `evaluateCandidate` at the top of every `action === 'spawn'` branch before `classifyAndSpawnWorkflow`
- `adws/triggers/webhookGatekeeper.ts` — `classifyAndSpawnWorkflow` now calls `evaluateCandidate` (or accepts a pre-computed decision from cron) instead of the old `acquireIssueSpawnLock` call
- BDD feature file and step definitions for the takeover handler integration

## Technical Implementation

### Files Modified

- `adws/triggers/takeoverHandler.ts`: New module — 185 lines implementing the five-branch decision tree with full DI
- `adws/triggers/__tests__/takeoverHandler.test.ts`: New unit test suite — 359 lines, vitest, injected mocks
- `adws/triggers/__tests__/takeoverHandler.integration.test.ts`: New integration test — 133 lines, fixture state file, stubbed GitHub reconcile
- `adws/triggers/spawnGate.ts`: Added `readSpawnLockRecord()` export; upgraded `acquireIssueSpawnLock` to write `pidStartedAt` and use `isProcessLive` instead of `isProcessAlive`
- `adws/triggers/trigger_cron.ts`: Imports `evaluateCandidate`; calls it before every spawn; dispatches on `defer_live_holder`, `skip_terminal`, `take_over_adwId`, and `spawn_fresh`
- `adws/triggers/webhookGatekeeper.ts`: `classifyAndSpawnWorkflow` accepts optional `precomputedDecision`; internally calls `evaluateCandidate` when no pre-computed decision is provided; removed old `acquireIssueSpawnLock` call
- `features/takeover_handler_integration.feature`: BDD scenarios (434 lines)
- `features/step_definitions/takeoverHandlerSteps.ts`: Step definitions (774 lines)

### Key Changes

- **`CandidateDecision` discriminated union** — four kinds: `spawn_fresh`, `take_over_adwId` (carries `adwId` + `derivedStage`), `defer_live_holder` (carries `holderPid`), `skip_terminal` (carries `adwId` + `terminalStage`: `'completed' | 'discarded' | 'paused'`).
- **Five-branch decision tree** — evaluated in order: (1) lock held by live holder → `defer_live_holder`; (2) no adwId or no state file → `spawn_fresh`; (3) `completed`/`discarded` → `skip_terminal` with lock released; (4) `paused` → `skip_terminal` (pause queue scanner is sole resumer); (5) `abandoned` or `*_running`/`starting`/`resuming` → `worktreeReset` → `remoteReconcile` → `take_over_adwId`, with SIGKILL for live-but-unlocked PIDs on running-stage branches.
- **`TakeoverDeps` DI interface** — all I/O injected (`acquireIssueSpawnLock`, `releaseIssueSpawnLock`, `readSpawnLockRecord`, `resolveAdwId`, `readTopLevelState`, `isProcessLive`, `killProcess`, `resetWorktree`, `deriveStageFromRemote`, `getWorktreePath`). `buildDefaultTakeoverDeps()` wires production implementations.
- **Lock handoff** — on `spawn_fresh` and `take_over_adwId`, the lock stays held by the trigger process and is inherited by the child orchestrator, which re-acquires it via `acquireOrchestratorLock` (issue #463). On `defer_live_holder` and `skip_terminal`, the lock is released internally before returning.
- **Cron double-evaluation prevention** — `trigger_cron.ts` passes the pre-computed `CandidateDecision` as an optional fifth argument to `classifyAndSpawnWorkflow`; when present, `classifyAndSpawnWorkflow` skips its own `evaluateCandidate` call and uses the forwarded decision directly.

## How to Use

`evaluateCandidate` is called automatically by both trigger paths — no manual invocation needed for normal operation.

**Consuming the decision (trigger-level pattern):**

```ts
import { evaluateCandidate } from './takeoverHandler';

const decision = evaluateCandidate({ issueNumber: issue.number, repoInfo });

if (decision.kind === 'defer_live_holder') {
  log(`live holder pid=${decision.holderPid}, skipping`);
  return;
}
if (decision.kind === 'skip_terminal') {
  log(`terminal stage "${decision.terminalStage}", skipping`);
  return;
}
if (decision.kind === 'take_over_adwId') {
  // spawn the existing adwId directly
  spawnDetached('bunx', ['tsx', 'adws/adwSdlc.tsx', String(issueNumber), decision.adwId, ...targetRepoArgs]);
  releaseIssueSpawnLock(repoInfo, issueNumber);
  return;
}
// spawn_fresh: proceed with classifyAndSpawnWorkflow
await classifyAndSpawnWorkflow(issueNumber, repoInfo, targetRepoArgs, undefined, decision);
```

**Decision tree summary:**

| State file condition | Returned kind |
|---|---|
| Lock held by live process | `defer_live_holder` |
| No adwId or no state file | `spawn_fresh` |
| `completed` or `discarded` stage | `skip_terminal` |
| `paused` stage | `skip_terminal` (terminalStage: 'paused') |
| `abandoned` stage | `take_over_adwId` |
| `*_running`/`starting`/`resuming` + dead PID | `take_over_adwId` |
| `*_running`/`starting`/`resuming` + live unlocked PID | SIGKILL → `take_over_adwId` |
| Any other stage | `spawn_fresh` (defensive fallthrough) |

**Testing with injected deps:**

```ts
import { evaluateCandidate } from '../takeoverHandler';
import type { TakeoverDeps } from '../takeoverHandler';

const deps: TakeoverDeps = {
  acquireIssueSpawnLock: vi.fn().mockReturnValue(true),
  releaseIssueSpawnLock: vi.fn(),
  readSpawnLockRecord: vi.fn().mockReturnValue(null),
  resolveAdwId: vi.fn().mockReturnValue('fixture-adwid'),
  readTopLevelState: vi.fn().mockReturnValue({ workflowStage: 'abandoned', branchName: 'feature/issue-999' }),
  isProcessLive: vi.fn().mockReturnValue(false),
  killProcess: vi.fn(),
  resetWorktree: vi.fn(),
  deriveStageFromRemote: vi.fn().mockReturnValue('awaiting_merge'),
  getWorktreePath: vi.fn().mockReturnValue('/tmp/worktree-path'),
};

const decision = evaluateCandidate({ issueNumber: 999, repoInfo }, deps);
// decision.kind === 'take_over_adwId'
```

## Configuration

No new configuration required. The module uses the existing `AGENTS_STATE_DIR` (via `agentState.ts`) and reads `spawnGate` lock files from the same directory.

## Testing

```bash
# Full suite (unit + integration)
bunx vitest run adws/triggers/__tests__/takeoverHandler.test.ts adws/triggers/__tests__/takeoverHandler.integration.test.ts

# With regression checks
bunx vitest run adws/triggers/__tests__/takeoverHandler.test.ts adws/triggers/__tests__/takeoverHandler.integration.test.ts adws/triggers/__tests__/spawnGate.test.ts adws/triggers/__tests__/webhookHandlers.test.ts adws/triggers/__tests__/cronIssueFilter.test.ts adws/triggers/__tests__/cronStageResolver.test.ts
```

The unit test suite is organized into one describe block per decision-tree branch. The integration test writes a fixture `abandoned` state file to a temp dir, injects stubbed `resetWorktree` and `deriveStageFromRemote`, and asserts the full `worktreeReset → remoteReconcile → take_over_adwId` sequence.

## Notes

- **`paused` is not a takeover target** — the pause queue scanner in `pauseQueueScanner.ts` is the sole resumer. `evaluateCandidate` returns `skip_terminal` with `terminalStage: 'paused'` so both trigger paths skip without spawning.
- **`adwPrReview.tsx` is out of scope** — PR review orchestrators are keyed by PR number, have no top-level state, and are spawned directly in `trigger_webhook.ts` lines 110/123 and `trigger_cron.ts` line 169. These sites intentionally bypass `evaluateCandidate`.
- **`awaiting_merge` cron path unchanged** — `trigger_cron.ts` dispatches merge candidates to `adwMerge.tsx` before reaching the `evaluateCandidate` gate. This is intentional per the PRD.
- **No `lastSeenAt` reads** — the hung-orchestrator detector (a future PRD slice) will consume `lastSeenAt`. This module reads only `pid` + `pidStartedAt` for the dead-vs-live decision.
- **`branchName`-less state files** — state files written before issue #461 lack `branchName`. On `abandoned` and `*_running` branches, `resetWorktree` is skipped when `branchName` is absent; `remoteReconcile` still runs and handles the missing-branch case via its own fallback chain.
- Parent PRD: `specs/prd/orchestrator-coordination-resilience.md`
