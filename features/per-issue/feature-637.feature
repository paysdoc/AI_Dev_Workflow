@adw-637 @adw-tg4om4-fix-make-phase-timeo
Feature: phase_timeout becomes a recoverable stage — a timed-out workflow with a dead orchestrator is picked up by cron/takeover instead of stranding forever

  Issue #637 closes the `phase_timeout` dead-end. The agent watchdog
  (`handlePhaseTimeout`, adws/phases/workflowCompletion.ts) writes
  `workflowStage: 'phase_timeout'` and posts a "Phase Timeout" comment when a phase
  exceeds its watchdog, then exits — but until now NO recovery path read that
  stage. `classifyStage` (landed in #636) already places `phase_timeout` in the
  `resumable` class, yet both consumers still routed the resumable class to their
  defensive fallthrough: the cron backlog filter EXCLUDED the issue
  (`adw_stage:phase_timeout`) and the takeover handler SPAWNED FRESH. A timed-out
  run therefore sat untouched indefinitely (live victim: issue #612, stranded for
  hours with uncommitted work).

  This slice wires the recovery branch into both consumers so a `phase_timeout` run
  is actually picked up, reusing the existing reset-from-remote recovery
  (resume-in-place is a later PRD slice):

    • CRON (evaluateIssue, adws/triggers/cronIssueFilter.ts): a `phase_timeout`
      issue idle past the grace period becomes ELIGIBLE to re-spawn its recorded
      ADW run — the same disposition `abandoned` (the retriable stage) already has,
      so the next tick recovers it. This is the direct inverse of feature-636 §1,
      which pinned `phase_timeout` as excluded and flagged that "a LATER
      resumable-class slice will flip it".
    • TAKEOVER (evaluateCandidate, adws/triggers/takeoverHandler.ts): a
      `phase_timeout` candidate whose owning process is dead is TAKEN OVER under its
      existing run id — worktree reset, stage reconciled from the remote, no fresh
      spawn. This is the direct inverse of feature-636 §10, which pinned
      `phase_timeout` as a fresh spawn. (Issue #638 — resume-in-place via the
      worktree-reuse gate — has since made the worktree reset CONDITIONAL: a healthy
      phase_timeout worktree is reused in place, and the reset §1 pins is now reached
      only when the gate fails. §1 is updated and cross-tagged @adw-638 accordingly.)

  The flip is SURGICAL — only `phase_timeout` changes disposition. The other members
  of the `resumable` class (e.g. `build_completed`, which phaseRunner writes between
  phases) MUST keep their pre-existing dispositions: cron still excludes them,
  takeover still spawns fresh. A blanket "recover every resumable stage"
  implementation would re-sweep live mid-flight runs (and would regress
  feature-636 §1 and §8) — that is the precise over-reach this issue must avoid.
  §3 and §4 pin that boundary under @adw-637 so the build's TDD loop (which runs
  only this issue's tag) catches a blanket flip directly, not only in a later full
  regression run.

  The watchdog's "Phase Timeout" issue comment previously promised the workflow
  would "re-enter this phase on the next cron tick / webhook event" — a claim that
  was false while no consumer read the stage. §5 pins that the composed comment now
  describes the recovery the system actually performs. (The parallel correction to
  the `phase_timeout` entry in the WorkflowStage type documentation is a
  source-comment change verified by review and the type layer; per the
  Rot-Detection Rubric a doc-comment is not an observable output, so no scenario
  asserts its text.)

  Observability / rot-prevention note:

    Every assertion targets a runtime OUTPUT of the system under test, never a
    source file. None reads cronIssueFilter.ts, takeoverHandler.ts,
    stageClassifier.ts, workflowCommentsIssue.ts, or workflowTypes.ts as text,
    substring-matches their contents, or parses them as JSON/AST.

      • §1–§4 drive the same injected surfaces feature-636 established: the cron
        backlog filter (`evaluateIssue`) over a constructed issue with an injected
        stage resolver (assert the returned `FilterResult` — its `eligible` flag and
        `action`), and the takeover handler (`evaluateCandidate`) over injected
        `TakeoverDeps` (assert the returned `CandidateDecision` kind plus the
        recorded process-kill / worktree-reset / remote-reconcile boundary calls).
      • §5 phase-imports the pure comment formatter and asserts the produced comment
        body — the registry's formatted-comment pattern (cf. T-PY5), a return value,
        not a source property.
      • §6 asserts the type-checker's verdict (registry T22).

    The `phase_timeout` / `build_completed` strings in the steps are INPUT test data
    — the stage value the system reads from a state file at runtime — exactly the
    artefact category the Rubric permits, NOT a read of this repo's source files.

  Scope notes:

    • Behaviour pinned here is the per-consumer OBSERVABLE recovery decision
      (eligible / excluded / take-over / spawn-fresh, plus the boundary calls), NOT
      the `StageClass` label — an implementer may keep `phase_timeout` in any class
      and wire the consumers to these decisions. The `never`-exhaustiveness guard
      remains a compile-time property (feature-636 AC1), proxied here only by §6.
    • The cron grace-period, cancellation, and in-flight-dedup gates are pre-existing
      and orthogonal to this change; scenarios place the issue past the grace period
      so the stage disposition — the thing this slice changes — is the observed
      signal.
    • feature-636 §1 and §10 are UPDATED by this issue: their `phase_timeout` example
      rows (which pinned the now-replaced excluded / spawn-fresh dispositions) are
      removed and the two scenarios cross-tagged @adw-637. Their retained rows
      (`build_completed`, `merge_blocked`, …) still guard the behaviour this slice
      deliberately preserves.
    • The @regression maintenance sweep is SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion is a deliberate
      human decision and the agent never auto-promotes.

  Vocabulary note:

    Reused registered phrases (`features/regression/vocabulary.md`):
      G18  `the ADW codebase is checked out`
      T22  `the ADW TypeScript type-check passes`

    Reused phrases introduced by feature-636 (cron + takeover decision surfaces):
      `a backlog issue {int} idle past the cron grace period whose latest ADW run is recorded at stage {string}`
      `the cron backlog filter evaluates the issue`
      `the cron backlog filter excludes the issue from the sweep`
      `the cron backlog filter marks the issue eligible to re-spawn the recorded ADW run`
      `a takeover candidate for issue {int} whose stalled ADW run is recorded at stage {string} on branch {string} with a dead owning process`
      `a takeover candidate for issue {int} whose recorded ADW run is at stage {string}`
      `the takeover handler evaluates the candidate`
      `the takeover handler takes over the recorded ADW run`
      `the takeover handler resets the worktree and reconciles from the remote before taking over`
      `the takeover handler signals no owning process to die`
      `the takeover handler spawns a fresh workflow`
      `the takeover handler performs no worktree reset or remote reconcile`

    Novel phrasing introduced here (surfaced to the maintainer in the agent Output)
    — the registry has no phrase for the composed Phase Timeout comment body:
      • `the workflow composes the Phase Timeout comment for a timed-out phase`
      • `the Phase Timeout comment tells the reader the timed-out run will be recovered automatically on the next cron tick`

    Reused phrase introduced by feature-638 (now used by the updated §1, which #638
    re-pins to the gate-fails reset path):
      `the candidate's worktree fails the reuse gate`

    Step-definition note for the maintainer: §1–§4 reuse the feature-636 cron /
    takeover step definitions verbatim (phase-import `evaluateIssue` with an injected
    `resolveStage` returning `{ stage, adwId, lastActivityMs }` placed past the grace
    period; phase-import `evaluateCandidate` with `TakeoverDeps` whose
    `readTopLevelState` returns the given `workflowStage` and `isProcessLive` returns
    the "dead"/"live" flag, asserting the recorded `killProcess` / `resetWorktree` /
    `deriveStageFromRemote` / `releaseIssueSpawnLock` calls). §5 phase-imports
    `formatWorkflowComment` from adws/github/workflowCommentsIssue.ts (the public
    entry; `formatPhaseTimeoutComment` is not exported), calls
    `formatWorkflowComment('phase_timeout', ctx)` with a minimal `WorkflowContext`
    (`adwId`, `timeoutPhaseName`, `timeoutMs`), and asserts the returned body
    communicates automatic recovery on the next cron tick — a recovery-intent check
    (recover / retried / picked up / taken over / re-run), deliberately RED against
    the legacy "re-enter this phase on the next cron tick / webhook event" wording
    and NOT keyed to the implementer's exact sentence.

  Background:
    Given the ADW codebase is checked out

  # ── §1 Takeover recovers a dead phase_timeout run (the headline flip) ─────────
  #
  # The inverse of feature-636 §10. A run the watchdog left at `phase_timeout` whose
  # orchestrator has since exited is taken over under its existing run id — the
  # worktree is reset and the stage reconciled from the remote, with no process
  # signalled to die (the owner is already dead). This reuses the existing
  # reset-from-remote recovery that `abandoned` and the running family already use.
  # (AC1: takeover has a branch that recovers phase_timeout; AC4: tests cover it.)
  #
  # UPDATED by issue #638 (resume-in-place via the worktree-reuse gate): reset is no
  # longer unconditional. A healthy phase_timeout worktree is now reused IN PLACE
  # (feature-638 §4); the reset-from-remote path this scenario pins is reached only
  # when the worktree FAILS the gate, so the Given now states that condition and the
  # scenario is cross-tagged @adw-638. The take-over decision itself is unchanged.

  @adw-637 @adw-638 @adw-tg4om4-fix-make-phase-timeo
  Scenario: The takeover handler resets a stalled phase_timeout run from the remote when its worktree fails the reuse gate
    Given a takeover candidate for issue 7370 whose stalled ADW run is recorded at stage "phase_timeout" on branch "feature-issue-7370-x" with a dead owning process
    And the candidate's worktree fails the reuse gate
    When the takeover handler evaluates the candidate
    Then the takeover handler takes over the recorded ADW run
    And the takeover handler resets the worktree and reconciles from the remote before taking over
    And the takeover handler signals no owning process to die

  # ── §2 Cron picks up a dead-orchestrator phase_timeout on the next tick ───────
  #
  # The inverse of feature-636 §1. A `phase_timeout` issue idle past the grace
  # period (its orchestrator exited 0 when the watchdog fired) is no longer left out
  # of the sweep — the cron marks it eligible to re-spawn its recorded ADW run, the
  # same disposition `abandoned` already has, so the next cron tick recovers it.
  # (AC2: a phase_timeout workflow with a dead orchestrator is picked up.)

  @adw-637 @adw-tg4om4-fix-make-phase-timeo
  Scenario: The cron backlog filter recovers a phase_timeout issue idle past the grace period
    Given a backlog issue 7371 idle past the cron grace period whose latest ADW run is recorded at stage "phase_timeout"
    When the cron backlog filter evaluates the issue
    Then the cron backlog filter marks the issue eligible to re-spawn the recorded ADW run

  # ── §3 Cron scope guard — the flip is surgical, not a blanket resumable sweep ──
  #
  # `build_completed` is a sibling of `phase_timeout` in the `resumable` class
  # (phaseRunner writes it between phases). Marking it eligible from the backlog
  # would re-sweep a live mid-flight run. The flip must touch ONLY `phase_timeout`:
  # a sibling resumable stage idle past grace stays excluded. Pins the surgical cron
  # scope (and matches the retained feature-636 §1 `build_completed` row).

  @adw-637 @adw-tg4om4-fix-make-phase-timeo
  Scenario: The cron backlog filter still excludes a sibling resumable stage that is not phase_timeout
    Given a backlog issue 7372 idle past the cron grace period whose latest ADW run is recorded at stage "build_completed"
    When the cron backlog filter evaluates the issue
    Then the cron backlog filter excludes the issue from the sweep

  # ── §4 Takeover scope guard — the flip is surgical, not a blanket resumable take ─
  #
  # The takeover mirror of §3. Only `phase_timeout` flips to a take-over; another
  # resumable stage (`build_completed`) still spawns fresh and performs no worktree
  # reset or remote reconcile. A blanket "take over every resumable stage"
  # implementation would regress feature-636 §8. Pins the surgical takeover scope.

  @adw-637 @adw-tg4om4-fix-make-phase-timeo
  Scenario: The takeover handler still spawns fresh for a sibling resumable stage that is not phase_timeout
    Given a takeover candidate for issue 7373 whose recorded ADW run is at stage "build_completed"
    When the takeover handler evaluates the candidate
    Then the takeover handler spawns a fresh workflow
    And the takeover handler performs no worktree reset or remote reconcile

  # ── §5 The Phase Timeout comment describes the real recovery ──────────────────
  #
  # The watchdog comment used to promise the workflow would "re-enter this phase on
  # the next cron tick / webhook event" — false while the stage was a dead-end no
  # consumer read. With recovery wired, the composed comment must describe the
  # recovery the system now actually performs. Asserted against the formatter's
  # OUTPUT (a returned string), never its source text. (AC3, observable half; the
  # type-doc half is a source-comment change left to review per the Rubric.)

  @adw-637 @adw-tg4om4-fix-make-phase-timeo
  Scenario: The composed Phase Timeout comment describes the automatic recovery instead of promising in-place re-entry
    When the workflow composes the Phase Timeout comment for a timed-out phase
    Then the Phase Timeout comment tells the reader the timed-out run will be recovered automatically on the next cron tick

  # ── §6 Type-check backstop ────────────────────────────────────────────────────
  #
  # The recovery branch added to cron + takeover and the corrected comment keep the
  # ADW codebase type-clean (the `never`-exhaustiveness guard from feature-636 still
  # holds with phase_timeout now consumed). A backstop, consistent with
  # feature-636 §11 and feature-521 §7. (AC1 backstop.)

  @adw-637 @adw-tg4om4-fix-make-phase-timeo
  Scenario: The ADW TypeScript type-check passes with phase_timeout recovery wired into cron and takeover
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
