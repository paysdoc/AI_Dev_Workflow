@adw-636 @adw-d0hv98-refactor-exhaustive
Feature: Exhaustive classifyStage routes cron + takeover — every existing stage keeps its current recovery disposition (behaviour-preserving)

  Issue #636 introduces a single pure `classifyStage(stage)` over the
  `WorkflowStage` union — an exhaustive `switch` with a `never` fallthrough that
  returns a `StageClass` (`active | awaiting_merge | retriable | resumable |
  terminal | human_gated`) — and routes the cron stage resolver and the takeover
  handler through it, replacing the bespoke `isActiveStage` / `isRetriableStage`
  predicates and their `endsWith('_running')` / `endsWith('_completed')` family
  matching. The headline value is a COMPILE-TIME guard: adding a future stage
  without a classification case becomes a build error.

  This slice is strictly BEHAVIOUR-PRESERVING — "no stage changes class yet". The
  observable risk it must not regress is subtle: the two predicates it collapses
  are NOT equivalent. They disagree per-stage, and a single shared classifier
  returns ONE class per stage while each consumer maps that class to an action
  differently:

    • cron `isActiveStage` treats `starting`, every `*_running`, and every
      intermediate `*_completed` (but NOT the terminal `completed`) as active.
    • takeover `isRunningStage` treats every `*_running`, `starting`, and
      `resuming` as a live run to take over — it does NOT include `*_completed`,
      and it DOES include `resuming`.

  So `build_completed` is *active* to cron (excluded from the sweep) yet *not
  running* to takeover (spawns fresh); `resuming` is *not* active to cron
  (excluded) yet *is* running to takeover (taken over). Behaviour preservation
  means each consumer's per-stage decision is reproduced exactly — not that the
  two consumers agree. These scenarios therefore pin the OBSERVABLE recovery
  decision of each consumer per representative stage, NOT the internal
  `StageClass` label (that is the unit test's job — "one classification per stage
  literal" — and the `never` exhaustiveness is a type-system guarantee, not a
  runtime behaviour).

  The behavioural contract pinned below:

    1. CRON EXCLUDES SETTLED / OWNED STAGES (AC3, cron). An issue whose latest ADW
       run sits at an active, terminal, human-gated, or queue-owned stage is left
       out of the backlog sweep — the cron does not re-process it. This includes
       the family-matched `build_running` (a `*_running`) and `build_completed`
       (an intermediate `*_completed`), the deliberate-terminal `discarded` (never
       re-spawned — the loop-forever guard), the human-gated `merge_blocked`, the
       queue-owned `paused`, and the as-yet-unrecovered `phase_timeout`.
    2. CRON DISPATCHES A MERGE FOR awaiting_merge (AC3, cron). An issue recorded
       at `awaiting_merge` with a resolvable run id is eligible with a `merge`
       action carrying that run id — it bypasses the grace period.
    3. CRON GUARDS awaiting_merge WITHOUT A RUN ID (AC3, cron edge). An
       `awaiting_merge` issue with no ADW run id in its comments is excluded — no
       merge is dispatched against a missing run id.
    4. CRON RE-SPAWNS THE retriable STAGE (AC3, cron). An issue recorded at
       `abandoned` (the sole retriable stage) is eligible with a `spawn` action
       carrying its run id — the crashed run is retried, not started clean.
    5. TAKEOVER TAKES OVER A STALLED ACTIVE RUN WITH A DEAD OWNER (AC3, takeover).
       A candidate whose run is at a running-family stage (`*_running`,
       `starting`, `resuming`) with a dead owning process is taken over under its
       existing run id — the worktree is reset and the stage reconciled from the
       remote first, and no process is signalled to die.
    6. TAKEOVER SIGKILLS A LIVE STALE OWNER THEN TAKES OVER (AC3, takeover). The
       same running-family candidate whose owning process is still alive but does
       not hold the spawn lock is signalled to die, then taken over.
    7. TAKEOVER TAKES OVER abandoned (AC3, takeover). An `abandoned` candidate is
       taken over after a worktree reset and remote reconcile, with no process
       kill.
    8. TAKEOVER SPAWNS FRESH FOR AN INTERMEDIATE `*_completed` (AC3, divergence).
       `build_completed` is NOT a running-family stage to takeover, so it spawns a
       fresh workflow — even though cron treats the same stage as active. This is
       the sharpest guard that collapsing the `endsWith` families into one
       classifier did not leak cron's membership into takeover.
    9. TAKEOVER STANDS DOWN FOR SETTLED / QUEUE-OWNED STAGES (AC3, takeover). A
       candidate at `completed` or `discarded` (terminal) or `paused` /
       `paused_auth` (queue-owned, resumed only by their own queue scanner) is not
       taken over and not re-spawned — the handler stands down and releases the
       spawn lock, performing no worktree reset or remote reconcile.
   10. TAKEOVER FALLS THROUGH TO A FRESH SPAWN FOR THE UNRECOVERED STAGES (AC3,
       defensive). `phase_timeout` and `merge_blocked` are not yet recovered by
       takeover and fall through to a fresh spawn — the pre-existing defensive
       disposition this slice preserves. (`phase_timeout` is the dead-end stage a
       LATER resumable-class slice will flip to a take-over; pinning it here makes
       that future behaviour change test-visible.)
   11. EXHAUSTIVENESS COMPILES (AC1 backstop). With every `WorkflowStage` literal
       classified and a `never` fallthrough in place, the ADW TypeScript
       type-check passes — the baseline that makes an unclassified future stage a
       build error.

  Observability / rot-prevention note:

    Every assertion below targets a runtime OUTPUT of the system under test, never
    a source file. None reads `adws/triggers/cronStageResolver.ts`,
    `adws/triggers/cronIssueFilter.ts`, `adws/triggers/takeoverHandler.ts`, or any
    `classifyStage` module as text, substring-matches its contents, or parses it
    as JSON/AST.

      • §1–§4 drive the cron backlog filter (`evaluateIssue` from
        `adws/triggers/cronIssueFilter.ts`) over a constructed issue with an
        injected stage resolver, and assert the returned `FilterResult` — its
        `eligible` flag, `action`, and carried run id. This is the registry's
        phase-import / mock-query pattern (a function of the system under test;
        its return value is an observable output, not a source property).
      • §5–§10 drive the takeover handler (`evaluateCandidate` from
        `adws/triggers/takeoverHandler.ts`) over injected `TakeoverDeps`, and
        assert the returned `CandidateDecision` kind plus the calls recorded on
        the injected boundaries (process kill, worktree reset, remote reconcile,
        spawn-lock release) — the same injected-deps surface the existing
        `takeoverHandler.test.ts` asserts against.
      • §11 asserts the type-checker's verdict (registry T22).

    The `workflowStage` strings in the Examples tables (`build_running`,
    `awaiting_merge`, `abandoned`, …) are INPUT test data — the stage values the
    system reads from a state file at runtime — exactly the artefact category the
    Rot-Detection Rubric permits. They are NOT reads of this repo's source files,
    and no scenario asserts that a `WorkflowStage` literal or a `StageClass` case
    is present in any source file.

  Scope notes:

    • The `never` exhaustiveness guard is a COMPILE-TIME property: an unclassified
      stage fails to build. That negative cannot be a passing runtime scenario
      without mutating source, so it is deliberately left to the unit/type layer
      (AC1, AC4) and proxied here only by §11 (the type-check passes — a backstop,
      not a proof that the guard is present).
    • These scenarios assert the per-consumer OBSERVABLE recovery decision, never
      the `StageClass` label nor the cron `reason` string. An implementer is free
      to classify e.g. `resuming` as `active` or `phase_timeout` as `resumable`
      and wire the consumers so behaviour is unchanged — every scenario here still
      passes, because it pins the decision (taken over / spawned fresh / excluded
      / merge / re-spawn / stand down), not the taxonomy choice. The cron `reason`
      string for catch-all stages is intentionally NOT pinned: it legitimately
      changes when such a stage gains a class, while its eligibility stays false.
    • The cron `evaluateIssue` grace-period, cancellation, and in-flight-dedup
      gates are pre-existing and orthogonal to the classifier; scenarios place the
      issue past the grace period (or at a grace-bypassing stage) so the stage
      disposition — the thing the classifier owns — is the observed signal.
    • Other consumers of `isActiveStage` (`adws/triggers/webhookHandlers.ts`,
      `adws/triggers/devServerJanitor.ts`) are touched by the same predicate
      replacement but are out of this issue's named scope (cron resolver +
      takeover handler); their behaviour preservation rides on the unchanged
      `classifyStage` contract and is not re-pinned here.
    • The `@regression` maintenance sweep is SKIPPED for this issue:
      `.adw/scenarios.md` configures a `## Regression Scenario Directory`, so
      promotion is a deliberate human decision and the agent never auto-promotes.

  Vocabulary note:

    Reused registered phrases (`features/regression/vocabulary.md`):
      G18 (`the ADW codebase is checked out`),
      T22 (`the ADW TypeScript type-check passes`).

    Novel phrasing introduced here — the registry is scoped to
    orchestrator/phase/mock-query behaviours and has NO phrase for the cron
    backlog filter's eligibility decision or the takeover handler's candidate
    decision. The gap is surfaced to the maintainer in the agent Output:
      • `a backlog issue {int} idle past the cron grace period whose latest ADW run is recorded at stage {string}`
      • `a backlog issue {int} recorded at stage "awaiting_merge" with no ADW run id in its issue comments`
      • `the cron backlog filter evaluates the issue`
      • `the cron backlog filter excludes the issue from the sweep`
      • `the cron backlog filter marks the issue eligible to dispatch a merge for the recorded ADW run`
      • `the cron backlog filter marks the issue eligible to re-spawn the recorded ADW run`
      • `a takeover candidate for issue {int} whose stalled ADW run is recorded at stage {string} on branch {string} with a dead owning process`
      • `a takeover candidate for issue {int} whose stalled ADW run is recorded at stage {string} on branch {string} with a live owning process that does not hold the spawn lock`
      • `a takeover candidate for issue {int} whose recorded ADW run is at stage "abandoned" on branch {string}`
      • `a takeover candidate for issue {int} whose recorded ADW run is at stage {string}`
      • `the takeover handler evaluates the candidate`
      • `the takeover handler takes over the recorded ADW run`
      • `the takeover handler resets the worktree and reconciles from the remote before taking over`
      • `the takeover handler signals the stale owning process to die`
      • `the takeover handler signals no owning process to die`
      • `the takeover handler spawns a fresh workflow`
      • `the takeover handler stands down and releases the spawn lock`
      • `the takeover handler performs no worktree reset or remote reconcile`

    Step-definition note for the maintainer: the cron steps phase-import
    `evaluateIssue` and drive it with a constructed `CronIssue` plus an injected
    `resolveStage` stub returning `{ stage, adwId, lastActivityMs }`, controlling
    `now` / `gracePeriodMs` so "idle past the grace period" holds; they assert the
    returned `FilterResult`. The takeover steps phase-import `evaluateCandidate`
    and drive it with `TakeoverDeps` whose `acquireIssueSpawnLock` returns true,
    `resolveAdwId` returns a fixed run id, `readTopLevelState` returns a state at
    the given `workflowStage` (with `branchName` / `pid` / `pidStartedAt` set per
    the Given) and `isProcessLive` set per "live" / "dead"; they assert the
    returned `CandidateDecision` kind and the recorded `killProcess` /
    `resetWorktree` / `deriveStageFromRemote` / `releaseIssueSpawnLock` calls —
    the same injected-deps shape `adws/triggers/__tests__/takeoverHandler.test.ts`
    already uses.

  Background:
    Given the ADW codebase is checked out

  # ─────────────────────────────── CRON BACKLOG FILTER ────────────────────────
  #
  # Consumer 1: evaluateIssue (adws/triggers/cronIssueFilter.ts), which today
  # routes through isActiveStage + isRetriableStage. After the refactor it routes
  # through classifyStage. Its observable output is the FilterResult.

  # ── §1 Cron excludes every settled / owned stage ─────────────────────────────
  #
  # The negative space the classifier must preserve. `build_running` (a *_running)
  # and `build_completed` (an intermediate *_completed) are the family-matched
  # active stages; `completed` is the terminal boundary the *_completed family
  # must not swallow into eligibility; `discarded` is the deliberate-terminal
  # never-re-spawn guard; `merge_blocked` is human-gated; `paused` is owned by the
  # pause queue; `phase_timeout` is the as-yet-unrecovered dead-end. Every one is
  # left out of the sweep. (Contract §1; AC3.)

  @adw-636 @adw-d0hv98-refactor-exhaustive
  Scenario Outline: The cron backlog filter excludes an issue whose ADW run sits at a settled or owned stage
    Given a backlog issue 7360 idle past the cron grace period whose latest ADW run is recorded at stage "<stage>"
    When the cron backlog filter evaluates the issue
    Then the cron backlog filter excludes the issue from the sweep

    Examples:
      | stage           |
      | build_running   |
      | build_completed |
      | completed       |
      | discarded       |
      | merge_blocked   |
      | paused          |
      | phase_timeout   |

  # ── §2 Cron dispatches a merge for awaiting_merge with a run id ───────────────
  #
  # awaiting_merge bypasses the grace period and dispatches the merge orchestrator
  # for the recorded run id — the one positive non-spawn recovery action the cron
  # takes. (Contract §2; AC3.)

  @adw-636 @adw-d0hv98-refactor-exhaustive
  Scenario: The cron backlog filter dispatches a merge for an awaiting_merge issue carrying a run id
    Given a backlog issue 7361 idle past the cron grace period whose latest ADW run is recorded at stage "awaiting_merge"
    When the cron backlog filter evaluates the issue
    Then the cron backlog filter marks the issue eligible to dispatch a merge for the recorded ADW run

  # ── §3 Cron guards awaiting_merge with no run id ─────────────────────────────
  #
  # An awaiting_merge issue whose comments carry no ADW run id cannot name a run
  # to merge, so it is excluded — no merge is dispatched against a missing id.
  # (Contract §3; AC3 edge.)

  @adw-636 @adw-d0hv98-refactor-exhaustive
  Scenario: The cron backlog filter excludes an awaiting_merge issue that has no run id
    Given a backlog issue 7362 recorded at stage "awaiting_merge" with no ADW run id in its issue comments
    When the cron backlog filter evaluates the issue
    Then the cron backlog filter excludes the issue from the sweep

  # ── §4 Cron re-spawns the retriable stage ────────────────────────────────────
  #
  # `abandoned` is the sole retriable stage: a transient crash/exit that should be
  # retried. The cron marks it eligible to spawn, carrying the run id so the
  # spawned orchestrator resumes that run rather than starting clean. (Contract
  # §4; AC3.)

  @adw-636 @adw-d0hv98-refactor-exhaustive
  Scenario: The cron backlog filter re-spawns an abandoned run, carrying its run id
    Given a backlog issue 7363 idle past the cron grace period whose latest ADW run is recorded at stage "abandoned"
    When the cron backlog filter evaluates the issue
    Then the cron backlog filter marks the issue eligible to re-spawn the recorded ADW run

  # ──────────────────────────────── TAKEOVER HANDLER ──────────────────────────
  #
  # Consumer 2: evaluateCandidate (adws/triggers/takeoverHandler.ts), which today
  # routes through its own isRunningStage family match. After the refactor it
  # routes through classifyStage. Its observable output is the CandidateDecision
  # kind plus the calls recorded on the injected TakeoverDeps boundaries.

  # ── §5 Takeover takes over a stalled active run with a dead owner ─────────────
  #
  # The running family takeover recovers: *_running, starting, and resuming with a
  # dead owning process are taken over under the existing run id, after a worktree
  # reset and a remote reconcile, with no process signalled to die. `resuming` is
  # included deliberately — it is a takeover running-family member even though
  # cron does NOT treat it as active. (Contract §5; AC3.)

  @adw-636 @adw-d0hv98-refactor-exhaustive
  Scenario Outline: The takeover handler takes over a stalled running-family run whose owning process is dead
    Given a takeover candidate for issue 7364 whose stalled ADW run is recorded at stage "<stage>" on branch "feature-issue-7364-x" with a dead owning process
    When the takeover handler evaluates the candidate
    Then the takeover handler takes over the recorded ADW run
    And the takeover handler resets the worktree and reconciles from the remote before taking over
    And the takeover handler signals no owning process to die

    Examples:
      | stage         |
      | build_running |
      | test_running  |
      | starting      |
      | resuming      |

  # ── §6 Takeover SIGKILLs a live stale owner, then takes over ──────────────────
  #
  # Same running-family candidate, but the owning process is still alive and is
  # not the lock holder (this handler acquired the lock). The stale owner is
  # signalled to die, then the run is taken over. (Contract §6; AC3.)

  @adw-636 @adw-d0hv98-refactor-exhaustive
  Scenario: The takeover handler signals a live stale owner to die before taking over a running-family run
    Given a takeover candidate for issue 7365 whose stalled ADW run is recorded at stage "build_running" on branch "feature-issue-7365-x" with a live owning process that does not hold the spawn lock
    When the takeover handler evaluates the candidate
    Then the takeover handler signals the stale owning process to die
    And the takeover handler takes over the recorded ADW run

  # ── §7 Takeover takes over an abandoned run ───────────────────────────────────
  #
  # `abandoned` is recovered by reset + reconcile + take-over, with no process
  # kill (the abandoned run has already exited). (Contract §7; AC3.)

  @adw-636 @adw-d0hv98-refactor-exhaustive
  Scenario: The takeover handler takes over an abandoned run after a worktree reset and remote reconcile
    Given a takeover candidate for issue 7366 whose recorded ADW run is at stage "abandoned" on branch "feature-issue-7366-x"
    When the takeover handler evaluates the candidate
    Then the takeover handler takes over the recorded ADW run
    And the takeover handler resets the worktree and reconciles from the remote before taking over
    And the takeover handler signals no owning process to die

  # ── §8 Takeover spawns fresh for an intermediate *_completed (DIVERGENCE) ─────
  #
  # The sharpest behaviour-preservation guard. `build_completed` is *active* to
  # cron (§1 excludes it) but NOT a running-family stage to takeover, so takeover
  # spawns a fresh workflow. Collapsing the two `endsWith` families into one
  # classifier must not leak cron's `*_completed`-is-active membership into the
  # takeover handler. (Contract §8; AC3.)

  @adw-636 @adw-d0hv98-refactor-exhaustive
  Scenario: The takeover handler spawns fresh for an intermediate build_completed stage
    Given a takeover candidate for issue 7367 whose recorded ADW run is at stage "build_completed"
    When the takeover handler evaluates the candidate
    Then the takeover handler spawns a fresh workflow

  # ── §9 Takeover stands down for settled / queue-owned stages ──────────────────
  #
  # `completed` / `discarded` are terminal; `paused` / `paused_auth` are owned by
  # their own queue scanner (the sole resumer). For all four the takeover handler
  # stands down and releases the spawn lock, with no worktree reset or remote
  # reconcile — it neither takes over nor spawns. The disposition is identical
  # across the four even though their intent differs. (Contract §9; AC3.)

  @adw-636 @adw-d0hv98-refactor-exhaustive
  Scenario Outline: The takeover handler stands down and releases the lock for a settled or queue-owned stage
    Given a takeover candidate for issue 7368 whose recorded ADW run is at stage "<stage>"
    When the takeover handler evaluates the candidate
    Then the takeover handler stands down and releases the spawn lock
    And the takeover handler performs no worktree reset or remote reconcile

    Examples:
      | stage       |
      | completed   |
      | discarded   |
      | paused      |
      | paused_auth |

  # ── §10 Takeover falls through to a fresh spawn for the unrecovered stages ────
  #
  # `phase_timeout` and `merge_blocked` are not yet recovered by takeover and hit
  # its defensive fallthrough — a fresh spawn. This is the pre-existing
  # disposition this behaviour-preserving slice keeps. `phase_timeout` is the
  # dead-end stage a LATER resumable-class slice will flip to a take-over; pinning
  # its current fresh-spawn here makes that future behaviour change test-visible.
  # (Contract §10; AC3.)

  @adw-636 @adw-d0hv98-refactor-exhaustive
  Scenario Outline: The takeover handler falls through to a fresh spawn for an as-yet-unrecovered stage
    Given a takeover candidate for issue 7369 whose recorded ADW run is at stage "<stage>"
    When the takeover handler evaluates the candidate
    Then the takeover handler spawns a fresh workflow
    And the takeover handler performs no worktree reset or remote reconcile

    Examples:
      | stage         |
      | phase_timeout |
      | merge_blocked |

  # ── §11 Exhaustiveness compiles (type-check backstop) ─────────────────────────
  #
  # With every WorkflowStage literal classified and a `never` fallthrough wired
  # in, the ADW type-check passes — the baseline that turns an unclassified future
  # stage into a build error. A backstop for AC1, not a proof the guard is
  # present (that is the unit/type layer's job). (Contract §11; AC1.)

  @adw-636 @adw-d0hv98-refactor-exhaustive
  Scenario: The ADW TypeScript type-check passes with the exhaustive classifier wired into cron and takeover
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
