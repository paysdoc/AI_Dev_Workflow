# Stage Classifier, Resume Policy & Recovery Routing Module

## Overview

`adws/core/stageClassifier.ts` is a pure classification module that maps every `WorkflowStage` literal to one of six `StageClass` values via an exhaustive `switch` with a compile-time `never` guard. The cron issue filter (`cronIssueFilter.ts`) and takeover handler (`takeoverHandler.ts`) dispatch on the class; per-stage raw-string overrides handle the two stages whose recovery differs from their class default (`phase_timeout` in both consumers). `adws/core/resumePolicy.ts` is the pure bounded-resume-cap policy: it decides `'resume' | 'escalate'` for each automatic `phase_timeout` recovery, capping the loop at `MAX_RESUME_ATTEMPTS = 3` before escalating to the `human_gated` stage — the money-fire backstop for cron-driven phase-timeout loops.

## Responsibilities

- Export `StageClass = 'active' | 'awaiting_merge' | 'retriable' | 'resumable' | 'terminal' | 'human_gated'`
- Export `classifyStage(stage: WorkflowStage): StageClass` — exhaustive `switch` with a `never` fallthrough that fails to compile if any `WorkflowStage` literal is unclassified
- Export `classifyStageString(stage: string): StageClass` — adapter for raw persisted stage strings, handling dynamic `${phaseName}_running` / `${phaseName}_completed` values emitted by `phaseRunner` that are not `WorkflowStage` literals
- Centralize the `endsWith('_running')` / `endsWith('_completed')` family matching previously duplicated across three predicates
- Provide the shared `recoverViaResetFromRemote` helper in `takeoverHandler.ts` — reused by the `active` branch and the unhealthy-gate fallback for the worktreeReset → remoteReconcile → `take_over_adwId` sequence
- Provide `recoverViaResumeInPlaceOrReset` in `takeoverHandler.ts` — the unified seam for `retriable` (abandoned) and `phase_timeout` within-budget; probes the worktree and reuses in place if healthy, else falls back to `recoverViaResetFromRemote`. The `active` branch still calls `recoverViaResetFromRemote` unconditionally.
- Export `nextResumeAction(attempts, max?)` from `resumePolicy.ts` — pure cap decision: `'resume'` while `attempts < max`, `'escalate'` at/above the bound
- Export `MAX_RESUME_ATTEMPTS = 3` — the hard cap on automatic `phase_timeout` resumes; mirrors `MAX_PR_RESOLUTION_ATTEMPTS` and `MAX_AUTO_MERGE_ATTEMPTS`
- Wire the cap gate in `evaluateCandidate`'s `phase_timeout` branch: read `state.resumeAttempts`, call `nextResumeAction`, escalate to `human_gated` or increment and call `recoverViaResumeInPlaceOrReset`
- Provide `formatHumanGatedComment(adwId, attempts, max)` in `workflowCommentsIssue.ts` — ctx-free escalation comment posted when the cap is reached

## Contracts & Invariants

- Every `WorkflowStage` literal maps to exactly one `StageClass`; omitting a `case` in `classifyStage` is a `tsc` compile error (the `default` branch assigns `stage` to `never`)
- `classifyStageString` checks `endsWith('_running')` → `active` and `endsWith('_completed')` → `resumable` **before** delegating to `classifyStage`, so dynamic phaseRunner strings are classified correctly even though they are not `WorkflowStage` literals
- Unknown strings and the empty string `''` fall through to the `default` branch and return `'resumable'` at runtime (the safest defensive class → `spawn_fresh` in takeover, excluded in cron)
- The `terminal` class is exactly `{completed, discarded, paused, paused_auth}` — matches the `skip_terminal.terminalStage` discriminated union in `takeoverHandler.ts`; no dynamic string maps to `terminal`
- Per-consumer raw-stage branches (`if (stage === 'phase_timeout')`) in cron and takeover do not change the `StageClass`; they only override the default routing for that specific stage without affecting any other `resumable` stage
- `nextResumeAction` is pure (no I/O): `attempts < max → 'resume'`; `attempts >= max → 'escalate'`; identical inputs always produce identical output
- `state.resumeAttempts` is a cumulative counter: incremented on each automatic `phase_timeout` resume, cleared only on `## Retry` (analogous to `mergeRetryCount`); it survives cron ticks because `writeTopLevelState` shallow-merges and `workflowInit`'s `{ workflowStage: 'starting' }` write does not clear it
- The `escalate_human_gated` decision never spawns — both `trigger_cron` and `webhookGatekeeper` skip the spawn on this kind, and cron does not add the issue to `processedSpawns`
- `## Retry` on a `human_gated` stage resets to `{ workflowStage: 'phase_timeout', resumeAttempts: 0 }` — re-arming the cap; `## Retry` on any other non-`merge_blocked` stage is a no-op

## Classification Table

| StageClass | WorkflowStage literals | Cron decision | Takeover decision |
|---|---|---|---|
| `active` | `starting`, `resuming`, `build_running`, `test_running`, `review_running`, `document_running`, `install_running` | exclude (in progress) | SIGKILL-if-live → reset → reconcile → `take_over_adwId` |
| `awaiting_merge` | `awaiting_merge` | eligible → `merge` | `spawn_fresh` |
| `retriable` | `abandoned` | eligible → `spawn` | probe → reuse/reset → reconcile → `take_over_adwId` (no kill) |
| `terminal` | `completed`, `discarded`, `paused`, `paused_auth` | exclude (inline checks) | `skip_terminal` (release lock) |
| `human_gated` | `merge_blocked`, `human_gated` | exclude (inline checks) | `spawn_fresh` |
| `resumable` | all remaining literals including `phase_timeout`, `error`, `plan_building`, etc. | exclude by default; **`phase_timeout` explicitly eligible** | `spawn_fresh` by default; **`phase_timeout` explicitly cap-gated → within budget: probe → reuse/reset → `take_over_adwId`; at cap: `escalate_human_gated`** |

## Consumer Routing

**`takeoverHandler.evaluateCandidate`** dispatches on the `StageClass` with a raw-stage override before the class fallthrough:
- `terminal` → `releaseLock(); return { kind: 'skip_terminal', … }`
- `retriable` → `recoverViaResumeInPlaceOrReset(…)` (no SIGKILL; worktree already dead)
- `stage === 'phase_timeout'` (raw-stage check, after `retriable`) → **cap gate first**: `const attempts = state.resumeAttempts ?? 0; if (nextResumeAction(attempts) === 'escalate') { writeTopLevelState({ workflowStage: 'human_gated' }); commentOnIssue(formatHumanGatedComment(…)); releaseLock(); return { kind: 'escalate_human_gated', adwId }; }` else `writeTopLevelState({ resumeAttempts: attempts + 1 }); return recoverViaResumeInPlaceOrReset(…)` (#638 gate nested under #639 cap)
- `active` → SIGKILL-if-live → `recoverViaResetFromRemote(…)`
- else (`awaiting_merge | human_gated | other resumable`) → `spawn_fresh`

`recoverViaResumeInPlaceOrReset(d, input, adwId, state)` is the unified seam for the two recoverable confirmed-dead stages. It probes the worktree via `decideWorktreeReuse(WorktreeProbe)` — Class-A git-operability signals only — and either resumes in place (healthy worktree: uncommitted work preserved, orphaned lock cleared) or falls back to `recoverViaResetFromRemote` (unhealthy: live owner, interrupted rebase/merge/cherry-pick, wrong HEAD, locked/prunable/missing registration). Both branches conclude with `takeOverWithDerivedStage` → `{ kind: 'take_over_adwId', adwId, derivedStage }`.

`recoverViaResetFromRemote(d, input, adwId, state)` is a private helper used by the `active` branch and the unhealthy-gate fallback: if `state.branchName` is set, `d.getWorktreePath` + `d.resetWorktree`; then `takeOverWithDerivedStage`.

**`cronIssueFilter.evaluateIssue`** dispatches using inline checks then the classifier:
- inline checks for `awaiting_merge`, `discarded`, `merge_blocked`, `human_gated`, `completed`, `paused` run first
- `classifyStageString(stage) === 'active'` → `{ eligible: false, reason: 'active' }`
- `classifyStageString(stage) === 'retriable'` → `{ eligible: true, action: 'spawn' }`
- `stage === 'phase_timeout'` (raw-stage check, after `retriable`) → `{ eligible: true, action: 'spawn', adwId }` — un-strands watchdog-killed workflows
- fallthrough → `{ eligible: false, reason: \`adw_stage:${stage}\` }`

**`cronStageResolver.isActiveStage`** (compatibility bridge for `devServerJanitor` and `webhookHandlers`):
- Preserves the historical "in progress" set `{starting, *_running, *_completed}` which differs from the `active` class
- Bridge: `cls === 'active' && stage !== 'resuming'` OR `cls === 'resumable' && stage.endsWith('_completed')`

## Bounded Resume Cap Flow

```
cron tick sees phase_timeout
  → evaluateCandidate → phase_timeout branch
    → attempts = state.resumeAttempts ?? 0
    → nextResumeAction(attempts, 3)
      < 3 → writeTopLevelState({ resumeAttempts: attempts + 1 })
           → recoverViaResumeInPlaceOrReset → probe → reuse-or-reset → take_over_adwId (re-spawn)
      ≥ 3 → writeTopLevelState({ workflowStage: 'human_gated' })
           → commentOnIssue(formatHumanGatedComment)
           → releaseLock()
           → escalate_human_gated (no re-spawn)

human writes "## Retry" on issue
  → retryHandler.handleRetryDirective
    → stage === 'human_gated'
    → writeTopLevelState({ workflowStage: 'phase_timeout', resumeAttempts: 0 })
    → next cron tick: attempts = 0, resumes normally
```

## Configuration

`MAX_RESUME_ATTEMPTS = 3` in `adws/core/resumePolicy.ts`. No environment variable — change the constant to adjust the cap. No other configuration; pure TypeScript modules, no I/O (outside the injected `TakeoverDeps` in `takeoverHandler`).

## Gotchas

- **`phase_timeout` recovery is via per-consumer raw-stage branches, not reclassification.** `phase_timeout` stays `resumable` in `classifyStage`. Both `evaluateIssue` (cron) and `evaluateCandidate` (takeover) add an explicit `if (stage === 'phase_timeout')` branch keyed on the raw string, so other `resumable` stages (`plan_created`, `build_completed`, etc.) are unaffected. This is the intended pattern for per-stage overrides; do not move `phase_timeout` to `retriable` without also verifying all other consumers.
- **No SIGKILL on `phase_timeout`.** `handlePhaseTimeout` already calls `process.exit(0)` — the orchestrator is dead before the stage is written. The takeover branch skips the live-PID kill and goes straight to the cap gate then `recoverViaResumeInPlaceOrReset`. The spawn-lock acquisition at the top of `evaluateCandidate` plus the probe's `liveOwner` signal together guard against a surprise-live holder (which would be forced to the reset path).
- **`human_gated` stage name equals its class name.** This mirrors the `awaiting_merge` precedent (`classifyStage('awaiting_merge') === 'awaiting_merge'`). `merge_blocked` remains a distinct sibling in the same `human_gated` class; the two have different `## Retry` reset targets (`awaiting_merge` vs `phase_timeout`) so they must stay separate.
- **`resumeAttempts` is cumulative, not per-phase.** A workflow that makes progress but times out at several distinct phases will still escalate after 3 total resumes. Reset-on-progress is deliberately out of scope to keep the slice tight.
- **Cap gate sits above `recoverViaResumeInPlaceOrReset`.** This means it composes cleanly: #639's cap check is evaluated first; within budget, #638's probe-and-reuse gate runs. Keep the cap check at the top of the `phase_timeout` branch; the gate nests underneath it.
- **`resuming` vs `*_completed` asymmetry.** `resuming` is `active` (takeover reclaims it) but excluded from `isActiveStage`'s historical set. `*_completed` is `resumable` (takeover → `spawn_fresh`) but included in `isActiveStage`'s set (bridge's `endsWith('_completed')` check). These two opposite memberships exist because `phaseRunner` writes `${phase}_completed` between phases — a live orchestrator passes through these — so `shouldCleanWorktree` in the janitor must not kill it.
- **Dynamic phaseRunner stages.** `phaseRunner` writes `workflowStage: \`${phaseName}_running\`` and `workflowStage: \`${phaseName}_completed\`` (e.g. `plan_running`, `step-def_running`, `test_completed`). These are not `WorkflowStage` literals but are persisted in `state.json`. Always use `classifyStageString` (not `classifyStage`) when reading a raw `string` from the state file.
- **`isActiveStage` is NOT the same as `active`.** The compat bridge preserves a different set. Do not replace `isActiveStage` calls in `devServerJanitor.ts` or `webhookHandlers.ts` with `classifyStageString(s) === 'active'` without migrating the grace semantics.
- **`hungOrchestratorDetector.ts`** has its own `endsWith('_running')` family match (a third, narrower set). It was not routed through the classifier to stay behavior-preserving.
- **`escalate_human_gated` is not `skip_terminal`.** The `skip_terminal` kind's `terminalStage` union is `completed|discarded|paused|paused_auth`; widening it to include `human_gated` would be a type lie. The dedicated `escalate_human_gated` kind keeps the taxonomy honest.
- **Resume-in-place is implemented for `abandoned` and `phase_timeout` (both recoverable confirmed-dead stages).** `recoverViaResumeInPlaceOrReset` probes Class-A git-operability signals (`worktreeReuseGate.ts` + `worktreeProbe.ts`) and reuses a healthy worktree in place — preserving uncommitted work — instead of resetting. Unhealthy worktrees (live owner, interrupted op, wrong HEAD, locked/prunable/missing) still reset. Class-B content health (diff quality, test results) is assessed only by the existing blocking end-verification and HITL-on-destructive-diffs gate; `decideWorktreeReuse` never inspects work content.
