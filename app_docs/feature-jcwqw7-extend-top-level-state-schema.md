# Extend Top-Level State Schema with `lastSeenAt` and Atomic `writeTopLevelState`

**ADW ID:** jcwqw7-orchestrator-resilie
**Date:** 2026-04-20
**Specification:** specs/issue-461-adw-guimqa-orchestrator-resilie-sdlc_planner-extend-top-level-state-schema.md

## Overview

Extends `agents/<adwId>/state.json` with a new `lastSeenAt` field and refreshes the JSDoc for the three existing liveness fields (`pid`, `pidStartedAt`, `branchName`). Simultaneously upgrades `AgentStateManager.writeTopLevelState()` from a plain `fs.writeFileSync` to an atomic write-temp-then-rename pattern, eliminating the risk of a torn or zero-byte state file once the heartbeat module starts writing every 30 seconds.

## What Was Built

- `lastSeenAt?: string` added to `AgentState` interface in `adws/types/agentTypes.ts` — the only genuinely new field (`pid`, `pidStartedAt`, `branchName` already existed from PRD slice #456)
- JSDoc refreshed on all four fields documenting format contracts: `pidStartedAt` platform-token format, ISO 8601 for `lastSeenAt`, operator-facing description for `branchName`
- `writeTopLevelState` upgraded to atomic write-temp-then-rename; cleanup of `.tmp` file on error
- Four new unit tests in `adws/core/__tests__/topLevelState.test.ts` covering the full acceptance-criteria surface

## Technical Implementation

### Files Modified

- `adws/types/agentTypes.ts`: Added `lastSeenAt?: string` to `AgentState`; refreshed JSDoc on `pid`, `pidStartedAt`, `branchName`, and the new `lastSeenAt`
- `adws/core/agentState.ts`: Extracted `atomicWriteJson(filePath, data)` module-level helper; replaced the tail `fs.writeFileSync` in `writeTopLevelState` with `atomicWriteJson`; added `getProcessStartTime` and `isProcessLive` as delegated statics on `AgentStateManager`
- `adws/core/__tests__/topLevelState.test.ts`: Added four new test cases (new-schema round-trip, pre-461 forward-compatible read, partial-patch field preservation, no stale `.tmp` file on success)

### Key Changes

- `atomicWriteJson` writes to `filePath + '.tmp'` then calls `fs.renameSync` — atomic on POSIX; a mid-write crash leaves the `.tmp` behind but the next call overwrites it before renaming, requiring no cleanup branch
- All four fields remain `?: optional` so existing state files without these fields deserialize without error; missing fields surface as `undefined`
- `readTopLevelState` is unchanged — it does `JSON.parse(...) as AgentState` with no field-level validation, so forward-compatible read is automatic
- Partial-patch writes preserve all existing fields because `writeTopLevelState` performs a shallow merge before calling `atomicWriteJson`
- No orchestrator entrypoints are wired — heartbeat and takeover slices will consume the schema in follow-up issues

## How to Use

This slice is schema + writer only. Consumers read and write these fields through the existing `AgentStateManager` API:

1. **Read liveness fields**: `AgentStateManager.readTopLevelState(adwId)` — returns `AgentState | null`; access `state.pid`, `state.pidStartedAt`, `state.lastSeenAt`, `state.branchName` (may be `undefined` for pre-461 files)
2. **Patch a single field atomically**: `AgentStateManager.writeTopLevelState(adwId, { lastSeenAt: new Date().toISOString() })` — preserves all other fields unchanged
3. **Write all four fields at orchestrator launch**: `AgentStateManager.writeTopLevelState(adwId, { pid: process.pid, pidStartedAt, branchName, lastSeenAt })`

## Configuration

No new environment variables or configuration files. The `.tmp` file convention uses the same directory as the canonical state file (`AGENTS_STATE_DIR`); no cross-filesystem rename risk.

## Testing

```bash
bun run test:unit -- topLevelState   # targeted suite (four new + existing tests must all pass)
bun run test:unit                    # full unit suite (regression guard)
bunx tsc --noEmit -p adws/tsconfig.json
bun run lint
bun run build
```

## Notes

- `pidStartedAt` format: Linux returns `/proc/<pid>/stat` field 22 (jiffies string); macOS/BSD returns `ps -o lstart=` output (e.g. `"Sun Apr 20 10:15:23 2026"`); produced by `processLiveness.getProcessStartTime` — never re-normalised by the writer
- `lastSeenAt` will be written by the heartbeat module (future slice) every 30 seconds via `writeTopLevelState({ lastSeenAt: new Date().toISOString() })`; a stale `lastSeenAt` with a live PID indicates a wedged event loop
- A pre-existing `.tmp` file from a prior crash is silently overwritten on the next `writeTopLevelState` call; `fs.unlinkSync` is attempted on any write/rename error before re-throwing
- `renameSync` raises `EXDEV` on cross-filesystem moves; not a risk here since `.tmp` and target live under the same `AGENTS_STATE_DIR`
- BDD coverage for this feature lives in `features/extend_top_level_state_schema.feature` tagged `@adw-461`
- See also `app_docs/feature-guimqa-extend-top-level-state-schema.md` — parallel planning run for the same issue
