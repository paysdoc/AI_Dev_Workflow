# Target-Repo Guardrails Injection

## Overview

Every ADW agent spawns with `--dangerously-skip-permissions`, and target-repo worktrees never receive the framework's own `.claude/settings.json` or hooks. This module closes that hole: on target-repo runs only, `claudeAgent` injects an inline `--settings` payload — a canonical deny list plus all five framework hooks at absolute paths — so a target repo that ships no guardrails of its own still cannot force-push, recursively force-delete, or read `.env` secrets, and its tool activity is still logged. Self-host runs receive nothing; the framework's own project `settings.json` stays authoritative there.

## Responsibilities

- Own the canonical deny-list template (`templates/claude-settings-starter.json`) — the single source of truth also copied verbatim into target repos by `/adw_init` (follow-up issue), parsed here at spawn time.
- Build the injected `--settings` payload (`adws/core/guardrailsPayload.ts`): parses the template's `permissions.deny`, adds all five hooks (`PreToolUse`, `PostToolUse`, `Notification`, `Stop`, `SubagentStop`) as `bun <absolute-framework-path>/.claude/hooks/<hook>.ts <flags> || true` commands, and declares no `permissions.allow`.
- Decide whether to inject (`adws/core/guardrailsGate.ts`): a pure guard-clause chain — kill switch → self-host → `.github/adw.yml` canary → startup probe verdict — with injectable seams (`GuardrailsGateDeps`) for tests.
- Verify the payload actually enforces (`adws/core/guardrailsProbe.ts` + `scripts/guardrails-probe.ts`): spawns a real `claude -p` (haiku) against a scratch dir with the exact payload, asserts a deny/allow matrix plus hook firing, and fails open on any problem.
- Wire the decision into the spawn boundary (`adws/agents/claudeAgent.ts`'s `runClaudeAgentWithCommand`): unshifts `--settings <json>` onto `cliArgs` and sets `spawnEnv.CLAUDE_HOOKS_LOG_DIR` to an absolute per-run directory when the gate says inject.
- Thread launch-boundary facts (`{ selfHost, adwId }`) from phase/orchestrator boundaries through `commandAgent.ts` and the direct `runClaudeAgentWithCommand` callers (`planAgent.ts`, `testAgent.ts`, `gitAgent.ts`, `patchAgent.ts`, `refactorAgent.ts`) to the spawn.
- Count permission-denied tool calls per run (`adws/core/claudeStreamParser.ts`'s `deniedToolCallCount`, carried onto `AgentResult`) and surface a non-zero count as a denial notice in issue/PR stage comments (`adws/phases/phaseCommentHelpers.ts`'s `formatDenialNotice`) and the workflow-completion comment (`adws/phases/workflowCompletion.ts`).
- Warm the probe verdict once at trigger startup (`trigger_cron.ts`'s `main()`, before the first `checkAndTrigger()`) and surface it in `trigger_webhook.ts`'s `/health` check as a `guardrailsProbe` entry.
- Widen the shared `.claude/hooks/pre-tool-use.ts` `.env` carve-out to also spare `.env.example` (both the file-path check and the Bash-command regex), so the injected deny list's `.env.example` allowance is not defeated by the co-injected hook.

## Contracts & Invariants

- **Target-repo only.** `resolveGuardrailsDecision` returns `{ inject: false }` whenever `input.selfHost` is true. An un-threaded caller (no `launchContext` passed) defaults `selfHost` to `true`, so a missing wire-up fails safe toward "no injection" rather than accidentally injecting.
- **Gate order is fixed and short-circuits**: kill switch (`ADW_TARGET_GUARDRAILS=off`) → self-host → `.github/adw.yml` `guardrails !== true` → probe verdict. Any one of these withholding injection means the remaining checks (including the paid, network-bound probe) never run.
- **Fail-open, never fail-closed.** A failed startup probe results in `{ inject: false }` plus exactly one Slack alert per process (`probeFailureAlertSent` memo in `guardrailsGate.ts`) — a bad guardrails rollout can never block the ADW queue, only leave a repo running with today's (no-guardrails) behaviour.
- **No `permissions.allow` is ever declared** in the injected payload — verified a no-op under `--dangerously-skip-permissions`, so there's no reason to widen the attack surface with one.
- **Hook paths must be absolute.** `$CLAUDE_PROJECT_DIR` resolves to the target worktree, where the framework's own hook scripts don't exist; `buildGuardrailsSettings` always joins hook commands against `frameworkRepoRoot`, never a relative path.
- **`CLAUDE_HOOKS_LOG_DIR` must be absolute**, not the issue's literal relative form. A relative value resolves against the hook process's cwd — which on a target run is the worktree itself — and leaks untracked session-log files into it. `resolveHookLogDir(adwId)` always returns `path.join(AGENTS_STATE_DIR, adwId, 'hook-logs')`, an absolute path under the framework's own agent-state tree.
- **The probe and its alert run at most once per process.** `getGuardrailsProbeVerdict()` memoizes the verdict (`resetGuardrailsProbeMemo()` is test-only); `notifyProbeFailureOnce()` memoizes the alert separately (`resetGuardrailsAlertMemo()` is test-only) — so a persistently-failing probe does not spam Slack on every subsequent target-repo spawn.
- **Denial counting is additive across two shapes.** The CLI emits `tool_result` both as a top-level parsed JSONL message and nested inside an assistant message's content blocks; `claudeStreamParser.ts` increments `deniedToolCallCount` in both places, so a run's total is not shape-dependent.
- **The injected pre-tool-use hook must agree with the deny-list template's carve-outs.** The template's `Read(!**/.env.example)` carve-out only holds if `pre-tool-use.ts`'s `isEnvFileAccess` also spares `.env.example` — both were widened together (issue #762's "spec conflict #2"); if one changes, the other must be checked.

## Configuration

- `ADW_TARGET_GUARDRAILS=off` — kill switch read directly from `process.env` by the parent process (no `SAFE_ENV_VARS` entry needed, since it's never forwarded to the Claude CLI subprocess). Disables injection unconditionally, beating every other gate.
- `.github/adw.yml` `guardrails: true` — per-target-repo opt-in canary key (see `adws/core/adwYmlConfig.ts`). Default `false` (absent, malformed, or explicit `false` all withhold injection). This is temporary rollout scaffolding; the end state is mandatory guardrails for all target repos.
- `CLAUDE_HOOKS_LOG_DIR` — set on `spawnEnv` (after the `getSafeSubprocessEnv()` allowlist filter, mirroring the `ADW_WORKTREE_PATH` pattern) to the absolute per-run hook-log directory whenever injection is active. Not set otherwise.
- `templates/claude-settings-starter.json` — the canonical 13-pattern deny list. Edit this file, not any copy of it, to change the deny rules; both the spawn-time payload builder and `/adw_init`'s target-repo copy read from it.

## Gotchas

- The probe (`scripts/guardrails-probe.ts`) spawns a **real, paid, network-bound** `claude -p` call — it cannot run inside the BDD harness's mocked stub and is deliberately excluded from that suite's coverage; only `adws/core/guardrailsProbe.ts`'s subprocess-invocation wiring is unit/BDD-tested.
- `runGuardrailsProbe()` resolves `REPO_ROOT` inside the function body, not at module scope, so merely importing `guardrailsProbe.ts` (e.g. transitively via the `adws/core` barrel) never touches it — only actually running the probe does.
- `**/logs/` was added to `.gitignore` because Claude Code hook logs can land in any directory an agent `cd`'s into (not just the repo root) when `CLAUDE_HOOKS_LOG_DIR` is unset or misconfigured — a defense-in-depth guard against the same worktree-leak class the absolute-path invariant above prevents by construction.
- `formatDenialNotice()` returns `null` (not an empty string) when `count` is 0, specifically so a clean run's stage comment gets no denial line appended — callers must treat the return as optional, not always-render.
- The gate's `readAdwYml` dependency reads from `input.worktreePath`, not `REPO_ROOT` — the canary is per-target-repo, and a self-host run never reaches that check anyway (short-circuited earlier).
