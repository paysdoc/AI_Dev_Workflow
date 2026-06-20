# Claude Agents Core

## Overview

This module provides the foundational layer for spawning and managing Claude Code CLI subprocesses as agents within the ADW workflow. It handles process lifecycle, JSONL stream parsing, error classification, and structured output extraction for all agent invocations across the system.

## Responsibilities

- Spawns Claude Code CLI processes via `spawn()` with `--print --verbose --dangerously-skip-permissions --output-format stream-json` flags
- Injects `ADW_WORKTREE_PATH` and `ADW_MAIN_REPO_PATH` environment variables when the working directory is inside a worktree
- Attaches a per-phase watchdog timer (via `getAgentTimeoutForPhase`) and kills the process group on expiry, throwing `AgentTimeoutError`
- Streams stdout through `parseJsonlOutput` to extract turn counts, tool call counts, and the final result message
- Extracts real-time token usage via `AnthropicTokenUsageExtractor` and injects it into progress callbacks
- Detects and early-terminates on auth errors, rate limits/API outages, context compaction, and output token threshold breaches — each resolves to a distinct `AgentResult` shape
- Retries up to 3 times on transient `ENOENT` failures, clearing the `resolveClaudeCodePath` cache between attempts with exponential backoff
- Retries once on expired OAuth token after verifying `claude auth status --json`; throws `AuthRequiredError` if auth is invalid or still failing after retry
- Throws `RateLimitError` (no retry) when rate limiting or API outage is detected, signaling the orchestrator to pause
- Saves every prompt to `<statePath>/prompts/<command>.txt` for replay and audit
- Provides `runCommandAgent<T>()` as a typed wrapper: selects model and effort via `getModelForCommand`/`getEffortForCommand`, optionally extracts structured output via a caller-supplied `extractOutput` function, and runs a schema-validated retry loop (up to 10 retries, early-exit after 3 consecutive identical errors) using a corrective Haiku prompt
- Provides `runGenerateBranchNameAgent` (invokes `/generate_branch_name` skill, returns `branchName`) and `runCommitAgent` (invokes `/commit` skill, validates and normalises the commit message prefix)
- Writes all stdout and stderr to a per-agent JSONL output file (append mode); logs final cost and model breakdown on close

## Contracts & Invariants

- Every spawned process is detached (`detached: true`) so `killProcessGroup(-pid)` can reach grandchildren (e.g., orphaned heredoc pipelines)
- The `AgentResult.success` field is `false` whenever the process exits non-zero OR the final JSONL result carries `isError: true`; token-limit and compaction terminations resolve as `success: true` with their respective flags set
- `costSource` is always present on resolved results; value is `'extractor_finalized'` when the CLI emits a cost summary line, otherwise `'extractor_estimated'`
- `runCommandAgent` never throws on extraction failure — it retries via a fresh Haiku session; `OutputValidationError` is only thrown after all retries are exhausted
- `extractOutput` functions must return `ExtractionResult<T>` (never throw) so the retry loop can distinguish parse failures from code errors
- Commit message validation in `runCommitAgent` always guarantees the returned `commitMessage` starts with the correct `<agentName>: <keyword>:` prefix, stripping malformed prefixes if needed
- `AuthRequiredError` and `RateLimitError` are always thrown (never returned in `AgentResult`) so callers cannot silently ignore them

## Configuration

No configuration files. Behaviour is governed by call-site parameters:
- `model` defaults to `'sonnet'`; overridden per-command by `getModelForCommand`
- `effort` is optional; overridden per-command by `getEffortForCommand`
- Watchdog timeout is looked up per phase name via `getAgentTimeoutForPhase`
- Token threshold for early termination is `MAX_THINKING_TOKENS * TOKEN_LIMIT_THRESHOLD` (constants from `../core`)
- Retry counts are module-level constants: `MAX_RETRIES = 10`, `MAX_CONSECUTIVE_IDENTICAL_ERRORS = 3`

## Gotchas

- The watchdog kill does not set a special exit code — `agentProcessHandler` resolves normally after the process group is killed; the `watchdogFired` boolean in `runClaudeAgentWithCommand` is the sole gate that surfaces `AgentTimeoutError` to the caller
- Rate limit detection fires on `rateLimitRejected`, `serverErrorDetected`, OR `overloadedErrorDetected` — all three signal the same "pause" path
- Context compaction resolves as `success: true` with `compactionDetected: true`; callers must check this flag and re-invoke rather than treating the result as a completed run
- ENOENT retry clears the path cache and re-resolves the Claude CLI binary before each attempt; a permanently missing binary will exhaust all 3 attempts and return the last failed result (no exception)
- Auth retry calls `execSync` with the full `process.env` (not the sandboxed env) so the CLI can access its own credentials at `HOME`
- `runCommitAgent` throws on non-success exit (unlike most agents which return the result); callers must not inspect `result.success` after the call
- Branch slug extraction takes only the last non-empty line of agent output; any trailing explanation text from the model is silently discarded
- `issueClass` is accepted but ignored in `formatBranchNameArgs` (the LLM no longer assembles the prefix); the parameter remains for call-site compatibility
