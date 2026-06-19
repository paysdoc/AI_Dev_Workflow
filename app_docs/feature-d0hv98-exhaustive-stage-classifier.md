# Stage Classifier & Recovery Routing Module

## Overview

`adws/core/stageClassifier.ts` is a pure classification module that maps every `WorkflowStage` literal to one of six `StageClass` values. It replaced three scattered, drift-prone string predicates (`isActiveStage`, `isRetriableStage`, `isRunningStage`) with a single exhaustive `switch` that produces a compile-time error if any `WorkflowStage` literal is left unclassified. The cron issue filter (`cronIssueFilter.ts`) and the takeover handler (`takeoverHandler.ts`) both dispatch on the class; where a specific stage needs recovery behaviour that differs from its class default, those consumers add a per-stage branch keyed on the raw stage string, so no other stage in the same class changes.

## Responsibilities

- Export `StageClass = 'active' | 'awaiting_merge' | 'retriable' | 'resumable' | 'terminal' | 'human_gated'`
- Export `classifyStage(stage: WorkflowStage): StageClass` — exhaustive `switch` with a `never` fallthrough that fails to compile if a `WorkflowStage` literal is unclassified
- Export `classifyStageString(stage: string): StageClass` — adapter for raw persisted stage strings, handling dynamic `${phaseName}_running` / `${phaseName}_completed` values emitted by `phaseRunner` that are not `WorkflowStage` literals
- Centralize the `endsWith('_running')` / `endsWith('_completed')` family matching previously duplicated across three predicates
- Provide the shared `recoverViaResetFromRemote` helper in `takeoverHandler.ts` — reused by the `retriable`, `active`, and `phase_timeout` branches for the worktreeReset → remoteReconcile → `take_over_adwId` sequence

## Contracts & Invariants

- Every `WorkflowStage` literal maps to exactly one `StageClass`; omitting a `case` in `classifyStage` is a `tsc` compile error (the `default` branch assigns `stage` to `never`)
- `classifyStageString` checks `endsWith('_running')` → `active` and `endsWith('_completed')` → `resumable` **before** delegating to `classifyStage`, so dynamic phaseRunner strings are classified correctly even though they are not `WorkflowStage` literals
- Unknown strings and the empty string `''` fall through to the `default` branch and return `'resumable'` at runtime (the safest defensive class → `spawn_fresh` in takeover, excluded in cron)
- The `terminal` class is exactly `{completed, discarded, paused, paused_auth}` — matches the `skip_terminal.terminalStage` discriminated union in `takeoverHandler.ts`; no dynamic string maps to `terminal`
- Per-consumer raw-stage branches (`if (stage === 'phase_timeout')`) in cron and takeover do not change the `StageClass`; they only override the default routing for that specific stage without affecting any other `resumable` stage

## Classification Table

| StageClass | WorkflowStage literals | Cron decision | Takeover decision |
|---|---|---|---|
| `active` | `starting`, `resuming`, `build_running`, `test_running`, `review_running`, `document_running`, `install_running` | exclude (in progress) | SIGKILL-if-live → reset → reconcile → `take_over_adwId` |
| `awaiting_merge` | `awaiting_merge` | eligible → `merge` | `spawn_fresh` |
| `retriable` | `abandoned` | eligible → `spawn` | reset → reconcile → `take_over_adwId` (no kill) |
| `terminal` | `completed`, `discarded`, `paused`, `paused_auth` | exclude (inline checks) | `skip_terminal` (release lock) |
| `human_gated` | `merge_blocked` | exclude (inline check) | `spawn_fresh` |
| `resumable` | all remaining literals including `phase_timeout`, `error`, `plan_building`, etc. | exclude by default; **`phase_timeout` explicitly eligible** | `spawn_fresh` by default; **`phase_timeout` explicitly reset → reconcile → `take_over_adwId`** |

## Consumer Routing

**`takeoverHandler.evaluateCandidate`** dispatches on the `StageClass` with a raw-stage override before the class fallthrough:
- `terminal` → `releaseLock(); return { kind: 'skip_terminal', … }`
- `retriable` → `recoverViaResetFromRemote(…)`
- `stage === 'phase_timeout'` (raw-stage check, after `retriable`) → `recoverViaResetFromRemote(…)` (no SIGKILL; orchestrator already exited via `process.exit(0)`)
- `active` → SIGKILL-if-live → `recoverViaResetFromRemote(…)`
- else (`awaiting_merge | human_gated | other resumable`) → `spawn_fresh`

`recoverViaResetFromRemote(d, input, adwId, state)` is a private helper shared by `retriable`, `active`, and `phase_timeout` branches: if `state.branchName` is set, `d.getWorktreePath` + `d.resetWorktree`; then `d.deriveStageFromRemote` → `{ kind: 'take_over_adwId', adwId, derivedStage }`.

**`cronIssueFilter.evaluateIssue`** dispatches using inline checks then the classifier:
- inline checks for `awaiting_merge`, `discarded`, `merge_blocked`, `completed`, `paused` run first
- `classifyStageString(stage) === 'active'` → `{ eligible: false, reason: 'active' }`
- `classifyStageString(stage) === 'retriable'` → `{ eligible: true, action: 'spawn' }`
- `stage === 'phase_timeout'` (raw-stage check, after `retriable`) → `{ eligible: true, action: 'spawn', adwId }` — un-strands watchdog-killed workflows
- fallthrough → `{ eligible: false, reason: \`adw_stage:${stage}\` }`

**`cronStageResolver.isActiveStage`** (compatibility bridge for `devServerJanitor` and `webhookHandlers`):
- Preserves the historical "in progress" set `{starting, *_running, *_completed}` which differs from the `active` class
- Bridge: `cls === 'active' && stage !== 'resuming'` OR `cls === 'resumable' && stage.endsWith('_completed')`

## Configuration

No configuration. Pure TypeScript modules, no I/O, no environment variables.

## Gotchas

- **`phase_timeout` recovery is via per-consumer raw-stage branches, not reclassification.** `phase_timeout` stays `resumable` in `classifyStage`. Both `evaluateIssue` (cron) and `evaluateCandidate` (takeover) add an explicit `if (stage === 'phase_timeout')` branch keyed on the raw string, so other `resumable` stages (`plan_created`, `build_completed`, etc.) are unaffected. This is the intended pattern for per-stage overrides; do not move `phase_timeout` to `retriable` without also verifying all other consumers.
- **No SIGKILL on `phase_timeout`.** `handlePhaseTimeout` already calls `process.exit(0)` — the orchestrator is dead before the stage is written. The takeover branch skips the live-PID kill and goes straight to `recoverViaResetFromRemote`. The spawn-lock acquisition at the top of `evaluateCandidate` guards against a live holder.
- **`resuming` vs `*_completed` asymmetry.** `resuming` is `active` (takeover reclaims it) but excluded from `isActiveStage`'s historical set. `*_completed` is `resumable` (takeover → `spawn_fresh`) but included in `isActiveStage`'s set (bridge's `endsWith('_completed')` check). These two opposite memberships exist because `phaseRunner` writes `${phase}_completed` between phases — a live orchestrator passes through these — so `shouldCleanWorktree` in the janitor must not kill it.
- **Dynamic phaseRunner stages.** `phaseRunner` writes `workflowStage: \`${phaseName}_running\`` and `workflowStage: \`${phaseName}_completed\`` (e.g. `plan_running`, `step-def_running`, `test_completed`). These are not `WorkflowStage` literals but are persisted in `state.json`. Always use `classifyStageString` (not `classifyStage`) when reading a raw `string` from the state file.
- **`isActiveStage` is NOT the same as `active`.** The compat bridge preserves a different set. Do not replace `isActiveStage` calls in `devServerJanitor.ts` or `webhookHandlers.ts` with `classifyStageString(s) === 'active'` without migrating the grace semantics.
- **`hungOrchestratorDetector.ts`** has its own `endsWith('_running')` family match (a third, narrower set). It was not routed through the classifier to stay behavior-preserving.
- **Resume-in-place is out of scope.** The current `phase_timeout` recovery is reset-from-remote takeover (same path as `abandoned`). Actual in-place phase re-entry is a later PRD slice; the corrected comments in `workflowTypes.ts`, `workflowCommentsIssue.ts`, and `workflowCompletion.ts` explicitly say so.
