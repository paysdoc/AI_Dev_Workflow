# Feature: Enforce ADW guardrails in target-repo agent runs via `--settings` injection

## Metadata
issueNumber: `762`
adwId: `0rvmyc-enforce-adw-guardrai`
issueJson: `{"number":762,"title":"Enforce ADW guardrails in target-repo agent runs via --settings injection","state":"OPEN","author":"paysdoc","labels":["adw:feature"],"createdAt":"2026-07-17T09:59:42Z","comments":[{"author":"paysdoc","createdAt":"2026-07-17T14:17:25Z","body":"## continue"}]}` (full problem/solution body reproduced verbatim in the Problem Statement and Solution Statement below).

## Feature Description
Every ADW agent spawns with `--dangerously-skip-permissions` (`adws/agents/claudeAgent.ts:103`), and `copyClaudeAssetsToWorktree` (`adws/phases/worktreeSetup.ts`) copies only `.claude/commands/` and `.claude/skills/` into target worktrees — never hooks, never settings. A target repo that ships no `.claude/settings.json` (the common case) therefore runs ADW agents with **zero guardrails**: no deny rules, no pre-tool-use blocking, no session-log hooks.

This feature closes that hole at the spawn boundary. On **target-repo runs only**, `claudeAgent` passes an inline `--settings <JSON>` payload carrying (a) the canonical deny list sourced from a new `templates/claude-settings-starter.json`, and (b) all five framework hooks registered at **absolute** framework paths, run with `bun` and directed to write their session logs **outside** the target worktree. Self-host runs receive nothing (the framework's own project `settings.json` stays authoritative; injecting there too would double-fire hooks and duplicate session logs).

Rollout is gated three ways so a mistaken deny rule can never wedge the queue: an `ADW_TARGET_GUARDRAILS=off` kill switch, a `guardrails: true` canary key in `.github/adw.yml`, and a startup probe that **fails open** (start without injection + Slack alert) rather than blocking. A per-run permission-denied count is surfaced in run reporting so a bad deny rule reads as "N denials" rather than masquerading as agent flakiness — a brand-new failure mode, since `--dangerously-skip-permissions` runs have never denied anything before.

## User Story
As an **ADW operator running the framework against external target repos**,
I want **ADW's own deny rules and hooks to apply to every target-repo agent run regardless of what the target repo ships**,
So that **an agent working in a target repo that has no `.claude/settings.json` still cannot force-push, recursively force-delete, or read `.env` secrets, and its tool activity is logged — with a safe, observable, instantly-reversible rollout.**

## Problem Statement
Target repos often ship no `.claude/settings.json` and no hooks. `copyClaudeAssetsToWorktree` (`adws/phases/worktreeSetup.ts`) copies only `.claude/commands/` and `.claude/skills/` into target worktrees — never hooks or settings. Since every agent spawns with `--dangerously-skip-permissions` (`adws/agents/claudeAgent.ts`), ADW agents run in target repos with ZERO guardrails: no deny rules, no pre-tool-use blocking, no session-log hooks. ADW's guardrails must apply to every target-repo run irrespective of the target's own configuration.

Concretely, the RED baseline verified in the codebase:
- `cliArgs` (`adws/agents/claudeAgent.ts:100-108`) carries no `--settings` flag at all (`grep '--settings' adws/` → no matches).
- No `guardrails` key exists in `adws/core/adwYmlConfig.ts` (only `hitl` and `unitTests`).
- The stream parser cannot count permission denials: `ToolResultContentBlock` (`adws/core/claudeStreamParser.ts:33-37`) models only `{type, tool_use_id, content}` with no `is_error` field, and `JsonlParserState` has no denial counter — although `installPhase.ts:61` already reads `is_error` off raw parsed JSON, proving the field is on the wire and the type is merely incomplete.

## Solution Statement
`claudeAgent` passes `--settings <inline JSON string>` on **target-repo runs only** (self-host runs keep the framework's project `settings.json`). The spawn distinguishes target vs self-host via the GitContext launch boundary (`GitContext.selfHost`, `adws/gitContext/gitContext.ts:126`), threaded to the spawn.

### Canonical template
Create `templates/claude-settings-starter.json` — the single source of truth for the deny list, consumed two ways: parsed by `claudeAgent` at spawn (this issue), and copied verbatim by `/adw_init` into target repos (follow-up issue). Contents (13 deny patterns, no allow list, no hooks — hooks are added at spawn):

```json
{
  "permissions": {
    "deny": [
      "Bash(rm -rf:*)", "Bash(rm -fr:*)", "Bash(rm -Rf:*)", "Bash(rm -fR:*)",
      "Bash(rm --recursive --force:*)", "Bash(rm --force --recursive:*)",
      "Bash(rm* -r* -f*)", "Bash(rm* -f* -r*)",
      "Bash(git push*--force*)", "Bash(git push -f:*)",
      "Read(**/.env*)", "Read(!**/.env.sample)", "Read(!**/.env.example)"
    ]
  }
}
```

Every pattern was live-tested on 2026-07-17 (deny rules ARE enforced under `--dangerously-skip-permissions`, including via `--settings`; `Read(!pattern)` inside the parens is an UNDOCUMENTED gitignore-style negation carve-out; `Bash(git push*--force*)` catches flag-after-args; space-anchored `Bash(rm* -r* -f*)` catches `rm -r -f x` without false-positives; the blanket `Read(**/.env*)` without the carve-outs breaks any build that adds an env var — the carve-outs are load-bearing).

### Injected payload (built at spawn)
- Deny rules from the template (parsed, not re-declared).
- All five hooks (PreToolUse, PostToolUse, Notification, Stop, SubagentStop) with **absolute framework paths** (`$CLAUDE_PROJECT_DIR` resolves to the worktree, where the hooks don't exist). Run hooks with `bun /abs/path.ts` (NOT `bunx tsx` — target repos don't have tsx); keep the `|| true` non-blocking wrapper. The command shapes and per-hook flags mirror the framework's own `.claude/settings.json:23-79` — `notification.ts --notify`, `stop.ts --chat`, the other three flagless.
- NO allow list — verified a no-op under `--dangerously-skip-permissions`.
- Spawn env: `CLAUDE_HOOKS_LOG_DIR` set to the run's agent-state hook-log directory. **See "Spec conflict #1" — this value MUST be ABSOLUTE**, resolving to `<framework>/agents/{adwId}/hook-logs`, not the issue's literal relative `agents/{adwId}/hook-logs/`.

### Assurance (required, not optional)
1. **Kill switch**: `ADW_TARGET_GUARDRAILS=off` disables injection entirely — instant rollback, no deploy. Read by ADW's own (parent) process; needs no `SAFE_ENV_VARS` entry.
2. **Startup gate**: a probe script (`scripts/guardrails-probe.ts`) spawns a real `claude -p` (haiku) against a scratch dir with the exact payload and asserts the deny matrix (`.env` DENIED, `.env.sample` SUCCEEDED, `rm -r -f` DENIED, normal read SUCCEEDED) plus hook firing. The trigger-startup path runs it before processing any issue. On probe failure: **fail-open** — start without injection (today's behavior) and send a Slack alert.
3. **Deny observability**: count permission-denied tool results in the parsed stream-JSONL per run and surface the count in the run's issue comment / Slack when > 0.
4. **Canary rollout**: injection activates only for repos with `guardrails: true` in `.github/adw.yml` (extend `adws/core/adwYmlConfig.ts`). The key is temporary rollout scaffolding; the end state is mandatory guardrails for all target repos.

### Two spec conflicts flagged to the maintainer (NOT silently resolved)
Both were verified empirically against the real hook on 2026-07-17 (not reasoned about):

- **Spec conflict #1 — the specified hook-log value leaks into the worktree.** The issue specifies `CLAUDE_HOOKS_LOG_DIR=agents/{adwId}/hook-logs/` (relative) yet its AC says "Hook logs land in `agents/{adwId}/hook-logs/`, **never in the worktree**". Those conflict: `LOG_BASE_DIR = process.env.CLAUDE_HOOKS_LOG_DIR || 'logs'` (`.claude/hooks/utils/constants.ts:11`) is joined with the session id (`getSessionLogDir` → `path.join(LOG_BASE_DIR, sessionId)`); `path.join` on a RELATIVE base yields a RELATIVE path, which `fs.mkdirSync` resolves against the **hook process's cwd** — which on a target run IS the target worktree. Verified: firing `post-tool-use.ts` with a relative `CLAUDE_HOOKS_LOG_DIR` and cwd=scratch-worktree wrote the log INSIDE the scratch worktree; an ABSOLUTE value wrote it under the absolute path and left the worktree clean. **Resolution in this plan: use an absolute path** (`<framework>/agents/{adwId}/hook-logs`). This changes a value the issue states explicitly, so it is flagged rather than silently applied.
- **Spec conflict #2 — the injected pre-tool-use hook blocks `.env.example`, which the deny list carves out.** The template carves `.env.example` out of the blanket `Read(**/.env*)`, but `isEnvFileAccess` (`.claude/hooks/pre-tool-use.ts:85`) blocks any path containing `.env` unless it `endsWith('.env.sample')` — `.env.example` is not spared. Verified: `.env` → exit 2 (correct block); `.env.sample` → exit 0 (agrees with carve-out); `.env.example` → exit 2 (**contradicts** `Read(!**/.env.example)`); `README.md` → exit 0 (no collateral). This conflict is **created by this issue** (before #762 neither layer was present in a target run, so they could not disagree), hence owned here. **Resolution: widen the hook's carve-out to also spare `.env.example`** (a one-line change at `:85`, mirrored in the Bash-command regex at `:104` for consistency). If the maintainer instead scopes `.env.example` support out of #762, the `.env.example` row of BDD §14 must be retired deliberately rather than left failing.

### Known watch item (observed during canary, NOT pinned)
`pre-tool-use.ts` contains `rewriteWorktreePath`, env-gated on `ADW_WORKTREE_PATH` / `ADW_MAIN_REPO_PATH` — which `claudeAgent.ts:122-130` already sets for ANY worktree cwd. Once hooks fire in target runs, path rewriting activates against target-repo layouts for the first time. Intended behavior, but must be observed during canary. It is deliberately not asserted (its correct behaviour on target layouts is not yet specified).

## Relevant Files
Use these files to implement the feature:

### Existing files to modify
- `adws/agents/claudeAgent.ts` — **primary spawn boundary.** `runClaudeAgentWithCommand` builds `cliArgs` at `:100-108` (where `--settings` is unshifted) and `spawnEnv` at `:120` (where `CLAUDE_HOOKS_LOG_DIR` is set directly, after the `getSafeSubprocessEnv()` allowlist filter — mirroring the `ADW_WORKTREE_PATH` block at `:122-130`). Gains the target-vs-self-host + adwId launch context and calls the guardrails gate; the ENOENT/auth/rate-limit retries reuse the same `cliArgs`/`spawnOptions`, so the injected flag rides every respawn automatically.
- `adws/core/adwYmlConfig.ts` — extend with a `guardrails` key using the existing three-touch-point parser pattern (`AdwYmlConfig` interface `:37`, `DEFAULT_CONFIG` `:42`, `KEY_SPECS` `:84`, and the two return literals in `parseAdwYml` `:130-133`). Default `false` (opt-in canary; malformed → `false` + warn, failing safe toward off).
- `adws/core/claudeStreamParser.ts` — widen `ToolResultContentBlock` (`:33-37`) with `is_error?: boolean`; add `deniedToolCallCount: number` to `JsonlParserState` (`:100-119`); count permission-denied tool results in `parseJsonlOutput` (`:158-258`).
- `adws/agents/agentProcessHandler.ts` — copy `state.deniedToolCallCount` into the returned `AgentResult` at each result-assembly site (`:193/217/235/259/274/289`); initialize the new state field at `:56`.
- `adws/types/agentTypes.ts` — add `deniedToolCallCount?: number` to `AgentResult` (`:9-42`).
- `.claude/hooks/pre-tool-use.ts` — widen the `.env` carve-out to also spare `.env.example` (file-path check `:85`; Bash-command regex `:104` for consistency). **Spec conflict #2.** Shared hook (also runs self-host); widening to spare a second sample file is behaviour-preserving.
- `adws/phases/phaseCommentHelpers.ts` — surface the denial count in the run's stage comment (`postIssueStageComment` `:18`, `postPRStageComment` `:36`) via a small pure formatter, only when > 0.
- `adws/phases/workflowCompletion.ts` — `completeWorkflow` (`:25`) is the end-of-run summary surface; append the aggregated denial notice when > 0.
- `adws/triggers/trigger_cron.ts` — cron startup `main()` (`:433-447`, after `assertCwdIsRepoRoot()`); warm the guardrails probe verdict once before the first `checkAndTrigger()` (fail-open + Slack alert on failure).
- `adws/triggers/trigger_webhook.ts` — the `/health` check composition (`:72-92`, alongside `checkEnvironmentVariables`/`checkClaudeCodeCLI`/etc.) surfaces the guardrails probe verdict.
- `adws/agents/commandAgent.ts` — `CommandAgentOptions` (`:91` already carries `subprocessEnv?`) gains the launch-context field; the two `runClaudeAgentWithCommand` calls (`:188/233`) forward it. This covers the majority of SDLC agents (build, document, review, scenario-fix, alignment, validation, resolution, step-def, install) in one place.
- `adws/agents/planAgent.ts` (`:225/273`), `adws/agents/testAgent.ts` (`:162/209`), `adws/agents/gitAgent.ts` (`:61/182`), `adws/agents/patchAgent.ts` (`:49`), `adws/agents/refactorAgent.ts` (`:36`) — direct `runClaudeAgentWithCommand` callers; thread the launch context through their signatures (several already forward `subprocessEnv`, the natural sibling).
- `adws/core/environment.ts` — reference only; confirms `CLAUDE_HOOKS_LOG_DIR` and `ADW_TARGET_GUARDRAILS` need NO `SAFE_ENV_VARS` entry (`:168-194`): the former is set on `spawnEnv` after the filter, the latter is read by the parent. `REPO_ROOT` (`:20`) and `AGENTS_STATE_DIR` (`:155`) are the absolute bases for the hook-log dir and framework hook paths.

### New Files
- `templates/claude-settings-starter.json` — canonical deny-list SSOT (13 patterns, no allow list, no hooks), exactly as in the Solution. Lives beside `templates/vocabulary.md.template`.
- `adws/core/guardrailsPayload.ts` — **pure payload builder** (deep module, no I/O beyond reading the template file; unit-test target). Exports: `buildGuardrailsSettings({ frameworkRepoRoot }): GuardrailsSettings` (parses the template's `permissions.deny`, adds the five hooks at absolute `bun <frameworkRepoRoot>/.claude/hooks/<hook>.ts <flags> || true` paths, declares NO allow list); `serializeGuardrailsSettings(settings): string`; `resolveHookLogDir(adwId): string` (returns the ABSOLUTE `path.join(AGENTS_STATE_DIR, adwId, 'hook-logs')`). Kept under 300 lines.
- `adws/core/guardrailsGate.ts` — **pure decision module** (injectable seams; unit-test target). Exports `resolveGuardrailsDecision(input, deps): Promise<GuardrailsDecision>` where `GuardrailsDecision = { inject: false } | { inject: true; settingsJson: string; hookLogDir: string }`; `input = { selfHost, worktreePath, adwId }`; `deps = { probeGuardrails: () => ProbeVerdict; notifySlack: (text) => Promise<void>; readAdwYml: (worktreePath) => AdwYmlConfig; getEnv: (name) => string | undefined }`. Order: kill switch → self-host → adw.yml `guardrails !== true` → probe verdict (fail → no inject + AWAIT one Slack alert) → build + inject. Kept under 300 lines.
- `adws/core/guardrailsProbe.ts` — `runGuardrailsProbe(): Promise<ProbeVerdict>` (invokes `scripts/guardrails-probe.ts`) and a memoized `getGuardrailsProbeVerdict()` so the probe runs at most once per process and the fail-open Slack alert fires once. Wired as the production `probeGuardrails` seam.
- `scripts/guardrails-probe.ts` — standalone probe: spawns a real `claude -p` (haiku) against a scratch dir with the exact injected payload; asserts the deny matrix (`.env` DENIED, `.env.sample` SUCCEEDED, `rm -r -f` DENIED, normal read SUCCEEDED) plus hook firing (a hook-log file appears). Exit 0 = pass, non-zero = fail. (`scripts/` is a new directory.)
- `adws/core/__tests__/guardrailsPayload.test.ts`, `adws/core/__tests__/guardrailsGate.test.ts` — unit tests for the two pure modules.
- `features/per-issue/step_definitions/feature-762.steps.ts` — self-contained `@adw-762` step definitions for the existing `features/per-issue/feature-762.feature` (see Testing Strategy). The `.feature` file already exists (19 scenarios).

### Conditional documentation (matched conditions in `.adw/conditional_docs.md`)
- `app_docs/feature-qr9z6g-fix-worktree-path-rewriting.md` — matched: "working with `.claude/hooks/pre-tool-use.ts`"; "modifying `claudeAgent.ts` spawn env or `getSafeSubprocessEnv()` / `SAFE_ENV_VARS`"; "adding new env vars that must propagate from ADW orchestrator to spawned Claude CLI subprocesses". Directly covers the `CLAUDE_HOOKS_LOG_DIR` env propagation and the `rewriteWorktreePath` watch item.
- `app_docs/feature-oqb76h-gitcontext-base-path-authority.md` — **Owns** `adws/agents/claudeAgent.ts`, `adws/agents/commandAgent.ts`, and the phase agent-callers; matched: "`subprocessEnv?: NodeJS.ProcessEnv` added to `runClaudeAgentWithCommand`… the per-command subprocess auth seam"; "the Claude subprocess env is constructed as `{ ...getSafeSubprocessEnv(), ...(subprocessEnv ?? {}) }`". The launch-context threading rides the same seam.
- `app_docs/feature-k2tkdn-gitcontext-boundary-constructor.md` — **Owns** `adws/core/launchGitContext.ts`; matched: "`buildLaunchGitContext`… `selfHost`… launch boundary". The `selfHost` discriminator originates here.
- `app_docs/feature-6zw7n2-hitl-opt-in-adw-yml.md` — matched: "`adws/core/adwYmlConfig.ts` (`readAdwYmlConfig` / `parseAdwYml`) needs context". The `guardrails` key extends this parser.

## Implementation Plan
### Phase 1: Foundation (deny-list SSOT, payload builder, config gate, parser widening)
Establish the pieces that carry no wiring risk and are independently unit-testable: the canonical template, the pure payload builder, the `guardrails` adw.yml key, and the stream-parser denial counter (type widening + state field + count logic). None of these change spawn behaviour yet.

### Phase 2: Core Implementation (the gate, the probe, the hook fix, the boundary injection)
Build the decision module (`guardrailsGate.ts`) and the probe (`guardrailsProbe.ts` + `scripts/guardrails-probe.ts`), fix the pre-tool-use `.env.example` carve-out, then wire the gate into `claudeAgent` so target-repo spawns receive `--settings` + `CLAUDE_HOOKS_LOG_DIR` and self-host spawns receive nothing. This is where the RED BDD scenarios flip GREEN.

### Phase 3: Integration (threading the launch context, startup probe, run reporting)
Thread `{ selfHost, adwId }` from the phase/orchestrator boundaries (where `GitContext.selfHost` + `adwId` are in scope) through the agent runners to the spawn; warm the probe verdict at trigger startup (fail-open + Slack alert) and surface it in `/health`; surface the per-run denial count in run reporting.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Add the canonical deny-list template (`templates/claude-settings-starter.json`)
- Create the file with exactly the 13-pattern `permissions.deny` array from the Solution — no allow list, no hooks.
- This is the single source of truth; do not duplicate the pattern list elsewhere. `claudeAgent` parses it at spawn; `/adw_init` copies it verbatim in the follow-up issue.

### 2. Build the pure payload builder (`adws/core/guardrailsPayload.ts`)
- `buildGuardrailsSettings({ frameworkRepoRoot })`: read + `JSON.parse` `templates/claude-settings-starter.json`, extract `permissions.deny`, and return `{ permissions: { deny }, hooks: {...} }` with the five hook events, each command `bun ${frameworkRepoRoot}/.claude/hooks/<hook>.ts <flags> || true` (flags per `.claude/settings.json`: Notification `--notify`, Stop `--chat`, others none). Declare **no** `permissions.allow`.
- `serializeGuardrailsSettings(settings)`: `JSON.stringify` for the `--settings` argument.
- `resolveHookLogDir(adwId)`: return `path.join(AGENTS_STATE_DIR, adwId, 'hook-logs')` — an ABSOLUTE path (AGENTS_STATE_DIR is `<cwd=REPO_ROOT>/agents`). **Spec conflict #1.**
- Guard clauses first; immutable locals; JSDoc on each export; keep under 300 lines. Reading the template is the only side effect (isolate it).

### 3. Extend the adw.yml parser with the `guardrails` key (`adws/core/adwYmlConfig.ts`)
- Add `readonly guardrails: boolean` to `AdwYmlConfig`; add `guardrails: false` to `DEFAULT_CONFIG` (opt-in canary default).
- Add a `KEY_SPECS` entry `{ key: 'guardrails', regex: /^\s*guardrails\s*:\s*(.*)$/, defaultValue: false, malformedWarn: (v) => \`adw.yml: malformed 'guardrails' value "${v}", defaulting to disabled (guardrails: false)\` }`.
- Add `guardrails: resolved.get('guardrails') ?? DEFAULT_CONFIG.guardrails` to the return literal in `parseAdwYml`, and update the absent-file/unreadable return paths (they return `DEFAULT_CONFIG`, so no change needed beyond the new default field).
- Add a commented `# guardrails: false` stanza to `ADW_YML_TEMPLATE` documenting the canary opt-in.

### 4. Widen the stream parser for denial counting (`adws/core/claudeStreamParser.ts`)
- Add `is_error?: boolean` to `ToolResultContentBlock`.
- Add `deniedToolCallCount: number` to `JsonlParserState`.
- In `parseJsonlOutput`, increment `state.deniedToolCallCount` for each parsed permission-denied tool result. Detect it via the CLI's tool_result shape (`is_error === true` with permission-denied content), handling tool_result both as a top-level message (the shape `installPhase.ts:61` already reads) and nested in message content blocks. Pin the exact discriminator from the probe/live CLI; the BDD (§11) seeds the CLI's permission-denied shape and the unit test asserts the increment.

### 5. Carry the denial count through to `AgentResult` (`adws/agents/agentProcessHandler.ts`, `adws/types/agentTypes.ts`)
- Add `deniedToolCallCount?: number` to `AgentResult`.
- Initialize `deniedToolCallCount: 0` in the `JsonlParserState` at `agentProcessHandler.ts:56`, and set `deniedToolCallCount: state.deniedToolCallCount` on every returned `AgentResult` (success and non-success paths).

### 6. Fix the pre-tool-use `.env.example` carve-out (`.claude/hooks/pre-tool-use.ts`) — Spec conflict #2
- `:85`: change the file-path guard to `filePath.includes('.env') && !filePath.endsWith('.env.sample') && !filePath.endsWith('.env.example')`.
- `:104`: widen the Bash-command regex negative lookahead from `(?!\.sample)` to `(?!\.(?:sample|example))` so `.env.example` references in commands are spared too.
- Leave `.env` blocking and the `rm -rf` detection unchanged. This preserves self-host behaviour (a second sample-file exception is behaviour-preserving).

### 7. Build the probe (`scripts/guardrails-probe.ts`, `adws/core/guardrailsProbe.ts`)
- `scripts/guardrails-probe.ts`: create a throwaway scratch dir; spawn a real `claude -p` (haiku, `--dangerously-skip-permissions`, `--settings <payload>`, `CLAUDE_HOOKS_LOG_DIR=<abs scratch log dir>`); assert the deny matrix (`.env` DENIED, `.env.sample` SUCCEEDED, `rm -r -f` DENIED, a normal read SUCCEEDED) and that a hook-log file appears. Exit 0 = pass, non-zero + reason = fail. Clean up the scratch dir.
- `adws/core/guardrailsProbe.ts`: `runGuardrailsProbe()` executes the script and maps its exit status to `ProbeVerdict = { ok: boolean; detail?: string }`; `getGuardrailsProbeVerdict()` memoizes it (probe + fail-open Slack alert happen once per process).

### 8. Build the gate (`adws/core/guardrailsGate.ts`)
- `resolveGuardrailsDecision(input, deps)` in strict order (guard clauses):
  1. `if (deps.getEnv('ADW_TARGET_GUARDRAILS') === 'off') return { inject: false };` (kill switch beats everything).
  2. `if (input.selfHost) return { inject: false };` (self-host keeps project settings).
  3. `if (deps.readAdwYml(input.worktreePath).guardrails !== true) return { inject: false };` (canary gate; omitted/false/absent all withhold).
  4. `const verdict = deps.probeGuardrails(); if (!verdict.ok) { await deps.notifySlack(<alert>); return { inject: false }; }` (fail-open, loud).
  5. Build: `settingsJson = serializeGuardrailsSettings(buildGuardrailsSettings({ frameworkRepoRoot: REPO_ROOT }))`, `hookLogDir = resolveHookLogDir(input.adwId)`, `return { inject: true, settingsJson, hookLogDir };`.
- Production deps wire `probeGuardrails → getGuardrailsProbeVerdict` (memoized — the probe runs at most once per process), `notifySlack → a once-per-process guarded wrapper around postSlack` (AWAITED, not fire-and-forget) so a memoized failed verdict alerts exactly once rather than on every spawn, `readAdwYml → readAdwYmlConfig`, `getEnv → (n) => process.env[n]`. The BDD (§9) injects a plain capturing notifier and asserts one call per gate invocation; the once-guard is a production-wiring concern, not part of the pure gate.

### 9. Wire the gate into the spawn boundary (`adws/agents/claudeAgent.ts`)
- Add an optional trailing param `launchContext?: { selfHost: boolean; adwId: string }` to `runClaudeAgentWithCommand` (consistent with the existing trailing-optional pattern that added `subprocessEnv` in #701).
- Before spawning, call `resolveGuardrailsDecision({ selfHost: launchContext?.selfHost ?? true, worktreePath: cwd ?? process.cwd(), adwId: launchContext?.adwId ?? '' }, prodDeps)`. `selfHost` defaults to `true` when the context is absent, so an un-threaded caller injects nothing (fail-safe = today's behaviour).
- If `decision.inject`: unshift `'--settings', decision.settingsJson` into `cliArgs` (before the trailing `prompt`) and set `spawnEnv['CLAUDE_HOOKS_LOG_DIR'] = decision.hookLogDir` directly on `spawnEnv` (after `getSafeSubprocessEnv()`, mirroring the `ADW_WORKTREE_PATH` block at `:122-130`). The ENOENT/auth/rate-limit retries reuse the same `cliArgs`/`spawnOptions`, so the flag rides every respawn.
- Because the gate is async, resolve the decision before the `spawn` call (the function is already `async`).

### 10. Thread the launch context from the phase/orchestrator boundaries (Phase 3 integration)
- `adws/agents/commandAgent.ts`: add `launchContext?` to `CommandAgentOptions` and forward it in both `runClaudeAgentWithCommand` calls (`:188/233`). This covers every commandAgent-based agent at once.
- `adws/agents/planAgent.ts`, `testAgent.ts`, `gitAgent.ts`, `patchAgent.ts`, `refactorAgent.ts`: add `launchContext?` to their signatures and forward it (siblings of the existing `subprocessEnv` param).
- Phase callers (`buildPhase.ts:157/235`, `documentPhase.ts:68/117`, `reviewPhase.ts`, `scenarioFixPhase.ts:130`, `prPhase.ts`, `prReviewPhase.ts`) construct `{ selfHost: gitCtx.selfHost, adwId }` (both already in scope, e.g. `buildPhase.ts:41/46`) and pass it alongside `gitCtx.commandEnv()`.
- Orchestrator-level target spawns (`adws/triggers/autoMergeHandler.ts:67`, `adws/adwUpgrade.tsx:443`) pass `{ selfHost: false, adwId }`; `adws/core/issueClassifier.ts:50` passes `{ selfHost: true, adwId }` (classifier runs framework-side → never injected).
- Verify no runner drops the context on the target-repo SDLC path (plan → build → test → review → document → commit → PR). Un-threaded incidental callers simply do not inject (safe canary behaviour).

### 11. Warm the probe at trigger startup and surface it in `/health`
- `adws/triggers/trigger_cron.ts` `main()` (`:433-447`): after `assertCwdIsRepoRoot()` and before the first `void checkAndTrigger()`, `await getGuardrailsProbeVerdict()` so the probe (and its fail-open Slack alert on failure) runs before any issue is processed. Non-fatal — a failed probe must not crash the cron (fail-open).
- `adws/triggers/trigger_webhook.ts` `/health` (`:72-92`): add `result.checks.guardrailsProbe = <verdict-derived CheckResult>` so the probe status is observable, consistent with the other checks.

### 12. Surface the per-run denial count in reporting
- Add a pure `formatDenialNotice(count: number): string | null` (returns `null` when `count === 0`) — the composable seam the BDD (§11/§12) drives via a capturing reporter.
- Append its output (when non-null) to the run's stage comment in `adws/phases/phaseCommentHelpers.ts` (`postIssueStageComment`) and to the end-of-run summary in `adws/phases/workflowCompletion.ts` (`completeWorkflow`), reading `AgentResult.deniedToolCallCount`.

### 13. Add unit tests
- `adws/core/__tests__/guardrailsPayload.test.ts`: template parse (13 deny patterns present), five hooks at absolute `bun` paths, no allow list, `resolveHookLogDir` returns an absolute path under `agents/{adwId}/hook-logs`.
- `adws/core/__tests__/guardrailsGate.test.ts`: kill switch → no inject; self-host → no inject; adw.yml `guardrails` omitted/false/absent → no inject, `true` → inject; probe fail → no inject + AWAITED Slack alert (capturing notifier); probe pass → inject + no alert.
- Extend `adws/core/__tests__/adwYmlConfig.test.ts`: `guardrails` parse table (true/false/omitted/malformed/duplicate-key/comment-stripping) beside the existing `hitl`/`unitTests` cases.
- Extend `adws/agents/__tests__/claudeAgent.test.ts` (mirroring the `subprocessEnv overlay (#701)` block at `:247`, asserting on `mockSpawn.mock.calls`): target run → `cliArgs` contains `--settings` + `spawnEnv` has an absolute `CLAUDE_HOOKS_LOG_DIR`; self-host run / kill switch / no-context → no `--settings`.
- Add a `claudeStreamParser` denial-count test: a stream with 3 permission-denied tool results yields `deniedToolCallCount === 3`; a clean stream yields `0`.

### 14. Add the BDD step definitions (`features/per-issue/step_definitions/feature-762.steps.ts`)
- Implement the self-contained `@adw-762` step defs for the existing `features/per-issue/feature-762.feature` per the Testing Strategy below (recorder-stub over the REAL `runClaudeAgentWithCommand`; real hook subprocess for §13/§14; injected probe verdict + capturing Slack/reporter for §9/§10/§11/§12).

### 15. Run the validation commands
- Execute every command in `Validation Commands` and confirm zero errors and zero regressions (lint, both type-checks, unit tests, build, the `@adw-762` suite GREEN, and the full existing regression suite still GREEN).

## Testing Strategy
### Unit Tests
`.adw/project.md` declares `## Unit Tests: enabled`, and the issue's final AC mandates unit coverage. Unit tests (Vitest) cover the pure/deterministic halves that the BDD layer deliberately does not duplicate:
- **Payload builder** (`guardrailsPayload.test.ts`): template parse (deny list present by category and count), all five hooks registered at ABSOLUTE `bun` paths, NO allow list, absolute `resolveHookLogDir`.
- **Gate** (`guardrailsGate.test.ts`): the full decision matrix — kill switch, self-host, adw.yml gate (`true`/`false`/omitted/absent), fail-open (probe fail → no inject + one AWAITED Slack alert via a capturing notifier), probe pass (inject, no alert).
- **adw.yml parser** (`adwYmlConfig.test.ts`, extended): the `guardrails` parse table (malformed values, duplicate keys, comment stripping) beside the existing `hitl`/`unitTests` tests.
- **Spawn conditional** (`claudeAgent.test.ts`, extended): target-vs-self-host `--settings` presence, kill switch, absent-context fail-safe, and the absolute `CLAUDE_HOOKS_LOG_DIR` on `spawnEnv` — asserted against the mocked `spawn`.
- **Denial counter** (`claudeStreamParser.test.ts`): count equals the number of permission-denied tool results; clean stream → 0.

### BDD scenarios (primary validation — `features/per-issue/feature-762.feature`, already written, 19 scenarios)
The BDD layer's distinct value is driving the REAL `runClaudeAgentWithCommand` end-to-end and proving the built payload SURVIVES to the actual spawn — a builder that is unit-perfect but never wired into argv is exactly the bug #762 fixes. `feature-762.steps.ts` must be self-contained with its own `@adw-762` `Before`/`After` and module-private `ctx`; do NOT reach into other per-issue modules' spawn step defs.
- **Recorder stub, not a hand-rolled argv (§1–§8, §11–§12).** Write a tiny recorder stub into a temp dir that writes `{argv, env, cwd}` to JSON then streams a minimal valid assistant + result JSONL envelope so `handleAgentProcess` resolves. Point `CLAUDE_CODE_PATH` at it (already on the `getSafeSubprocessEnv` allowlist; `resolveClaudeCodePath` reads the live env var — call `clearClaudeCodePathCache()` between scenarios). Do NOT extend `test/mocks/claude-cli-stub.ts` (it records only the prompt). Parse the recorded argv JSON — that is parsing the SUT's OUTPUT (permitted), not `templates/claude-settings-starter.json` (a prohibited source-file assertion).
- **The `When` calls the real function.** `the ADW agent is spawned` must call the REAL `runClaudeAgentWithCommand` over the temp worktree so the RED comes from the real `cliArgs` lacking `--settings` and the GREEN from it carrying it.
- **adw.yml + kill switch fixtures.** `…adw.yml sets guardrails to "<v>"` writes a real `.github/adw.yml` into the temp worktree so the real `readAdwYmlConfig`/`parseAdwYml` resolves the gate (do not stub the read); `…omits the guardrails key` / `…ships no adw.yml` write the respective absent states. `the guardrails kill switch is set to off` sets `ADW_TARGET_GUARDRAILS=off` and MUST restore it in `After`.
- **Deny rules pinned by category (§2), not byte-exactly** — a rule for each destructive class (recursive-force removal, force push, environment-secret read) plus the sample-file carve-out; the verbatim 13-string list is the unit test's job.
- **Hook-log placement (§8) pins the ACCEPTANCE CRITERION, not the literal value.** Assert the recorded `CLAUDE_HOOKS_LOG_DIR` resolves (`path.resolve(recordedCwd, value)`) OUTSIDE the temp worktree and under the run's agent-state dir; and that the temp worktree gains no session-log directory. Resolving against the RECORDED cwd is the whole point (Spec conflict #1).
- **Probe verdict injected (§9/§10), never spawned** — through the gate's `probeGuardrails` seam, with the Slack alert asserted against a CAPTURING notifier and the production seam AWAITing the send.
- **Denial count (§11/§12)** — seed the recorder stub's JSONL with tool_result blocks in the CLI's permission-denied shape; assert the count reaches the composed report body via a capturing reporter. Widening `ToolResultContentBlock` with `is_error` is part of the work; the scenario is RED until it lands.
- **Real hook subprocess (§13/§14) — do not mock.** §13 fires the REAL `post-tool-use.ts` via `spawnSync('bun', [absHookPath], { cwd: scratchWorktree, env: { ...process.env, CLAUDE_HOOKS_LOG_DIR: <resolved dest> }, input: JSON.stringify({ session_id, tool_name: 'Read' }) })` and asserts (a) a `post_tool_use.json` appears under the framework agents root for the adwId and (b) the scratch worktree gains no hook-log artefact. §14 fires the REAL `pre-tool-use.ts` and reads its EXIT STATUS (2 = blocked at `:188`, 0 = allowed): `.env` → 2, `.env.sample` → 0 (green today, must stay), `.env.example` → 2 today (RED; the carve-out fix makes it 0). Do NOT set `ADW_WORKTREE_PATH`/`ADW_MAIN_REPO_PATH` (rewrite out of scope).
- **§T type-check backstop** asserts the ADW TypeScript type-check passes with the payload builder, gate, and denial counter (incl. the `ToolResultContentBlock` widening) wired in.

### Edge Cases
- Kill switch beats the adw.yml gate (both set → no injection).
- adw.yml `guardrails` omitted / explicit `false` / file absent / malformed value → no injection (opt-in default; malformed fails safe toward off).
- Absent `launchContext` at an un-threaded caller → no injection (fail-safe = today's behaviour), never a crash.
- Probe fail → no injection + exactly one AWAITED Slack alert (memoized: not once per spawn); probe never wedges the queue.
- Relative `CLAUDE_HOOKS_LOG_DIR` would land logs inside the worktree — the implementation must use an absolute path (Spec conflict #1), and §8/§13 catch a regression to relative.
- `.env.example` read: denied by the hook today (Spec conflict #2), allowed after the carve-out widening; `.env` still blocked; `.env.sample` still allowed; unrelated files (`README.md`) unaffected.
- Clean run (0 denials) adds no denial line to reporting.
- Self-host run keeps the framework's project `settings.json`; hooks fire exactly once (no double-fire).

## Acceptance Criteria
- A target-repo spawn (with `guardrails: true` in adw.yml, kill switch unset, probe passing) receives `--settings` carrying the deny rules (recursive-force removal, force push, environment-secret read, with the sample-file carve-out) + all five hooks at absolute paths that do not resolve inside the worktree + no allow list; a self-host spawn receives none.
- `ADW_TARGET_GUARDRAILS=off` results in no injection regardless of adw.yml.
- The adw.yml gate withholds injection unless `guardrails: true` (omitted / `false` / absent all withhold).
- Hook logs land under `<framework>/agents/{adwId}/hook-logs/`, never in the worktree (verified by a real hook firing with cwd = the worktree).
- The startup probe runs at trigger startup and fails open (no injection + Slack alert) on failure; a passing probe permits injection and raises no alert.
- The per-run denied-tool-call count appears in run reporting when > 0, and is absent when 0.
- The injected pre-tool-use hook and the injected deny list agree on the environment carve-outs (`.env` blocked; `.env.sample` and `.env.example` allowed).
- Unit tests pass for the payload builder (template parse, absolute paths, no allow list), the target-vs-self-host conditional, the kill switch, the adw.yml gate, and the fail-open path.
- The `@adw-762` BDD suite is GREEN; both type-checks, lint, build, and the full existing regression suite remain GREEN (zero regressions).

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions (project-specific commands from `.adw/commands.md`).

- `bun run lint` — linter passes (no unused imports, code hygiene).
- `bunx tsc --noEmit` — root type-check passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW type-check passes (payload builder, gate, `launchContext` threading, `deniedToolCallCount`, and the `ToolResultContentBlock` widening compile cleanly). Pins BDD §T.
- `bun run test:unit` — unit tests pass, including the new `guardrailsPayload`/`guardrailsGate` suites, the extended `adwYmlConfig`/`claudeAgent` suites, and the parser denial-count test; existing tests remain green (zero regression).
- `bun run build` — build succeeds with no errors.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-762"` — the 19-scenario suite is GREEN. **RED before the fix**: §1–§4, §8, §9, §10, §11, §13, and §14's `.env.example` row fail (no `--settings`, no probe/alert, no denial count, relative hook-log leak, `.env.example` blocked); GREEN after. §5–§7 and §12 are vacuously green today and become load-bearing guards once §1 lands; §14's `.env.sample` row is a green no-collateral guard that must stay green.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — the regression suite still passes (the shared `pre-tool-use.ts` carve-out widening introduces no regression).

## Notes
- **Coding guidelines** (`.adw/coding_guidelines.md`): files under 300 lines (hence the split into `guardrailsPayload.ts` / `guardrailsGate.ts` / `guardrailsProbe.ts`); guard clauses over nesting (the gate is a linear guard chain); immutable locals; pure core with side effects (template read, spawn, Slack, comment posting) isolated at the boundaries; no decorators; JSDoc on exported symbols; no `any` (the `ToolResultContentBlock`/`AgentResult` widenings use explicit optional fields).
- **No new libraries** — the feature reuses `spawn`/`fs`/`path`, the existing `readAdwYmlConfig`, `postSlack`, `resolveClaudeCodePath`, `REPO_ROOT`/`AGENTS_STATE_DIR`, and the stream parser. If a dependency were ever needed, `.adw/commands.md` specifies `bun add <package>` — none is needed here.
- **Two spec conflicts are flagged, not silently resolved** (see Solution Statement): (#1) the hook-log value must be ABSOLUTE, deviating from the issue's literal relative `agents/{adwId}/hook-logs/`; (#2) the injected pre-tool-use hook must widen its carve-out to spare `.env.example`. Both are verified empirically (2026-07-17). Confirm both with the maintainer; if `.env.example` is scoped out, retire §14's `.env.example` row deliberately.
- **The target-vs-self-host seam is a deliberate design choice.** This plan threads an explicit `{ selfHost, adwId }` launch context (from `GitContext.selfHost`, `gitContext.ts:126`) rather than deriving self-host from `cwd` — it matches the issue's stated "GitContext launch boundary" mechanism, is deterministic (not a path heuristic), keeps test hygiene clean (no temp worktrees inside `REPO_ROOT`), and degrades safely (absent context → no injection). The BDD scenarios are signature-independent, so an alternative seam would also satisfy them.
- **BDD observability limit** (per project memory): deny-rule ENFORCEMENT and hook FIRING are behaviours of the real Claude CLI, which is non-hermetic/paid/network-bound. The harness pins the CONFIGURATION contract (what the spawn is configured with) via the recorder stub and pins real hook behaviour via `bun`-subprocess §13/§14; the live ENFORCEMENT contract is exactly what the startup probe covers, and is deliberately not a BDD scenario.
- **`@regression` maintenance is skipped** for this issue (`.adw/scenarios.md` configures a `## Regression Scenario Directory`, so promotion is a deliberate human decision). §1 (a target run is guardrailed) and §5 (a self-host run is not) are the natural promotion candidates if this is later hardened into the mandatory, un-gated end state.
- **Follow-up (out of scope here):** `/adw_init` copies `templates/claude-settings-starter.json` verbatim into target repos, and the adw.yml `guardrails` default flips to on after clean canary runs — both are separate config-change issues the template is designed to serve.
```
