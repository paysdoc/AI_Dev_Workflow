# Claude Agents Core & Target-Repo Guardrails

## Overview

This module provides the foundational layer for spawning and managing Claude Code CLI subprocesses as agents within the ADW workflow. It handles process lifecycle, JSONL stream parsing, error classification, and structured output extraction for all agent invocations across the system. Because every agent spawns with `--dangerously-skip-permissions` and a target-repo worktree never receives the framework's own `.claude/settings.json` or hooks, this same spawn layer also injects a guardrails `--settings` payload on target-repo runs only — a canonical deny list plus all five framework hooks at absolute paths — so a target repo that ships no guardrails of its own still cannot force-push, recursively force-delete, or read `.env` secrets, and its tool activity is still logged. Self-host runs receive nothing; the framework's own project `settings.json` stays authoritative there.

## Responsibilities

- Spawns Claude Code CLI processes via `spawn()` with `--print --verbose --dangerously-skip-permissions --output-format stream-json` flags
- Injects `ADW_WORKTREE_PATH` and `ADW_MAIN_REPO_PATH` environment variables when the working directory is inside a worktree **and** the caller threads a `launchContext.gitContext` (the launch boundary's `GitContext`, narrowed to `mainRepoPath` — `claudeAgent` no longer constructs one, #822). An un-threaded worktree spawn sets neither variable, which silently disables `.claude/hooks/pre-tool-use.ts` path rewriting, so every worktree-cwd spawn site must carry `gitContext`.
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
- On target-repo runs only, injects a guardrails `--settings` payload at the same spawn call site: `resolveGuardrailsDecision` (`adws/core/guardrailsGate.ts`) runs a guard-clause chain — kill switch → self-host → `.github/adw.yml` canary → startup probe verdict — and when it says inject, `runClaudeAgentWithCommand` (`claudeAgent.ts`) unshifts `--settings <json>` onto `cliArgs` and sets `spawnEnv.CLAUDE_HOOKS_LOG_DIR` to an absolute per-run directory
- `buildGuardrailsSettings` (`adws/core/guardrailsPayload.ts`) builds that payload: parses the canonical deny-list template (`templates/claude-settings-starter.json` — the same template `/adw_init` copies verbatim into target repos), adds all five framework hooks (`PreToolUse`, `PostToolUse`, `Notification`, `Stop`, `SubagentStop`) as `bun <absolute-framework-path>/.claude/hooks/<hook>.ts <flags> || true` commands, and declares no `permissions.allow`
- `commandAgent.ts` and the direct `runClaudeAgentWithCommand` callers (`planAgent.ts`, `testAgent.ts`, `gitAgent.ts`, `patchAgent.ts`, `refactorAgent.ts`) thread launch-boundary facts (`{ selfHost, adwId }`) through to the spawn so the gate has what it needs to decide
- `adws/core/guardrailsProbe.ts` + `scripts/guardrails-probe.ts` verify the injected payload actually enforces: spawn a real `claude -p` (haiku) against a scratch dir with the exact payload, assert a deny/allow matrix plus hook firing, and fail open on any problem; `trigger_cron.ts`'s `main()` warms the verdict once at startup (before the first `checkAndTrigger()`) and `trigger_webhook.ts`'s `/health` check surfaces it as a `guardrailsProbe` entry
- Counts permission-denied tool calls per run (`adws/core/claudeStreamParser.ts`'s `deniedToolCallCount`, carried onto `AgentResult`) and surfaces a non-zero count as a denial notice in issue/PR stage comments (`adws/phases/phaseCommentHelpers.ts`'s `formatDenialNotice`) and the workflow-completion comment (`adws/phases/workflowCompletion.ts`)
- Widens the shared `.claude/hooks/pre-tool-use.ts` `.env` carve-out to also spare `.env.example` (both the file-path check and the Bash-command regex), so the injected deny list's `.env.example` allowance is not defeated by the co-injected hook

## Contracts & Invariants

- Every spawned process is detached (`detached: true`) so `killProcessGroup(-pid)` can reach grandchildren (e.g., orphaned heredoc pipelines)
- The `AgentResult.success` field is `false` whenever the process exits non-zero OR the final JSONL result carries `isError: true`; token-limit and compaction terminations resolve as `success: true` with their respective flags set
- `costSource` is always present on resolved results; value is `'extractor_finalized'` when the CLI emits a cost summary line, otherwise `'extractor_estimated'`
- `runCommandAgent` never throws on extraction failure — it retries via a fresh Haiku session; `OutputValidationError` is only thrown after all retries are exhausted
- `extractOutput` functions must return `ExtractionResult<T>` (never throw) so the retry loop can distinguish parse failures from code errors
- Commit message validation in `runCommitAgent` always guarantees the returned `commitMessage` starts with the correct `<agentName>: <keyword>:` prefix, stripping malformed prefixes if needed
- `AuthRequiredError` and `RateLimitError` are always thrown (never returned in `AgentResult`) so callers cannot silently ignore them
- **Guardrails injection is target-repo only.** `resolveGuardrailsDecision` returns `{ inject: false }` whenever `input.selfHost` is true. An un-threaded caller (no `launchContext` passed) defaults `selfHost` to `true`, so a missing wire-up fails safe toward "no injection" rather than accidentally injecting.
- **Gate order is fixed and short-circuits**: kill switch (`ADW_TARGET_GUARDRAILS=off`) → self-host → `.github/adw.yml` `guardrails !== true` → probe verdict. Any one of these withholding injection means the remaining checks (including the paid, network-bound probe) never run.
- **Fail-open, never fail-closed.** A failed startup probe results in `{ inject: false }` plus exactly one Slack alert per process (`probeFailureAlertSent` memo in `guardrailsGate.ts`) — a bad guardrails rollout can never block the ADW queue, only leave a repo running with today's (no-guardrails) behaviour.
- **No `permissions.allow` is ever declared** in the injected payload — verified a no-op under `--dangerously-skip-permissions`, so there's no reason to widen the attack surface with one.
- **Hook paths must be absolute.** `$CLAUDE_PROJECT_DIR` resolves to the target worktree, where the framework's own hook scripts don't exist; `buildGuardrailsSettings` always joins hook commands against `frameworkRepoRoot`, never a relative path.
- **`CLAUDE_HOOKS_LOG_DIR` must be absolute**, not the issue's literal relative form. A relative value resolves against the hook process's cwd — which on a target run is the worktree itself — and leaks untracked session-log files into it. `resolveHookLogDir(adwId)` always returns `path.join(AGENTS_STATE_DIR, adwId, 'hook-logs')`, an absolute path under the framework's own agent-state tree.
- **The probe and its alert run at most once per process.** `getGuardrailsProbeVerdict()` memoizes the verdict (`resetGuardrailsProbeMemo()` is test-only); `notifyProbeFailureOnce()` memoizes the alert separately (`resetGuardrailsAlertMemo()` is test-only) — so a persistently-failing probe does not spam Slack on every subsequent target-repo spawn.
- **Denial counting is additive across two shapes.** The CLI emits `tool_result` both as a top-level parsed JSONL message and nested inside an assistant message's content blocks; `claudeStreamParser.ts` increments `deniedToolCallCount` in both places, so a run's total is not shape-dependent.
- **The injected pre-tool-use hook must agree with the deny-list template's carve-outs.** The template's `Read(!**/.env.example)` carve-out only holds if `pre-tool-use.ts`'s `isEnvFileAccess` also spares `.env.example` — both were widened together (issue #762's "spec conflict #2"); if one changes, the other must be checked.

## Configuration

No configuration files govern the base spawn layer. Behaviour is governed by call-site parameters:
- `model` defaults to `'sonnet'`; overridden per-command by `getModelForCommand`
- `effort` is optional; overridden per-command by `getEffortForCommand`
- Watchdog timeout is looked up per phase name via `getAgentTimeoutForPhase`
- Token threshold for early termination is `MAX_THINKING_TOKENS * TOKEN_LIMIT_THRESHOLD` (constants from `../core`)
- Retry counts are module-level constants: `MAX_RETRIES = 10`, `MAX_CONSECUTIVE_IDENTICAL_ERRORS = 3`

Guardrails injection is additionally governed by:
- `ADW_TARGET_GUARDRAILS=off` — kill switch read directly from `process.env` by the parent process (no `SAFE_ENV_VARS` entry needed, since it's never forwarded to the Claude CLI subprocess). Disables injection unconditionally, beating every other gate.
- `.github/adw.yml` `guardrails: true` — per-target-repo opt-in canary key (see `adws/core/adwYmlConfig.ts`). Default `false` (absent, malformed, or explicit `false` all withhold injection). This is temporary rollout scaffolding; the end state is mandatory guardrails for all target repos.
- `CLAUDE_HOOKS_LOG_DIR` — set on `spawnEnv` (after the `getSafeSubprocessEnv()` allowlist filter, mirroring the `ADW_WORKTREE_PATH` pattern) to the absolute per-run hook-log directory whenever injection is active. Not set otherwise.
- `templates/claude-settings-starter.json` — the canonical 13-pattern deny list. Edit this file, not any copy of it, to change the deny rules; both the spawn-time payload builder and `/adw_init`'s target-repo copy read from it.

## Gotchas

- The watchdog kill does not set a special exit code — `agentProcessHandler` resolves normally after the process group is killed; the `watchdogFired` boolean in `runClaudeAgentWithCommand` is the sole gate that surfaces `AgentTimeoutError` to the caller
- Rate limit detection fires on `rateLimitRejected`, `serverErrorDetected`, OR `overloadedErrorDetected` — all three signal the same "pause" path
- Context compaction resolves as `success: true` with `compactionDetected: true`; callers must check this flag and re-invoke rather than treating the result as a completed run
- ENOENT retry clears the path cache and re-resolves the Claude CLI binary before each attempt; a permanently missing binary will exhaust all 3 attempts and return the last failed result (no exception)
- Auth retry calls `execSync` with the full `process.env` (not the sandboxed env) so the CLI can access its own credentials at `HOME`
- `runCommitAgent` throws on non-success exit (unlike most agents which return the result); callers must not inspect `result.success` after the call
- Branch slug extraction takes only the last non-empty line of agent output; any trailing explanation text from the model is silently discarded
- `issueClass` is accepted but ignored in `formatBranchNameArgs` (the LLM no longer assembles the prefix); the parameter remains for call-site compatibility
- The probe (`scripts/guardrails-probe.ts`) spawns a **real, paid, network-bound** `claude -p` call — it cannot run inside the BDD harness's mocked stub and is deliberately excluded from that suite's coverage; only `adws/core/guardrailsProbe.ts`'s subprocess-invocation wiring is unit/BDD-tested
- `runGuardrailsProbe()` resolves `REPO_ROOT` inside the function body, not at module scope, so merely importing `guardrailsProbe.ts` (e.g. transitively via the `adws/core` barrel) never touches it — only actually running the probe does
- `**/logs/` was added to `.gitignore` because Claude Code hook logs can land in any directory an agent `cd`'s into (not just the repo root) when `CLAUDE_HOOKS_LOG_DIR` is unset or misconfigured — a defense-in-depth guard against the same worktree-leak class the absolute-path invariant above prevents by construction
- `formatDenialNotice()` returns `null` (not an empty string) when `count` is 0, specifically so a clean run's stage comment gets no denial line appended — callers must treat the return as optional, not always-render
- The gate's `readAdwYml` dependency reads from `input.worktreePath`, not `REPO_ROOT` — the canary is per-target-repo, and a self-host run never reaches that check anyway (short-circuited earlier)
