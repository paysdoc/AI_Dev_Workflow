@adw-719 @adw-fuckpv-pr-review-hands-off
Feature: A clean PR-review run hands its PR off to awaiting_merge — gated on reviewPassed — so cron's existing merge dispatch finally merges it (#712 / PR #715 stuck-state)

  Issue #719 makes a clean `adwPrReview` run reach the merge path end to end.
  Today `adwPrReview` finishes by calling `completePRReviewWorkflow`, which
  writes the orchestrator-specific execution state and posts a completion
  comment but NEVER writes the top-level `workflowStage: 'awaiting_merge'`. The
  run therefore settles at an inert terminal state: cron never sees an
  `awaiting_merge` handoff for the addressed PR, so it never dispatches a merge,
  and the addressed PR is left open forever. That is exactly the #712 / PR #715
  stuck-state — a PR-review correctly addressed its comments yet the PR sat
  un-merged because the handoff was missing.

  The reference handoff already exists and is well understood. Every SDLC
  orchestrator on a clean run writes
  `AgentStateManager.writeTopLevelState(adwId, { workflowStage: 'awaiting_merge' })`
  and DELIBERATELY does NOT call `completeWorkflow` — calling it would overwrite
  the stage with `completed` and rob cron of the handoff. Cron's existing backlog
  filter then resolves `awaiting_merge` + a run id and returns a `merge` action,
  which spawns the thin `adwMerge` orchestrator. #719 makes PR-review participate
  in that SAME contract — and introduces NO new merge mechanism.

  The fix, precisely: a pure `decidePostReviewOutcome(reviewPassed)` gate decides
  the post-review outcome — a passed review proceeds and yields `awaiting_merge`;
  a failed review stops and yields no `awaiting_merge`. `adwPrReview` consults the
  gate at completion and writes `awaiting_merge` to the top-level state ONLY when
  the review passed. When the review did not pass, today's inert terminal
  behaviour is preserved exactly: no `awaiting_merge` is written, so the PR is not
  handed to the merge path. PR-review keeps its OWN generated adwId for this slice
  — adwId consolidation with the issue's run is a later slice and is out of scope
  here.

  The behavioural contract pinned below:

    1. PURE GATE — PASS PROCEEDS TO awaiting_merge (AC1, unit-level core). The
       decision for a review that passed proceeds and selects `awaiting_merge`.
    2. PURE GATE — FAIL STOPS WITHOUT awaiting_merge (AC1, unit-level core). The
       decision for a review that did not pass stops and selects no
       `awaiting_merge`.
    3. CLEAN RUN HANDS OFF (AC2, the core fix). On a PR-review run whose review
       passed, the top-level workflow state records `awaiting_merge` at
       completion — the handoff that was missing.
    4. FAILED RUN STAYS INERT (AC3, regression guard). On a PR-review run whose
       review did NOT pass, the top-level workflow state does NOT record
       `awaiting_merge` and carries no error — today's inert terminal behaviour,
       preserved, with the PR left for human follow-up rather than merge.
    5. EXISTING DISPATCH CONSUMES THE HANDOFF (AC4, no new mechanism). An issue
       whose PR-review run has handed off at `awaiting_merge` carrying its run id
       is dispatched a `merge` by the SAME cron backlog filter the SDLC path
       relies on — #719 adds no new merge mechanism, it only feeds the existing
       one.
    6. TYPE-CHECK BACKSTOP (AC5). The ADW TypeScript type-check still passes after
       the gate is added and wired.

  Observability / rot-prevention note:

    Every assertion below targets an artefact the system produces at runtime —
    never the text of a source file:

      • the top-level workflow STATE FILE written under the run's adwId
        (`agents/<adwId>/state.json`, field `workflowStage`) — the artefact behind
        registered vocabulary T1, read the same way; §3 asserts the negative of T1
        and T9's "records no error" against the same artefact;
      • the cron backlog filter's recorded eligibility DECISION (the `eligible`
        flag, `action`, and carried run id) — the same observable feature-636 §2
        pins for the existing `awaiting_merge` → `merge` dispatch;
      • the post-review outcome DECISION returned by the pure gate (§1) — a value
        OUTPUT of the system under test, asserted by its observable disposition
        (proceed + `awaiting_merge` / stop + none), exactly as feature-712 §4–§6
        assert the value returned by the pure remote-version read;
      • the ADW TypeScript type-check exit status (T22).

    No step reads `adws/adwPrReview.tsx`, `adws/phases/prReviewCompletion.ts`, or
    `adws/phases/decidePostReviewOutcome.ts` as text, substring-matches their
    contents, or parses them as JSON/AST. The gate's behaviour is proven by the
    stage the completion writes (or refrains from writing), the decision the gate
    returns, and the action the existing cron filter takes on the handoff.

  Scope notes:

    • DISTINCT FROM THE ERROR PATH (#587). #719's fail case (§3) is a clean run
      whose review did not pass after the bounded retry budget — an INERT terminal
      outcome that writes no `awaiting_merge` and no error. It is NOT the
      exception/error path owned by `handlePRReviewWorkflowError`
      (`feature-587.feature`), which moves the issue to Blocked, posts an error
      comment, and exits non-zero. §3 deliberately asserts "records no error" to
      separate the inert-not-passed outcome from the errored outcome; feature-587
      stays green and is not re-tagged.
    • THE MERGE ITSELF IS OUT OF SCOPE. The cron `awaiting_merge` → `merge`
      dispatch is owned by feature-636 §2; the `adwMerge` PR-merge execution is
      owned by feature-530. #719 only proves the HANDOFF reaches that existing
      dispatch (§4). Those features stay green; #719 introduces no new merge code,
      and §4 reuses feature-636's cron-filter vocabulary verbatim to make "no new
      mechanism" literally true at the phrase level.
    • PR-review keeps its OWN generated adwId for this slice. Reusing the issue's
      adwId so the merge dispatch resolves against the issue's run is the later
      consolidation slice and is NOT asserted here; §4 dispatches against the
      PR-review run's own id.
    • The bounded review→patch retry loop, the scenario/unit/build phases, and the
      commit+push phase are pre-existing and unchanged by #719; this file pins only
      the post-review OUTCOME gate and the stage it writes, not the phases upstream
      of it.
    • The `@regression` maintenance sweep is SKIPPED for this issue:
      `.adw/scenarios.md` configures a `## Regression Scenario Directory`, so
      promotion is a deliberate human decision and the agent never auto-promotes.

  Vocabulary note:

    Reused registered phrases (`features/regression/vocabulary.md`):
      G18 (`the ADW codebase is checked out`),
      G4  (`an issue {int} exists in the mock issue tracker`),
      G1  (`the mock GitHub API is configured to accept issue comments`),
      G6  (`a state file exists for adwId {string} at stage {string}`),
      G11 (`the worktree for adwId {string} is initialised at branch {string}`),
      T1  (`the state file for adwId {string} records workflowStage {string}`),
      T9  (`the state file for adwId {string} records no error`),
      T22 (`the ADW TypeScript type-check passes`).

    Reused from sibling per-issue file #636 (globally loaded, not yet registered)
    — deliberately reused verbatim so §4 proves the EXISTING dispatch consumes the
    handoff with no new merge vocabulary:
      `the cron backlog filter evaluates the issue`,
      `the cron backlog filter marks the issue eligible to dispatch a merge for the recorded ADW run`.

    Novel phrasing introduced here — the registry has no phrase for the post-review
    outcome gate's decision, for executing the PR-review outcome handoff, for the
    negative of T1, or for a PR-review-sourced handoff feeding cron. The gap is
    surfaced to the maintainer in the agent Output:
      • `the post-review outcome is decided for a passing review`
      • `the post-review outcome is decided for a failing review`
      • `the post-review outcome proceeds to awaiting_merge`
      • `the post-review outcome stops without awaiting_merge`
      • `the PR-review outcome handoff is executed for adwId {string} on PR {int} after a passing review`
      • `the PR-review outcome handoff is executed for adwId {string} on PR {int} after a failing review`
      • `the state file for adwId {string} does not record workflowStage {string}`
      • `a PR-review run for adwId {string} has handed issue {int} off to awaiting_merge`

    Step-definition note for the maintainer: §1 drives the pure
    `decidePostReviewOutcome(reviewPassed)` in-process and asserts the returned
    decision's disposition (mirroring the unit tests required by AC1, and the
    pure-read scenarios in feature-712 §4–§6) — it pins no field names, only the
    proceed/stop + awaiting_merge/none outcome, so it survives a change to the
    decision object's shape. §2–§3 drive the PR-review completion+gate via
    phase-import over a mocked `WorkflowConfig` (the feature-530 "merge handoff is
    executed" shape), seeding a pre-handoff stage via G6 so the contrast is crisp:
    the passing run ADVANCES the recorded stage to `awaiting_merge`; the failing
    run LEAVES it untouched (still not `awaiting_merge`) and clean. §4 reuses the
    feature-636 cron-filter harness — the novel Given seeds the same cron
    evaluation context feature-636's Given builds (an issue past the grace period
    recorded at `awaiting_merge` with a resolvable run id), framed as the
    PR-review run's handoff, then defers to feature-636's globally-loaded
    `evaluates the issue` / `eligible to dispatch a merge` steps.

  Background:
    Given the ADW codebase is checked out

  # ── §1 Pure gate — the post-review outcome decision (AC1, unit-level core) ─────
  #
  # `decidePostReviewOutcome(reviewPassed)` is a pure function: a passed review
  # proceeds and selects `awaiting_merge`; a failed review stops and selects none.
  # These pin AC1's contract directly on the decision the gate returns — the
  # value-output analogue of feature-712 §4–§6. (Contract §1, §2.)

  @adw-719 @adw-fuckpv-pr-review-hands-off
  Scenario: The post-review outcome gate proceeds to awaiting_merge for a passing review
    When the post-review outcome is decided for a passing review
    Then the post-review outcome proceeds to awaiting_merge

  @adw-719 @adw-fuckpv-pr-review-hands-off
  Scenario: The post-review outcome gate stops without awaiting_merge for a failing review
    When the post-review outcome is decided for a failing review
    Then the post-review outcome stops without awaiting_merge

  # ── §2 Clean PR-review run hands the PR off to awaiting_merge (AC2, the fix) ───
  #
  # THE core fix. A PR-review run whose review passed reaches completion and writes
  # the top-level `awaiting_merge` handoff — the value that was missing and that
  # cron's merge dispatch reads. The run is seeded at a pre-handoff stage; the
  # passing gate ADVANCES it to `awaiting_merge`. (Contract §3.)

  @adw-719 @adw-fuckpv-pr-review-hands-off
  Scenario: A clean PR-review run records awaiting_merge at completion
    Given an issue 7191 exists in the mock issue tracker
    And the worktree for adwId "prreview-719-pass" is initialised at branch "feature-issue-7191-prr"
    And a state file exists for adwId "prreview-719-pass" at stage "pr_review_build_completed"
    And the mock GitHub API is configured to accept issue comments
    When the PR-review outcome handoff is executed for adwId "prreview-719-pass" on PR 7191 after a passing review
    Then the state file for adwId "prreview-719-pass" records workflowStage "awaiting_merge"

  # ── §3 Failed PR-review run stays inert; no awaiting_merge written (AC3) ───────
  #
  # The regression guard. A PR-review run whose review did NOT pass after the retry
  # budget settles inertly: the gate stops before any handoff, so the top-level
  # state is LEFT untouched (still not `awaiting_merge`) and carries no error. This
  # is today's inert behaviour, preserved — distinct from the #587 error path, which
  # blocks the issue and exits non-zero. (Contract §4.)

  @adw-719 @adw-fuckpv-pr-review-hands-off
  Scenario: A PR-review run whose review did not pass stays inert and records no awaiting_merge
    Given an issue 7192 exists in the mock issue tracker
    And the worktree for adwId "prreview-719-fail" is initialised at branch "feature-issue-7192-prr"
    And a state file exists for adwId "prreview-719-fail" at stage "pr_review_build_completed"
    And the mock GitHub API is configured to accept issue comments
    When the PR-review outcome handoff is executed for adwId "prreview-719-fail" on PR 7192 after a failing review
    Then the state file for adwId "prreview-719-fail" does not record workflowStage "awaiting_merge"
    And the state file for adwId "prreview-719-fail" records no error

  # ── §4 The existing cron merge dispatch consumes the handoff (AC4) ────────────
  #
  # End-to-end proof the #712 / PR #715 stuck-state is fixed: once a clean PR-review
  # run has handed its PR's issue off at `awaiting_merge` carrying the run id, the
  # SAME cron backlog filter the SDLC path relies on dispatches a merge for that
  # run. #719 introduces no new merge mechanism — it reuses this exact dispatch
  # (feature-636 §2), framed here as the PR-review handoff feeding it. (Contract §5.)

  @adw-719 @adw-fuckpv-pr-review-hands-off
  Scenario: The existing cron merge dispatch is eligible to merge a PR handed off by a clean PR-review run
    Given a PR-review run for adwId "prreview-719-merge" has handed issue 7194 off to awaiting_merge
    When the cron backlog filter evaluates the issue
    Then the cron backlog filter marks the issue eligible to dispatch a merge for the recorded ADW run

  # ── §5 Type-check backstop (AC5) ──────────────────────────────────────────────

  @adw-719 @adw-fuckpv-pr-review-hands-off
  Scenario: TypeScript type-check passes after wiring the post-review outcome gate
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
