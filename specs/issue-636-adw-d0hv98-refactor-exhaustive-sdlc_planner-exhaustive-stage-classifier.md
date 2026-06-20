# Feature: Exhaustive `classifyStage` + route cron/takeover through it (behavior-preserving)

## Metadata
issueNumber: `636`
adwId: `d0hv98-refactor-exhaustive`
issueJson: `{"number":636,"title":"refactor: exhaustive stageClassifier + route cron/takeover through it (behavior-preserving)","body":"## Parent PRD\n\n`specs/prd/stage-recovery-resume-in-place.md`\n\n## What to build\n\nIntroduce a single pure `classifyStage(stage)` over the `WorkflowStage` union, implemented as an exhaustive `switch` with a `never` fallthrough, returning a `StageClass` (`active | awaiting_merge | retriable | resumable | terminal | human_gated`). Replace the `isActiveStage`/`isRetriable` predicates (and their `endsWith('_running')`-style family matching) and route the cron stage resolver and takeover handler through it.\n\nThis slice is **behavior-preserving**: every existing stage is classified so current recovery behavior is reproduced exactly (no stage changes class yet). The value is the compile-time guard — adding a future stage without a classification case becomes a build error. See PRD \"Implementation Decisions\" (stage classification module, StageClass taxonomy).\n\n## Acceptance criteria\n\n- [ ] `classifyStage` covers every `WorkflowStage` literal; an unclassified stage fails to compile (`never` guard)\n- [ ] cron stage resolver and takeover handler consume `classifyStage` instead of bespoke predicates\n- [ ] No observable change in recovery behavior for any existing stage (existing takeover/cron tests still pass unchanged)\n- [ ] Unit tests assert one classification per stage literal\n\n## Blocked by\n\nNone - can start immediately\n\n## User stories addressed\n\n- User story 13\n- User story 14\n- User story 15"}`

## Feature Description

ADW derives every recovery decision (re-spawn, take over, skip, merge) from a single field: the persisted `workflowStage`. Today that derivation is spread across three hand-rolled, drift-prone mechanisms:

1. `isActiveStage(stage)` in `cronStageResolver.ts` — `stage === 'starting' || stage.endsWith('_running') || stage.endsWith('_completed')` (minus the terminal `'completed'`).
2. `isRetriableStage(stage)` in `cronStageResolver.ts` — `stage === 'abandoned'`.
3. `isRunningStage(stage)` (a private helper inside `takeoverHandler.ts`) — `stage.endsWith('_running') || stage === 'starting' || stage === 'resuming'`, plus a chain of inline `stage === '…'` equality branches in `evaluateCandidate`.

Because these are open-ended string predicates, adding a new `WorkflowStage` literal silently slots into "none of the above" with **no compiler signal** — exactly the failure mode that stranded issue #612 for hours: the `phase_timeout` stage was written by the watchdog but no recovery predicate matched it, so it fell through every allowlist and was never resumed.

This feature introduces a single pure classifier, `classifyStage(stage: WorkflowStage): StageClass`, implemented as an **exhaustive `switch` with a `never` fallthrough**. Every `WorkflowStage` literal must map to exactly one of six classes — `active | awaiting_merge | retriable | resumable | terminal | human_gated`. Omitting a stage becomes a **compile error**. The cron stage resolver, the cron issue filter, and the takeover handler are rerouted to consume the classifier instead of the bespoke predicates.

This slice is strictly **behavior-preserving**: every current stage keeps its current recovery decision. The deliverable is the compile-time exhaustiveness guard and a single named taxonomy — not any change in runtime routing. Subsequent PRD slices (resume-in-place, N-cap escalation) build on this foundation by *reclassifying* specific stages; that is explicitly out of scope here.

## User Story

As an **ADW maintainer adding or changing a workflow stage**
I want **a single exhaustive `classifyStage` function that fails to compile when a `WorkflowStage` is left unclassified**
So that **a new stage can never silently fall through every recovery path (the `phase_timeout` dead-end class of bug) and the cron/takeover recovery semantics stay centralized and auditable**.

## Problem Statement

The recovery semantics of a `WorkflowStage` are encoded by three independent predicates using open-ended `endsWith('_running')` / `endsWith('_completed')` family matching and scattered `stage === '…'` equality checks across `cronStageResolver.ts`, `cronIssueFilter.ts`, and `takeoverHandler.ts`. There is:

- **No exhaustiveness guard.** A newly added `WorkflowStage` literal compiles cleanly while matching no predicate, so cron excludes it (`adw_stage:<stage>`) and takeover treats it as `spawn_fresh` — a silent dead-end. This is the documented root cause of the #612 incident (`project_phase_timeout_deadend`).
- **No single source of truth.** The cron notion of "in progress" (`isActiveStage` = `{starting, *_running, *_completed}`) and the takeover notion of "reclaimable running" (`isRunningStage` = `{starting, resuming, *_running}`) are *deliberately different sets* but that divergence is implicit and undocumented.
- **Duplicated string matching.** The same `endsWith` family logic is re-implemented in each consumer, so a change in one must be hand-mirrored in the others.

## Solution Statement

Introduce a pure stage-classification module, `adws/core/stageClassifier.ts`, exporting:

- `type StageClass = 'active' | 'awaiting_merge' | 'retriable' | 'resumable' | 'terminal' | 'human_gated'`.
- `classifyStage(stage: WorkflowStage): StageClass` — an exhaustive `switch` over the closed `WorkflowStage` union with a `default` branch that assigns `stage` to `never` (the compile-time guard) and returns the defensive fallback class at runtime.
- `classifyStageString(stage: string): StageClass` — a thin adapter for the *raw persisted* stage string, which may be a **dynamic `${phaseName}_running` / `${phaseName}_completed` value emitted by `phaseRunner` that is not a `WorkflowStage` literal** (e.g. `plan_running`, `test_completed`, `step-def_running`). It centralizes the legacy family fallback (the `endsWith` matching that used to be scattered across the three predicates) in exactly one place.

The six classes are assigned so that **each consumer reproduces its current decisions exactly**:

| StageClass | Cron filter decision | Takeover decision |
|---|---|---|
| `active` | exclude (in progress) | reclaim **with** SIGKILL-if-live → reset → reconcile → `take_over` |
| `retriable` | eligible → `spawn` | reclaim **without** kill (reset → reconcile) → `take_over` |
| `terminal` | excluded (via inline checks / fallback) | `skip_terminal` (release lock) |
| `human_gated` | excluded (inline `merge_blocked` check) | `spawn_fresh` |
| `awaiting_merge` | eligible → `merge` (inline check) | `spawn_fresh` |
| `resumable` | excluded (fallback) | `spawn_fresh` |

Routing changes:
- **Takeover** (`takeoverHandler.ts`) consumes `classifyStageString` directly, replacing the private `isRunningStage` helper and the inline `stage === '…'` equality cascade with a class-driven decision. Decisions are reproduced exactly (verified stage-by-stage below).
- **Cron filter** (`cronIssueFilter.ts`) replaces its `isActiveStage(stage)` / `isRetriableStage(stage)` calls with `classifyStageString(stage) === 'active'` / `=== 'retriable'`. The explicit inline equality checks it already performs for `awaiting_merge`, `discarded`, `merge_blocked`, `completed`, `paused` are exact (not family matching) and are retained.
- **`isRetriableStage`** is removed (cron was its only consumer).
- **`isActiveStage`** is retained as a thin classifier-backed compatibility predicate (now delegating to `classifyStageString`, no scattered `endsWith`) **solely for its out-of-scope consumers** `devServerJanitor.ts` and `webhookHandlers.ts`, whose `isNonTerminal`/grace-skip semantics require the historical `{starting, *_running, *_completed}` set. Migrating those two consumers (and `hungOrchestratorDetector.ts`'s independent `endsWith('_running')`) onto the classifier is deferred to a follow-up so this slice stays strictly behavior-preserving (see Notes).

## Relevant Files

Use these files to implement the feature:

### Core implementation

- `adws/types/workflowTypes.ts` — defines the `WorkflowStage` union (51 literals, lines 6–72). This is the closed set the classifier must exhaustively cover. No change to the union itself; the classifier imports the type.
- `adws/triggers/cronStageResolver.ts` — currently defines `isActiveStage` (lines 67–71) and `isRetriableStage` (lines 82–84) with `endsWith` family matching. `isRetriableStage` is removed; `isActiveStage` is reimplemented as a classifier-backed bridge. `resolveIssueWorkflowStage`, `extractLatestAdwId`, `getLastActivityFromState` are unchanged.
- `adws/triggers/takeoverHandler.ts` — `evaluateCandidate` decision tree (lines 106–191) and the private `isRunningStage` helper (lines 96–102). Reroute the stage branches through `classifyStageString`; the `terminalStage` discriminator type (`'completed' | 'discarded' | 'paused' | 'paused_auth'`) maps exactly to the `terminal` class.
- `adws/triggers/cronIssueFilter.ts` — `evaluateIssue` (lines 75–153). Replace the `isActiveStage`/`isRetriableStage` calls (lines 145, 148) and their import (line 11) with `classifyStageString` checks. Keep the inline `awaiting_merge`/`discarded`/`merge_blocked`/`completed`/`paused` checks.
- `adws/core/phaseRunner.ts` — **read-only reference.** Lines 147–151 write `workflowStage: \`${phaseName}_running\`` and lines 160–163 write `workflowStage: \`${phaseName}_completed\``. This is the source of dynamic, non-`WorkflowStage`-literal stage strings that `classifyStageString` must handle. Do not modify.
- `adws/types/agentTypes.ts` — `AgentState.workflowStage?: string` (line 272). Confirms consumers receive a raw `string`, which is why `classifyStageString(stage: string)` is the consumer-facing entry point.

### Out-of-scope consumers (retained `isActiveStage`, do NOT change behavior)

- `adws/triggers/devServerJanitor.ts` — `isNonTerminal = isActiveStage(state.workflowStage)` (line 288) feeds `shouldCleanWorktree` (lines 126–137). Import path/usage unchanged; relies on the historical `isActiveStage` set.
- `adws/triggers/webhookHandlers.ts` — `isActiveStage(workflowStage)` grace-period skip on issue-closed cleanup (line 175). Import path/usage unchanged.

### New Files

- `adws/core/stageClassifier.ts` — the new module: `StageClass` type, `classifyStage(stage: WorkflowStage): StageClass` (exhaustive switch + `never` guard), `classifyStageString(stage: string): StageClass` (dynamic-string adapter). Pure, no I/O — mirrors the existing pure-verdict modules `adws/core/resolveVerdict.ts` and `adws/core/testVerdict.ts`.
- `adws/core/__tests__/stageClassifier.test.ts` — unit tests asserting one classification per `WorkflowStage` literal, plus `classifyStageString` behavior for dynamic/empty/unknown strings.

### Tests to update

- `adws/triggers/__tests__/cronStageResolver.test.ts` — remove the `isRetriableStage` `describe` blocks (function removed; coverage moves to the classifier test). The `isActiveStage` blocks (lines 100–147) **pass unchanged** because the bridge preserves the exact historical set, including the synthetic `plan_running`/`plan_completed`/`some_unknown_stage` cases.
- `adws/triggers/__tests__/trigger_cron.test.ts` — the `vi.mock('../cronStageResolver', …)` (lines 65–69) lists `isRetriableStage`; drop that key (function removed). `cronIssueFilter` is fully mocked here, so the classifier path is not exercised.
- `adws/triggers/__tests__/takeoverHandler.test.ts` and `adws/triggers/__tests__/cronIssueFilter.test.ts` — **expected to pass unchanged** (decisions preserved). Run them as regression proof; do not edit unless an assertion references a removed symbol.

### Conditional documentation (matched conditions — read before implementing)

- `app_docs/feature-gq51dc-migrate-cron-stage-from-state-file.md` — covers `cronStageResolver.ts` stage classification, `evaluateIssue()` eligibility, and how `isActiveStage()`/`isRetriableStage()` classify stages. **Primary reference for the cron-side routing.**
- `app_docs/feature-i4m1uk-orchestrator-resilie-takeover-handler-integration.md` — covers `evaluateCandidate`, `CandidateDecision`, `TakeoverDeps`, the `take_over_adwId` decision, the `worktreeReset → remoteReconcile` sequence, and SIGKILL for live-but-unlocked `*_running` PIDs. **Primary reference for the takeover-side routing.**
- `app_docs/feature-nq7174-discarded-workflow-stage-foundation.md` — terminal vs. retriable stage semantics; `cronIssueFilter.evaluateIssue` and `cronStageResolver.isRetriableStage`. Explains the `discarded`/`abandoned` distinction the taxonomy must preserve.
- `app_docs/feature-29w5wf-reclassify-abandoned-discarded-call-sites.md` — `workflowStage` write sites, terminal stages, `webhookHandlers` PR-closed writes, and the `MergeRunResult.outcome` vs `workflowStage` (cron-sweeper classification) distinction.
- `app_docs/feature-bed2tg-orchestrator-watchdog-agent-timeout.md` — `AgentTimeoutError`, `handlePhaseTimeout`, and the `phase_timeout` stage (the motivating dead-end stage). Confirms `phase_timeout` must keep its current behavior in this slice.
- `app_docs/feature-djtyv4-remote-reconcile-module.md` — `deriveStageFromRemote` wiring into `takeoverHandler` and the `take_over_adwId` derived-stage path.
- `app_docs/feature-z16ycm-add-top-level-workfl-top-level-workflow-state.md` — `workflowStage` transitions and `runPhase()` stage writes in `phaseRunner.ts` (the dynamic-stage source).
- `app_docs/feature-f704s2-dev-server-janitor-cron.md` — `devServerJanitor.ts` and `shouldCleanWorktree` kill-decision logic (the out-of-scope `isActiveStage` consumer whose behavior must be preserved).

## Implementation Plan

### Phase 1: Foundation — the classifier module

Create `adws/core/stageClassifier.ts` as a pure module. Define `StageClass`. Implement `classifyStage(stage: WorkflowStage): StageClass` as an exhaustive `switch` covering all 51 literals, with a `default` branch that performs the `const _exhaustive: never = stage` assignment (the compile-time guard) and returns the defensive fallback `'resumable'` at runtime. Implement `classifyStageString(stage: string): StageClass` that bridges the dynamic phaseRunner strings (`endsWith('_running') → 'active'`, `endsWith('_completed') → 'resumable'`) and otherwise delegates to `classifyStage`. Write the per-literal unit tests first/alongside (TDD-friendly; this is a pure function).

### Phase 2: Core implementation — reroute takeover and cron

Reroute `takeoverHandler.evaluateCandidate` to dispatch on `classifyStageString(stage)`, removing the private `isRunningStage` helper and folding the inline `stage === '…'` branches into the class switch while preserving lock-release and side-effect ordering. Reroute `cronIssueFilter.evaluateIssue` to use `classifyStageString(stage) === 'active'` / `=== 'retriable'`. Remove `isRetriableStage` from `cronStageResolver.ts`.

### Phase 3: Integration — preserve out-of-scope consumers, prove no regressions

Reimplement `isActiveStage` in `cronStageResolver.ts` as a classifier-backed compatibility bridge so `devServerJanitor.ts` and `webhookHandlers.ts` keep identical behavior. Update the two affected test files (`cronStageResolver.test.ts` drops `isRetriableStage` blocks; `trigger_cron.test.ts` drops the `isRetriableStage` mock key). Run the full validation suite to confirm the takeover/cron/janitor/webhook behavioral tests pass unchanged and the `never` guard holds under `tsc`.

## Step by Step Tasks

Execute every step in order, top to bottom.

### Step 1 — Read references and confirm the stage inventory
- Read the two primary conditional docs (`feature-gq51dc-…` and `feature-i4m1uk-…`) and skim the others listed in Relevant Files.
- Re-read `adws/types/workflowTypes.ts` lines 6–72 and confirm the 51 `WorkflowStage` literals against the classification table in this plan (Testing Strategy → Unit Tests). Confirm `adws/core/phaseRunner.ts` writes `${phaseName}_running` / `${phaseName}_completed` (the dynamic-string source).

### Step 2 — Create `adws/core/stageClassifier.ts`
- Add `export type StageClass = 'active' | 'awaiting_merge' | 'retriable' | 'resumable' | 'terminal' | 'human_gated';`.
- Implement `export function classifyStage(stage: WorkflowStage): StageClass` as an exhaustive `switch`:
  - `'active'`: `starting`, `resuming`, `build_running`, `test_running`, `review_running`, `document_running`, `install_running`.
  - `'awaiting_merge'`: `awaiting_merge`.
  - `'retriable'`: `abandoned`.
  - `'terminal'`: `completed`, `discarded`, `paused`, `paused_auth`.
  - `'human_gated'`: `merge_blocked`.
  - `'resumable'`: every remaining literal (the full list is enumerated in Testing Strategy → Unit Tests).
  - `default:` perform `const _exhaustive: never = stage;` (compile-time guard) then `return 'resumable';` (runtime defensive fallback for out-of-union strings forced in via casts). Add a `// eslint-disable` only if the unused-var lint flags `_exhaustive`; prefer `void _exhaustive;` to satisfy the "remove unused" rule.
- Implement `export function classifyStageString(stage: string): StageClass`:
  - `if (stage.endsWith('_running')) return 'active';` — covers dynamic `${phase}_running` (and is consistent with the literal `*_running` cases).
  - `if (stage.endsWith('_completed')) return 'resumable';` — covers dynamic `${phase}_completed`.
  - `return classifyStage(stage as WorkflowStage);` — remaining literals; the `never`-guarded `default` returns `'resumable'` for any genuinely unknown string.
- Add a module-level JSDoc block documenting the taxonomy, the dynamic-phaseRunner-string rationale, and that this is behavior-preserving (no stage is reclassified vs. the legacy predicates). Keep the file well under 300 lines.

### Step 3 — Write `adws/core/__tests__/stageClassifier.test.ts`
- Assert `classifyStage(stage)` for **every** `WorkflowStage` literal using an exhaustive `const EXPECTED: Record<WorkflowStage, StageClass>` map iterated with `Object.entries` (the `Record` type forces a test entry per literal — a second compile-time exhaustiveness backstop). Mirror the classification table.
- Assert `classifyStageString` for: a literal in each class; dynamic non-union strings (`'plan_running'` → `'active'`, `'plan_completed'` → `'resumable'`, `'test_completed'` → `'resumable'`, `'step-def_running'` → `'active'`); the empty string `''` → `'resumable'`; and an unknown string `'some_unknown_future_stage'` → `'resumable'`.
- Add one test documenting the guard intent: a comment-anchored test noting that omitting a `case` in `classifyStage` is a `tsc` error (the behavioral proof is Step 9's typecheck, not a runtime assertion).

### Step 4 — Reroute `takeoverHandler.ts` through the classifier
- Import `classifyStageString` (and `StageClass` if needed) from `../core/stageClassifier`. Remove the private `isRunningStage` helper (lines 96–102).
- In `evaluateCandidate`, after resolving `const stage = state.workflowStage ?? ''`, compute `const cls = classifyStageString(stage)` and dispatch (preserving exact current ordering, side effects, and lock semantics):
  - `cls === 'terminal'` → `releaseLock(); return { kind: 'skip_terminal', adwId, terminalStage: stage as 'completed' | 'discarded' | 'paused' | 'paused_auth' };` (the `terminal` class is exactly those four literals). Prefer a small `assertTerminalStage(stage)` guard over a bare cast to honor the type-safety guideline.
  - `cls === 'retriable'` → abandoned path: reset worktree (if `branchName`) → `deriveStageFromRemote` → `return { kind: 'take_over_adwId', … }` (no kill; lock retained).
  - `cls === 'active'` → running path: SIGKILL if `pid` live and not lock holder → reset worktree (if `branchName`) → `deriveStageFromRemote` → `take_over_adwId` (lock retained).
  - else (`'awaiting_merge' | 'human_gated' | 'resumable'`, plus empty-string `stage`) → `return { kind: 'spawn_fresh' }` (lock retained for caller's spawn).
- Verify the decision tree matches the original branch-for-branch (see Testing Strategy → Edge Cases). The existing `takeoverHandler.test.ts` (including the `'some_unknown_future_stage' as never` → `spawn_fresh` case at line 351) must pass unchanged.

### Step 5 — Reroute `cronIssueFilter.ts` through the classifier
- Replace the import on line 11 (`isActiveStage, isRetriableStage`) with `classifyStageString` from `../core/stageClassifier` (keep `resolveIssueWorkflowStage` import).
- Replace `if (isActiveStage(stage))` (line 145) with `if (classifyStageString(stage) === 'active')` and `if (isRetriableStage(stage))` (line 148) with `if (classifyStageString(stage) === 'retriable')`. Leave the inline `awaiting_merge`/`discarded`/`merge_blocked`/`completed`/`paused` checks and all eligibility/reason logic untouched.
- Confirm decisions are unchanged for every stage (see Edge Cases): only the log `reason` annotation for `resuming` (`adw_stage:resuming` → `active`) and `*_completed` (`active` → `adw_stage:<stage>`) shifts; both remain `eligible: false`. No existing test asserts those reasons (verified).

### Step 6 — Remove `isRetriableStage`, bridge `isActiveStage` in `cronStageResolver.ts`
- Delete `isRetriableStage` (lines 82–84).
- Reimplement `isActiveStage(stage: string): boolean` as a classifier-backed bridge that preserves the exact historical set `{starting, *_running, *_completed}` (and excludes `resuming`):
  ```ts
  import { classifyStageString } from '../core/stageClassifier';
  // Compatibility predicate for devServerJanitor + webhookHandlers: the historical
  // "in progress" set {starting, *_running, *_completed}. Backed by classifyStageString
  // so the family matching lives in one place; 'resuming' stays excluded and *_completed
  // stays included to match legacy janitor/webhook grace semantics exactly.
  export function isActiveStage(stage: string): boolean {
    const cls = classifyStageString(stage);
    if (cls === 'active') return stage !== 'resuming';
    if (cls === 'resumable') return stage.endsWith('_completed');
    return false;
  }
  ```
- Keep the existing JSDoc updated to describe the new compatibility role. Do not change `devServerJanitor.ts` or `webhookHandlers.ts`.

### Step 7 — Update affected test files
- `adws/triggers/__tests__/cronStageResolver.test.ts`: remove the two `isRetriableStage` `describe` blocks and the `isRetriableStage` import; remove the single `isRetriableStage('awaiting_merge')` assertion block. Leave all `isActiveStage` blocks intact — they pass unchanged via the bridge.
- `adws/triggers/__tests__/trigger_cron.test.ts`: in the `vi.mock('../cronStageResolver', …)` factory (lines 65–69), remove the `isRetriableStage: vi.fn(() => false)` entry. Leave `resolveIssueWorkflowStage` and `isActiveStage`.

### Step 8 — Refactor pass for coding guidelines
- Re-read `.adw/coding_guidelines.md` and ensure the new/changed code uses guard clauses (≤2 nesting depth), pure functions, explicit types (no `any`), and no unused imports. Confirm `evaluateCandidate` reads top-to-bottom as a guarded dispatch, not a nested tree.

### Step 9 — Run the Validation Commands
- Run every command in the Validation Commands section. The `bunx tsc --noEmit -p adws/tsconfig.json` run is the **proof of acceptance criterion 1** (the `never` guard compiles only when all literals are classified). The full `bun run test:unit` run is the proof of criteria 3 & 4. Fix any failure before considering the task complete.
- As a manual exhaustiveness sanity check, temporarily delete one `case` from `classifyStage`, confirm `tsc` errors on the `never` assignment, then restore it. (Do not leave this change in.)

## Testing Strategy

### Unit Tests

`.adw/project.md` declares `## Unit Tests: enabled`, so unit tests are in scope.

**`adws/core/__tests__/stageClassifier.test.ts` (new)** — the authoritative per-literal classification assertions. Use an exhaustive `Record<WorkflowStage, StageClass>` expectation map so the test file itself fails to compile if a literal is added without an expected class:

| StageClass | `WorkflowStage` literals |
|---|---|
| `active` | `starting`, `resuming`, `build_running`, `test_running`, `review_running`, `document_running`, `install_running` |
| `awaiting_merge` | `awaiting_merge` |
| `retriable` | `abandoned` |
| `terminal` | `completed`, `discarded`, `paused`, `paused_auth` |
| `human_gated` | `merge_blocked` |
| `resumable` | `classified`, `branch_created`, `plan_building`, `plan_created`, `planFile_created`, `plan_committing`, `build_progress`, `build_completed`, `build_committing`, `pr_creating`, `pr_created`, `error`, `test_failed`, `test_resolving`, `test_passed`, `unverified`, `stack_incoherent`, `review_passed`, `review_failed`, `review_patching`, `document_completed`, `document_failed`, `token_limit_recovery`, `compaction_recovery`, `test_compaction_recovery`, `review_compaction_recovery`, `plan_validating`, `plan_validated`, `plan_resolving`, `plan_resolved`, `plan_validation_failed`, `plan_aligning`, `plan_aligned`, `install_completed`, `install_failed`, `resumed`, `phase_timeout` |

Plus `classifyStageString` cases: dynamic `*_running`/`*_completed` non-union strings, empty string, and unknown string (all listed in Step 3).

**Regression (must pass unchanged — do not edit except for removed symbols):**
- `adws/triggers/__tests__/takeoverHandler.test.ts` (+ `.integration.test.ts`) — every `evaluateCandidate` branch: `defer_live_holder`, `spawn_fresh` (no adwId / null state / unknown stage), `skip_terminal` (`completed`/`discarded`/`paused`/`paused_auth`), `take_over_adwId` from `abandoned` and from `*_running` (live-PID SIGKILL, dead-PID, no-PID), and the `worktreeReset → remoteReconcile` ordering.
- `adws/triggers/__tests__/cronIssueFilter.test.ts`, `triggerCronAwaitingMerge.test.ts` — `awaiting_merge` → `merge`, `discarded`/`merge_blocked` exclusions, `abandoned` → `spawn`, grace-period and label-recovery gates.
- `adws/triggers/__tests__/devServerJanitor.test.ts`, `webhookHandlers.test.ts` — `isActiveStage`-driven grace/clean decisions (proves the bridge preserves the historical set).

### Edge Cases

- **`phase_timeout`** — must classify as `resumable` (cron excludes via fallback; takeover `spawn_fresh`), exactly its current behavior. Reclassification to `resumable`-with-resume-in-place is a *later* slice; this slice must not change its decision.
- **Dynamic phaseRunner stages** (`plan_running`, `plan_completed`, `test_completed`, `review_completed`, `step-def_running`, …) — not `WorkflowStage` literals but persisted at runtime. `classifyStageString` must route `*_running` → `active` and `*_completed` → `resumable`, preserving `isActiveStage`/takeover behavior. This is the single most important non-obvious test surface.
- **Empty string `''`** (state with no `workflowStage`) — takeover currently falls to `spawn_fresh`; `classifyStageString('')` → `'resumable'` → `spawn_fresh`. Preserved.
- **Unknown/out-of-union string** (`'some_unknown_future_stage' as never` in the takeover test) — `classifyStageString` → `'resumable'` → `spawn_fresh`. Preserved; the existing test passes unchanged.
- **`resuming` vs `*_completed` asymmetry** — `resuming` is `active` (takeover reclaims it) but is excluded from `isActiveStage`'s legacy set by the bridge's `stage !== 'resuming'` guard; `*_completed` is `resumable` (takeover `spawn_fresh`) but included in `isActiveStage`'s legacy set by the bridge's `endsWith('_completed')` check. These two opposite memberships are why the bridge exists and why the cron/takeover "active" notions are intentionally different.
- **`terminal` discriminator integrity** — the `terminal` class is exactly `{completed, discarded, paused, paused_auth}`, matching the `skip_terminal.terminalStage` union; no dynamic string maps to `terminal`, so the takeover cast/guard is sound.

## Acceptance Criteria

- `adws/core/stageClassifier.ts` exports `classifyStage(stage: WorkflowStage): StageClass` as an exhaustive `switch`; deleting any `case` produces a `tsc` compile error on the `never` assignment (manually verified in Step 9).
- `takeoverHandler.evaluateCandidate` and `cronIssueFilter.evaluateIssue` consume `classifyStageString` (no remaining `isRunningStage`/`isRetriableStage` references; cron no longer imports the bespoke predicates).
- `isRetriableStage` is deleted; `isActiveStage` is a classifier-backed bridge retained only for `devServerJanitor`/`webhookHandlers`.
- Every existing takeover and cron behavioral test passes **unchanged** (only the removed-`isRetriableStage` test/mock entries are edited).
- `adws/core/__tests__/stageClassifier.test.ts` asserts exactly one `StageClass` for every `WorkflowStage` literal via an exhaustive `Record<WorkflowStage, StageClass>` map.
- `bun run lint`, both `tsc` typechecks, `bun run test:unit`, and `bun run build` all pass.

## Validation Commands

Execute every command to validate the feature works correctly with zero regressions. Commands are from `.adw/commands.md`.

- `bun run lint` — ESLint; no new lint errors (unused vars, `any`, etc.).
- `bunx tsc --noEmit` — root typecheck.
- `bunx tsc --noEmit -p adws/tsconfig.json` — **ADW typecheck; this is the proof of the exhaustiveness `never` guard** (acceptance criterion 1).
- `bunx vitest run adws/core/__tests__/stageClassifier.test.ts` — the new per-literal classification suite passes.
- `bunx vitest run adws/triggers/__tests__/takeoverHandler.test.ts adws/triggers/__tests__/cronIssueFilter.test.ts adws/triggers/__tests__/cronStageResolver.test.ts adws/triggers/__tests__/trigger_cron.test.ts adws/triggers/__tests__/devServerJanitor.test.ts adws/triggers/__tests__/webhookHandlers.test.ts adws/triggers/__tests__/triggerCronAwaitingMerge.test.ts` — the full cron/takeover/janitor/webhook regression surface passes (behavior-preservation proof).
- `bun run test:unit` — the complete Vitest suite passes (zero regressions).
- `bun run build` — `tsc` build succeeds with no errors.

## Notes

- **Coding guidelines.** `.adw/coding_guidelines.md` applies. The classifier is a pure function (no side effects), explicitly typed (no `any`), and uses a flat `switch`. `evaluateCandidate` is refactored to guard-clause dispatch (≤2 nesting depth). Keep `stageClassifier.ts` well under the 300-line limit. Use `void _exhaustive;` (not an eslint-disable) to satisfy "remove unused variables" while keeping the `never` assignment.
- **Why `isActiveStage` survives.** Fully deleting it would require migrating `devServerJanitor` and `webhookHandlers` onto the `active` class, which has a *different* set than the historical `isActiveStage` (`active` adds `resuming` and drops `*_completed`). Because `phaseRunner` writes a live orchestrator's stage as `${phase}_completed` between phases, dropping `*_completed` from the janitor's `isNonTerminal` could let `shouldCleanWorktree` kill a *live* orchestrator (`isNonTerminal && orchestratorAlive` no longer short-circuits). That is a real, harmful behavior change, so it is out of scope for this behavior-preserving slice. The bridge keeps those two consumers byte-for-byte identical.
- **Deliberately out of scope (follow-ups).**
  - `hungOrchestratorDetector.ts:91` has its own `endsWith('_running')` family match (a *third*, narrower set than either `isActiveStage` or takeover's running set). Routing it through the classifier would change its set; leave it for a dedicated follow-up.
  - Reclassifying `phase_timeout` (and other recovery stages) to enable resume-in-place is the *next* PRD slice; this slice only establishes the taxonomy and the compile-time guard.
  - Migrating `devServerJanitor`/`webhookHandlers` off the `isActiveStage` bridge once the `active`-set delta is validated.
- **Parent PRD.** The referenced `specs/prd/stage-recovery-resume-in-place.md` does not yet exist in the repo (related PRDs such as `orchestrator-coordination-resilience.md` do). This plan infers the taxonomy from the issue body, the `UBIQUITOUS_LANGUAGE.md` terms (`Stage`, `Takeover`, `Merge Blocked` = "terminal-until-human"), and the existing predicate semantics. If the PRD lands and defines the `StageClass` names or members differently, reconcile the taxonomy table before implementing.
- **No new libraries.** Pure TypeScript over existing types. (`.adw/commands.md` library install command is `bun add <package>` if ever needed — it is not needed here.)
- **Ubiquitous language.** Consider adding `StageClass` / `Stage Classification` as a term to `UBIQUITOUS_LANGUAGE.md` in a later docs pass; the six class names (`active`, `awaiting_merge`, `retriable`, `resumable`, `terminal`, `human_gated`) should become the canonical vocabulary for stage recovery semantics. `human_gated = {merge_blocked}` aligns with the existing "Merge Blocked … recoverable only via an explicit Retry Directive" definition.
