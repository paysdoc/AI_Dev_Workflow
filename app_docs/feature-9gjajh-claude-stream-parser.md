# Claude Stream Parser & Orchestrator Core

## Overview

This module is the shared core layer for parsing Claude Code agent output and driving multi-phase orchestrator workflows. It handles JSONL stream parsing from agent subprocesses, JSON extraction from agent text output, CLI argument parsing for all orchestrator entry points, orchestrator stage/script mapping, and per-phase cost tracking and lifecycle management.

## Responsibilities

- **JSONL stream parsing** (`claudeStreamParser.ts`): Parses streamed JSONL output from Claude Code agent processes line by line, buffering partial lines across data chunks. Extracts assistant text, tool-use blocks, and final result messages. Detects structured error signals — rate limits, authentication failures, overloads (HTTP 529), server errors (other 5xx), and context-compaction boundaries — ranked through a pure `classifyApiSignal(error, status)` applied identically to a `system`/`api_retry` message and to a terminal `result.api_error_status`. A rejected `rate_limit_event` (`rate_limit_info.status === "rejected"`) is the only source of the limit type and reset time; `createJsonlParserState(primaryModel?)` returns the zeroed state so the state shape cannot drift between call sites.
- **`classifyApiSignal` ranking**: evaluated in order — `auth` (`error === "authentication_failed"` or `status === 401`), `rate_limit` (`"rate_limit"` or `429`), `overloaded` (`"overloaded"` or `529`), `server_error` (`"server_error"` or another 5xx). A non-number `status` (including `null` — no HTTP response) never matches a status check. The documented enum replaced the undocumented `"overloaded_error"` spelling, which no real fixture ever proved the CLI emits.
- **Pause-worthy attempt threshold**: `api_retry` auth, rate-limit and overloaded signals decide on their own on any attempt, including the first — the CLI's own backoff already spaces retries out. Only `server_error` and unclassified retries (`billing_error`, `invalid_request`, `unknown`, …) keep the repeated-retry rule, pausing at `attempt >= PAUSE_ON_RETRY_ATTEMPT` (2). A terminal `result.api_error_status` is not a retry, so its mapping (via the same `classifyApiSignal`) fires immediately regardless of attempt.
- **Progress callbacks**: Fires `ProgressCallback` on each tool-use event and text turn, carrying turn count, tool count, and optional real-time token estimates.
- **State file output**: Appends raw JSONL events and tool-use log lines to the agent state directory when a `statePath` is provided.
- **JSON extraction** (`jsonParser.ts`): Extracts and parses JSON objects or arrays from raw agent output strings, tolerating surrounding prose by regex-matching the first `{...}` or `[...]` block on parse failure.
- **Orchestrator CLI parsing** (`orchestratorCli.ts`): Provides composable helpers for all orchestrator entry points — extracts `--cwd`, `--issue-type`, `--target-repo`, and `--clone-url` flags (mutating the args array in place), validates issue numbers and type values, and prints standardised usage messages. Resolves a `RepoIdentifier` from either CLI-provided target-repo info or local git remote.
- **Orchestrator script mapping** (`orchestratorLib.ts`): Maps named orchestrator identifiers (e.g. `sdlc-orchestrator`, `build-orchestrator`) to script paths, and provides the inverse lookup. Computes which workflow stage to resume from using a canonical `STAGE_ORDER` array. #822 deleted this module's `hasUncommittedChanges` free function (a non-boundary `gitContextForRepo` construction) — it now constructs nothing; every former caller calls `gitCtx.hasUncommittedChanges(cwd)` directly on its own threaded `GitContext` instead.
- **Phase runner** (`phaseRunner.ts`): `CostTracker` accumulates `costUsd` and `ModelUsageMap` across phases. `runPhase()` wraps each phase function with skip-on-resume logic (consulting the top-level phases map, falling back to the legacy `completedPhases` string array), writes `running`/`completed`/`failed` status to the top-level state, persists token counts, posts cost records to D1, and delegates `RateLimitError` and `AgentTimeoutError` to workflow-completion handlers. `runPhasesSequential()` and `runPhasesParallel()` compose `runPhase()` for ordered and concurrent execution. Both `runPhase` and `runPhasesParallel` pass the caught `RateLimitError` itself as `handleRateLimitPause`'s trailing `facts` argument, so any reset-time/limit-type facts the error carries reach the pause-queue entry.

## Contracts & Invariants

- `parseJsonlOutput` is stateful: callers must pass the same `JsonlParserState` object across successive data chunks. `state.lineBuffer` bridges partial lines at chunk boundaries.
- `JsonlParserState.rateLimitDetected` (renamed from `rateLimitRejected`, since a documented `rate_limit`/429 sets it too, not only a rejected event) extends `RateLimitFacts` (`rateLimitType?`, `resetsAt?`, from `adws/types/agentTypes.ts`). The facts are captured only from a **rejected** `rate_limit_event` — never from `api_retry` or `result`, and never defaulted when the event omits them (a fact the parser did not capture reads as `undefined`, not `0` or an invented value). When two rejected events appear in one stream, the later one's facts win. `resetsAt` is Unix epoch **seconds**, exactly as the CLI emits it; the parser never converts it.
- Every hand-built `JsonlParserState` literal was replaced by `createJsonlParserState(primaryModel?)` (`agentProcessHandler.ts`, `rateLimitProbe.ts`, `conformanceCheck.ts`, the parser's own test helper) so the four call sites cannot drift from the interface again.
- Non-JSON lines encountered during JSONL parsing are silently appended to `state.fullOutput` rather than thrown; errors never abort the parse loop.
- `ClaudeCodeResultMessage` reads two snake_case fields the CLI emits on `result` today, `is_error` and `api_error_status` (`null` on success, the HTTP status on an API failure), alongside its older camelCase fields (`isError`, etc.) — a known drift not corrected here; owned by the PRD's envelope-gate issue.
- `extractCwdOption`, `extractIssueTypeOption`, and `parseTargetRepoArgs` mutate the input `args` array by splicing out consumed arguments. Callers must not rely on the array being unchanged after these calls.
- `printUsageAndExit` and invalid-argument paths call `process.exit(1)` directly; they never return.
- `runPhase` skips a phase whose top-level `phases` map entry has `status === 'completed'`. Entries with `status === 'failed'` or `'running'` are NOT skipped and will re-execute. The legacy `completedPhases` string array is only consulted when no `phases` map entry exists, preserving in-flight workflow compatibility.
- D1 cost-record posting is fire-and-forget: errors are logged but never propagate to callers.
- `deriveOrchestratorScript` falls back to `adwSdlc.tsx` for any name not in its explicit map; `orchestratorNamesForScript` does NOT apply this fallback, so unmapped names (e.g. `init-orchestrator`) return no matches.
- `orchestratorLib.ts`'s `hasUncommittedChanges` free function (which returned `false` on git errors rather than throwing) is gone (#822). Its replacement, `GitContext.hasUncommittedChanges` called directly on a threaded context, propagates errors like every other `GitContext` method — there is no more construction step whose failure needed swallowing.

## Configuration

- `RUNNING_TOKENS` environment flag (from `core/config`): when truthy, `CostTracker.persist()` updates `config.ctx.runningTokenTotal` with a display-formatted token count for live GitHub comment updates.
- `GITHUB_REPO_URL` environment variable: used by `CostTracker.commit()` when posting cost records to D1.
- `statePath` parameter to `parseJsonlOutput`: when provided, raw JSONL events are written to `output.jsonl` and tool-use entries are appended to the agent log under that path.

## Gotchas

- `parseJsonlOutput` buffers the last segment of every non-`\n`-terminated chunk; callers that forget to flush the buffer after the stream ends will silently lose the final partial line.
- `runPhasesParallel` catches only `RateLimitError` from `Promise.all`; if multiple phases throw, only the first rejection is handled. Phase functions passed to parallel execution must not have data dependencies on each other.
- `extractJson` tries a direct `JSON.parse` first, then falls back to the first `{...}` match. A document containing multiple JSON objects returns only the first; trailing content is silently dropped.
- `buildRepoIdentifier` calls `getRepoInfo()` (which reads the local git remote) when `targetRepo` is null; this will throw if the process is not running inside a git repository with a GitHub remote.
- The `ORCHESTRATOR_SCRIPT_BY_NAME` map uses `adwSdlc` as the default for both `sdlc-orchestrator` and `feature-orchestrator`; they resolve to the same script and are indistinguishable via `orchestratorNamesForScript`.
