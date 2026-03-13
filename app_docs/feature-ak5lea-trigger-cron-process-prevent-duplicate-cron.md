# Prevent Duplicate trigger_cron Processes Per Repository

**ADW ID:** ak5lea-trigger-cron-process
**Date:** 2026-03-13
**Specification:** specs/issue-177-adw-ak5lea-trigger-cron-process-sdlc_planner-prevent-duplicate-trigger-cron.md

## Overview

This feature prevents multiple `trigger_cron` processes from running simultaneously for the same repository. When the webhook server restarts, it previously lost its in-memory tracking of spawned cron processes, allowing duplicate pollers to spawn. A persistent PID-file-based guard now ensures only one cron process runs per repo at any time, with automatic stale file cleanup.

## What Was Built

- New `cronProcessGuard.ts` module providing persistent PID-file-based duplicate detection
- Integration of PID-file checks in `ensureCronProcess()` in `webhookGatekeeper.ts`
- Startup self-guard in `trigger_cron.ts` that detects and exits duplicate processes

## Technical Implementation

### Files Modified

- `adws/triggers/cronProcessGuard.ts`: New module with PID file read/write/check functions and a `registerAndGuard()` startup guard
- `adws/triggers/webhookGatekeeper.ts`: Updated `ensureCronProcess()` to check PID file liveness before spawning and to write PID after spawning
- `adws/triggers/trigger_cron.ts`: Added startup call to `registerAndGuard()` — exits immediately if a live duplicate is detected for the same repo

### Key Changes

- **PID files** are stored at `agents/cron/{owner}_{repo}.json` with format `{ pid, repoKey, startedAt }`, persisting across webhook restarts
- **`isCronAliveForRepo(repoKey)`** reads the PID file and calls `isProcessAlive()` for an OS-level liveness check; stale files are removed automatically
- **`registerAndGuard(repoKey, ownPid)`** is called at `trigger_cron.ts` startup — if another live PID is registered for the same repo, it returns `false` and the new process exits with `process.exit(0)`
- **`ensureCronProcess()`** now has a two-layer guard: the existing in-memory `Set` (fast-path within a session) and the new PID file check (survives restarts)
- Cron processes for **different repositories** each have their own PID file and coexist without interference

## How to Use

The guard is fully automatic — no manual configuration is needed.

1. Start the webhook server normally (`bunx tsx adws/triggers/trigger_webhook.ts`)
2. The webhook calls `ensureCronProcess()` which checks the PID file before spawning
3. If the webhook is restarted, the next `ensureCronProcess()` call reads the PID file and skips spawning if the existing cron is still alive
4. If the existing cron has died (crashed or stopped), the stale PID file is cleaned up automatically and a new cron is spawned
5. If a race condition causes two cron processes to start simultaneously, the second one detects the first via `registerAndGuard()` at startup and exits immediately with a warning log

## Configuration

No configuration required. PID files are stored under `agents/cron/` following the project's existing `AGENTS_STATE_DIR` convention.

## Testing

Run the validation commands to verify correctness:

```bash
bun run lint
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json
bun run build
bun run test
```

To manually test duplicate prevention:
1. Start the webhook server so it spawns a `trigger_cron` process
2. Restart the webhook server
3. Verify only one `trigger_cron` process is running (`ps aux | grep trigger_cron`)
4. Check `agents/cron/` for the PID file

## Notes

- The in-memory `cronSpawnedForRepo` Set in `webhookGatekeeper.ts` is kept as a fast-path cache to avoid repeated disk reads within a single webhook session. The PID file is the authoritative source of truth across restarts.
- The `registerAndGuard()` startup guard in `trigger_cron.ts` acts as a second line of defense against race conditions between two simultaneous `ensureCronProcess()` calls.
- PID reuse by the OS is an accepted edge case — the polling intervals make this extremely unlikely in practice.
- This approach is intentionally simple (no lock files or IPC) and matches the project's existing `stateHelpers.ts` PID check patterns. A distributed setup (multi-machine) would require a network-based lock instead.
