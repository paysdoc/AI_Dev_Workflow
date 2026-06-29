# Stage Classifier, Resume Policy & Recovery Routing Module

## Overview

`adws/core/stageClassifier.ts` is a pure classification module that maps every `WorkflowStage` literal to one of six `StageClass` values via an exhaustive `switch` with a compile-time `never` guard. The cron issue filter (`cronIssueFilter.ts`) and takeover handler (`takeoverHandler.ts`) dispatch on the class; per-stage raw-string overrides handle stages whose recovery differs from their class default. `adws/core/resumePolicy.ts` is the pure bounded-resume-cap policy: it decides `'resume' | 'escalate'` for each automatic `phase_timeout` recovery, capping the loop at `MAX_RESUME_ATTEMPTS = 3` before escalating to the `human_gated` stage. `adws/triggers/retryHandler.ts` maps `## Retry` directives from humans to state resets for the three human-gated recovery paths: `merge_blocked`, `human_gated`, and `review_failed`.

## Responsibilities

- Export `StageClass = 'active' | 'awaiting_merge' | 'retriable' | 'resumable' | 'terminal' | 'human_gated'`
- Export `classifyStage(stage: WorkflowStage): StageClass` — exhaustive `switch` with a `never` fallthrough that fails to compile if any `WorkflowStage` literal is unclassified
- Export `classifyStageString(stage: string): StageClass` — adapter for raw persisted stage strings, handling dynamic `${phaseName}_running` / `${phaseName}_completed` values emitted by `phaseRunner` that are not `WorkflowStage` literals
- Centralize the `endsWith('_running')` / `endsWith('_completed')` family matching previously duplicated across three predicates
- Provide the shared `recoverViaResetFromRemote` helper in `takeoverHandler.ts` — reused by the `active` branch and the unhealthy-gate fallback for the worktreeReset → remoteReconcile → `take_over_adwId` sequence
- Provide `recoverViaResumeInPlaceOrReset` in `takeoverHandler.ts` — the unified seam for `retriable` (abandoned) and `phase_timeout` within-budget; probes the worktree and reuses in place if healthy, else falls back to `recoverViaResetFromRemote`
- Export `nextResumeAction(attempts, max?)` from `resumePolicy.ts` — pure cap decision: `'resume'` while `attempts < max`, `'escalate'` at/above the bound
- Export `MAX_RESUME_ATTEMPTS = 3` — the hard cap on automatic `phase_timeout` resumes
- Wire the cap gate in `evaluateCandidate`'s `phase_timeout` branch: read `state.resumeAttempts`, call `nextResumeAction`, escalate to `human_gated` or increment and call `recoverViaResumeInPlaceOrReset`
- Provide `formatHumanGatedComment(adwId, attempts, max)` in `workflowCommentsIssue.ts` — ctx-free escalation comment posted when the cap is reached
- Handle `## Retry` directives in `retryHandler.ts` with three recovery paths: `merge_blocked → awaiting_merge`, `human_gated → phase_timeout`, `review_failed → phase_timeout` (re-arms resumeAttempts to 0 in each case)
- Classify `review_failed` as `human_gated` — cron never auto-spawns it, takeover → `spawn_fresh`; recoverable only by `## Retry` which re-arms to `phase_timeout` so the review re-runs
- Pin `review_failed` ineligibility in `evaluateIssue` (money-fire pin): an early explicit guard before the grace-period and processed-spawn checks so a `review_failed` issue is never auto-spawned regardless of recent activity or dedup state
- Provide `executeSdlcReviewFailedHandoff` in `adws/phases/sdlcReviewHandoff.ts` — extracted from `adwSdlc.tsx` so the BDD §2 scenario can drive the SDLC review-failure outcome in isolation; writes `review_failed` top-level state, posts the branch-pointing comment, and logs the warning

## Contracts & Invariants

- Every `WorkflowStage` literal maps to exactly one `StageClass`; omitting a `case` in `classifyStage` is a `tsc` compile error (the `default` branch assigns `stage` to `never`)
- `classifyStageString` checks `endsWith('_running')` → `active` and `endsWith('_completed')` → `resumable` **before** delegating to `classifyStage`, so dynamic phaseRunner strings are classified correctly even though they are not `WorkflowStage` literals
- Unknown strings and the empty string `''` fall through to the `default` branch and return `'resumable'` at runtime (safest defensive class → `spawn_fresh` in takeover, excluded in cron)
- The `terminal` class is exactly `{completed, discarded, paused, paused_auth}` — no dynamic string maps to `terminal`
- `nextResumeAction` is pure (no I/O): `attempts < max → 'resume'`; `attempts >= max → 'escalate'`; identical inputs always produce identical output
- `state.resumeAttempts` is cumulative: incremented on each automatic `phase_timeout` resume, cleared only on `## Retry`; it survives cron ticks because `writeTopLevelState` shallow-merges
- The `escalate_human_gated` decision never spawns — both `trigger_cron` and `webhookGatekeeper` skip the spawn on this kind
- `## Retry` on `human_gated` resets to `{ workflowStage: 'phase_timeout', resumeAttempts: 0 }`; on `review_failed` also resets to `{ workflowStage: 'phase_timeout', resumeAttempts: 0 }` (review re-runs); on any other non-`merge_blocked` stage is a no-op
- `review_failed` cron exclusion guard is placed **before** the grace-period and processed-spawn dedup checks — a just-failed review with recent activity or a review already in `processedSpawns` must still be ineligible (money-fire pin)
- `executeSdlcReviewFailedHandoff` posts the `review_failed` issue comment via `postIssueStageComment` using the same `formatReviewFailedComment` path as `reviewPhase`; the comment carries a `**Branch:**` line (guarded on `ctx.branchName`) and `## Retry` recovery instructions

## Classification Table

| StageClass | WorkflowStage literals | Cron decision | Takeover decision |
|---|---|---|---|
| `active` | `starting`, `resuming`, `build_running`, `test_running`, `review_running`, `document_running`, `install_running` | exclude (in progress) | SIGKILL-if-live → reset → reconcile → `take_over_adwId` |
| `awaiting_merge` | `awaiting_merge` | eligible → `merge` | `spawn_fresh` |
| `retriable` | `abandoned` | eligible → `spawn` | probe → reuse/reset → reconcile → `take_over_adwId` (no kill) |
| `terminal` | `completed`, `discarded`, `paused`, `paused_auth` | exclude (inline checks) | `skip_terminal` (release lock) |
| `human_gated` | `merge_blocked`, `human_gated`, `review_failed` | exclude (inline checks + explicit guard for `review_failed`) | `spawn_fresh` |
| `resumable` | all remaining literals including `phase_timeout`, `error`, `plan_building`, etc. | exclude by default; **`phase_timeout` explicitly eligible** | `spawn_fresh` by default; **`phase_timeout` explicitly cap-gated** |

## Consumer Routing

**`takeoverHandler.evaluateCandidate`** dispatches on the `StageClass` with a raw-stage override before the class fallthrough:
- `terminal` → `releaseLock(); return { kind: 'skip_terminal', … }`
- `retriable` → `recoverViaResumeInPlaceOrReset(…)` (no SIGKILL; worktree already dead)
- `stage === 'phase_timeout'` (raw-stage check, after `retriable`) → **cap gate first**: `const attempts = state.resumeAttempts ?? 0; if (nextResumeAction(attempts) === 'escalate') { writeTopLevelState({ workflowStage: 'human_gated' }); commentOnIssue(formatHumanGatedComment(…)); releaseLock(); return { kind: 'escalate_human_gated', adwId }; }` else `writeTopLevelState({ resumeAttempts: attempts + 1 }); return recoverViaResumeInPlaceOrReset(…)` (#638 gate nested under #639 cap)
- `active` → SIGKILL-if-live → `recoverViaResetFromRemote(…)`
- else (`awaiting_merge | human_gated | other resumable`) → `spawn_fresh`

**`cronIssueFilter.evaluateIssue`** dispatches using inline checks then the classifier:
- inline checks for `awaiting_merge`, `discarded`, `merge_blocked`, `human_gated`, `completed`, `paused` run first
- **`review_failed` explicit guard** (before grace-period check): `return { eligible: false, reason: 'review_failed' }` — money-fire pin; takes precedence over grace-period and processedSpawns dedup
- `classifyStageString(stage) === 'active'` → `{ eligible: false, reason: 'active' }`
- `classifyStageString(stage) === 'retriable'` → `{ eligible: true, action: 'spawn' }`
- `stage === 'phase_timeout'` (raw-stage check, after `retriable`) → `{ eligible: true, action: 'spawn', adwId }`
- fallthrough → `{ eligible: false, reason: \`adw_stage:${stage}\` }`

**`retryHandler.handleRetryDirective`** maps `## Retry` comments to state resets:
- `merge_blocked` → `{ workflowStage: 'awaiting_merge', mergeRetryCount: 0 }`
- `human_gated` → `{ workflowStage: 'phase_timeout', resumeAttempts: 0 }`
- `review_failed` → `{ workflowStage: 'phase_timeout', resumeAttempts: 0 }` — review re-runs; completed plan/build/step-def phases stay skipped
- any other stage → no-op, returns `false`

**`sdlcReviewHandoff.executeSdlcReviewFailedHandoff`** is called by `adwSdlc.tsx` when `decidePostReviewOutcome` returns `skipDocAndPR: true`:
- Writes `{ workflowStage: 'review_failed' }` via `AgentStateManager.writeTopLevelState`
- Posts the branch-pointing `review_failed` issue comment via `postIssueStageComment` (uses `formatReviewFailedComment`)
- Logs the warning with branch name
- Returns void; `adwSdlc.tsx` then persists cost/metadata and `return`s before doc/PR phases

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

## review_failed Recovery Flow

```
SDLC review loop exhausted (reviewPassed === false)
  → decidePostReviewOutcome(false) → { skipDocAndPR: true, workflowStage: 'review_failed' }
  → executeSdlcReviewFailedHandoff(config)
      → writeTopLevelState({ workflowStage: 'review_failed' })
      → postIssueStageComment → formatReviewFailedComment → **Branch:** `<branch>` + ## Retry instruction
  → adwSdlc.tsx persists cost/metadata, returns (no doc/PR/awaiting_merge)

cron tick sees review_failed
  → evaluateIssue → explicit review_failed guard
  → { eligible: false, reason: 'review_failed' }  ← money-fire pin

human pushes a fix to branch, writes "## Retry"
  → retryHandler.handleRetryDirective
    → stage === 'review_failed'
    → writeTopLevelState({ workflowStage: 'phase_timeout', resumeAttempts: 0 })

cron tick sees phase_timeout
  → evaluateCandidate → cap gate (attempts=0, within budget)
  → recoverViaResumeInPlaceOrReset → re-spawn orchestrator
  → review re-runs (plan/build/step-def phases stay skipped)
```

## Configuration

`MAX_RESUME_ATTEMPTS = 3` in `adws/core/resumePolicy.ts`. No environment variable — change the constant to adjust the cap. No other configuration; pure TypeScript modules, no I/O (outside the injected `TakeoverDeps` in `takeoverHandler` and `RetryHandlerDeps` in `retryHandler`).

## Gotchas

- **`phase_timeout` recovery is via per-consumer raw-stage branches, not reclassification.** `phase_timeout` stays `resumable` in `classifyStage`. Both `evaluateIssue` (cron) and `evaluateCandidate` (takeover) add an explicit `if (stage === 'phase_timeout')` branch keyed on the raw string.
- **`review_failed` is `human_gated` (not `resumable`).** It was previously classified as `resumable`, which would have allowed cron to auto-spawn it — the money-fire risk. It now sits alongside `merge_blocked` and `human_gated` in the `human_gated` class. The reclassification is a single-line move in the exhaustive switch; the `never` guard enforces it at compile time.
- **The `review_failed` cron guard precedes grace-period and processedSpawns checks.** A `review_failed` issue with recent activity (within grace period) or already in `processedSpawns` must still be ineligible. If the guard were placed after the grace-period check, a just-failed review would become eligible after a period of inactivity — the exact money-fire scenario. Placement before is load-bearing.
- **`review_failed → phase_timeout` re-arm does NOT consume the resume counter.** The counter is incremented only by the automatic `evaluateCandidate` cap gate. A human posting `## Retry` resets `resumeAttempts: 0`, giving the subsequent automatic recovery path a full fresh budget.
- **No PR exists when `review_failed` is written.** `adwSdlc.tsx` returns before the PR phase. The `review_failed` comment points the operator at the (PR-less) branch so they can push a fix without an open PR context.
- **Intermediate loop comments vs. terminal handoff comment.** `reviewPhase.ts` posts a `review_failed` comment on each failed attempt in the retry loop (per-attempt informational). The terminal operator-facing comment is posted by `executeSdlcReviewFailedHandoff` after the loop exhausts — this is the deterministic one that BDD §2 asserts. Multiple branch-pointing comments on the issue are acceptable known behaviour.
- **`executeSdlcReviewFailedHandoff` is extracted for BDD testability.** The extraction mirrors the `completePRReviewWorkflow` pattern from `prReviewCompletion.ts`. The inline-in-`main()` form cannot be driven by the §2 scenario without spawning a full orchestrator subprocess.
- **No SIGKILL on `phase_timeout`.** `handlePhaseTimeout` already calls `process.exit(0)` — the orchestrator is dead before the stage is written. The takeover branch skips the live-PID kill and goes straight to the cap gate then `recoverViaResumeInPlaceOrReset`.
- **`human_gated` stage name equals its class name.** This mirrors the `awaiting_merge` precedent. `merge_blocked` and `review_failed` remain distinct siblings in the same `human_gated` class; the three have different `## Retry` reset targets (`awaiting_merge`, `phase_timeout`, `phase_timeout`) so they must stay separate.
- **`resumeAttempts` is cumulative, not per-phase.** A workflow that makes progress but times out at several distinct phases will still escalate after 3 total resumes.
- **Dynamic phaseRunner stages.** `phaseRunner` writes `workflowStage: \`${phaseName}_running\`` and `workflowStage: \`${phaseName}_completed\`` (e.g. `plan_running`, `step-def_running`, `test_completed`). These are not `WorkflowStage` literals. Always use `classifyStageString` (not `classifyStage`) when reading a raw `string` from the state file.
- **`isActiveStage` is NOT the same as `active`.** The compat bridge preserves a different set. Do not replace `isActiveStage` calls in `devServerJanitor.ts` or `webhookHandlers.ts` with `classifyStageString(s) === 'active'` without migrating the grace semantics.
