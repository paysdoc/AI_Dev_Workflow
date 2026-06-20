# Slack & Logging

## Overview

This module provides structured console logging and Slack webhook notifications for ADW sessions. It solves two operational visibility problems: surfacing timestamped, level-tagged output for in-process debugging, and delivering out-of-band alerts to a Slack channel when auth-gate events are detected or cleared.

## Responsibilities

- Emits timestamped, emoji-prefixed log lines to stdout at four levels: `info`, `error`, `success`, `warn`
- Colors `error`-level output in ANSI red for terminal visibility
- Tags every log line with the current session's ADW ID when one has been set via `setLogAdwId()`
- Posts arbitrary text to a Slack incoming webhook via `postSlack()`
- Sends a structured auth-detection alert (`:lock:`) via `sendSlackDetectionNotification()` when an auth gate fires, including host, ADW ID, issue number, agent name, and first-detection timestamp
- Sends a structured auth-recovery alert (`:unlock:`) via `sendSlackRecoveryNotification()` when auth is cleared, including the count of paused issues being resumed
- Ensures the per-session logs directory exists on disk via `ensureLogsDirectory()` (held in `utils.ts` as a widely-shared utility)
- Provides retry-wrapped `execWithRetry()` around `execSync` with exponential backoff and immediate bail-out for non-retryable error patterns

## Contracts & Invariants

- `postSlack()` is no-throw at the call boundary: HTTP errors and network failures are logged as warnings and swallowed; callers never receive a rejected promise
- If `SLACK_WEBHOOK_URL` is not set, all Slack calls skip silently with a single `warn` log; no error is raised
- The Slack POST uses a 10-second `AbortSignal` timeout; hangs do not block indefinitely
- `setLogAdwId()` mutates module-level state; the ADW ID persists for the lifetime of the process unless `resetLogAdwId()` is called (intended for test isolation only)
- `execWithRetry()` retries up to 3 attempts by default with 500 ms x 2^attempt backoff between retries; the backoff is synchronous (`Atomics.wait`) and blocks the calling thread
- `execWithRetry()` aborts immediately (no backoff) when the error message matches any non-retryable pattern: `No commits between`, `already exists`, `is not mergeable`, `gh auth login`, `GH_TOKEN`, `HTTP 401`, `Bad credentials`, `authentication`
- `utils.ts` is a backward-compatible re-export barrel; all named exports from `logger.ts`, `adwId.ts`, and `orchestratorCli.ts` remain importable from `utils.ts`

## Configuration

`SLACK_WEBHOOK_URL` — environment variable. Must be a valid Slack incoming webhook URL. If absent, all Slack notification calls are no-ops. No other configuration is required.

## Gotchas

- The logger's ADW ID is module-global singleton state. In test environments, always call `resetLogAdwId()` in teardown to prevent state leaking between test cases.
- `execWithRetry()` uses `Atomics.wait()` for synchronous sleep, which blocks the Node.js event loop. Do not call it from async contexts where latency matters.
- `ensureLogsDirectory()` reads `LOGS_DIR` from the `environment` module at import time; if that value is wrong or unset, directory creation silently uses whatever path is resolved.
- `sendSlackDetectionNotification()` and `sendSlackRecoveryNotification()` are fire-and-forget; their return promises should be awaited only when the caller needs to ensure delivery before proceeding (e.g., before process exit).
- Auth-related error strings in `NON_RETRYABLE_PATTERNS` are matched with `String.includes()` (substring, case-sensitive). Variations in error message formatting from different `gh` CLI versions may bypass the fast-fail path.
