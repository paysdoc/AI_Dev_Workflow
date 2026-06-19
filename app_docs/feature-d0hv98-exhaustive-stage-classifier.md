# Stage Classifier Module

## Overview

`adws/core/stageClassifier.ts` is a pure classification module that maps every `WorkflowStage` literal to one of six `StageClass` values. It replaces three scattered, drift-prone string predicates (`isActiveStage`, `isRetriableStage`, `isRunningStage`) with a single exhaustive `switch` that produces a compile-time error if any `WorkflowStage` literal is left unclassified. This is the foundational module for recovery routing: both the cron issue filter and the takeover handler dispatch on the class rather than on raw stage strings.

## Responsibilities

- Export `StageClass = 'active' | 'awaiting_merge' | 'retriable' | 'resumable' | 'terminal' | 'human_gated'`
- Export `classifyStage(stage: WorkflowStage): StageClass` — exhaustive `switch` with a `never` fallthrough that fails to compile if a `WorkflowStage` literal is unclassified
- Export `classifyStageString(stage: string): StageClass` — adapter for raw persisted stage strings, handling dynamic `${phaseName}_running` / `${phaseName}_completed` values emitted by `phaseRunner` that are not `WorkflowStage` literals
- Centralize the `endsWith('_running')` / `endsWith('_completed')` family matching that was previously duplicated across three predicates

## Contracts & Invariants

- Every `WorkflowStage` literal maps to exactly one `StageClass`; omitting a `case` in `classifyStage` is a `tsc` compile error (the `default` branch assigns `stage` to `never`)
- `classifyStageString` checks `endsWith('_running')` → `active` and `endsWith('_completed')` → `resumable` **before** delegating to `classifyStage`, so dynamic phaseRunner strings are classified correctly even though they are not `WorkflowStage` literals
- Unknown strings and the empty string `''` fall through to the `default` branch and return `'resumable'` at runtime (the safest defensive class → `spawn_fresh` in takeover, excluded in cron)
- The `terminal` class is exactly `{completed, discarded, paused, paused_auth}` — this matches the `skip_terminal.terminalStage` discriminated union in `takeoverHandler.ts`; no dynamic string maps to `terminal`
- This module is behavior-preserving: every stage maps to the same recovery decision as the legacy predicates it replaced; reclassification of specific stages (e.g. `phase_timeout`) is deferred to follow-up PRD slices

## Classification Table

| StageClass | WorkflowStage literals | Cron decision | Takeover decision |
|---|---|---|---|
| `active` | `starting`, `resuming`, `build_running`, `test_running`, `review_running`, `document_running`, `install_running` | exclude (in progress) | SIGKILL-if-live → reset → reconcile → `take_over_adwId` |
| `awaiting_merge` | `awaiting_merge` | eligible → `merge` | `spawn_fresh` |
| `retriable` | `abandoned` | eligible → `spawn` | reset → reconcile → `take_over_adwId` (no kill) |
| `terminal` | `completed`, `discarded`, `paused`, `paused_auth` | exclude (inline checks) | `skip_terminal` (release lock) |
| `human_gated` | `merge_blocked` | exclude (inline check) | `spawn_fresh` |
| `resumable` | all remaining literals (37 stages including `phase_timeout`, `error`, `plan_building`, etc.) | exclude (fallback) | `spawn_fresh` |

## Consumer Routing

**`takeoverHandler.evaluateCandidate`** calls `classifyStageString(stage.workflowStage ?? '')` and dispatches on the class:
- `terminal` → `releaseLock(); return { kind: 'skip_terminal', … }`
- `retriable` → worktreeReset → remoteReconcile → `take_over_adwId`
- `active` → SIGKILL-if-live → worktreeReset → remoteReconcile → `take_over_adwId`
- else (`awaiting_merge | human_gated | resumable`) → `spawn_fresh`

**`cronIssueFilter.evaluateIssue`** calls `classifyStageString(stage)`:
- `=== 'active'` → `{ eligible: false, reason: 'active' }`
- `=== 'retriable'` → `{ eligible: true, action: 'spawn' }`
- The inline equality checks for `awaiting_merge`, `discarded`, `merge_blocked`, `completed`, and `paused` run before the classifier calls and are retained.

**`cronStageResolver.isActiveStage`** (compatibility bridge for `devServerJanitor` and `webhookHandlers`):
- Preserves the historical "in progress" set `{starting, *_running, *_completed}` which differs from the `active` class
- Bridge: `cls === 'active' && stage !== 'resuming'` OR `cls === 'resumable' && stage.endsWith('_completed')`
- `isRetriableStage` was removed; `cronIssueFilter` uses `classifyStageString` directly

## Configuration

No configuration. Pure TypeScript module, no I/O, no environment variables.

## Gotchas

- **`resuming` vs `*_completed` asymmetry.** `resuming` is `active` (takeover reclaims it) but is excluded from `isActiveStage`'s historical set (the bridge's `stage !== 'resuming'` guard). `*_completed` is `resumable` (takeover → `spawn_fresh`) but included in `isActiveStage`'s historical set (the bridge's `endsWith('_completed')` check). These two opposite memberships exist because `phaseRunner` writes `${phase}_completed` between phases — a live orchestrator passes through these stages — so `shouldCleanWorktree` in the janitor must not kill it.
- **Dynamic phaseRunner stages.** `phaseRunner` writes `workflowStage: \`${phaseName}_running\`` and `workflowStage: \`${phaseName}_completed\`` (e.g. `plan_running`, `step-def_running`, `test_completed`). These are not `WorkflowStage` literals but are persisted in `state.json`. Always use `classifyStageString` (not `classifyStage`) when reading a raw `string` from the state file.
- **`phase_timeout` stays `resumable` in this slice.** The `phase_timeout` stage classifies as `resumable` (cron excludes via fallback, takeover `spawn_fresh`), which reproduces its pre-classifier behavior. Reclassifying it to enable resume-in-place is a follow-up slice.
- **`isActiveStage` is NOT the same as `active`.** The compat bridge intentionally preserves a *different* set than the `active` class. Do not replace `isActiveStage` calls in `devServerJanitor.ts` or `webhookHandlers.ts` with `classifyStageString(s) === 'active'` without migrating the grace semantics.
- **`hungOrchestratorDetector.ts`** has its own `endsWith('_running')` family match (a third, narrower set). It was not routed through the classifier in this slice to stay behavior-preserving.
