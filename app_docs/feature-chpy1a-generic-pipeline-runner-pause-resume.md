# Generic Pipeline Runner with Rate Limit Pause/Resume

**ADW ID:** chpy1a-orchestrator-refacto
**Date:** 2026-03-26
**Specification:** specs/issue-314-adw-chpy1a-orchestrator-refacto-sdlc_planner-generic-pipeline-runner.md

## Overview

This feature adds rate limit detection and pause/resume mechanics to ADW workflows so that multi-phase runs survive API outages without losing progress. When Claude CLI hits a rate limit, billing cap, or API outage, the workflow pauses gracefully, records its completed phases to disk, and enqueues itself for automatic probing and resumption. It also migrates 4 outlier orchestrators to the modern `CostTracker + runPhase()` pattern so all workflows benefit from the new cross-cutting behavior.

## What Was Built

- **Rate limit detection** — `agentProcessHandler.ts` now detects 4 rate-limit/outage strings in Claude CLI output and sets `rateLimited: true` on `AgentResult`
- **`RateLimitError` class** — typed error thrown from `runClaudeAgentWithCommand` so all agent invocations automatically propagate the signal without per-agent changes
- **`pauseQueue.ts`** — new module providing atomic read/write/remove operations on `agents/paused_queue.json`
- **`pauseQueueScanner.ts`** — cron-integrated probe logic: sends a cheap haiku ping every N cycles; on success, removes from queue and respawns the orchestrator detached
- **`handleRateLimitPause()`** — writes `completedPhases` and `pausedAtPhase` to state.json, enqueues the workflow, posts a `⏸️ Paused` comment on the GitHub issue, and exits 0
- **`runPhase()` enhancements** — catches `RateLimitError` and calls `handleRateLimitPause`; skips already-completed phases on resume via `config.completedPhases`; records each completed phase name to state.json after success
- **New workflow stages** — `paused` and `resumed` added to `WorkflowStage` union, `STAGE_ORDER`, `STAGE_HEADER_MAP`, and `workflowCommentsIssue.ts` templates
- **Cron trigger improvements** — status-aware issue re-evaluation (re-runs `error`, `paused`, `review_failed`, `build_failed`); verbose one-liner poll log per cycle; pause queue scanning wired in; dependency-deferred issues no longer added to `processedIssues`
- **Dependency extraction improvements** — keyword proximity parser eliminates unnecessary LLM calls; in-memory cache keyed by issue body hash
- **Orchestrator migrations** — `adwBuild`, `adwPatch`, `adwTest`, and `adwPrReview` migrated to `initializeWorkflow + CostTracker + runPhase()` pattern

## Technical Implementation

### Files Modified

- `adws/agents/agentProcessHandler.ts`: Detects rate-limit/outage strings (`"You've hit your limit"`, `"You're out of extra usage"`, `502 Bad Gateway`, `Invalid authentication credentials`); sets `rateLimited: true` on `AgentResult`; also consolidated `compactionDetected` handling here
- `adws/types/agentTypes.ts`: Added `rateLimited?: boolean` and `compactionDetected?: boolean` to `AgentResult`; added `RateLimitError` class; added `'paused'` to `AgentExecutionStatus`; added `'alignment-agent'` identifier
- `adws/agents/claudeAgent.ts`: Propagates `rateLimited` flag — does NOT retry (unlike `authExpired`)
- `adws/core/phaseRunner.ts`: `runPhase()` now accepts optional `phaseName`, catches `RateLimitError`, skips completed phases, and records phase completion to state.json
- `adws/phases/workflowCompletion.ts`: Added `handleRateLimitPause()` and `deriveOrchestratorScript()` helper; fixed `reviewContinuationCount` tracking; wired `onCompactionDetected` callback in review phase
- `adws/phases/workflowInit.ts`: Reads `completedPhases` from state.json on resume and stores on `WorkflowConfig`
- `adws/triggers/trigger_cron.ts`: Added `cycleCount`, `scanPauseQueue` call, status-aware `evaluateIssue()`, verbose `POLL:` log, removed blanket `hasAdwWorkflowComment` filter
- `adws/triggers/issueDependencies.ts`: Keyword proximity parsing, `## Blocked by` heading support, in-memory dependency cache
- `adws/github/workflowCommentsIssue.ts`: Added `paused` and `resumed` comment templates
- `adws/core/workflowCommentParsing.ts`: Added `paused`/`resumed` to `STAGE_ORDER` and `STAGE_HEADER_MAP`
- `adws/types/workflowTypes.ts`: Added `'paused'` and `'resumed'` to `WorkflowStage` union
- `adws/core/config.ts`: Added `PROBE_INTERVAL_CYCLES` (default 15) and `MAX_UNKNOWN_PROBE_FAILURES` (default 3)
- `adws/adwBuild.tsx`, `adws/adwPatch.tsx`, `adws/adwTest.tsx`, `adws/adwPrReview.tsx`: Migrated to modern `initializeWorkflow + CostTracker + runPhase()` pattern

### New Files

- `adws/core/pauseQueue.ts`: `PausedWorkflow` interface + `readPauseQueue`, `appendToPauseQueue`, `removeFromPauseQueue`, `updatePauseQueueEntry` with atomic write-via-temp-rename
- `adws/triggers/pauseQueueScanner.ts`: `scanPauseQueue(cycleCount)` — probes every `PROBE_INTERVAL_CYCLES` cycles, resumes or escalates based on probe result

### Key Changes

- **Zero per-agent changes needed**: `RateLimitError` is thrown inside `runClaudeAgentWithCommand`, so every agent inherits rate limit propagation automatically
- **Pause queue is shared**: `agents/paused_queue.json` holds all paused workflows; atomic read-modify-write minimizes race conditions between concurrent cron processes
- **Skip-completed-phases**: `runPhase()` checks `config.completedPhases` (loaded from state.json on resume) before executing; completed phases return a zero-cost empty result
- **Cron now re-evaluates failed/paused issues**: The old blanket `!hasAdwWorkflowComment` filter is replaced by stage-aware logic — only `completed` and actively-running stages are excluded
- **Verbose poll log**: Each cron cycle emits `POLL: {total} open, {N} candidate(s) [#123, #456], filtered: #299(active), #300(completed)`

## How to Use

### Automatic Behavior (no configuration needed)

1. A running ADW workflow hits a rate limit during any phase
2. `agentProcessHandler` detects the limit string, kills the process, and returns `rateLimited: true`
3. `runClaudeAgentWithCommand` throws `RateLimitError(phaseName)`
4. `runPhase()` catches it, calls `handleRateLimitPause()`, which writes state and exits 0
5. The GitHub issue receives a `⏸️ Paused` comment listing completed phases and the pause reason
6. The cron trigger probes every 15 cycles (≈ 5 min); on success it posts `▶️ Resumed` and respawns the orchestrator
7. The orchestrator reads `completedPhases` from state.json and skips them

### Passing Phase Names in Orchestrators

All `runPhase()` call sites now accept an optional third argument for skip-on-resume support:

```ts
await runPhase(config, tracker, executeBuildPhase, 'build');
await runPhase(config, tracker, executeTestPhase, 'test');
```

### Configuring Probe Intervals

Set environment variables to tune the probe behavior:

| Variable | Default | Description |
|---|---|---|
| `PROBE_INTERVAL_CYCLES` | `15` | Probe every N cron cycles (1 cycle = 20s → 5 min) |
| `MAX_UNKNOWN_PROBE_FAILURES` | `3` | Remove from queue after N consecutive unknown failures |

### Pause Queue File

The queue is written to `agents/paused_queue.json` in the ADW working directory. Each entry contains `adwId`, `issueNumber`, `orchestratorScript`, `pausedAtPhase`, `pauseReason`, `worktreePath`, `branchName`, and optional `extraArgs`.

## Configuration

- `PROBE_INTERVAL_CYCLES` env var (default: `15`)
- `MAX_UNKNOWN_PROBE_FAILURES` env var (default: `3`)
- No other configuration changes required — existing workflows continue to work unchanged

## Testing

```sh
# Type-check
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json

# Lint
bun run lint

# Build
bun run build
```

To manually test pause/resume:
1. Set a breakpoint or inject a fake rate-limit string into an agent's stdout
2. Verify `agents/paused_queue.json` is written and the GitHub issue gets a `⏸️ Paused` comment
3. Run `scanPauseQueue(PROBE_INTERVAL_CYCLES)` manually to trigger a probe cycle
4. Confirm `▶️ Resumed` comment appears and the orchestrator spawns with the same adwId

## Notes

- `handleRateLimitPause` exits with code 0 (graceful), unlike `handleWorkflowError` which exits code 1. This distinction is important for cron process management.
- The `completedPhases` mechanism is phase-name-based and orthogonal to `RecoveryState` (which uses GitHub comment parsing). Both coexist: `RecoveryState` handles crash recovery, `completedPhases` handles clean pause/resume.
- The `adwPrReview.tsx` migration is intentionally lighter than the other 3 outliers — full unification of `PRReviewWorkflowConfig` with `WorkflowConfig` is out of scope.
- Dependency-deferred issues are no longer added to `processedIssues` so they are re-checked on the next cron cycle once their blocker resolves.
- The dependency cache (`Map<string, number[]>`) is in-memory only and resets on cron restart; this is intentional to avoid stale results when an issue body changes.
