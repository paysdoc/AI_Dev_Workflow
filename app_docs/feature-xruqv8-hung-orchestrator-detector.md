# Hung Orchestrator Detector

**ADW ID:** xruqv8-orchestrator-resilie
**Date:** 2026-04-20
**Specification:** specs/issue-465-adw-xruqv8-orchestrator-resilie-sdlc_planner-hung-orchestrator-detector.md

## Overview

Adds `adws/core/hungOrchestratorDetector.ts`, a pure-query module that identifies wedged orchestrators — those with a live PID but a stale `lastSeenAt` — and wires an automatic recovery sweep into the cron per-cycle work. When a hung orchestrator is detected, the cron SIGKILLs the PID and rewrites state to `abandoned` so the existing retriable-stage path can respawn it on the next cycle.

## What Was Built

- `hungOrchestratorDetector.ts` — pure read-only module exporting `findHungOrchestrators(now, staleThresholdMs, deps?)`
- `HUNG_DETECTOR_INTERVAL_CYCLES` constant in `adws/core/config.ts` (default 5 ≈ 100 s)
- `runHungDetectorSweep(now, deps?)` helper exported from `trigger_cron.ts` for testability
- Cron sweep block inside `checkAndTrigger()`: SIGKILL + `abandoned` state rewrite per hung entry, gated on cycle counter
- Guard in `trigger_cron.ts` to skip `activateGitHubAppAuth` and `registerAndGuard`/`setInterval` when the file is imported as a module (test safety)
- Contract test suite `adws/core/__tests__/hungOrchestratorDetector.test.ts` — fixture state files on disk, injected `isProcessLive` fake, injected clock via `now` parameter
- Cron-integration test suite `adws/triggers/__tests__/trigger_cron.test.ts` — stubs `findHungOrchestrators`, spies on `process.kill` and `AgentStateManager.writeTopLevelState`
- BDD feature `features/hung_orchestrator_detector.feature` with step definitions

## Technical Implementation

### Files Modified

- `adws/core/hungOrchestratorDetector.ts`: new — pure query; exports `findHungOrchestrators`, `HungOrchestrator`, `HungDetectorDeps`, `defaultHungDetectorDeps`
- `adws/core/config.ts`: added `HUNG_DETECTOR_INTERVAL_CYCLES` constant
- `adws/core/index.ts`: re-exports for `findHungOrchestrators`, `defaultHungDetectorDeps`, `HUNG_DETECTOR_INTERVAL_CYCLES`, and types
- `adws/triggers/trigger_cron.ts`: imports detector + `AgentStateManager`; adds `runHungDetectorSweep`; wires sweep into `checkAndTrigger()`; guards module-level side effects behind `process.argv[1]` check
- `adws/core/__tests__/hungOrchestratorDetector.test.ts`: new — contract tests
- `adws/triggers/__tests__/trigger_cron.test.ts`: new — cron-integration tests
- `features/hung_orchestrator_detector.feature`: new — BDD scenarios
- `features/step_definitions/hungOrchestratorDetectorSteps.ts`: new — step definitions

### Key Changes

- **Pure-query separation:** the detector performs no kills, no state writes; all side effects belong to the caller. This makes the module trivially testable with fake deps.
- **Dependency injection via `HungDetectorDeps`:** `listAdwIds`, `readTopLevelState`, and `isProcessLive` are all injectable, mirroring the `JanitorDeps` pattern in `devServerJanitor.ts`.
- **Defensive skips:** entries missing `pid`, `pidStartedAt`, or `lastSeenAt`, or with an unparseable timestamp, are silently skipped — never throw.
- **Per-entry error isolation:** SIGKILL and state rewrite are each wrapped in independent `try/catch`; a failure on one entry does not abort siblings.
- **Import guard in `trigger_cron.ts`:** `activateGitHubAppAuth`, `registerAndGuard`, and `setInterval` are now gated on `process.argv[1]?.includes('trigger_cron')` to prevent side effects when the module is imported by tests.

## How to Use

The detector runs automatically every `HUNG_DETECTOR_INTERVAL_CYCLES` cron cycles (default 100 s). No operator action is required for normal recovery.

To tune the sweep frequency:
```
HUNG_DETECTOR_INTERVAL_CYCLES=3  # check every ~60s
```

To tune the staleness threshold (shared with the heartbeat module):
```
HEARTBEAT_STALE_THRESHOLD_MS=120000  # 2 minutes instead of 3
```

To call the detector directly (e.g., in a diagnostic script):
```ts
import { findHungOrchestrators } from './adws/core';
const hung = findHungOrchestrators(Date.now(), 180_000);
console.log(hung);
```

## Configuration

| Constant | Env var | Default | Description |
|---|---|---|---|
| `HUNG_DETECTOR_INTERVAL_CYCLES` | `HUNG_DETECTOR_INTERVAL_CYCLES` | `5` | Cron cycles between detector passes (5 × 20 s = 100 s) |
| `HEARTBEAT_STALE_THRESHOLD_MS` | `HEARTBEAT_STALE_THRESHOLD_MS` | `180000` | Age (ms) at which `lastSeenAt` is considered stale |

## Testing

```bash
# Contract tests (detector logic only)
bun run test:unit -- hungOrchestratorDetector

# Cron-integration tests (SIGKILL + state rewrite side effects)
bun run test:unit -- trigger_cron

# Full unit suite
bun run test:unit

# BDD regression
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

## Notes

- **Prerequisite signals:** the detector depends on the heartbeat module (shipped in #462) writing `lastSeenAt` every 30 s. Only `adwSdlc` currently runs a heartbeat (tracer-bullet); other orchestrators are covered in PRD slice #8.
- **`pidStartedAt` write-side migration deferred:** entries without `pidStartedAt` are safely skipped. PID-reuse-safe detection requires both `pid` and `pidStartedAt` from the top-level state file (per `app_docs/feature-xlv8zk-process-liveness-module.md`).
- **Recovery path:** after `abandoned` is written, the existing `isRetriableStage('abandoned') === true` path in `cronStageResolver.ts` causes the issue to be respawned on the next cron cycle with no additional changes required.
- **Relationship to devServerJanitor:** the janitor targets orphaned dev-server subprocesses; this detector targets the orchestrator process itself while still alive but wedged — complementary, not overlapping.
- **Relationship to takeoverHandler (future PRD slice #11):** the `abandoned` rewrite is the coordination point; the takeover handler will consume it on the next cycle.
