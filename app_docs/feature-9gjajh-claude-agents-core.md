# Claude Agents Core & Target-Repo Guardrails

## Overview

This module provides the foundational layer for spawning and managing Claude Code CLI subprocesses as agents within the ADW workflow. It handles process lifecycle, JSONL stream parsing, error classification, and structured output extraction for all agent invocations across the system. Because every agent spawns with `--dangerously-skip-permissions` and a target-repo worktree never receives the framework's own `.claude/settings.json` or hooks, this same spawn layer also injects a guardrails `--settings` payload on target-repo runs only — a canonical deny list plus all five framework hooks at absolute paths — so a target repo that ships no guardrails of its own still cannot force-push, recursively force-delete, or read `.env` secrets, and its tool activity is still logged. Self-host runs receive nothing; the framework's own project `settings.json` stays authoritative there.

## Responsibilities

- Starts every `claude` process ADW launches under one shared launch environment, `buildClaudeLaunchEnv(overlay?)` (`adws/core/environment.ts`): the allowlisted environment (`getSafeSubprocessEnv()`), then the caller's overlay, then `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`. Users: the agent spawn and its retries, both `claude auth status --json` checks (`claudeAgent.ts`, `trigger_cron.ts`), the rate-limit, schema and guardrails probes, and the health check's `claude --version`
- Spawns Claude Code CLI processes via `spawn()` with `--print --verbose --dangerously-skip-permissions --output-format stream-json` flags
- Injects `ADW_WORKTREE_PATH` and `ADW_MAIN_REPO_PATH` environment variables when the working directory is inside a worktree **and** the caller threads a `launchContext.gitContext` (the launch boundary's `GitContext`, narrowed to `mainRepoPath` and `commandEnv` — `claudeAgent` no longer constructs one). An un-threaded worktree spawn sets neither variable, which silently disables `.claude/hooks/pre-tool-use.ts` path rewriting, so every worktree-cwd spawn site must carry `gitContext`.
- Attaches a per-phase watchdog timer (via `getAgentTimeoutForPhase`) and kills the process group on expiry, throwing `AgentTimeoutError`
- Streams stdout through `parseJsonlOutput` to extract turn counts, tool call counts, and the final result message
- Extracts real-time token usage via `AnthropicTokenUsageExtractor` and injects it into progress callbacks
- Detects and early-terminates on auth errors, rate limits/API outages, and output token threshold breaches, and on context compaction only when the caller passes `killOnCompaction` — each resolves to a distinct `AgentResult` shape
- Retries up to 3 times on transient `ENOENT` failures, clearing the `resolveClaudeCodePath` cache between attempts with exponential backoff
- Retries once on expired OAuth token after verifying `claude auth status --json`; throws `AuthRequiredError` if auth is invalid or still failing after retry
- Throws `RateLimitError` (no retry) when rate limiting or API outage is detected, signaling the orchestrator to pause; carries `rateLimitType`/`resetsAt` (from `adws/types/agentTypes.ts`'s `RateLimitFacts`) through from the `AgentResult` when a rejected `rate_limit_event` supplied them, `undefined` otherwise — never defaulted
- Saves every prompt to `<statePath>/prompts/<command>.txt` for replay and audit
- Provides `runCommandAgent<T>()` as a typed wrapper: selects model and effort via `getModelForCommand`/`getEffortForCommand`, optionally extracts structured output via a caller-supplied `extractOutput` function, and runs a schema-validated retry loop (up to 10 retries, early-exit after 3 consecutive identical errors) by running the `/correct_output` command (`.claude/commands/correct_output.md`), routed through the tables like every other command. The loop writes the invalid output to `<agent output name>-invalid-output-<n>.txt` in the logs directory and passes `[command, args, invalidOutputFile, validationError, schemaJson]` positionally; no prompt is assembled in code
- Provides `runGenerateBranchNameAgent` (invokes `/generate_branch_name` skill, returns `branchName`) and `runCommitAgent` (invokes `/commit` skill, validates and normalises the commit message prefix)
- Writes all stdout and stderr to a per-agent JSONL output file (append mode); logs final cost and model breakdown on close
- Overlays the launch identity on every agent: `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME` and `GIT_COMMITTER_EMAIL` are copied from `launchContext.gitContext.commandEnv()` onto the spawn environment, after the `getSafeSubprocessEnv()` allowlist and before the caller's explicit `subprocessEnv`. Agents run `git commit` themselves, so without these variables git falls back to the host's identity. Only the four identity keys are overlaid, never the credential, which stays opt-in per caller.
- On target-repo runs only, injects a guardrails `--settings` payload at the same spawn call site: `resolveGuardrailsDecision` (`adws/core/guardrailsGate.ts`) runs a guard-clause chain — kill switch → self-host → startup probe verdict — and when it says inject, `runClaudeAgentWithCommand` (`claudeAgent.ts`) unshifts `--settings <json>` onto `cliArgs` and sets `spawnEnv.CLAUDE_HOOKS_LOG_DIR` to an absolute per-run directory
- `buildGuardrailsSettings` (`adws/core/guardrailsPayload.ts`) builds that payload: parses the canonical deny-list template (`templates/claude-settings-starter.json` — the same template `/adw_init` copies verbatim into target repos), adds all five framework hooks (`PreToolUse`, `PostToolUse`, `Notification`, `Stop`, `SubagentStop`) as `bun <absolute-framework-path>/.claude/hooks/<hook>.ts <flags> || true` commands, and declares no `permissions.allow`
- `adws/checkModelLiterals.ts` (`bun run lint:model-literals`) is the guard that keeps spawn sites on the routing tables: it reports `file:line` for a `'--model'` literal in an argv array, a literal fifth (`model`) argument to `runClaudeAgentWithCommand`, and a `model` parameter with a literal default, over `adws/` and `scripts/` (skipping `__tests__`, `node_modules`, `dist` and `modelRouting.ts`). `adws/__tests__/checkModelLiterals.test.ts` runs it over the repository
- `commandAgent.ts` and the direct `runClaudeAgentWithCommand` callers (`planAgent.ts`, `testAgent.ts`, `gitAgent.ts`, `patchAgent.ts`, `refactorAgent.ts`) thread launch-boundary facts (`{ selfHost, adwId }`) through to the spawn so the gate has what it needs to decide
- `adws/core/guardrailsProbe.ts` + `scripts/guardrails-probe.ts` verify the injected payload actually enforces: spawn a real `claude -p` on `PROBE_MODEL` against a scratch dir with the exact payload, under `buildClaudeLaunchEnv({ CLAUDE_HOOKS_LOG_DIR })`, assert a deny/allow matrix plus hook firing, and fail open on any problem; `trigger_cron.ts`'s `main()` warms the verdict once at startup (before the first `checkAndTrigger()`) and `trigger_webhook.ts`'s `/health` check surfaces it as a `guardrailsProbe` entry
- Counts permission-denied tool calls per run (`adws/core/claudeStreamParser.ts`'s `deniedToolCallCount`, carried onto `AgentResult`) and surfaces a non-zero count as a denial notice in issue/PR stage comments (`adws/phases/phaseCommentHelpers.ts`'s `formatDenialNotice`) and the workflow-completion comment (`adws/phases/workflowCompletion.ts`)
- Widens the shared `.claude/hooks/pre-tool-use.ts` `.env` carve-out to also spare `.env.example` (both the file-path check and the Bash-command regex), so the injected deny list's `.env.example` allowance is not defeated by the co-injected hook

## Contracts & Invariants

- Every `claude` process ADW starts has `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`; the builder applies it after the overlay, so no caller can re-enable memory. Auto-memory is the operator's `~/.claude/projects/<key>/memory/`, and a worktree resolves to the same key as the checkout
- `ANTHROPIC_API_KEY` stays on the allowlist and is forwarded when set; it is optional, and setting it moves billing from the Claude subscription to the API
- No call site outside `adws/core/modelRouting.ts` names a model literally; one-turn probes use `PROBE_MODEL`, everything else reads `getModelForCommand`/`getEffortForCommand`. No Haiku entry in any routing table carries an effort
- Every spawned process is detached (`detached: true`) so `killProcessGroup(-pid)` can reach grandchildren (e.g., orphaned heredoc pipelines)
- The `AgentResult.success` field is `false` whenever the process exits non-zero OR the final JSONL result carries `isError: true`; token-limit and compaction terminations resolve as `success: true` with their respective flags set
- `costSource` is always present on resolved results; value is `'extractor_finalized'` when the CLI emits a cost summary line, otherwise `'extractor_estimated'`
- `runCommandAgent` never throws on extraction failure — it retries through the `/correct_output` command; `OutputValidationError` is only thrown after all retries are exhausted. A run stopped on compaction skips extraction and the retry loop (its output is cut off and its caller restarts it), so its `parsed` is `undefined`; the `/correct_output` retry never receives `killOnCompaction`
- `extractOutput` functions must return `ExtractionResult<T>` (never throw) so the retry loop can distinguish parse failures from code errors
- Commit message validation in `runCommitAgent` always guarantees the returned `commitMessage` starts with the correct `<agentName>: <keyword>:` prefix, stripping malformed prefixes if needed
- `AuthRequiredError` and `RateLimitError` are always thrown (never returned in `AgentResult`) so callers cannot silently ignore them
- **Guardrails injection is target-repo only.** `resolveGuardrailsDecision` returns `{ inject: false }` whenever `input.selfHost` is true. An un-threaded caller (no `launchContext` passed) defaults `selfHost` to `true`, so a missing wire-up fails safe toward "no injection" rather than accidentally injecting. Phases take `selfHost` from the launch boundary's `GitContext.selfHost` through `workflowLaunchContext` (`adws/phases/workflowRepoIdentity.ts`), never from whether a `RepoContext` was bound, because a self-host run binds one too.
- **Gate order is fixed and short-circuits**: kill switch (`ADW_TARGET_GUARDRAILS=off`) → self-host → probe verdict. Any one of these withholding injection means the remaining checks (including the paid, network-bound probe) never run. No repository setting takes part: a target repository is injected with or without a `.github/adw.yml`, and a leftover `guardrails:` key there is ignored.
- **Fail-open, never fail-closed.** A failed startup probe results in `{ inject: false }` plus exactly one Slack alert per process (`probeFailureAlertSent` memo in `guardrailsGate.ts`) — a bad guardrails rollout can never block the ADW queue, only leave a repo running with today's (no-guardrails) behaviour.
- **No `permissions.allow` is ever declared** in the injected payload — verified a no-op under `--dangerously-skip-permissions`, so there's no reason to widen the attack surface with one.
- **Hook paths must be absolute.** `$CLAUDE_PROJECT_DIR` resolves to the target worktree, where the framework's own hook scripts don't exist; `buildGuardrailsSettings` always joins hook commands against `frameworkRepoRoot`, never a relative path.
- **`CLAUDE_HOOKS_LOG_DIR` must be absolute**, not the issue's literal relative form. A relative value resolves against the hook process's cwd — which on a target run is the worktree itself — and leaks untracked session-log files into it. `resolveHookLogDir(adwId)` always returns `path.join(AGENTS_STATE_DIR, adwId, 'hook-logs')`, an absolute path under the framework's own agent-state tree.
- **The probe and its alert run at most once per process.** `getGuardrailsProbeVerdict()` memoizes the verdict (`resetGuardrailsProbeMemo()` is test-only); `notifyProbeFailureOnce()` memoizes the alert separately (`resetGuardrailsAlertMemo()` is test-only) — so a persistently-failing probe does not spam Slack on every subsequent target-repo spawn.
- **Denial counting is additive across two shapes.** The CLI emits `tool_result` both as a top-level parsed JSONL message and nested inside an assistant message's content blocks; `claudeStreamParser.ts` increments `deniedToolCallCount` in both places, so a run's total is not shape-dependent.
- **The injected pre-tool-use hook must agree with the deny-list template's carve-outs.** The template's `Read(!**/.env.example)` carve-out only holds if `pre-tool-use.ts`'s `isEnvFileAccess` also spares `.env.example` — both were widened together (issue #762's "spec conflict #2"); if one changes, the other must be checked.

## Configuration

No configuration files govern the base spawn layer. Behaviour is governed by call-site parameters:
- `model` is required and comes from `getModelForCommand`
- `effort` is optional; overridden per-command by `getEffortForCommand`
- Watchdog timeout is looked up per phase name via `getAgentTimeoutForPhase`
- `killOnCompaction` (default `false`) is threaded `handleAgentProcess` ← `runClaudeAgentWithCommand` ← `CommandAgentOptions`/`runBuildAgent`/`runTestAgent`/`runResolveTestAgent`. Only `buildPhase.ts` and `runUnitTestsWithRetry` (when `onCompactionDetected` is supplied) set it; the review phase's `runBuildAgent` calls leave it off
- Token threshold for early termination is `MAX_THINKING_TOKENS * TOKEN_LIMIT_THRESHOLD` (constants from `../core`)
- `ANTHROPIC_API_KEY` — optional; forwarded to agents when set
- Retry counts are module-level constants: `MAX_RETRIES = 10`, `MAX_CONSECUTIVE_IDENTICAL_ERRORS = 3`

Guardrails injection is additionally governed by:
- `ADW_TARGET_GUARDRAILS=off` — kill switch read directly from `process.env` by the parent process (no `SAFE_ENV_VARS` entry needed, since it's never forwarded to the Claude CLI subprocess). Disables injection unconditionally, beating every other gate.
- `CLAUDE_HOOKS_LOG_DIR` — set on `spawnEnv` (on top of the shared launch environment, mirroring the `ADW_WORKTREE_PATH` pattern) to the absolute per-run hook-log directory whenever injection is active. Not set otherwise.
- `templates/claude-settings-starter.json` — the canonical 13-pattern deny list. Edit this file, not any copy of it, to change the deny rules; both the spawn-time payload builder and `/adw_init`'s target-repo copy read from it.

## Gotchas

- The identity overlay needs a `launchContext.gitContext` with `commandEnv`; a spawn without a launch context gets no identity and its commits carry the host's git config. An explicit `subprocessEnv` overrides the overlay.
- The watchdog kill does not set a special exit code — `agentProcessHandler` resolves normally after the process group is killed; the `watchdogFired` boolean in `runClaudeAgentWithCommand` is the sole gate that surfaces `AgentTimeoutError` to the caller
- Rate limit detection fires on `rateLimitDetected` (renamed from `rateLimitRejected` — a documented `rate_limit`/429 `api_retry` or terminal `result.api_error_status: 429` sets it too, not only a rejected `rate_limit_event`), `serverErrorDetected`, OR `overloadedErrorDetected` — all three signal the same "pause" path. The rate-limited `AgentResult` carries `rateLimitType`/`resetsAt` only when a rejected event supplied them.
- Context compaction terminates the agent only when the caller passes `killOnCompaction`, which only the build phase and the unit-test path do, because they restart the agent. The result is then `success: true` with `compactionDetected: true`; the caller must check this flag and re-invoke rather than treating the result as a completed run. Every other agent runs on with the compacted context and resolves normally, without `compactionDetected`
- ENOENT retry clears the path cache and re-resolves the Claude CLI binary before each attempt; a permanently missing binary will exhaust all 3 attempts and return the last failed result (no exception)
- The auth retry's `claude auth status` check runs under the agent's launch environment, which keeps `HOME` and `USER` so the CLI can access its own credentials
- The probes keep their inline prompts (`ping`, `say hello`, the deny-matrix prompts); they do no pipeline work and sit outside the slash-command rule
- `scripts/guardrails-probe.ts` runs `main()` unconditionally on import; do not add an entry-point guard, because a symlinked `argv[1]` would make it exit 0 without probing and `runGuardrailsProbe()` reads exit 0 as a pass
- Tests observe the launch environment through a recording fake `claude` (`adws/core/__tests__/fixtures/recordingClaudeCli.ts`), not by mocking `child_process`; it lives under `adws/` because an adws test cannot import from `scripts/` or `test/` (`rootDir`)
- `runClaudeAgentWithCommand` keeps `command: string` and has no default `model`
- `runCommitAgent` throws on non-success exit (unlike most agents which return the result); callers must not inspect `result.success` after the call
- Branch slug extraction takes only the last non-empty line of agent output; any trailing explanation text from the model is silently discarded
- `issueClass` is accepted but ignored in `formatBranchNameArgs` (the LLM no longer assembles the prefix); the parameter remains for call-site compatibility
- The probe (`scripts/guardrails-probe.ts`) spawns a **real, paid, network-bound** `claude -p` call — it cannot run inside the BDD harness's mocked stub and is deliberately excluded from that suite's coverage; only `adws/core/guardrailsProbe.ts`'s subprocess-invocation wiring is unit/BDD-tested
- `runGuardrailsProbe()` resolves `REPO_ROOT` inside the function body, not at module scope, so merely importing `guardrailsProbe.ts` (e.g. transitively via the `adws/core` barrel) never touches it — only actually running the probe does
- `**/logs/` was added to `.gitignore` because Claude Code hook logs can land in any directory an agent `cd`'s into (not just the repo root) when `CLAUDE_HOOKS_LOG_DIR` is unset or misconfigured — a defense-in-depth guard against the same worktree-leak class the absolute-path invariant above prevents by construction
- `formatDenialNotice()` returns `null` (not an empty string) when `count` is 0, specifically so a clean run's stage comment gets no denial line appended — callers must treat the return as optional, not always-render

## Decisions

- [ADR-0001](../specs/adr/0001-script-per-orchestrator-driving-claude-code-cli.md) — One script per orchestrator, each driving the Claude Code CLI as a subprocess
- [ADR-0010](../specs/adr/0010-model-and-effort-routing-per-command.md) — Model and reasoning effort are routed per slash command from central tables
- [ADR-0015](../specs/adr/0015-slash-commands-as-single-spawn-path.md) — Agents are spawned through one function, and their prompt is a slash command
- [ADR-0020](../specs/adr/0020-shared-phase-runner-and-core-decomposition.md) — Phases run through a shared phase runner, and the core is split into single-purpose modules
- [ADR-0023](../specs/adr/0023-context-exhaustion-is-a-reset.md) — Context exhaustion restarts the agent with fresh context; git state carries the work over
- [ADR-0026](../specs/adr/0026-cost-computed-locally-persisted-in-d1.md) — Cost computed locally and persisted in a D1 database
- [ADR-0039](../specs/adr/0039-host-wide-auth-gate.md) — An expired Claude login closes a host-wide gate until a human logs in again
- [ADR-0050](../specs/adr/0050-target-repo-guardrails.md) — ADW injects its own guardrails into agent runs on target repositories
- [ADR-0052](../specs/adr/0052-stateless-pipeline-agents.md) — Pipeline agents never load Claude auto-memory
