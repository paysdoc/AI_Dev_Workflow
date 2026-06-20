# Coordination Kernel

## Overview

The coordination kernel manages the runtime lifecycle of ADW orchestrator processes. It provides liveness detection that is immune to PID reuse, a heartbeat ticker to distinguish alive-but-wedged from progressing orchestrators, a pure query to find hung orchestrators, per-phase timeout configuration, a generic retry-with-resolution loop, and a POSIX process-group kill helper.

## Responsibilities

- Emit periodic `lastSeenAt` heartbeat writes to the top-level state file so the cron sweeper can distinguish alive-but-wedged from alive-and-progressing orchestrators (`heartbeat.ts`).
- Determine whether a recorded PID is still the original process by pairing `kill -0` with process start-time comparison, eliminating PID-reuse false positives (`processLiveness.ts`).
- Scan all agent state directories and return orchestrators whose `workflowStage` ends in `_running`, whose PID is live per start-time, and whose `lastSeenAt` is older than a caller-supplied staleness threshold — without performing any kills or state writes (`hungOrchestratorDetector.ts`).
- Resolve per-phase watchdog timeouts from env vars, a static override map, or a configurable default (`agentTimeouts.ts`).
- Run a generic run-then-resolve retry loop, accumulating cost and model-usage, handling context-compaction resets without consuming retry budget, and logging each attempt to the agent state file (`retryOrchestrator.ts`).
- Terminate entire POSIX process groups (SIGTERM then SIGKILL after a grace period) to reach grandchildren orphaned by heredoc pipelines or nested shells (`processKill.ts`).

## Contracts & Invariants

- `isProcessLive` returns `false` — never throws — on Windows or when start-time cannot be read; callers must not rely on an exception to detect unsupported platforms.
- `findHungOrchestrators` never throws and never mutates state; all recovery actions belong to the caller.
- An entry is reported as hung only when all three conditions hold simultaneously: `workflowStage` ends in `_running`, the PID+start-time tuple is live, and `lastSeenAt` age strictly exceeds `staleThresholdMs`.
- Context-compaction resets in `retryWithResolution` do not increment `retryCount`; they increment `contextResetCount` and throw once `maxContextResets` is exceeded.
- `killProcessGroup` uses negative-PID (`-pid`) to signal the entire process group; it silently ignores ESRCH (process already gone) at both the SIGTERM and SIGKILL stages.
- Heartbeat write failures are logged as warnings and swallowed — a failed write does not stop the interval or propagate to the orchestrator.

## Configuration

- `AGENT_DEFAULT_TIMEOUT_MS` — default watchdog timeout in milliseconds (default: 1 800 000, i.e. 30 minutes). Parsed at module load time.
- `AGENT_PHASE_TIMEOUT_<PHASE_UPPER>` — per-phase override env var (e.g. `AGENT_PHASE_TIMEOUT_STEP_DEF`). Hyphens in phase names are replaced with underscores before uppercasing. Takes precedence over the static `AGENT_PHASE_TIMEOUT_MAP`.
- `MAX_CONTEXT_RESETS` — imported from `config.ts`; caps the number of compaction-driven context resets per `retryWithResolution` call.
- Heartbeat interval is passed by the caller to `startHeartbeat`; there is no module-level default.

## Gotchas

- On Linux, start-time is read from `/proc/<pid>/stat` field 22 (jiffies since boot). The parser anchors on the last `)` in the line to correctly handle process names that contain `)`. If the `/proc` entry is missing or malformed, `getProcessStartTime` returns `null` and `isProcessLive` returns `false`.
- On macOS/BSD, start-time comes from `ps -o lstart=`; the string includes day-of-week and is locale-dependent. Both sides of a comparison must be produced by the same `ps` invocation format for the equality check to be meaningful.
- Windows is explicitly unsupported: `getProcessStartTime` returns `null` unconditionally, so `isProcessLive` always returns `false`. No error is raised.
- `killProcessGroup` targets the process group (negative PID), not just the process. If the target process was started without its own process group (e.g. without `detached: true`), the kill will also reach sibling processes in the same group.
- `retryWithResolution` accumulates cost state in a closure-local object; callers that need to merge cost with an outer tracker must do so using the returned `RetryResult` fields, not by reading state mid-loop.
- `AGENT_PHASE_TIMEOUT_MAP` is populated at module initialisation using `process.env.AGENT_DEFAULT_TIMEOUT_MS`; tests that set this env var after module load will not see the updated default in the static map.
