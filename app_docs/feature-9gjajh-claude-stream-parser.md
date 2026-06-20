# Claude Stream Parser & Orchestrator Core

## Overview

This module is the shared core layer for parsing Claude Code agent output and driving multi-phase orchestrator workflows. It handles JSONL stream parsing from agent subprocesses, JSON extraction from agent text output, CLI argument parsing for all orchestrator entry points, orchestrator stage/script mapping, and per-phase cost tracking and lifecycle management.

## Responsibilities

- **JSONL stream parsing** (`claudeStreamParser.ts`): Parses streamed JSONL output from Claude Code agent processes line by line, buffering partial lines across data chunks. Extracts assistant text, tool-use blocks, and final result messages. Detects structured error signals: rate-limit rejections, authentication errors, server errors (HTTP 5xx), overloaded errors (HTTP 529), and context-compaction boundaries.
- **Progress callbacks**: Fires `ProgressCallback` on each tool-use event and text turn, carrying turn count, tool count, and optional real-time token estimates.
- **State file output**: Appends raw JSONL events and tool-use log lines to the agent state directory when a `statePath` is provided.
- **JSON extraction** (`jsonParser.ts`): Extracts and parses JSON objects or arrays from raw agent output strings, tolerating surrounding prose by regex-matching the first `{...}` or `[...]` block on parse failure.
- **Orchestrator CLI parsing** (`orchestratorCli.ts`): Provides composable helpers for all orchestrator entry points — extracts `--cwd`, `--issue-type`, `--target-repo`, and `--clone-url` flags (mutating the args array in place), validates issue numbers and type values, and prints standardised usage messages. Resolves a `RepoIdentifier` from either CLI-provided target-repo info or local git remote.
- **Orchestrator script mapping** (`orchestratorLib.ts`): Maps named orchestrator identifiers (e.g. `sdlc-orchestrator`, `build-orchestrator`) to script paths, and provides the inverse lookup. Detects uncommitted working-tree changes via `git status --porcelain`. Computes which workflow stage to resume from using a canonical `STAGE_ORDER` array.
- **Phase runner** (`phaseRunner.ts`): `CostTracker` accumulates `costUsd` and `ModelUsageMap` across phases. `runPhase()` wraps each phase function with skip-on-resume logic (consulting the top-level phases map, falling back to the legacy `completedPhases` string array), writes `running`/`completed`/`failed` status to the top-level state, persists token counts, posts cost records to D1, and delegates `RateLimitError` and `AgentTimeoutError` to workflow-completion handlers. `runPhasesSequential()` and `runPhasesParallel()` compose `runPhase()` for ordered and concurrent execution.

## Contracts & Invariants

- `parseJsonlOutput` is stateful: callers must pass the same `JsonlParserState` object across successive data chunks. `state.lineBuffer` bridges partial lines at chunk boundaries.
- Non-JSON lines encountered during JSONL parsing are silently appended to `state.fullOutput` rather than thrown; errors never abort the parse loop.
- `extractCwdOption`, `extractIssueTypeOption`, and `parseTargetRepoArgs` mutate the input `args` array by splicing out consumed arguments. Callers must not rely on the array being unchanged after these calls.
- `printUsageAndExit` and invalid-argument paths call `process.exit(1)` directly; they never return.
- `runPhase` skips a phase whose top-level `phases` map entry has `status === 'completed'`. Entries with `status === 'failed'` or `'running'` are NOT skipped and will re-execute. The legacy `completedPhases` string array is only consulted when no `phases` map entry exists, preserving in-flight workflow compatibility.
- D1 cost-record posting is fire-and-forget: errors are logged but never propagate to callers.
- `deriveOrchestratorScript` falls back to `adwSdlc.tsx` for any name not in its explicit map; `orchestratorNamesForScript` does NOT apply this fallback, so unmapped names (e.g. `init-orchestrator`) return no matches.
- `hasUncommittedChanges` returns `false` on git errors rather than throwing.

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
