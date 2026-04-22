# Heartbeat Module + adwSdlc Tracer Integration

**ADW ID:** zy5s32-orchestrator-resilie
**Date:** 2026-04-20
**Specification:** specs/issue-462-adw-zy5s32-orchestrator-resilie-sdlc_planner-heartbeat-module-and-adwsdlc-tracer.md

## Overview

Implements a self-contained `heartbeat` module that writes `lastSeenAt` (ISO 8601) to the top-level state file on a fixed 30-second interval, completely decoupled from phase progress. The module is wired into `adwSdlc` as a tracer bullet, enabling the future hung-orchestrator detector to distinguish "alive and progressing", "alive but wedged", and "dead" states from the state file alone.

## What Was Built

- `adws/core/heartbeat.ts` — new module exporting `startHeartbeat`, `stopHeartbeat`, and `HeartbeatHandle`
- `adws/core/config.ts` — two new timing constants: `HEARTBEAT_TICK_INTERVAL_MS` (30s) and `HEARTBEAT_STALE_THRESHOLD_MS` (180s)
- `adws/core/index.ts` — barrel re-exports for the new heartbeat symbols
- `adws/adwSdlc.tsx` — tracer-bullet wiring: heartbeat starts after state init, stops in `finally`
- `adws/core/__tests__/heartbeat.test.ts` — Vitest contract tests with fake timers

## Technical Implementation

### Files Modified

- `adws/core/heartbeat.ts`: New module. `startHeartbeat(adwId, intervalMs)` creates a `setInterval` that calls `AgentStateManager.writeTopLevelState(adwId, { lastSeenAt: new Date().toISOString() })` per tick, swallowing write errors. `stopHeartbeat(handle)` calls `clearInterval` — idempotent by design.
- `adws/core/config.ts`: Added `HEARTBEAT_TICK_INTERVAL_MS = 30_000` and `HEARTBEAT_STALE_THRESHOLD_MS = 180_000` alongside existing timing constants.
- `adws/core/index.ts`: Re-exports `startHeartbeat`, `stopHeartbeat`, `type HeartbeatHandle` from `./heartbeat`.
- `adws/adwSdlc.tsx`: Imports `startHeartbeat`/`stopHeartbeat`/`HeartbeatHandle` from `./core/heartbeat` and `HEARTBEAT_TICK_INTERVAL_MS` from `./core/config`. Declares `let heartbeat: HeartbeatHandle | null = null` before the `try`, assigns it as the first statement inside `try`, and clears it in a new `finally` block.
- `adws/core/__tests__/heartbeat.test.ts`: Four contract tests covering tick write, stop prevents further writes, idempotent stop, and tick survival after a write error.

### Key Changes

- The heartbeat module has zero imports from `phases/`, `workflowPhases`, or orchestrator flow — it is a pure liveness ticker.
- Write failures are caught and logged with `warn`; the `setInterval` continues firing regardless.
- `stopHeartbeat` is idempotent (`clearInterval` on a cleared timer is a no-op), so the `finally` block in `adwSdlc.tsx` doesn't need to null the handle after calling stop.
- `HEARTBEAT_STALE_THRESHOLD_MS` has no consumer in this slice — it is added now so the future hung-orchestrator detector can import it from `config.ts` without a churn commit.
- The wire-up is intentionally tracer-bullet scoped to `adwSdlc` only; the remaining eleven orchestrators are wired via the shared wrapper in PRD slice #8.

## How to Use

1. `startHeartbeat` is called automatically when `adwSdlc` runs — no operator action required.
2. To observe ticks: `watch -n 5 'jq .lastSeenAt agents/<adwId>/state.json'` while a workflow is running.
3. Killing the orchestrator process stops ticks immediately; `lastSeenAt` freezes at the last written value.
4. For future detectors: compare `lastSeenAt` against wall time; if the gap exceeds `HEARTBEAT_STALE_THRESHOLD_MS` (180s) and the PID is still live, the orchestrator is hung.

## Configuration

| Constant | Default | Location |
|---|---|---|
| `HEARTBEAT_TICK_INTERVAL_MS` | `30_000` ms | `adws/core/config.ts` |
| `HEARTBEAT_STALE_THRESHOLD_MS` | `180_000` ms | `adws/core/config.ts` |

Both are plain `const` exports — tuning requires a single-line code edit (no env var override in this slice).

## Testing

```bash
bun run test:unit -- heartbeat
```

Four cases: tick writes `lastSeenAt` within `intervalMs * 1.5`; `stopHeartbeat` prevents further writes; `stopHeartbeat` is safe to call twice; a single write error does not kill the timer.

Tests use `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync()` and hit the real filesystem via `AgentStateManager.writeTopLevelState`. Each test seeds a fresh per-`adwId` state directory and cleans it up in `afterEach`.

## Notes

- Only `adwSdlc` is wired in this slice. The shared entrypoint wrapper (PRD slice #8) will roll out heartbeat wiring to all twelve orchestrators.
- `lastSeenAt` field is defined on `AgentState` (from issue #461). The heartbeat writes it via the atomic `writeTopLevelState` partial-patch writer, which preserves all other fields.
- The `finally` block placement (`after catch, before end of main`) ensures `stopHeartbeat` runs on normal exit, handled errors, and unhandled throws.
