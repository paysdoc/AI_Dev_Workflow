# Orchestrator Watchdog & Agent Timeout

**ADW ID:** bed2tg-bug-step-def-agent-c
**Date:** 2026-05-21
**Specification:** specs/issue-521-adw-bed2tg-bug-step-def-agent-c-sdlc_planner-orchestrator-watchdog-agent-timeout.md

## Overview

Fixes a bug where the step-def agent could wedge the orchestrator indefinitely. When the Claude CLI agent self-reports success but orphan child processes (e.g. `cat`/`head` from a heredoc pipeline) kept the process alive, the orchestrator's `await runClaudeAgentWithCommand(...)` never resolved. The fix adds a per-agent watchdog timeout that kills the entire process group and exits cleanly so the next cron tick re-enters the failed phase.

## What Was Built

- `adws/core/processKill.ts` — shared `killProcessGroup(pid, graceMs)` helper that sends SIGTERM then SIGKILL to an entire POSIX process group
- `adws/core/agentTimeouts.ts` — per-phase timeout map (`AGENT_PHASE_TIMEOUT_MAP`) and lookup helper (`getAgentTimeoutForPhase`)
- `AGENT_DEFAULT_TIMEOUT_MS` constant in `adws/core/config.ts` (30 min, env-overridable)
- `AgentTimeoutError` class in `adws/types/agentTypes.ts` (mirrors `RateLimitError`/`AuthRequiredError`)
- `'phase_timeout'` added to the `WorkflowStage` union in `adws/types/workflowTypes.ts`
- `failureReason?: string` field on `PhaseExecutionState` (canonical value: `'agent_timeout'`)
- Watchdog wired into `runClaudeAgentWithCommand` in `adws/agents/claudeAgent.ts` (initial spawn + ENOENT retry path)
- `handlePhaseTimeout` helper in `adws/phases/workflowCompletion.ts` — writes `phase_timeout` stage, posts GitHub comment, exits 0
- `formatPhaseTimeoutComment` in `adws/github/workflowCommentsIssue.ts` — `## :warning: Phase Timeout` comment body
- `phaseName` threaded through `CommandAgentOptions` → `runCommandAgent` → `runClaudeAgentWithCommand`
- `stepDefAgent` explicitly passes `phaseName: 'step-def'`
- `generate_step_definitions.md` Step 7 ("Verify") rewritten to use `bunx tsc --noEmit` and prohibit runtime imports of step files

## Technical Implementation

### Files Modified

- `adws/core/processKill.ts` *(new)*: `killProcessGroup(pid, graceMs)` — SIGTERM + scheduled SIGKILL on the POSIX process group; silences ESRCH
- `adws/core/agentTimeouts.ts` *(new)*: `AGENT_PHASE_TIMEOUT_MAP`, `getAgentTimeoutForPhase(phaseName)` with env-var override (`AGENT_PHASE_TIMEOUT_<PHASE_UPPER>`)
- `adws/core/config.ts`: `AGENT_DEFAULT_TIMEOUT_MS` (30 min default, env-overridable)
- `adws/core/devServerLifecycle.ts`: removed local `killProcessGroup`; now re-exports from `./processKill` for backward compat
- `adws/core/index.ts`: re-exports `killProcessGroup`, `getAgentTimeoutForPhase`, `AGENT_DEFAULT_TIMEOUT_MS`, `AgentTimeoutError`, `PhaseExecutionState`
- `adws/agents/claudeAgent.ts`: `detached: true` on spawn; watchdog `setTimeout` + `watchdogFired` guard after `handleAgentProcess`; mirrors watchdog on ENOENT retry path; throws `AgentTimeoutError` if fired
- `adws/agents/commandAgent.ts`: `phaseName?: string` added to `CommandAgentOptions`, threaded to `runClaudeAgentWithCommand`
- `adws/agents/stepDefAgent.ts`: passes `phaseName: 'step-def'` to `runCommandAgent`
- `adws/types/agentTypes.ts`: `AgentTimeoutError` class; `failureReason?: string` on `PhaseExecutionState`
- `adws/types/workflowTypes.ts`: `'phase_timeout'` added to `WorkflowStage`
- `adws/core/phaseRunner.ts`: catches `AgentTimeoutError` before existing `RateLimitError` branch; writes `status: 'failed', failureReason: 'agent_timeout'` to state; calls `handlePhaseTimeout` (lazy import mirrors rate-limit pattern)
- `adws/phases/workflowCompletion.ts`: `handlePhaseTimeout(config, phaseName, timeoutMs): never` — writes stage, posts comment, `process.exit(0)`
- `adws/github/workflowCommentsIssue.ts`: `WorkflowContext.timeoutPhaseName/timeoutMs`; `formatPhaseTimeoutComment`; `'phase_timeout'` case in `formatWorkflowComment` switch
- `.claude/commands/generate_step_definitions.md`: Step 7 now requires `bunx tsc --noEmit`; forbids `node`/`bun`/`tsx`/`import()` for step file verification

### Key Changes

- **Process-group kill**: `detached: true` makes the Claude CLI child the process group leader, so `process.kill(-pid, signal)` reaches all grandchildren (orphan `cat`/`head` processes that caused the original wedge).
- **Watchdog lifecycle**: the watchdog `setTimeout` is set immediately after spawn and cleared via `clearTimeout` on the normal `close` path. If it fires first, `watchdogFired = true` is checked after `handleAgentProcess` resolves (the kill causes a normal `close` event — no special exit-code branch needed in `agentProcessHandler`).
- **Clean exit on timeout**: `handlePhaseTimeout` exits 0 so the next cron tick / webhook event re-enters the failed phase. The existing `runPhase` skip-on-resume logic treats `status: 'failed'` as "do not skip", so no new resume code was needed.
- **Per-phase override**: `getAgentTimeoutForPhase` checks `AGENT_PHASE_TIMEOUT_<PHASE_UPPER>` env var first, then `AGENT_PHASE_TIMEOUT_MAP`, then `AGENT_DEFAULT_TIMEOUT_MS`. Add an entry to the map or set an env var to tune per-phase budgets.
- **Prompt fix (Layer 1)**: replacing the ambiguous "check for syntax errors" with an explicit `bunx tsc --noEmit` call and a prohibition on runtime imports eliminates the root-cause Bash invocation that produced the orphan children.

## How to Use

The watchdog is automatic — no operator action required for normal workflows.

**To tune the default timeout:**
```bash
AGENT_DEFAULT_TIMEOUT_MS=1800000  # 30 min (default)
```

**To tune a specific phase:**
```bash
AGENT_PHASE_TIMEOUT_STEP_DEF=600000  # 10 min for step-def phase
```

**To add a new per-phase entry permanently**, edit `adws/core/agentTimeouts.ts`:
```ts
export const AGENT_PHASE_TIMEOUT_MAP: Record<string, number> = {
  'step-def': DEFAULT_TIMEOUT_MS,
  'build': 45 * 60_000,  // example: 45 min for build phase
};
```

**When a timeout fires**, the orchestrator:
1. Kills the entire process group (SIGTERM → SIGKILL after 5 s)
2. Writes `phases[phaseName] = { status: 'failed', failureReason: 'agent_timeout' }` to `agents/<adwId>/state.json`
3. Posts `## :warning: Phase Timeout` on the GitHub issue with phase name and timeout duration
4. Writes `workflowStage: 'phase_timeout'` to top-level state
5. Exits 0 — the next cron tick re-enters the failed phase automatically

## Configuration

| Env var | Default | Description |
|---|---|---|
| `AGENT_DEFAULT_TIMEOUT_MS` | `1800000` (30 min) | Fallback timeout for all phases |
| `AGENT_PHASE_TIMEOUT_<PHASE>` | — | Per-phase override (e.g. `AGENT_PHASE_TIMEOUT_STEP_DEF`) |

`<PHASE>` is the phase name uppercased with hyphens replaced by underscores.

## Testing

```bash
# BDD scenarios for the watchdog (all must pass)
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-521"

# Regression suite (zero new failures)
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"

# Unit tests (claudeAgent watchdog coverage)
bun run test:unit
```

The `@adw-521` BDD suite covers: watchdog fires → state records `agent_timeout`, Phase Timeout comment posted, orphan children reaped, normal completion has no Phase Timeout comment, resume re-enters failed phase, per-phase override, default fallback, rate-limit path does NOT post Phase Timeout, type-check scenario.

## Notes

- **POSIX only**: `process.kill(-pid, signal)` uses POSIX process groups. ADW is single-host macOS/Linux; Windows is not supported.
- **No `unref()` on watchdog timer**: the timer keeps the event loop alive until `clearTimeout` on the close path. The firing path ends the process via `process.exit(0)` inside `handlePhaseTimeout`.
- **Resume semantics unchanged**: `runPhase` lines 130–137 already treat `status: 'failed'` as "do not skip" — no new resume code was required.
- **Layer 3 (out of scope)**: a minimal repro of "Bash tool subprocess outlives `result: success`" should be filed as a separate upstream `claude-cli` issue.
- **Unsticking the triggering run** (`mqwyb7-llm-drafted-observab`): run `pkill -f "mqwyb7-llm-drafted-observab"` manually before this fix merges to clear the wedged process tree.
