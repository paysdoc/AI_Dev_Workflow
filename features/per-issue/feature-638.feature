@adw-638 @adw-hxbf7l-feat-resume-in-place
Feature: resume-in-place via a worktree-reuse gate — takeover keeps a healthy worktree's work instead of always resetting it to the remote

  Issue #638 (parent PRD `specs/prd/stage-recovery-resume-in-place.md`) makes a
  recoverable run's takeover stop throwing away a healthy worktree. Until now both
  recoverable stages — `abandoned` (the retriable class) and `phase_timeout` (wired
  into takeover by feature-637) — routed through ONE recovery path:
  `recoverViaResetFromRemote` (adws/triggers/takeoverHandler.ts), which always ran
  `git reset --hard origin/<branch>` + `git clean -fdx` (adws/vcs/worktreeReset.ts),
  discarding every uncommitted change before resuming. That cost the live victim of
  the phase_timeout dead-end (issue #612) hours of uncommitted work even once it was
  finally picked up.

  This slice adds a two-layer worktree-reuse gate:

    • A PURE decision — `decideWorktreeReuse(probe)` over a `WorktreeProbe` that
      captures only **Class-A git-operability** signals: whether the lone `index.lock`
      is absent / orphaned (stale) / live-held; whether a rebase, merge, or
      cherry-pick is interrupted; whether HEAD sits on the expected branch; whether
      the worktree is locked or prunable; and whether a live process still owns it.
      The gate returns REUSE-IN-PLACE only when every signal is healthy, and
      RESET-FROM-REMOTE on any fault. It is total over the probe and has NO content
      input — see the Class-B note below.
    • A thin probing shell gathers those signals from the real worktree; it is the
      I/O boundary the pure gate is fed from (and the seam the takeover step harness
      injects in tests).

  Takeover (`evaluateCandidate`) now, for BOTH `abandoned` and `phase_timeout`
  (unified into the single gated path), probes the worktree and decides:

    • HEALTHY  → take over the recorded run id IN PLACE: no worktree reset, so the
      uncommitted work is preserved (AC1). The read-only remote stage-derivation that
      picks the resume stage still runs — it touches no working-tree content — so the
      take-over decision is reached exactly as on the reset path and the only observable
      difference is the SKIPPED worktree reset, keeping the downstream HITL gate intact
      (AC5).
    • UNHEALTHY → take over via the pre-existing reset-from-remote recovery (AC2) —
      the exact behaviour feature-636 §7 and feature-637 §1 pinned, now reached only
      when the gate fails.

  Recovery only ever reuses a CONFIRMED-DEAD run's worktree: the probe's live-held
  lock / live-owner signals are themselves fail signals, so a worktree a live process
  is still touching is reset, never reused (AC4). This is the same ordering the
  active running-family takeover already follows — kill the stale owner, confirm it is
  dead, then (now) probe and decide.

  Class-B content health (is the diff junk? is it destructive?) is explicitly NOT
  assessed by this gate — it has no diff input and makes no content judgment. Reusing
  a worktree in place PRESERVES its diff for the unchanged downstream gate, and a
  taken-over run re-enters its normal phase pipeline, so the pre-existing blocking
  end-verification and the destructive-diff HITL gate remain the junk gate exactly as
  before (AC5). See the scope note on why that orthogonal pre-existing gate is not
  re-pinned here.

  Observability / rot-prevention note:

    Every assertion targets a runtime OUTPUT of the system under test, never a source
    file. None reads takeoverHandler.ts, worktreeReset.ts, the new
    decideWorktreeReuse / probe modules, or workflowTypes.ts as text,
    substring-matches their contents, or parses them as JSON/AST.

      • §1–§3 phase-import the pure `decideWorktreeReuse` and assert its returned
        decision (reuse-in-place vs reset-from-remote) over constructed `WorktreeProbe`
        permutations — the registry's phase-import / return-value pattern (cf. the
        FilterResult and CandidateDecision return-value assertions feature-636 uses,
        and the formatted-string assertion of T-PY5). The decision is an observable
        output, not a source property.
      • §4–§7 drive the takeover handler (`evaluateCandidate`) over injected
        `TakeoverDeps` and assert the returned `CandidateDecision` kind plus the
        recorded boundary calls (worktree reset, remote reconcile, process kill) — the
        same injected-deps surface feature-636 / feature-637 and
        takeoverHandler.test.ts already assert against, extended with the injected
        worktree probe this slice adds.
      • §8 asserts the type-checker's verdict (registry T22).

    The `abandoned` / `phase_timeout` / `build_running` stage strings and the probe
    signal descriptors in the steps are INPUT test data — the stage a run records in
    its state file and the git-operability facts the probe reads at runtime — exactly
    the artefact category the Rot-Detection Rubric permits, NOT a read of this repo's
    source files.

  Scope notes:

    • Behaviour pinned here is the OBSERVABLE recovery action — reuse-in-place (take
      over with no reset/reconcile, work preserved) vs reset-from-remote (take over
      after reset + reconcile) — and the pure gate's reuse/reset verdict. The
      `WorktreeProbe` field shape, the gate's internal `reason` for a reset, and the
      `decideWorktreeReuse` return type are an implementer's choice and are NOT pinned;
      only the reuse-vs-reset verdict and the takeover's resulting boundary calls are.
      (The acceptance criteria's table-style unit tests over probe permutations are
      the unit layer's job; §3 mirrors that table observably at the BDD level.)
    • The flip is SURGICAL to the two recoverable stages. The active running-family
      takeover (`*_running` / `starting` / `resuming`, feature-636 §5–§6) is OUT of
      scope and keeps its unconditional reset-from-remote — §7 guards that boundary so
      the build's TDD loop (which runs only this issue's tag) catches a blanket
      "gate every recovery" over-reach directly, not only in a later full regression
      run. Extending resume-in-place to the active family is a deliberate NON-goal of
      this slice.
    • feature-636 §7 (abandoned) and feature-637 §1 (phase_timeout) are UPDATED by
      this issue: their Given now pins a worktree that FAILS the reuse gate (so their
      reset-from-remote assertion stays exactly true) and are cross-tagged @adw-638.
      They remain the canonical reset-path pins for the two stages; this file owns the
      new reuse-in-place path and the full probe matrix.
    • The blocking end-verification and the destructive-diff HITL gate are
      pre-existing and ORTHOGONAL to this change — this slice neither relaxes nor
      re-implements them (the gate is Class-A only). Per the same convention by which
      feature-636/637 leave the cron grace-period / cancellation / in-flight-dedup
      gates un-re-pinned, no scenario here re-asserts the downstream HITL gate; §4 and
      §6 pin only the IN-SCOPE half (reuse preserves the diff and re-enters the gated
      pipeline; an unconfirmed-dead worktree is never reused).
    • The @regression maintenance sweep is SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion is a deliberate
      human decision and the agent never auto-promotes.

  Vocabulary note:

    Reused registered phrases (`features/regression/vocabulary.md`):
      G18  `the ADW codebase is checked out`
      T22  `the ADW TypeScript type-check passes`

    Reused phrases established by feature-636 / feature-637 (takeover decision surface):
      `a takeover candidate for issue {int} whose stalled ADW run is recorded at stage {string} on branch {string} with a dead owning process`
      `the takeover handler evaluates the candidate`
      `the takeover handler takes over the recorded ADW run`
      `the takeover handler resets the worktree and reconciles from the remote before taking over`
      `the takeover handler signals no owning process to die`

    Novel phrasing introduced here (surfaced to the maintainer in the agent Output) —
    the registry has no phrase for the worktree-reuse gate or resume-in-place takeover:
      Pure gate (decideWorktreeReuse):
        • `a worktree probe reporting a fully git-operable worktree on the expected branch`
        • `a worktree probe reporting an orphaned index.lock and otherwise git-operable`
        • `a worktree probe reporting {string}`   (Class-A fault descriptor — Examples-driven)
        • `the worktree-reuse gate decides on the probe`
        • `the gate decides to reuse the worktree in place`
        • `the gate decides the worktree must be reset from the remote`
      Takeover integration (evaluateCandidate):
        • `the candidate's worktree passes the reuse gate`
        • `the candidate's worktree fails the reuse gate`
        • `the candidate's worktree is still owned by a live process`
        • `the takeover handler reuses the worktree in place with its uncommitted work preserved`

    Step-definition note for the maintainer:
      • §1–§3 phase-import `decideWorktreeReuse` (expected to land alongside the probe
        shell, e.g. adws/vcs/worktreeReuseGate.ts) and call it with a constructed
        `WorktreeProbe`. The "fully git-operable" baseline = no index.lock (or an
        orphaned one), no interrupted rebase/merge/cherry-pick, HEAD on the expected
        branch, not locked, not prunable, no live owner. Each `{string}` fault
        descriptor flips exactly ONE signal off the healthy baseline. Assert only the
        binary verdict (reuse vs reset), not the gate's `reason`.
      • §4–§7 extend the feature-636 takeover step harness: `TakeoverDeps` gains an
        injected worktree probe (e.g. `probeWorktree(worktreePath, expectedBranch)`
        returning a `WorktreeProbe`). `the candidate's worktree passes/fails the reuse
        gate` sets that probe to a healthy / unhealthy value; `still owned by a live
        process` sets the live-owner signal specifically. Keep the harness DEFAULT
        probe HEALTHY so every gate-relevant scenario states its own worktree health
        explicitly and the active-path guard (§7) and the cross-tagged feature-636 §5
        stay meaningful. `reuses the worktree in place with its uncommitted work
        preserved` asserts decision kind `take_over_adwId` with zero `resetWorktree`
        calls (no reset == uncommitted work kept); `deriveStageFromRemote` is STILL
        called to derive the resume stage — it is read-only and touches no working-tree
        content, so keeping it leaves the take_over_adwId decision shape unchanged for
        the downstream HITL gate (AC5). The reuse-vs-reset difference is purely the
        absence of `resetWorktree`.

  Background:
    Given the ADW codebase is checked out

  # ═══════════════════════ PURE WORKTREE-REUSE GATE (decideWorktreeReuse) ═══════
  #
  # Surface 1: the pure decision over a WorktreeProbe. Its observable output is the
  # reuse-vs-reset verdict — a return value, the registry's phase-import pattern.

  # ── §1 Healthy worktree → reuse in place (the headline) ──────────────────────
  #
  # Every Class-A signal healthy: no live-held lock, no interrupted op, HEAD on the
  # expected branch, not locked, not prunable, no live owner. The gate reuses in
  # place — the verdict that lets a recovered run keep its uncommitted work.
  # (AC1; AC6 — the healthy row of the permutation table.)

  @adw-638 @adw-hxbf7l-feat-resume-in-place
  Scenario: The worktree-reuse gate reuses a fully git-operable worktree in place
    Given a worktree probe reporting a fully git-operable worktree on the expected branch
    When the worktree-reuse gate decides on the probe
    Then the gate decides to reuse the worktree in place

  # ── §2 Orphaned (stale) index.lock is still reusable ─────────────────────────
  #
  # The orphaned-vs-live-held distinction the probe draws. A lone `index.lock` left
  # behind by a dead process (no live PID holds it) is a stale artefact, not an
  # in-flight write — the worktree is still git-operable, so the gate reuses it in
  # place. The live-held case is the §3 fault row that resets. (AC1; AC6 boundary.)

  @adw-638 @adw-hxbf7l-feat-resume-in-place
  Scenario: The worktree-reuse gate reuses a worktree whose only index.lock is orphaned
    Given a worktree probe reporting an orphaned index.lock and otherwise git-operable
    When the worktree-reuse gate decides on the probe
    Then the gate decides to reuse the worktree in place

  # ── §3 Any Class-A git-operability fault → reset from remote ─────────────────
  #
  # The negative space. Each row flips exactly ONE signal off the healthy baseline,
  # and any single fault makes the worktree unsafe to resume on, so the gate requires
  # a reset from the remote. A live-held lock and a live owner are the confirmed-dead
  # guard (AC4) — a worktree something live is still touching is never reused. Note
  # there is NO content/diff row: the gate is Class-A only and cannot fault on
  # content (AC5). (AC2; AC6 — the fault rows of the permutation table.)

  @adw-638 @adw-hxbf7l-feat-resume-in-place
  Scenario Outline: The worktree-reuse gate resets a worktree exhibiting any Class-A git-operability fault
    Given a worktree probe reporting "<fault>"
    When the worktree-reuse gate decides on the probe
    Then the gate decides the worktree must be reset from the remote

    Examples:
      | fault                        |
      | a live-held index.lock       |
      | an interrupted rebase        |
      | an interrupted merge         |
      | an interrupted cherry-pick   |
      | HEAD on an unexpected branch |
      | a locked worktree            |
      | a prunable worktree          |
      | a live owning process        |

  # ═══════════════════════ TAKEOVER INTEGRATION (evaluateCandidate) ════════════
  #
  # Surface 2: the takeover handler wires the gate into the recovery of the two
  # recoverable stages. Its observable output is the CandidateDecision kind plus the
  # calls recorded on the injected TakeoverDeps boundaries.

  # ── §4 Healthy worktree → resume in place for BOTH recoverable stages ────────
  #
  # The headline behaviour change. A dead `abandoned` or `phase_timeout` run whose
  # worktree passes the gate is taken over UNDER ITS EXISTING RUN ID with no worktree
  # reset — its uncommitted work survives — and no process is signalled to die (the
  # owner is already dead). The read-only remote stage-derivation that picks the resume
  # stage still runs (it touches no working-tree content), so the only observable
  # difference from the reset path is that the worktree is NOT reset. Taking over (not
  # merging, not completing) re-enters the run's normal phase pipeline, so the preserved
  # diff still meets the unchanged end-verification + destructive-diff HITL gate
  # downstream. (AC1; AC3 — applies to both stages; AC5 in-scope half.)

  @adw-638 @adw-hxbf7l-feat-resume-in-place
  Scenario Outline: The takeover handler resumes a healthy recoverable run in place without resetting its worktree
    Given a takeover candidate for issue 7380 whose stalled ADW run is recorded at stage "<stage>" on branch "feature-issue-7380-x" with a dead owning process
    And the candidate's worktree passes the reuse gate
    When the takeover handler evaluates the candidate
    Then the takeover handler takes over the recorded ADW run
    And the takeover handler reuses the worktree in place with its uncommitted work preserved
    And the takeover handler signals no owning process to die

    Examples:
      | stage         |
      | abandoned     |
      | phase_timeout |

  # ── §5 Unhealthy worktree → reset from remote for BOTH recoverable stages ────
  #
  # The gate-fails path is exactly the pre-existing reset-from-remote recovery
  # (feature-636 §7 / feature-637 §1, now cross-tagged @adw-638 and pinned to this
  # same failing-gate condition). A dead `abandoned` or `phase_timeout` run whose
  # worktree fails the gate is taken over only AFTER a worktree reset and a remote
  # reconcile, with no process kill. (AC2; AC3 — applies to both stages.)

  @adw-638 @adw-hxbf7l-feat-resume-in-place
  Scenario Outline: The takeover handler resets a recoverable run from the remote when its worktree fails the reuse gate
    Given a takeover candidate for issue 7381 whose stalled ADW run is recorded at stage "<stage>" on branch "feature-issue-7381-x" with a dead owning process
    And the candidate's worktree fails the reuse gate
    When the takeover handler evaluates the candidate
    Then the takeover handler takes over the recorded ADW run
    And the takeover handler resets the worktree and reconciles from the remote before taking over
    And the takeover handler signals no owning process to die

    Examples:
      | stage         |
      | abandoned     |
      | phase_timeout |

  # ── §6 Reuse only a CONFIRMED-DEAD run's worktree ────────────────────────────
  #
  # The integration mirror of the §3 live-owner fault row, encoding AC4. The recorded
  # run's PID is dead, but the probe finds a live process still owning the worktree
  # (e.g. a stray duplicate). Resume-in-place would race that writer, so the gate
  # withholds reuse and the handler falls back to reset-from-remote — a worktree is
  # reused ONLY when nothing live is still touching it. (AC4.)

  @adw-638 @adw-hxbf7l-feat-resume-in-place
  Scenario: The takeover handler refuses to reuse a worktree a live process still owns and resets it instead
    Given a takeover candidate for issue 7382 whose stalled ADW run is recorded at stage "phase_timeout" on branch "feature-issue-7382-x" with a dead owning process
    And the candidate's worktree is still owned by a live process
    When the takeover handler evaluates the candidate
    Then the takeover handler takes over the recorded ADW run
    And the takeover handler resets the worktree and reconciles from the remote before taking over

  # ── §7 Scope guard — the gate does not touch the active running-family takeover ─
  #
  # The surgical boundary. `build_running` is an active running-family stage whose
  # takeover (feature-636 §5) is OUT of this slice's scope. Even with a worktree that
  # WOULD pass the reuse gate, an active-family takeover still resets from the remote
  # unconditionally — resume-in-place is wired into the two recoverable stages only,
  # not blanket-applied to every recovery. A regression of this row means the gate
  # leaked into the active path. (Scope guard; mirrors feature-637 §3–§4.)

  @adw-638 @adw-hxbf7l-feat-resume-in-place
  Scenario: The takeover handler still resets an active running-family run from the remote even when its worktree would pass the reuse gate
    Given a takeover candidate for issue 7383 whose stalled ADW run is recorded at stage "build_running" on branch "feature-issue-7383-x" with a dead owning process
    And the candidate's worktree passes the reuse gate
    When the takeover handler evaluates the candidate
    Then the takeover handler takes over the recorded ADW run
    And the takeover handler resets the worktree and reconciles from the remote before taking over

  # ── §8 Type-check backstop ────────────────────────────────────────────────────
  #
  # The pure gate, the probe shell, and the new probe boundary on TakeoverDeps keep
  # the ADW codebase type-clean (the feature-636 `never`-exhaustiveness guard still
  # holds). A backstop, consistent with feature-636 §11 and feature-637 §6. (Backstop.)

  @adw-638 @adw-hxbf7l-feat-resume-in-place
  Scenario: The ADW TypeScript type-check passes with the worktree-reuse gate wired into takeover
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
