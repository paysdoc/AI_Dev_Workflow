# Bug: `phase_timeout` is a dead-end stage — timed-out workflows are stranded forever

## Metadata
issueNumber: `637`
adwId: `tg4om4-fix-make-phase-timeo`
issueJson: `{"number":637,"title":"fix: make phase_timeout a recoverable stage (un-strand timed-out workflows)","body":"## Parent PRD\n\n`specs/prd/stage-recovery-resume-in-place.md`\n\n## What to build\n\nReclassify `phase_timeout` from terminal-skip to `resumable` and add the cron/takeover recovery branch so a timed-out workflow is actually picked up on the next tick (initially reusing the existing reset-from-remote recovery — resume-in-place arrives in a later slice). Correct the two comments that falsely promise re-entry so they describe real behavior. See PRD \"Problem Statement\" and \"Implementation Decisions\" (truthful comments).\n\nEnd-to-end: a workflow stranded at `phase_timeout` is recovered automatically instead of sitting forever.\n\n## Acceptance criteria\n\n- [ ] `phase_timeout` classified `resumable`; takeover/cron has a branch that recovers it\n- [ ] A `phase_timeout` workflow with a dead orchestrator is picked up on the next cron tick\n- [ ] The \"Phase Timeout\" comment and the stage's type documentation describe the actual recovery\n- [ ] Tests cover the new takeover branch for `phase_timeout`\n\n## Blocked by\n\n- Blocked by #636\n\n## User stories addressed\n\n- User story 1\n- User story 2","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-06-19T17:38:11Z","comments":[],"actionableComment":null}`

## Bug Description

When the per-agent watchdog fires (`adws/agents/claudeAgent.ts` kills the wedged Claude process tree), `handlePhaseTimeout` (`adws/phases/workflowCompletion.ts:177`) writes the top-level `workflowStage: 'phase_timeout'`, posts a "Phase Timeout" comment promising re-entry, and calls `process.exit(0)` — the orchestrator process **dies**, leaving the issue's state file resting at `phase_timeout` with a dead PID.

**Expected behavior:** on the next cron tick (or webhook event), a `phase_timeout` workflow with a dead orchestrator is picked up and recovered automatically — exactly as an `abandoned` workflow is.

**Actual behavior:** the issue is **never** recovered. The cron backlog filter classifies `phase_timeout` as `resumable`, which falls through every eligibility branch to the catch-all `return { eligible: false, reason: 'adw_stage:phase_timeout' }` — so cron excludes it on every tick (logged as `filtered: #N(adw_stage:phase_timeout)`). Because cron never marks it eligible, the takeover gate (`evaluateCandidate`) is never even consulted; and even if it were, `evaluateCandidate` maps `resumable` to `spawn_fresh`, not to the reset-from-remote takeover. The workflow sits stranded indefinitely — the documented root cause of the #612 incident (it stranded a real workflow for hours). The "Phase Timeout" issue comment and the `phase_timeout` type doc both **falsely promise** "the workflow will re-enter this phase on the next cron tick / webhook event," which never happens.

## Problem Statement

`phase_timeout` is a real resting stage for a **dead** orchestrator, but no recovery consumer treats it as recoverable:

1. **Cron pre-filter** (`adws/triggers/cronIssueFilter.ts` → `evaluateIssue`): only `classifyStageString(stage) === 'retriable'` (i.e. `abandoned`) is made eligible for a spawn. `phase_timeout` is classified `resumable`, so it hits the final `return { eligible: false, reason: \`adw_stage:${stage}\` }` and is excluded forever.
2. **Takeover gate** (`adws/triggers/takeoverHandler.ts` → `evaluateCandidate`): dispatches on the `StageClass`. `terminal` → `skip_terminal`, `retriable` → reset→reconcile→`take_over_adwId`, `active` → SIGKILL-if-live→reset→reconcile→`take_over_adwId`, everything else (incl. `resumable`) → `spawn_fresh`. `phase_timeout` (resumable) therefore never reaches the reset-from-remote recovery.
3. **Truthfulness**: two human/maintainer-facing comments promise automatic re-entry that does not occur.

This is the exact "dead-end stage" class of bug that #636 introduced the exhaustive `classifyStage` to *prevent in the future* — but #636 was explicitly **behavior-preserving** (it classified `phase_timeout` as `resumable` to reproduce the existing broken behavior). #637 is the follow-up slice that actually wires `phase_timeout` into a recovery path.

## Solution Statement

Keep `phase_timeout` classified `resumable` in `classifyStage` (no taxonomy change — the acceptance criterion "classified `resumable`" is already satisfied by #636), and **add a per-consumer recovery branch keyed on the raw `phase_timeout` stage string** in the two consumers that currently strand it. This "pins the per-consumer recovery decision rather than changing the `StageClass`," so no *other* `resumable` stage (e.g. `plan_created`, `build_completed`) changes behavior:

1. **Cron filter** — in `evaluateIssue`, add `if (stage === 'phase_timeout') return { eligible: true, action: 'spawn', adwId }` immediately after the existing `retriable` branch (before the unknown-stage fallback). This makes a stranded `phase_timeout` issue eligible so `trigger_cron` routes it through `evaluateCandidate`.
2. **Takeover** — in `evaluateCandidate`, add `if (stage === 'phase_timeout')` that performs the **existing reset-from-remote recovery** (worktree reset → `deriveStageFromRemote` → `take_over_adwId`), reusing the same path as `abandoned`/`retriable`. Extract that 3-step tail into a small private helper shared by the `retriable`, `active`, and new `phase_timeout` branches (DRY; behavior-preserving for the first two). No SIGKILL is needed because `handlePhaseTimeout` already `process.exit(0)`'d the orchestrator (dead PID), and the live-holder case is already handled by the spawn-lock acquisition at the top of `evaluateCandidate`.
3. **Truthful comments** — correct the three comments that promise re-entry so they describe the *actual* recovery (reset-from-remote takeover on the next cron tick), not literal in-place phase re-entry (that "resume-in-place" behavior is a later slice).

This fixes both cron and webhook spawn paths in one place for the takeover side, because `webhookGatekeeper.ts` also routes through `evaluateCandidate`. Resume-in-place and N-cap timeout-loop escalation are explicitly **out of scope** (later PRD slices).

## Steps to Reproduce

There is no single CLI command; the bug lives in pure stage-routing functions, so reproduction is via the unit suite plus a conceptual operational trace.

**Operational trace (what happens in production):**
1. A workflow wedges; the per-phase watchdog fires and kills the Claude process tree.
2. `handlePhaseTimeout` writes `workflowStage: 'phase_timeout'`, posts the "Phase Timeout" comment, and `process.exit(0)` (orchestrator dies).
3. On every subsequent cron tick, `evaluateIssue` returns `{ eligible: false, reason: 'adw_stage:phase_timeout' }`; the cron log shows `filtered: #637(adw_stage:phase_timeout)`.
4. The issue is never re-spawned. It is stranded.

**Unit reproduction (RED before the fix):**
- `evaluateIssue(issue, now, …)` where the injected resolver returns `{ stage: 'phase_timeout', adwId: 'tg4om4-…', lastActivityMs: <older than grace> }` currently returns `{ eligible: false, reason: 'adw_stage:phase_timeout' }`. It should return `{ eligible: true, action: 'spawn', adwId: 'tg4om4-…' }`.
- `evaluateCandidate({ issueNumber, repoInfo }, deps)` where `readTopLevelState` returns a state with `workflowStage: 'phase_timeout'` and a `branchName` currently returns `{ kind: 'spawn_fresh' }` and never calls `resetWorktree`/`deriveStageFromRemote`. It should return `{ kind: 'take_over_adwId', adwId, derivedStage }` and call `resetWorktree` before `deriveStageFromRemote`.

## Root Cause Analysis

`phase_timeout` was added by the watchdog feature (#521/`feature-bed2tg`) as a resting stage written on watchdog kill, but it was added to the `WorkflowStage` union **after** the recovery predicates were written, and those predicates were closed allowlists (`isRetriableStage === 'abandoned'`, etc.) with no exhaustiveness guard — so it silently fell into "none of the above" and was excluded everywhere. #636 replaced the predicates with an exhaustive `classifyStage`, which now *guarantees* every stage is classified — but it deliberately preserved the existing (broken) behavior by mapping `phase_timeout → resumable`, where:

- `resumable` in the **cron filter** → falls through to the unknown-stage exclusion.
- `resumable` in **takeover** → `spawn_fresh` (not reset-from-remote takeover).

So the root cause is: **`phase_timeout` rests as a recoverable-but-dead state, yet both recovery consumers route the `resumable` class away from recovery.** The fix is to give `phase_timeout` an explicit recovery decision in each consumer (reusing the proven `abandoned` reset-from-remote path), while leaving its `resumable` classification — and every other `resumable` stage — untouched.

## Relevant Files

Use these files to fix the bug:

### Source — the fix
- `adws/triggers/cronIssueFilter.ts` — `evaluateIssue` (lines ~76–154). Add the `phase_timeout` eligibility branch after the `retriable` branch (line ~149–151) and before the unknown-stage fallback (line ~152–153). This is the cron-side fix (un-strands the backlog sweep).
- `adws/triggers/takeoverHandler.ts` — `evaluateCandidate` (lines ~99–177). Add the `phase_timeout` branch and extract the shared `reset → deriveStageFromRemote → take_over_adwId` tail into a private helper reused by the `retriable` (line ~144–151), `active` (line ~154–173), and new `phase_timeout` branches. This is the takeover-side fix (covers both cron and webhook spawn paths).
- `adws/types/workflowTypes.ts` — line 71, the `phase_timeout` type doc comment (currently `// Agent watchdog timeout — phase marked failed; resume re-enters on next cron / webhook`). Correct it to describe reset-from-remote recovery. **Comment-only; do not change the union member itself.**
- `adws/github/workflowCommentsIssue.ts` — `formatPhaseTimeoutComment` (line ~340–344). Correct the user-facing "Phase Timeout" comment string that promises "The workflow will re-enter this phase on the next cron tick / webhook event."
- `adws/phases/workflowCompletion.ts` — `handlePhaseTimeout` JSDoc (lines 173–176, "...exits 0 so the next cron tick re-enters the failed phase"). Align this third comment for truthfulness (same false promise). **Comment-only; the function body is unchanged — `process.exit(0)` stays.**

### Source — read-only reference (do NOT modify)
- `adws/core/stageClassifier.ts` — `classifyStage`/`classifyStageString`. `phase_timeout` stays `resumable` (line 104–105). The module docstring (line 11–12) already anticipates this slice ("phase_timeout → resumable-with-resume-in-place"); no code change here. Confirm the classification is unchanged.
- `adws/triggers/cronStageResolver.ts` — `resolveIssueWorkflowStage` returns the raw `stage` string the filter switches on; `isActiveStage` bridge is irrelevant to `phase_timeout`. No change.
- `adws/triggers/trigger_cron.ts` — lines 255–334: the dispatch loop. Confirms an eligible (`action: 'spawn'`) candidate is gated through `evaluateCandidate`, and `take_over_adwId` spawns `adwSdlc.tsx` with the existing adwId + `derivedStage`. No change.
- `adws/triggers/webhookGatekeeper.ts` — line ~100: webhook spawn path also routes through `evaluateCandidate`, so the takeover fix covers it automatically. No change.
- `adws/core/remoteReconcile.ts` — `deriveStageFromRemote` (the reset-from-remote stage derivation reused by the new branch). No change.

### Tests
- `adws/triggers/__tests__/takeoverHandler.test.ts` — add a `take_over_adwId from phase_timeout` describe block mirroring the existing `take_over_adwId from abandoned` block (line ~178–246): use `makeState({ workflowStage: 'phase_timeout', branchName: '…' })` + `makeDeps(...)`, assert `kind === 'take_over_adwId'`, `resetWorktree` called before `deriveStageFromRemote`, branchName passed through, lock NOT released, and (defensive) that a live PID is **not** SIGKILL'd on this branch.
- `adws/triggers/__tests__/cronIssueFilter.test.ts` — add a test that a `phase_timeout` resolution (older than the grace period) yields `{ eligible: true, action: 'spawn', adwId }`, plus a `filterEligibleIssues` assertion that the issue appears in `eligible` (not in `filteredAnnotations` as `adw_stage:phase_timeout`).
- `adws/core/__tests__/stageClassifier.test.ts` — **no change**; the `EXPECTED` map keeps `phase_timeout: 'resumable'`. It must still pass (proves the classification is intentionally unchanged).
- Regression (must pass unchanged): the existing `take_over_adwId from abandoned` / `*_running` blocks in `takeoverHandler.test.ts`, and the `cronIssueFilter.test.ts` / `triggerCronAwaitingMerge.test.ts` suites — proving no other `resumable`/`retriable`/`active` stage changed behavior.

### Conditional documentation (matched conditions — read before implementing)
- `app_docs/feature-d0hv98-exhaustive-stage-classifier.md` — **primary; `Owns` all four stage-routing files** (`stageClassifier.ts`, `cronStageResolver.ts`, `cronIssueFilter.ts`, `takeoverHandler.ts`). Conditions explicitly include "modifying `evaluateCandidate`… stage-dispatch", "modifying `evaluateIssue`… stage eligibility", and "troubleshooting a new stage that falls through all recovery paths (the `phase_timeout` dead-end class of bug)". The document phase must update *this* doc (docs-ownership routing), not spawn a new one.
- `app_docs/feature-bed2tg-orchestrator-watchdog-agent-timeout.md` — `AgentTimeoutError`, `handlePhaseTimeout`, the `phase_timeout` stage (the motivating dead-end). The comment corrections live here conceptually.
- `app_docs/feature-i4m1uk-orchestrator-resilie-takeover-handler-integration.md` — `evaluateCandidate`, `CandidateDecision`, `TakeoverDeps`, the `take_over_adwId` decision and the `worktreeReset → remoteReconcile` sequence (the recovery path being reused), and the cron/webhook "mandatory takeover gate".
- `app_docs/feature-gq51dc-migrate-cron-stage-from-state-file.md` — `cronStageResolver.ts` / `evaluateIssue()` eligibility (cron-side routing).
- `app_docs/feature-djtyv4-remote-reconcile-module.md` — `deriveStageFromRemote` wiring into `takeoverHandler`.
- `app_docs/feature-nq7174-discarded-workflow-stage-foundation.md` — terminal vs. retriable stage semantics (why `phase_timeout` is recoverable, not terminal).

### New Files
None. All changes are edits to existing source and test files.

## Step by Step Tasks

IMPORTANT: Execute every step in order, top to bottom.

### Step 1 — Read references and confirm the contract
- Read `.adw/coding_guidelines.md` and the matched conditional docs above (at minimum `feature-d0hv98`, `feature-i4m1uk`, `feature-bed2tg`).
- Confirm in `adws/core/stageClassifier.ts` that `phase_timeout` maps to `resumable` (line 104–105) and that this will **stay**. Confirm in `adws/triggers/trigger_cron.ts` (lines 255–334) that an eligible `action: 'spawn'` candidate is routed through `evaluateCandidate`, and that `take_over_adwId` re-spawns the existing adwId. Confirm `adws/triggers/webhookGatekeeper.ts` also routes through `evaluateCandidate`.

### Step 2 — Add the takeover recovery branch (`evaluateCandidate`)
- In `adws/triggers/takeoverHandler.ts`, extract the repeated `reset → reconcile → take_over` tail into a private helper, e.g.:
  ```ts
  function recoverViaResetFromRemote(
    d: TakeoverDeps,
    input: EvaluateCandidateInput,
    adwId: string,
    state: AgentState,
  ): CandidateDecision {
    if (state.branchName) {
      const wtPath = d.getWorktreePath(state.branchName);
      d.resetWorktree(wtPath, state.branchName);
    }
    const derivedStage = d.deriveStageFromRemote(input.issueNumber, adwId, input.repoInfo);
    return { kind: 'take_over_adwId', adwId, derivedStage };
  }
  ```
- Replace the inline tail in the existing `retriable` branch and `active` branch (after the SIGKILL) with calls to `recoverViaResetFromRemote(d, input, adwId, state)`. This must be byte-for-byte behavior-preserving for those two branches (proven by their existing tests).
- Add a new branch for `phase_timeout`, placed after the `retriable` branch, keyed on the **raw stage string** (since its `StageClass` is `resumable`, not `retriable`):
  ```ts
  // phase_timeout: the watchdog killed the agent and handlePhaseTimeout exited the
  // orchestrator (process.exit(0)), so the PID is dead. Recover by reusing the
  // abandoned/retriable reset-from-remote path. (Resume-in-place is a later slice —
  // issue #637 / the stage-recovery-resume-in-place PRD.)
  if (stage === 'phase_timeout') {
    return recoverViaResetFromRemote(d, input, adwId, state);
  }
  ```
- Do NOT add a SIGKILL for `phase_timeout` (the orchestrator already exited; the live-holder case is handled by `acquireIssueSpawnLock` at the top). Keep the final `spawn_fresh` fallthrough for `awaiting_merge`/`human_gated`/other `resumable` stages unchanged.

### Step 3 — Add the cron eligibility branch (`evaluateIssue`)
- In `adws/triggers/cronIssueFilter.ts`, immediately after the `if (classifyStageString(stage) === 'retriable') { … }` block (line ~149–151) and before the final unknown-stage `return { eligible: false, reason: \`adw_stage:${stage}\` }`, add:
  ```ts
  // phase_timeout: a watchdog-killed workflow whose orchestrator exited. Make it
  // eligible so trigger_cron routes it through evaluateCandidate (takeover), which
  // recovers it via reset-from-remote. Without this it falls through to the
  // unknown-stage exclusion below and strands forever (issue #637).
  if (stage === 'phase_timeout') {
    return { eligible: true, action: 'spawn', adwId: resolution.adwId ?? undefined };
  }
  ```
- Leave all earlier inline checks (`awaiting_merge`, `discarded`, `merge_blocked`, `completed`, `paused`, grace period, `active`/`retriable`) untouched. The grace-period gate stays in front of this branch by design (mirrors `abandoned`): recovery happens on the first tick after the grace window, which satisfies "picked up on the next cron tick."

### Step 4 — Correct the three re-entry comments to describe real recovery
- `adws/types/workflowTypes.ts:71` — replace the comment with truthful wording, e.g.:
  `// Agent watchdog timeout — phase marked failed; orchestrator exits. Recovered on the next`
  `// cron tick via reset-from-remote takeover (resume-in-place is a later slice).`
- `adws/github/workflowCommentsIssue.ts` `formatPhaseTimeoutComment` (line ~343) — replace "The workflow will re-enter this phase on the next cron tick / webhook event." with an accurate description, e.g. "The workflow will be recovered automatically on the next cron tick: the worktree is reset to the remote and the run resumes from the reconciled stage." Keep the `:warning: Phase Timeout` heading, the `${phase}`/`${minutes}` interpolation, the `**ADW ID:**` line, the running-token footer, and `ADW_SIGNATURE` intact.
- `adws/phases/workflowCompletion.ts:173–176` — update the `handlePhaseTimeout` JSDoc so it no longer claims "re-enters the failed phase"; describe that it exits 0 and the next cron tick recovers the run via reset-from-remote takeover. **Do not change the function body** (`process.exit(0)` and the state/comment writes stay).

### Step 5 — Add tests for the new takeover branch (acceptance criterion 4)
- In `adws/triggers/__tests__/takeoverHandler.test.ts`, add `describe('take_over_adwId from phase_timeout', …)` mirroring the `abandoned` block:
  - returns `{ kind: 'take_over_adwId' }` carrying `adwId` and the derived stage for `makeState({ workflowStage: 'phase_timeout', branchName: 'feature-issue-637-x' })`.
  - `resetWorktree` is called before `deriveStageFromRemote` (order enforced).
  - the `branchName` from state is passed to `resetWorktree`; when `branchName` is undefined, `resetWorktree` is skipped but `deriveStageFromRemote` is still called.
  - the spawn lock is **not** released on takeover.
  - defensive: a `phase_timeout` state with a live `pid` does **not** call `killProcess` (no SIGKILL on this branch).
- In `adws/triggers/__tests__/cronIssueFilter.test.ts`, add tests:
  - `evaluateIssue` with an injected resolver returning `{ stage: 'phase_timeout', adwId: 'tg4om4', lastActivityMs: <old> }` returns `{ eligible: true, action: 'spawn', adwId: 'tg4om4' }`.
  - `filterEligibleIssues` includes that issue in `eligible` and NOT in `filteredAnnotations` as `#N(adw_stage:phase_timeout)`.
- Do **not** edit `adws/core/__tests__/stageClassifier.test.ts` — confirm it still asserts `phase_timeout: 'resumable'` and passes.

### Step 6 — Refactor pass for coding guidelines
- Re-read `.adw/coding_guidelines.md`. Confirm: the new helper is pure-ish (only injected I/O), explicitly typed (no `any`), guard-clause style (≤2 nesting depth); `evaluateCandidate`/`evaluateIssue` still read top-to-bottom as guarded dispatch; no unused imports; files stay well under 300 lines.

### Step 7 — Run the Validation Commands
- Run every command in **Validation Commands** below. The two `tsc` typechecks must pass (the `phase_timeout` branches use existing types; no `never`-guard regression). The targeted vitest runs are the proof of acceptance criteria 1, 2, and 4; the full `bun run test:unit` is the zero-regression proof. Fix any failure before considering the task complete.

## Validation Commands

Execute every command to validate the bug is fixed with zero regressions. Commands are from `.adw/commands.md`.

- `bun run lint` — ESLint; no new lint errors (unused vars, `any`, etc.).
- `bunx tsc --noEmit` — root typecheck passes.
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW typecheck passes (the exhaustive `classifyStage` `never` guard still holds; `phase_timeout` remains classified).
- `bunx vitest run adws/triggers/__tests__/takeoverHandler.test.ts` — the new `phase_timeout` takeover branch passes **and** the existing `abandoned`/`*_running`/`skip_terminal`/`spawn_fresh` blocks pass unchanged (reproduces the bug as RED before the Step 2 fix, GREEN after).
- `bunx vitest run adws/triggers/__tests__/cronIssueFilter.test.ts` — the new `phase_timeout` eligibility test passes and existing filter tests pass unchanged (RED before the Step 3 fix, GREEN after).
- `bunx vitest run adws/core/__tests__/stageClassifier.test.ts` — passes **unchanged** (`phase_timeout` stays `resumable`).
- `bunx vitest run adws/triggers/__tests__/trigger_cron.test.ts adws/triggers/__tests__/triggerCronAwaitingMerge.test.ts adws/triggers/__tests__/webhookHandlers.test.ts adws/triggers/__tests__/devServerJanitor.test.ts` — cron/webhook/janitor regression surface passes (no collateral behavior change).
- `bun run test:unit` — the complete Vitest suite passes (zero regressions).
- `bun run build` — `tsc` build succeeds with no errors.

## Notes

- **Coding guidelines.** `.adw/coding_guidelines.md` applies: pure functions, explicit types (no `any`), guard clauses (≤2 nesting), DRY (the extracted `recoverViaResetFromRemote` helper removes the would-be third copy of the reset→reconcile→take_over tail), no unused imports, files <300 lines.
- **Why keep `phase_timeout` as `resumable` (not reclassify to `retriable`).** The acceptance criterion says "classified `resumable`," and #636 already maps it there. The recovery decision is pinned **per consumer** (a raw-stage `=== 'phase_timeout'` branch in cron and takeover), not by moving it into the `retriable` class — that keeps every other `resumable` stage (`plan_created`, `build_completed`, …) excluded/`spawn_fresh` exactly as today, and gives the future resume-in-place slice a single, named seam to change. (Matches the cron/takeover stage-predicate divergence lesson: pin per-consumer recovery decisions, not the `StageClass`.)
- **Both cron and webhook are covered.** The takeover fix lands in `evaluateCandidate`, the mandatory gate for both `trigger_cron` and `webhookGatekeeper`. The cron *pre-filter* fix (`evaluateIssue`) is cron-only because the webhook is event-triggered and has no backlog pre-filter. After the fix, the corrected comments accurately describe cron-tick recovery (a stranded issue with no new activity is recovered by the cron sweep, not by a webhook event).
- **Explicitly out of scope (later PRD slices).** (1) *Resume-in-place* — actually re-entering the timed-out phase in the existing worktree instead of reset-from-remote takeover; the corrected comments are worded to NOT promise this. (2) *N-cap timeout-loop escalation* — a phase that repeatedly times out will repeatedly recover (same characteristic as `abandoned` today); a bounded retry/escalation is deferred. Do not add either here.
- **Worktree hygiene (recurring incident — important).** This fresh worktree already contains out-of-scope working-tree modifications that diverge from `origin/dev`: `.claude/commands/document.md` (~120 lines), `.claude/commands/adw_init.md` (~11 lines), and `README.md`. These are unrelated to #637 and have historically been swept into bug PRs by accident (the "worktree born with dependency reversion" pattern, seen on #612/#636/#641). The build/commit step for #637 must stage **only** the stage-recovery source/test/doc files listed above — do **not** `git add -A`/`git commit -am` these reverted command files into this PR. If review uses `git diff origin/dev`, blocker any out-of-scope command-file revert.
- **Parent PRD missing.** `specs/prd/stage-recovery-resume-in-place.md` (referenced by the issue) does not exist in the repo (as already noted in the #636 plan). This plan infers the slice boundary from the issue body, the #636 plan (`specs/issue-636-…-exhaustive-stage-classifier.md`), the #521 watchdog feature doc (`feature-bed2tg`), and the existing predicate semantics. If the PRD lands later and defines the recovery contract differently, reconcile before/at review.
- **No new libraries.** Pure TypeScript edits over existing types and the existing `TakeoverDeps`/`deriveStageFromRemote` machinery. (`.adw/commands.md` library install command is `bun add <package>` if ever needed — it is not needed here.)
