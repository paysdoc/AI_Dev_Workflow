# Move Cron Log File to `logs/agents/cron/`

**ADW ID:** g3jxzh-chore-move-cron-log
**Date:** 2026-05-21
**Specification:** specs/issue-514-adw-g3jxzh-chore-move-cron-log-sdlc_planner-move-cron-log-to-logs-dir.md

## Overview

Separates cron stdout/stderr log output from orchestrator state by writing cron logs to `logs/agents/cron/{owner}_{repo}.log` instead of `agents/cron/{owner}_{repo}.log`. The `agents/` directory is reserved for state artefacts (PID files, `state.json`, heartbeat), while `logs/` is for log output. Previously, up to 13+ MB of log data was mixing into the state directory.

## What Was Built

- Updated the cron log directory path in `ensureCronProcess()` to use `LOGS_DIR` instead of `AGENTS_STATE_DIR`
- Removed the now-unused `AGENTS_STATE_DIR` import from `webhookGatekeeper.ts`
- Added `LOGS_DIR` to the existing `../core` import in `webhookGatekeeper.ts`

## Technical Implementation

### Files Modified

- `adws/triggers/webhookGatekeeper.ts`: Updated import to bring in `LOGS_DIR` from `../core` and removed `AGENTS_STATE_DIR`; changed `cronLogDir` computation from `path.join(AGENTS_STATE_DIR, 'cron')` to `path.join(LOGS_DIR, 'agents', 'cron')`

### Key Changes

- **Before:** `const cronLogDir = path.join(AGENTS_STATE_DIR, 'cron')` — placed logs at `agents/cron/{owner}_{repo}.log`
- **After:** `const cronLogDir = path.join(LOGS_DIR, 'agents', 'cron')` — places logs at `logs/agents/cron/{owner}_{repo}.log`
- Import consolidation: `AGENTS_STATE_DIR` (previously imported from `../core/config`) was dropped; `LOGS_DIR` was added to the existing `../core` import line
- PID files at `agents/cron/{owner}_{repo}.json` (written by `cronProcessGuard.ts`) are unaffected
- `trigger_shutdown.ts` cron shutdown loop filters for `*.json` only — no log-path references, no changes needed

## How to Use

No operator action is required. On the next cron spawn after deployment, `ensureCronProcess()` will create `logs/agents/cron/` automatically (via the existing `fs.mkdirSync(..., { recursive: true })` call) and write logs there.

Existing `agents/cron/*.log` files are left in place and can be moved or ignored — they are not consumed by any ADW component.

## Configuration

No configuration changes. `LOGS_DIR` is derived from `process.cwd()` in `adws/core/environment.ts` and was already exported from `adws/core/index.ts`.

## Testing

Run the validation suite to confirm no regressions:

```
bun run lint
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json
bun run test:unit
bun run build
```

## Notes

- A stale `logs/agents/cron/vestmatic_vestmatic.log` already existed from an earlier accident, so the target directory was present before this change.
- No back-compat shim attempts to read both old and new paths — there is no consumer of the `.log` file path, so a clean cut is safe.
- Migration of existing `agents/cron/*.log` files is out of scope per the issue.
