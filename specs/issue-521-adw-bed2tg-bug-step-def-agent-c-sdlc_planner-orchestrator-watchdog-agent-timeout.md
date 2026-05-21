# Bug: step-def agent can wedge orchestrator indefinitely on bash syntax check; no watchdog

## Metadata
issueNumber: `521`
adwId: `bed2tg-bug-step-def-agent-c`
issueJson: `{"number":521,"title":"bug: step-def agent can wedge orchestrator indefinitely on bash syntax check; no watchdog","state":"OPEN","author":"paysdoc","labels":["bug"],"createdAt":"2026-05-21T20:30:46Z"}`

## Bug Description

ADW workflow `mqwyb7-llm-drafted-observab` (issue #508, sdlc) remained stuck in `stepDef_running` for 2.5+ hours after the step-def agent emitted `{"type":"result","subtype":"success","duration_ms":480124}` to its JSONL stream. The agent self-reported success after ~8 minutes, but the `claude --print` CLI process never exited because two orphan children (`cat`, `head -20`) from a heredoc-piped Bash tool call (`node --input-type=module <<EOF ... EOF 2>&1 | head -20`) kept the bash subprocess alive. As a result, the orchestrator's `await runClaudeAgentWithCommand(...)` never resolved, and the workflow could not advance to the next phase.

**Symptoms:**
- Orchestrator process tree alive indefinitely while JSONL output reports `result: success`.
- `workflowStage: 'stepDef_running'` written to `agents/<adwId>/state.json` and never updated.
- No mechanism (in code, in operator workflow, or in cron sweeps) automatically reclaims the wedged orchestrator.
- The only escape today is manual `pkill -f` against the adwId, or the operator posting `## Cancel`.

**Expected behaviour:**
- The orchestrator must apply a per-agent invocation timeout. When the timeout elapses with no `close` event, kill the entire child-process tree (not just the immediate Claude CLI child — orphan shells were the root cause).
- The orchestrator must mark the failing phase as `failed` (not `completed`, not silently `running`) so resume-path logic does not treat the run as advanced.
- A `## :warning: Phase Timeout` comment must be posted on the issue so a human can see the wedge without log-spelunking.
- The orchestrator subprocess must exit cleanly (exit code 0) so the next cron tick or webhook event can re-enter the failed phase via the existing resume path (`runPhase` already does NOT skip phases with `status: 'failed'`).

## Problem Statement

There are two independent root causes; either alone would have prevented the incident. The plan fixes both:

1. **Prompt layer** — `.claude/commands/generate_step_definitions.md` step 7 (titled "Verify") says only *"Confirm each generated file parses correctly by checking for syntax errors"*. The model is free to pick the method. In the incident, it picked `node --input-type=module <<EOF ... EOF | head -20`, which *executes* the file at import. Cucumber's top-level `Before(...)` call in `feature-506.steps.ts` then threw `checkInstall`, but the surrounding `cat`/`head` pipeline children never exited.

2. **Orchestrator layer** — `adws/agents/claudeAgent.ts` has no watchdog on the `claude --print <slash-command>` child process. The only `timeout` present (15 s) is on the `claude auth status --json` health check at line 159. When the Claude CLI subprocess wedges (or leaks orphan children that keep its Bash tool alive), the orchestrator awaits forever.

(Layer 3 from the issue body — filing a minimal repro of *"Bash tool subprocess outlives `result: success`"* against `claude-cli` — is an upstream issue. Not in scope for this plan; tracked as a follow-up in the Notes section.)

## Solution Statement

**Layer 1 (prompt fix).** Rewrite `.claude/commands/generate_step_definitions.md` step 7 ("Verify") to require `bunx tsc --noEmit` against the generated step definition files, and to explicitly forbid runtime imports of step files (they have side effects via Cucumber's top-level `Before`/`Given`/`When`/`Then` calls). Use a non-pipeline command so heredoc-pipe-tail wedges cannot recur.

**Layer 2 (orchestrator watchdog).** Add a per-agent invocation timeout to `runClaudeAgentWithCommand` in `adws/agents/claudeAgent.ts`:

1. Spawn the Claude CLI child with `detached: true` so it becomes the leader of a new process group. The Bash tool's grandchildren (`cat`, `head`, anything heredoc-piped) inherit that group.
2. Start a `setTimeout(...)` watchdog at spawn time. The timeout value is determined per-invocation by a new per-slash-command map (default 30 minutes; configurable per command).
3. If the close event arrives first, clear the watchdog and return normally.
4. If the watchdog fires first, kill the entire process group with `SIGTERM` followed by `SIGKILL` after a short grace period — reuse/promote the existing `killProcessGroup` helper that already exists in `adws/core/devServerLifecycle.ts`. Throw a new `AgentTimeoutError(agentName, phaseName, timeoutMs)`.
5. `runPhase` (in `adws/core/phaseRunner.ts`) catches `AgentTimeoutError`, writes `phases[phaseName] = { status: 'failed', failureReason: 'agent_timeout', ... }` to the top-level state file, posts the `## :warning: Phase Timeout` comment, and exits cleanly via a new `handlePhaseTimeout` helper that mirrors `handleRateLimitPause` (process.exit(0)).
6. The existing `runPhase` skip-on-resume logic already treats `status: 'failed'` as "do not skip" — so the next orchestrator run re-enters the failed phase automatically. No new resume code is needed.

Phase-specific override is supported by giving every `runClaudeAgentWithCommand` call a `phaseName?` argument that is looked up in `AGENT_PHASE_TIMEOUT_MAP`, falling back to `AGENT_DEFAULT_TIMEOUT_MS` (30 min). The step-def phase will be the first concrete entry in the map; other phases get the default until tuned.

## Steps to Reproduce

1. Run an ADW SDLC workflow where the step-def agent (or any Claude agent) chooses a Bash tool invocation involving a heredoc piped to `head` or a similar truncating tail command.
2. Arrange for the heredoc-fed command to fail (so the body exits) while the pipeline's `cat`/`head` keep `stdin`/`stdout` open via the inherited unix-domain socket from the Claude tool dispatch.
3. Observe: the agent's JSONL stream emits `{"type":"result","subtype":"success","duration_ms":...}` but the orchestrator's `await runClaudeAgentWithCommand(...)` never resolves. The orchestrator's top-level state file remains at `*_running` indefinitely; no cron sweep clears it (the orchestrator process is alive, just blocked on the child's `close` event).

Reproducible deterministically via the BDD scenarios in `features/per-issue/feature-521.feature` against the claude-cli-stub configured to "hang past the agent watchdog timeout".

## Root Cause Analysis

### Layer 1 — under-specified prompt
`.claude/commands/generate_step_definitions.md` Step 7 ("Verify") gives the agent only the instruction *"Confirm each generated file parses correctly by checking for syntax errors."* The model freely picked `node --input-type=module <<EOF ... EOF 2>&1 | head -20`. Two failure modes compound:
- `node --input-type=module` *executes* the file at import. Step files call `Before(...)`/`Given(...)`/`When(...)`/`Then(...)` at module top-level. Cucumber's `checkInstall` throws when these are called outside a running Cucumber session — surfaced as `"instance of Cucumber that isn't running, status: PENDING"` in the incident.
- The `| head -20` tail and the heredoc-fed `cat` are inherited by the Bash tool's process and do not exit when `node` exits. They keep stdin/stdout open, which keeps `bash -c '...'` alive, which keeps the Claude CLI alive after the model emits its `result: success`.

This instruction has been unchanged since the file was created on 2026-03-20 (`8507da4`) — latent for 62 days. Previous runs likely picked safer syntax-check methods (`bunx tsc --noEmit`). One single misjudgement wedged the orchestrator.

### Layer 2 — no watchdog on Claude agent invocations
`adws/agents/claudeAgent.ts` spawns the Claude CLI child at line 126 without `detached: true` and without any timeout. The only `timeout: 15_000` in the file is on the `claude auth status --json` health check at line 159. The actual `claude --print <slash-command>` invocation awaits `handleAgentProcess` which awaits the `'close'` event indefinitely. When the child or its grandchildren wedge, the orchestrator wedges with it.

The existing rate-limit/auth/token-limit kill paths (`adws/agents/agentProcessHandler.ts` lines 92–137) detect *content patterns in the JSONL stream* — they cannot detect "JSONL stream ended cleanly but the process is still alive". They are necessary but not sufficient.

Combined effect: layer 1 picked a wedgeable Bash invocation; layer 2 had no recovery path.

## Relevant Files

Use these files to fix the bug:

- `.claude/commands/generate_step_definitions.md` — Step 7 ("Verify") prompt fix. Replace the under-specified "checking for syntax errors" instruction with `bunx tsc --noEmit` and an explicit prohibition on runtime imports of step files (layer 1).
- `adws/agents/claudeAgent.ts` — Add watchdog timeout, spawn with `detached: true`, kill process group on watchdog fire, throw `AgentTimeoutError`. This is the central wrapper called by every command agent (layer 2 core).
- `adws/agents/agentProcessHandler.ts` — Coordinate with the watchdog (set a `watchdogFired` ref so the `close` handler can resolve with the timeout outcome instead of treating the kill as a successful exit).
- `adws/agents/commandAgent.ts` — Thread `phaseName` (optional) through `CommandAgentOptions` so per-phase timeouts can be looked up. All thin-wrapper agents (`stepDefAgent`, `planAgent`, etc.) propagate this when invoked from a phase.
- `adws/agents/stepDefAgent.ts` — Pass `phaseName: 'step-def'` to `runCommandAgent`. (This is the immediate triggering agent; other agents can be migrated in follow-up PRs without blocking this fix — the default 30-min timeout already applies to them implicitly via `AGENT_DEFAULT_TIMEOUT_MS`.)
- `adws/types/agentTypes.ts` — Add `AgentTimeoutError` class (sibling of `RateLimitError`/`AuthRequiredError`). Add `failureReason?: string` to `PhaseExecutionState` so the state file can record `'agent_timeout'`.
- `adws/types/workflowTypes.ts` — Add `'phase_timeout'` to the `WorkflowStage` union so the top-level state writes can use it (mirrors the existing `'token_limit_recovery'`, `'compaction_recovery'` pattern).
- `adws/core/phaseRunner.ts` — Catch `AgentTimeoutError` in `runPhase`, record `phases[phaseName] = { status: 'failed', failureReason: 'agent_timeout', ... }`, delegate to `handlePhaseTimeout` (process.exit(0)). Mirrors the existing `RateLimitError` → `handleRateLimitPause` pattern.
- `adws/phases/workflowCompletion.ts` — Add `handlePhaseTimeout(config, phaseName, timeoutMs)` helper that writes the timeout state and posts the `## :warning: Phase Timeout` comment via `postIssueStageComment` before `process.exit(0)`.
- `adws/github/workflowCommentsIssue.ts` — Add `formatPhaseTimeoutComment` (returns the `## :warning: Phase Timeout` comment body, surfaces `phaseName`, `timeoutMs`, and `adwId`). Wire it into the `formatWorkflowComment` switch under the new `'phase_timeout'` case. Extend `WorkflowContext` with optional `timeoutPhaseName?` and `timeoutMs?` fields used only by this comment.
- `adws/core/config.ts` — Add `AGENT_DEFAULT_TIMEOUT_MS` (default `30 * 60_000` ms, env-overridable as `AGENT_DEFAULT_TIMEOUT_MS`).
- `adws/core/agentTimeouts.ts` (new) — Add `AGENT_PHASE_TIMEOUT_MAP: Record<string, number>` and a `getAgentTimeoutForPhase(phaseName: string | undefined): number` helper that falls back to `AGENT_DEFAULT_TIMEOUT_MS`. Mirrors the structure of `adws/core/modelRouting.ts`. Lives in its own file so future maintainers extend the map in one obvious place.
- `adws/core/processKill.ts` (new) — Extract `killProcessGroup(pid, graceMs)` from `adws/core/devServerLifecycle.ts` so both the dev-server lifecycle and the agent watchdog use the same `process.kill(-pid, SIGTERM)` → `process.kill(-pid, SIGKILL)` pattern. Update `devServerLifecycle.ts` to import from the new location.
- `adws/core/devServerLifecycle.ts` — Update to import `killProcessGroup` from `processKill.ts` (single source of truth for process-tree kill).

### New Files

- `adws/core/agentTimeouts.ts` — Per-phase agent timeout map + lookup helper (see above).
- `adws/core/processKill.ts` — Shared `killProcessGroup` helper (see above).

### Conditional Documentation

(Conditions reviewed in `.adw/conditional_docs.md`; none of the listed conditions apply directly to this bug — the watchdog change is new orchestration plumbing rather than a modification of any feature already documented under `app_docs/`. A new feature doc will be authored as part of the documentation phase post-merge.)

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Extract `killProcessGroup` to a shared module

- Create `adws/core/processKill.ts` containing the existing `killProcessGroup(pid, graceMs)` function (currently at `adws/core/devServerLifecycle.ts:91`).
- The exported function must accept a positive `pid` and call `process.kill(-pid, 'SIGTERM')` then schedule `process.kill(-pid, 'SIGKILL')` after `graceMs` (default 5_000 ms in the watchdog call sites). Swallow `ESRCH` (process already gone) in both calls.
- Re-export from `adws/core/index.ts` if other modules import it from there.
- Update `adws/core/devServerLifecycle.ts` to import `killProcessGroup` from `./processKill` and remove the local copy.

### 2. Add per-phase agent timeout configuration

- Add `AGENT_DEFAULT_TIMEOUT_MS` to `adws/core/config.ts`:
  - Value: `Math.max(1, parseInt(process.env.AGENT_DEFAULT_TIMEOUT_MS || '1800000', 10)) || 1_800_000` (30 minutes).
  - Export alongside the existing retry/concurrency constants.
- Create `adws/core/agentTimeouts.ts` exporting:
  - `AGENT_PHASE_TIMEOUT_MAP: Record<string, number>` — empty by default except for an explicit `'step-def': AGENT_DEFAULT_TIMEOUT_MS` entry (so the map is visibly extensible).
  - `getAgentTimeoutForPhase(phaseName: string | undefined): number` — returns `AGENT_PHASE_TIMEOUT_MAP[phaseName] ?? AGENT_DEFAULT_TIMEOUT_MS` when `phaseName` is set; returns `AGENT_DEFAULT_TIMEOUT_MS` otherwise.
- Re-export `getAgentTimeoutForPhase` from `adws/core/index.ts` if downstream modules consume it via that barrel.

### 3. Add `AgentTimeoutError` and extend `PhaseExecutionState`

- In `adws/types/agentTypes.ts`:
  - Add `export class AgentTimeoutError extends Error` with constructor `(agentName: string, phaseName: string | undefined, timeoutMs: number)`. Fields: `agentName`, `phaseName?`, `timeoutMs`. Mirrors `RateLimitError`/`AuthRequiredError`.
  - Extend the `PhaseExecutionState` interface (line 201) with an optional `failureReason?: string` field. Document the canonical value `'agent_timeout'` in a JSDoc comment on the field.
- In `adws/types/workflowTypes.ts`:
  - Add `'phase_timeout'` to the `WorkflowStage` union (in the "Terminal / handoff stages" block).

### 4. Thread per-phase timeout through the agent invocation chain

- In `adws/agents/commandAgent.ts`:
  - Add optional `phaseName?: string` to `CommandAgentOptions`.
  - Inside `runCommandAgent`, pass `phaseName` through to `runClaudeAgentWithCommand` (added in Step 5).
- In `adws/agents/stepDefAgent.ts`:
  - In `runStepDefAgent`, pass `phaseName: 'step-def'` to `runCommandAgent`.
  - (Other thin-wrapper agents need no change for this fix — they fall through to `AGENT_DEFAULT_TIMEOUT_MS`.)

### 5. Wire the watchdog into `runClaudeAgentWithCommand`

- In `adws/agents/claudeAgent.ts`:
  - Add an optional `phaseName?: string` parameter to `runClaudeAgentWithCommand` after `contextPreamble`. Document it in the JSDoc.
  - Resolve the timeout: `const timeoutMs = getAgentTimeoutForPhase(phaseName);` immediately before the spawn.
  - Change the `spawnOptions` literal at line 125 to include `detached: true`. The child becomes the leader of a new process group so `process.kill(-child.pid, ...)` reaches its descendants (cat/head/etc.).
  - After `const claude = spawn(...)`, set up the watchdog:
    ```ts
    let watchdogFired = false;
    const watchdog = setTimeout(() => {
      watchdogFired = true;
      log(`${agentName}: watchdog fired after ${timeoutMs} ms — killing process tree`, 'error');
      if (claude.pid !== undefined) killProcessGroup(claude.pid, 5_000);
    }, timeoutMs);
    ```
  - After the `await handleAgentProcess(...)` call (line 128) and the ENOENT retry block, do `clearTimeout(watchdog);`. (The retry block re-spawns and re-awaits — that path also needs its own watchdog; mirror the same setup inside the retry block.)
  - Immediately after the `clearTimeout`, before the `result.rateLimited` check, add:
    ```ts
    if (watchdogFired) {
      throw new AgentTimeoutError(agentName, phaseName, timeoutMs);
    }
    ```
  - Add `claude.unref()` is NOT needed — we still want the orchestrator to await the child via the existing handler.
- In `adws/agents/agentProcessHandler.ts`:
  - No code change required: when the watchdog kills the process group, the child eventually emits `'close'` and `handleAgentProcess` resolves normally. The `watchdogFired` check in `claudeAgent.ts` (above) is what surfaces the timeout to the caller. Add a one-line comment in `claudeAgent.ts` noting this so a future reader understands why we don't need a special exit-code branch here.

### 6. Catch the timeout in `runPhase` and exit cleanly

- In `adws/core/phaseRunner.ts`:
  - In the `catch (err)` block of `runPhase` (around line 168), before the existing `if (err instanceof RateLimitError)` check, write:
    ```ts
    if (phaseName && config.adwId) {
      // Existing failed-state write also captures agent_timeout via failureReason
    }
    if (err instanceof AgentTimeoutError) {
      if (phaseName && config.adwId) {
        AgentStateManager.writeTopLevelState(config.adwId, {
          phases: { [phaseName]: { status: 'failed', startedAt, completedAt: new Date().toISOString(), failureReason: 'agent_timeout' } },
        });
      }
      const { handlePhaseTimeout } = await import('../phases/workflowCompletion');
      handlePhaseTimeout(config, err.phaseName ?? phaseName ?? 'unknown', err.timeoutMs);
    }
    ```
  - Keep the rest of the existing rate-limit/throw logic untouched.
- Import `AgentTimeoutError` from `../types/agentTypes` at the top of the file.

### 7. Add `handlePhaseTimeout` and the `## :warning: Phase Timeout` comment

- In `adws/phases/workflowCompletion.ts`, add:
  ```ts
  export function handlePhaseTimeout(
    config: WorkflowConfig,
    phaseName: string,
    timeoutMs: number,
  ): never {
    const { orchestratorStatePath, orchestratorName, issueNumber, ctx, repoContext, adwId } = config;
    ctx.timeoutPhaseName = phaseName;
    ctx.timeoutMs = timeoutMs;
    if (repoContext) postIssueStageComment(repoContext, issueNumber, 'phase_timeout', ctx);
    AgentStateManager.writeTopLevelState(adwId, { workflowStage: 'phase_timeout' });
    AgentStateManager.appendLog(orchestratorStatePath, `${orchestratorName} workflow timed out at phase '${phaseName}' after ${timeoutMs} ms`);
    log(`${orchestratorName} workflow timed out at '${phaseName}' after ${timeoutMs} ms`, 'warn');
    process.exit(0);
  }
  ```
- In `adws/github/workflowCommentsIssue.ts`:
  - Extend `WorkflowContext` with `timeoutPhaseName?: string;` and `timeoutMs?: number;`.
  - Add `formatPhaseTimeoutComment(ctx)`:
    ```ts
    function formatPhaseTimeoutComment(ctx: WorkflowContext): string {
      const phase = ctx.timeoutPhaseName ?? 'unknown';
      const minutes = ctx.timeoutMs ? Math.round(ctx.timeoutMs / 60_000) : '?';
      return `## :warning: Phase Timeout\n\nPhase \`${phase}\` exceeded its ${minutes}-minute watchdog and was terminated. The workflow will re-enter this phase on the next cron tick / webhook event.\n\n**ADW ID:** \`${ctx.adwId}\`${formatRunningTokenFooter(ctx.runningTokenTotal)}${ADW_SIGNATURE}`;
    }
    ```
  - Add `case 'phase_timeout': return formatPhaseTimeoutComment(ctx);` to the `formatWorkflowComment` switch.

### 8. Layer 1 — fix the `generate_step_definitions` prompt

- In `.claude/commands/generate_step_definitions.md`, replace the Step 7 ("Verify") body with:
  ```md
  ### 7. Verify

  After writing, run a quick sanity check:
  - Type-check the generated step definition files with `bunx tsc --noEmit <path>` (one path per generated file). Do NOT execute the files at runtime: step definition modules call `Before(...)`/`Given(...)`/`When(...)`/`Then(...)` at top level and Cucumber throws `checkInstall` outside a running session.
  - Confirm step patterns are unique across all step definition files.

  Forbidden: any verification method that imports or executes step files (`node`, `bun`, `tsx`, dynamic `import()`, etc.) — these trip Cucumber's top-level registration and can leave heredoc/pipeline children alive after the imported module errors out.
  ```
- Do not rewrap any other sections of the file. Leave the polymorphism block, vocabulary registry instructions, and section numbering otherwise unchanged.

### 9. TypeScript type-check passes after the changes

- Run `bunx tsc --noEmit -p adws/tsconfig.json` and `bunx tsc --noEmit` from the repo root. Both must succeed.

### 10. Run the validation suite

- Execute every command in the `## Validation Commands` section below and confirm a clean exit.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `bun install` — ensure dependencies are installed (no library additions in this plan, but a clean install is a precondition for tsc/lint/test commands below).
- `bun run lint` — ESLint must pass with zero errors.
- `bunx tsc --noEmit` — root TypeScript type-check.
- `bunx tsc --noEmit -p adws/tsconfig.json` — adws-scoped type-check (catches issues hidden by the root tsconfig).
- `bun run test:unit` — Vitest unit suite. Specifically validates:
  - The existing `adws/agents/__tests__/claudeAgent.test.ts` still passes.
  - Any new test covering the watchdog (kill-tree, AgentTimeoutError throw, watchdog-fired ref) under `adws/agents/__tests__/claudeAgent.test.ts` passes.
  - Existing `adws/core/__tests__/devServerLifecycle.test.ts` still passes after `killProcessGroup` is relocated (the test imports the function — update the import path if needed).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-521"` — Per-issue BDD scenarios in `features/per-issue/feature-521.feature` must all pass (watchdog fires, state records `agent_timeout`, `## :warning: Phase Timeout` comment posted, orphan children reaped, normal completion has no Phase Timeout comment, resume re-enters failed phase, per-phase override works, default applies otherwise, rate-limit path does NOT post Phase Timeout, type-check scenario).
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Full regression suite must pass with zero new failures. Specifically validates that no orchestrator-level scenarios regressed due to the new exception class or the spawn-options change.
- `bun run build` — Build must succeed.

(Project-specific validation commands sourced from `.adw/commands.md`: `bun install`, `bun run lint`, `bunx tsc --noEmit`, `bunx tsc --noEmit -p adws/tsconfig.json`, `bun run test:unit`, `bun run build`. BDD scenario commands sourced from `.adw/commands.md` `## Run Scenarios by Tag` and `## Run Regression Scenarios` sections.)

## Notes

- **Coding guidelines.** Plan conforms to `.adw/coding_guidelines.md`: every new module is single-responsibility; `agentTimeouts.ts` and `processKill.ts` are < 50 lines each; the `runClaudeAgentWithCommand` modification stays flat (no new nesting depth — guard clauses for `watchdogFired` and the existing ENOENT/rateLimit/authExpired checks); `AgentTimeoutError` is explicit (no `any`); no decorators introduced; comments only on the WHY (e.g. why the agentProcessHandler `close` path doesn't need a special branch).
- **Library install.** No new third-party libraries required. (`.adw/commands.md` `## Library Install Command` is `bun add <package>` if needed, but this plan does not need it.)
- **Layer 3 follow-up (out of scope here).** File a minimal repro of "Bash tool subprocess outlives `result: success`" against `claude-cli` as a separate upstream issue. The captured Cucumber `checkInstall` stack trace from `/private/tmp/claude-501/.../tasks/bos7x8k2w.output` in the incident should be attached as the regression fixture. This plan does not include the upstream report — it stands on layers 1 and 2 alone, either of which would have prevented the incident.
- **Unsticking the current `mqwyb7` run.** Operational, not a code change. Document only: `pkill -f "mqwyb7-llm-drafted-observab"` to clear the wedged process tree; the build phase already committed cleanly, only step-def needs to re-run. This step is performed manually by the operator before merging this fix; no code in this plan attempts to clean up the historical incident.
- **`adws/core/index.ts` re-exports.** Add re-exports for `killProcessGroup` (from `./processKill`) and `getAgentTimeoutForPhase` / `AGENT_DEFAULT_TIMEOUT_MS` (from `./agentTimeouts`) only if existing call sites import them via the barrel. Otherwise, direct imports from the new files are preferred (single-responsibility imports per coding guidelines).
- **Resume semantics — already correct.** `runPhase` in `adws/core/phaseRunner.ts` lines 130–137 explicitly comments *"phases map entry exists — use it exclusively; 'failed' or 'running' must NOT skip"*. So writing `status: 'failed'` for a timed-out phase is sufficient — the next orchestrator invocation re-enters it without any new resume code. The §4 BDD scenario ("After a watchdog-triggered phase failure, re-invoking the orchestrator re-enters the failed phase") relies on this existing behaviour.
- **Single-host process-group kill.** `process.kill(-pid, signal)` requires POSIX process groups, which exist on macOS and Linux. ADW is single-host on POSIX hosts (see README `## Single-host constraint`); Windows is not supported, so this is not a portability regression.
- **No `unref()` on the watchdog timer.** The watchdog `setTimeout` should not be `unref`-ed because we want it to keep the event loop alive in the (unlikely) case that everything else has resolved but the watchdog is still pending — `clearTimeout` on the close path handles the normal exit, and the firing path ends the process via `process.exit(0)` inside `handlePhaseTimeout`. Default behaviour is correct; no `unref()`.
