# Build and Plan Phases

## Overview

The build and plan phases translate issue analysis into a committed implementation. The install phase primes agent context; the plan phase classifies the issue and produces the spec file; the plan validation phase aligns the spec with BDD scenarios; the build phase implements the spec with token-limit recovery.

## Responsibilities

- `installPhase.ts` — runs the install agent in the worktree, parses tool results (Read/Bash) from the JSONL output into a `<project-context>` preamble, caches it to `agents/{adwId}/install_cache.md`, and populates `config.installContext` for injection into later agents; entirely non-fatal
- `planPhase.ts` — runs `runPlanAgent` with the issue type slash command, corrects swapped plan filenames, reads the plan file for the issue comment summary, commits the plan, and posts stage comments at each step
- `planPhase.ts` — exposes `buildContinuationPrompt` used by the build phase when a context reset occurs; the prompt variant differs based on whether checkpoint commits exist in the branch
- `planValidationPhase.ts` — discovers BDD scenario files tagged `@adw-{N}`; runs the validation agent to detect plan-scenario mismatches; enters a resolution loop (up to `MAX_VALIDATION_RETRY_ATTEMPTS`) where `runResolutionAgent` fixes mismatches then `runValidationAgent` re-validates; commits artifacts if any changes were made
- `buildPhase.ts` — reads the plan file, enters a `while(!buildCompleted)` loop that respawns the build agent on token limit or compaction events; after `MAX_CONTEXT_RESETS` within a batch, commits a checkpoint and evaluates the progress gate; throws on progress gate abort; commits implementation after the loop

## Contracts & Invariants

- `installPhase.ts` always returns a cost result (possibly zero-cost); it never throws — errors are caught and logged
- `planPhase.ts` skips the plan agent when `planFileExists()` returns true (idempotent on recovery)
- `planPhase.ts` skips the commit when `shouldExecuteStage('plan_committing', recoveryState)` returns false (idempotent on recovery)
- `buildPhase.ts` accumulates cost and model usage across all continuation spawns
- The progress gate in `buildPhase.ts` aborts when the worktree tree hash has not advanced after a full batch of `MAX_CONTEXT_RESETS` resets; this prevents infinite looping on a stuck agent
- `planValidationPhase.ts` exits early (not an error) when no scenario files are tagged for the issue
- `planValidationPhase.ts` degrades gracefully when `OutputValidationError` is thrown by either validation or resolution agent: it logs a warning and returns without throwing
- `buildContinuationPrompt` in `planPhase.ts` generates two prompt variants: without checkpoint commits (secondary hint only) and with checkpoint commits (git state is authoritative)

## Configuration

- `MAX_CONTEXT_RESETS` — maximum agent respawns per batch before a checkpoint commit
- `MAX_PROGRESS_CHECKPOINTS` — maximum checkpoint commits before aborting
- `MAX_VALIDATION_RETRY_ATTEMPTS` — maximum plan-scenario resolution cycles
- `config.installContext` — injected into plan and scenario agents as a context preamble
- `config.projectConfig.commands.runTests` — used by the unit test phase, not the build phase
- Board status updates (`moveToStatus`) use `config.repoContext` when available

## Gotchas

- `installPhase.ts` extracts context from the install agent's JSONL by pairing `tool_use` (Read/Bash) blocks with their `tool_result` responses; only non-error results are included
- `buildPhase.ts` posts a `build_progress` comment at most once per minute (`PROGRESS_UPDATE_INTERVAL_MS = 60000`) to avoid flooding the issue
- `buildPhase.ts` logs an estimate-vs-actual cost comparison when `costSource === 'extractor_finalized'` and both estimated and actual usage are present
- `planValidationPhase.ts` commits updated artifacts only when the resolution agent returned at least one decision (`artifactsChanged`); a resolution with zero decisions produces no commit
- The build phase does not commit on its own after a successful build agent run — `shouldExecuteStage('build_committing', recoveryState)` guards a separate explicit `runCommitAgent` call
