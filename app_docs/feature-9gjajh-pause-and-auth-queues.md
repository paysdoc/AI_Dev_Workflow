# Pause & Auth Queues

## Overview

This module provides two shared, file-backed primitives for cross-workflow coordination on a single host: a pause queue that tracks workflows suspended due to rate-limiting or errors, and an auth gate that signals a host-wide GitHub authentication failure. Both use atomic temp-file-then-rename writes to minimize corruption risk from concurrent cron processes.

## Responsibilities

- Reads, appends, removes, and updates entries in `agents/paused_queue.json` via `readPauseQueue`, `appendToPauseQueue`, `removeFromPauseQueue`, and `updatePauseQueueEntry`
- Prevents duplicate pause-queue entries by deduplicating on `adwId` at append time
- Reads and writes `agents/.auth_gate` to record that a GitHub auth failure was detected, preserving the `firstDetectedAt` timestamp across successive detections
- Exposes `clearAuthGate` to remove the gate file when auth is restored
- Tracks Slack notification timing on the auth gate record via `markGateSlackNotified` and `shouldSendDetectionSlack`, enforcing a 2-hour cooldown between notifications
- Records which agent (`adwId`, `issueNumber`, `agentName`) last triggered each auth gate write

## Contracts & Invariants

- `appendToPauseQueue` is idempotent: a second call with the same `adwId` silently no-ops
- `updatePauseQueueEntry` is a no-op if the `adwId` is not present in the queue
- `readPauseQueue` returns `[]` (never throws) when the file is absent or unreadable
- `readAuthGate` returns `null` (never throws) when the gate file is absent or unreadable
- `writeAuthGate` preserves `firstDetectedAt` from an existing record, so the timestamp reflects the original detection event across updates
- `clearAuthGate` returns `false` when the file does not exist, `true` on successful deletion, and re-throws on any other filesystem error
- All writes use an atomic temp+rename pattern; the `agents/` directory is created as needed
- The auth gate is host-scoped: the `host` field is captured from `os.hostname()` at module load time and stamped on every write

## Configuration

- `PAUSE_QUEUE_PATH` is hardcoded to `agents/paused_queue.json` (relative to the working directory)
- `AUTH_GATE_PATH` is hardcoded to `agents/.auth_gate` (relative to the working directory)
- `SLACK_DETECTION_COOLDOWN_MS` is hardcoded to 2 hours (7 200 000 ms); it is exported but not overridable at runtime

## Gotchas

- Both paths are relative, so the effective file location depends on the process working directory at runtime; callers in different cwd contexts will read/write different files
- The pause queue is shared across all repos and workflows on the host; concurrent cron processes writing distinct `adwId` entries are low-risk but not fully serialized
- `shouldSendDetectionSlack` must be called by the caller — the module never sends Slack messages itself; forgetting to call `markGateSlackNotified` after sending will cause repeated notifications on the next cron tick
- `pauseReason` on `PausedWorkflow` accepts only `'rate_limited' | 'unknown_error'`; other error classifications must be mapped to one of these two values before enqueuing
- The auth gate does not enforce that only one host writes it; if multiple hosts share the same `agents/` directory (e.g. via a network mount), the `host` field may reflect whichever host wrote last
