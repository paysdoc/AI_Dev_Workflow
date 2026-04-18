# Pause-Queue Resume Spawn Hardening

**ADW ID:** ope038-pause-queue-resume-s
**Date:** 2026-04-18
**Specification:** specs/issue-448-adw-ope038-pause-queue-resume-s-sdlc_planner-fix-silent-resume-spawn.md

## Overview

This fix hardens `resumeWorkflow()` in `adws/triggers/pauseQueueScanner.ts` against three independent silent-failure modes that caused paused workflows to be permanently lost during the 2026-04-18 depaudit#6 rate-limit incident. The change restructures the side-effect order from `remove → post comment → spawn (blind)` to `spawn → await alive → remove + post comment`, so a failed spawn leaves the queue entry intact for next-cycle retry.

## What Was Built

- `awaitChildReadiness(child, timeoutMs)` — a private helper that races child `'error'`/`'exit'` events against a 2-second timeout, resolving only if the child stays alive
- Per-resume append-log file at `agents/paused_queue_logs/{adwId}.resume.log` capturing child stdout/stderr
- Explicit `cwd: process.cwd()` on the spawned child (replaces implicit inheritance)
- Deferred `removeFromPauseQueue` and `postIssueStageComment` — both now run only after the readiness window elapses without an early exit
- On spawn failure: `updatePauseQueueEntry` increments `probeFailures`, reusing the existing `MAX_UNKNOWN_PROBE_FAILURES` escalation path
- Vitest unit test covering the four key behaviors in isolation (193 lines)

## Technical Implementation

### Files Modified

- `adws/triggers/pauseQueueScanner.ts`: Added `awaitChildReadiness` helper, per-resume log file capture, explicit `cwd`, reordered side-effects, spawn-failure recovery path; exported `resumeWorkflow` for testability
- `adws/triggers/__tests__/pauseQueueScanner.test.ts`: New vitest file with four test cases; mocks `child_process`, `fs`, and all ADW modules

### Key Changes

- **`stdio: 'ignore'` → `stdio: ['ignore', logFd, logFd]`** — child stderr is now captured to a per-`adwId` append-log instead of being discarded
- **`cwd: process.cwd()`** — the orchestrator must run in the cron host's directory where `adws/*.tsx` scripts reside, not in the target-repo worktree (which has no `adws/` subtree)
- **Side-effect order inverted** — `removeFromPauseQueue` and `postIssueStageComment('resumed')` are guarded behind the readiness promise; they are skipped entirely if the child exits early
- **`probeFailures` reused for spawn failures** — no new queue field; the existing `MAX_UNKNOWN_PROBE_FAILURES` bound drives eventual abandonment via the standard error comment
- **`READINESS_WINDOW_MS = 2000`** — local constant, not an env var; tuned to exceed typical `tsx` TypeScript import time (~1 s) while keeping the scan loop responsive

## How to Use

The fix is transparent to operators — the resume path is internal to the cron scanner. Observable differences:

1. A failed resume no longer removes the entry from `agents/paused_queue.json`; the entry remains with an incremented `probeFailures`.
2. `agents/paused_queue_logs/{adwId}.resume.log` is created on the first resume attempt and appended on each subsequent attempt — inspect it for child stderr when diagnosing a stranded workflow.
3. A successful resume now logs `Resumed workflow {adwId} (pid {pid})` at `success` level instead of a pre-spawn line only.
4. After `MAX_UNKNOWN_PROBE_FAILURES` (default 3) consecutive spawn failures, the standard "Manual restart required" error comment is posted to the GitHub issue.

## Configuration

No new configuration. Uses existing constants:

| Constant | Source | Value |
|---|---|---|
| `READINESS_WINDOW_MS` | `pauseQueueScanner.ts` (local) | `2000` ms |
| `MAX_UNKNOWN_PROBE_FAILURES` | `adws/core/config.ts` | `3` |
| `AGENTS_STATE_DIR` | `adws/core/environment.ts` | `agents/` |

## Testing

Run the targeted unit test:

```sh
bunx vitest run adws/triggers/__tests__/pauseQueueScanner.test.ts
```

Full validation suite:

```sh
bun run lint
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json
bun run test:unit
bun run build
```

To reproduce the fix manually: insert a broken entry into `agents/paused_queue.json` (e.g. `orchestratorScript: 'adws/doesNotExist.tsx'`) and kick the scanner. Before the fix the entry disappears and a false `▶️ Resumed` comment appears; after the fix the entry stays with `probeFailures: 1` and a log file is written under `agents/paused_queue_logs/`.

## Notes

- **Why `cwd: process.cwd()` not `entry.worktreePath`**: the issue's own "Suggested fix directions" recommend `entry.worktreePath`, but target-repo worktrees (e.g. `/Users/martin/projects/paysdoc/depaudit/.worktrees/*/`) do not contain `adws/` scripts — using them as `cwd` would cause `Cannot find module 'adws/adwSdlc.tsx'` on every external-repo resume. The correct cwd is the cron host repo, mirroring `webhookGatekeeper.ts:25-32`. A one-line code comment in `pauseQueueScanner.ts` records this reasoning.
- **Resume log retention**: no rotation. Files are bounded in count by the pause-queue volume (typically < 10 entries). Future cleanup can be wired into `adws/triggers/devServerJanitor.ts` if needed.
- **Related open issue**: issue #449 (cross-trigger cron+webhook duplicate-spawn race) is the second half of the 2026-04-18 incident and is tracked separately on `bugfix-issue-449-fix-cross-trigger-spawn-dedup`. This fix is scoped to #448 only.
- **Incident context**: the 2026-04-18 depaudit#6 incident stranded `u2drew` and `0ejypj` — both paused at 12:45, scanner logged "resumed" at 12:49:32, neither child actually started, pause queue went empty, one workflow was manually recovered 3.5 h later via a `## Take action` comment.
