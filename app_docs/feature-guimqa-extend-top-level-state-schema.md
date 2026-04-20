# Extend Top-Level State Schema with PID/Progress/Branch Fields and Atomic Writer

**ADW ID:** guimqa-orchestrator-resilie
**Date:** 2026-04-20
**Specification:** specs/issue-461-adw-guimqa-orchestrator-resilie-sdlc_planner-extend-top-level-state-schema.md

## Overview

Extends `agents/<adwId>/state.json` with four fields (`pid`, `pidStartedAt`, `lastSeenAt`, `branchName`) that let an operator determine orchestrator ownership and liveness without spelunking into per-phase subdirectories. Simultaneously hardens `writeTopLevelState` with atomic tmp-file + rename semantics, eliminating the risk of a torn state file once the heartbeat module starts writing every 30 seconds.

## What Was Built

- `lastSeenAt?: string` added to `AgentState` interface (the only genuinely new field — `pid`, `pidStartedAt`, `branchName` already existed from #456)
- JSDoc updated for all four fields documenting per-field format contracts (`pidStartedAt` platform-token format, ISO 8601 for `lastSeenAt`)
- `atomicWriteJson` private helper extracted in `agentState.ts` — writes to `.tmp` then `fs.renameSync` into place
- `writeTopLevelState` refactored to use `atomicWriteJson` instead of direct `writeFileSync`
- Four new unit tests covering the full acceptance criteria surface

## Technical Implementation

### Files Modified

- `adws/types/agentTypes.ts`: Added `lastSeenAt?: string` to `AgentState`; updated JSDoc for all four liveness fields with format contracts
- `adws/core/agentState.ts`: Extracted `atomicWriteJson(filePath, data)` helper; replaced `fs.writeFileSync` in `writeTopLevelState` with `atomicWriteJson`
- `adws/core/__tests__/topLevelState.test.ts`: Added four new test cases (new-schema round-trip, pre-461 forward-compatible read, partial-patch preservation, no stale temp file)

### Key Changes

- `atomicWriteJson` writes `filePath + '.tmp'` then calls `fs.renameSync` — atomic on POSIX; a mid-write crash leaves the `.tmp` behind but the next call overwrites it before renaming
- All four fields remain `?: optional` on the interface so existing state files without these fields deserialize without error (missing fields surface as `undefined`)
- `readTopLevelState` is unchanged — it does `JSON.parse(...) as AgentState` with no field-level validation, so forward-compatible read is free
- The partial-patch write preserves existing fields because `writeTopLevelState` does a shallow merge before calling `atomicWriteJson`
- No orchestrator entrypoints wired — heartbeat and takeover slices will consume the schema in follow-up issues

## How to Use

This slice is schema + writer only. Consumers read and write these fields through the existing `AgentStateManager` API:

1. Read liveness fields: `AgentStateManager.readTopLevelState(adwId)` — returns `AgentState | null`; access `state.pid`, `state.pidStartedAt`, `state.lastSeenAt`, `state.branchName` (may be `undefined` for pre-461 files)
2. Patch a single field atomically: `AgentStateManager.writeTopLevelState(adwId, { lastSeenAt: new Date().toISOString() })` — preserves all other fields
3. Write all four at launch: `AgentStateManager.writeTopLevelState(adwId, { pid: process.pid, pidStartedAt, branchName, lastSeenAt })`

## Configuration

No new environment variables or configuration files. The `.tmp` file convention uses the same directory as the canonical state file (`AGENTS_STATE_DIR`); no cross-filesystem rename risk.

## Testing

```bash
bun run test:unit -- topLevelState   # targeted suite (four new + existing tests)
bun run test:unit                    # full unit suite (regression guard)
bunx tsc --noEmit -p adws/tsconfig.json
bun run lint
bun run build
```

## Notes

- `pidStartedAt` format: Linux returns `/proc/<pid>/stat` field 22 (jiffies string); macOS/BSD returns `ps -o lstart=` output (e.g. `"Sun Apr 20 10:15:23 2026"`); produced by `processLiveness.getProcessStartTime`
- `lastSeenAt` will be written by the heartbeat module (future slice) every 30 seconds via `writeTopLevelState({ lastSeenAt: new Date().toISOString() })`
- A pre-existing `.tmp` file from a prior crash is silently overwritten on the next `writeTopLevelState` call — no cleanup branch needed
- `renameSync` raises `EXDEV` on cross-filesystem moves; not a risk here since `.tmp` and target live under the same `AGENTS_STATE_DIR`
- BDD coverage: `features/extend_top_level_state_schema.feature` tagged `@adw-461`
