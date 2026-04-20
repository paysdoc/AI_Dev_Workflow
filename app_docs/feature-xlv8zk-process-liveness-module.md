# Process Liveness Module (PID + Start-Time Authoritative Liveness)

**ADW ID:** xlv8zk-orchestrator-resilie
**Date:** 2026-04-20
**Specification:** specs/issue-456-adw-xlv8zk-orchestrator-resilie-sdlc_planner-process-liveness-module.md

## Overview

Introduces `adws/core/processLiveness.ts`, a deep module that closes the PID-reuse-after-reboot liveness hazard. Previously, a bare `process.kill(pid, 0)` check would return `true` for any process occupying a PID slot, including an unrelated process that inherited the PID after the original orchestrator died. The new module pairs `kill -0` with the platform start-time so `isProcessLive` only returns `true` when the PID is alive **and** its start-time exactly matches the value recorded at lock/state-write time.

## What Was Built

- `adws/core/processLiveness.ts` — new deep module with two public functions: `getProcessStartTime(pid)` and `isProcessLive(pid, recordedStartTime)`, plus a `ProcessLivenessDeps` injection interface for testing
- Platform-specific start-time reading: Linux reads `/proc/<pid>/stat` field 22; macOS/BSD shells out to `ps -o lstart= -p <pid>`; Windows returns `null` (unsupported, no throw)
- Migration of `adws/triggers/spawnGate.ts` — `IssueSpawnLockRecord` extended with `pidStartedAt`; stale-lock detection now uses `isProcessLive` instead of bare `isProcessAlive`
- Migration of `adws/core/stateHelpers.ts` — `isAgentProcessRunning` upgraded to require `pid` + `pidStartedAt` pair; `isProcessAlive` marked `@deprecated`
- `adws/core/agentState.ts` — `static isProcessAlive` removed; `static getProcessStartTime` and `static isProcessLive` added; re-exports updated
- `adws/core/index.ts` — barrel exports updated: `isProcessAlive` removed, `getProcessStartTime` and `isProcessLive` added
- `adws/types/agentTypes.ts` — `AgentState.pidStartedAt?: string` field added alongside `pid?: number`
- `adws/core/__tests__/processLiveness.test.ts` — full unit-test matrix covering alive-match, alive-mismatch (PID reuse), dead process, and non-existent PID across Linux, macOS, and Windows branches
- `adws/triggers/__tests__/spawnGate.test.ts` — updated to mock `processLiveness.isProcessLive`; new cases for PID-reuse reclaim and missing-`pidStartedAt` reclaim

## Technical Implementation

### Files Modified

- `adws/core/processLiveness.ts` *(new)* — deep module with platform dispatch; `ProcessLivenessDeps` injection seam; internal `readLinuxStartTime` and `readPsLstart` helpers
- `adws/core/__tests__/processLiveness.test.ts` *(new)* — 190-line Vitest suite; all tests use injected fakes, no real-PID assertions
- `adws/triggers/spawnGate.ts` — imports `getProcessStartTime`/`isProcessLive`; `IssueSpawnLockRecord` gets `pidStartedAt`; stale-lock branch updated
- `adws/triggers/__tests__/spawnGate.test.ts` — mocks swapped to `processLiveness`; new PID-reuse and missing-`pidStartedAt` tests added
- `adws/core/stateHelpers.ts` — `isAgentProcessRunning` reads `pidStartedAt` and delegates to `isProcessLive`; `isProcessAlive` deprecated
- `adws/core/agentState.ts` — removed `static isProcessAlive`; added `static getProcessStartTime`/`static isProcessLive`; re-exports updated
- `adws/core/index.ts` — barrel updated: `isProcessAlive` out, `getProcessStartTime`/`isProcessLive` in
- `adws/types/agentTypes.ts` — `pidStartedAt?: string` added to `AgentState`

### Key Changes

- **PID-reuse-safe liveness**: `isProcessLive(pid, recordedStartTime)` requires `kill -0` success AND start-time equality; returns `false` on any mismatch, including recycled PIDs
- **Linux parser robustness**: `/proc/<pid>/stat` reader anchors on the *last* `)` so `comm` names containing `)` are handled correctly before extracting field 22
- **Dependency injection**: `ProcessLivenessDeps` interface (`readFile`, `execPs`) lets tests substitute fakes for file reads and `ps` invocations without touching real PIDs
- **Backward-compatible stale-lock reclaim**: a lock record missing `pidStartedAt` (old format) is unconditionally treated as stale and reclaimed
- **Safe state-file default**: `isAgentProcessRunning` returns `false` when `pidStartedAt` is absent from the state file, upholding the new invariant that liveness requires the full tuple

## How to Use

1. **Import the module** in any ADW module that needs liveness:
   ```ts
   import { getProcessStartTime, isProcessLive } from 'adws/core/processLiveness';
   ```
2. **Record start-time at launch** (e.g., when writing a spawn lock or orchestrator state):
   ```ts
   const pidStartedAt = getProcessStartTime(process.pid) ?? '';
   ```
3. **Check liveness** by supplying both the PID and the recorded start-time:
   ```ts
   const alive = isProcessLive(existingRecord.pid, existingRecord.pidStartedAt);
   ```
4. **Inject fakes in tests** by passing a `ProcessLivenessDeps` object as the third argument to avoid real-process interactions.

## Configuration

No environment variables or configuration options required. The module auto-detects the platform via `process.platform` and uses only built-in Node APIs (`fs`, `child_process`). No package installation needed.

## Testing

```bash
# New processLiveness suite
bun run test:unit -- processLiveness

# Updated spawnGate suite (includes PID-reuse and missing-pidStartedAt cases)
bun run test:unit -- spawnGate

# Full unit suite
bun run test:unit

# Type check
bunx tsc --noEmit -p adws/tsconfig.json
```

## Notes

- **Out-of-scope call sites**: `cronProcessGuard.ts`, `cancelHandler.ts`, `trigger_shutdown.ts`, `devServerJanitor.ts`, and `workflowCommentsBase.ts` still import `isProcessAlive` directly from `stateHelpers.ts`. These are deferred to subsequent PRD issues; `@deprecated` JSDoc marks the direction of travel.
- **Write-side migration deferred**: `AgentState.pidStartedAt` is now typed and readable, but the broader write-side migration (ensuring every orchestrator records `pidStartedAt` on state creation) is a separate issue. Until that lands, `isAgentProcessRunning` returns `false` for state files that predate this change (safe default).
- **Platform tokens are opaque**: The module stores and compares start-time strings without parsing them (Linux: clock ticks since boot; macOS: human-readable `lstart`). Cross-platform comparison is intentionally not supported.
- **Windows**: `getProcessStartTime` returns `null` and `isProcessLive` returns `false` for any input; no error is thrown.
