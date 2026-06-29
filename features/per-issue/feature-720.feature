@adw-720 @adw-vba2wo-add-review-failed-bl
Feature: An exhausted SDLC review blocks the issue at review_failed — no PR is created, a comment points at the branch, cron never re-fires it, and only ## Retry re-runs the review

  Issue #720 introduces an explicit `review_failed` blocking stage and makes the
  SDLC orchestrator use it end to end. Parent PRD:
  `specs/prd/pr-review-adwid-consolidation-and-review-failed-gate.md` (§Solution
  item 2; §Implementation Decisions "New / changed workflow stage", "Post-review
  outcome gate", "## Retry recovery").

  The defect this closes: when the SDLC review-retry loop is exhausted with
  unresolved blockers, the orchestrator used to proceed UNCONDITIONALLY — it
  created the PR and handed off to `awaiting_merge` anyway. The only thing
  standing between a failed review and a bad merge was that the PR was left
  unapproved (approval is gated on the review passing) plus branch protection.
  There was no explicit "this review failed, stop and ask a human" state. #720
  adds it.

  This slice builds directly on two shipped pieces and changes them minimally:

    • #719 introduced the pure `decidePostReviewOutcome(reviewPassed)` gate, shared
      by both orchestrators: a passed review proceeds and selects `awaiting_merge`;
      a failed review stops without `awaiting_merge`. #720 EXTENDS the failed
      branch — it now additionally selects the `review_failed` blocking stage and
      raises a "skip document + PR" signal for the SDLC caller (the SDLC review
      loop already runs BEFORE PR creation, so there is no PR to leave behind).
      feature-719 §1 still pins the pass→`awaiting_merge` / fail→not-`awaiting_merge`
      disposition and stays green and untouched; this file pins the NEW fields the
      failed decision now carries.
    • #639 established the `human_gated` cron-excluded class, the cron money-fire
      backstop (an escalated stage is left out of the sweep), and the
      `## Retry → phase_timeout` re-arm. #720 joins `review_failed` to that exact
      class and re-arm — it is recoverable only by a human posting `## Retry`,
      which re-runs the review.

  The behavioural contract pinned below:

    1. PURE GATE — FAIL SELECTS review_failed + SKIP DOC/PR (AC3, the extension).
       The decision for a review that did NOT pass selects the `review_failed`
       blocking stage and signals the SDLC orchestrator to skip document + PR
       creation. The decision for a review that passed proceeds WITH document + PR
       creation (the skip signal is not raised) — the contrast guard.
    2. SDLC REVIEW EXHAUSTION BLOCKS (AC4, the end-to-end fix). On an SDLC run
       whose review did not pass after the retry budget, the top-level workflow
       state records `review_failed`, NO PR is created, and the issue carries a
       comment pointing at the branch so a human can inspect and push a fix.
    3. THE MONEY-FIRE PIN — CRON NEVER RE-FIRES review_failed (AC2, safety-
       critical). The cron backlog filter leaves a `review_failed` issue out of
       the sweep — it is neither auto-spawned nor auto-merged, no matter how long
       it has sat idle. This is the explicit test the PRD calls out: if
       `review_failed` ever landed in the auto-spawn bucket, a failing review would
       re-run a full, expensive orchestrator every tick with no human in the loop.
    4. ## RETRY RE-ARMS review_failed → phase_timeout (AC5/AC6, human re-entry).
       A `## Retry` on a `review_failed` issue re-arms it to `phase_timeout` and
       clears the resume counter — the same stage from which the existing
       resume-in-place machinery (#637/#638) re-runs the review. The directive is
       a NO-OP on any stage that is not human-gated, so adding `review_failed` to
       the handler cannot disturb an active, completed, or otherwise unrelated run.
    5. TYPE-CHECK BACKSTOP (AC1, AC7). `review_failed` is a member of the closed
       `WorkflowStage` union and is classified into exactly one `StageClass`, so
       the #636 `never`-exhaustiveness guard still compiles. Proven by the type
       checker's verdict, never by parsing the union out of source.

  Observability / rot-prevention note:

    Every assertion below targets a runtime OUTPUT of the system under test, never
    a source file. No step reads `adws/phases/decidePostReviewOutcome.ts`,
    `adws/core/stageClassifier.ts`, `adws/triggers/cronIssueFilter.ts`,
    `adws/triggers/retryHandler.ts`, `adws/adwSdlc.tsx`, or
    `adws/types/workflowTypes.ts` as text, substring-matches their contents, or
    parses them as JSON/AST.

      • §1 phase-imports the pure `decidePostReviewOutcome(reviewPassed)` and
        asserts its returned decision — a function-of-the-system return value,
        exactly the observable category feature-719 §1 asserts for the same gate
        and feature-639 §1 asserts for `nextResumeAction`. The `review_failed`
        string and the skip-doc/PR disposition are the function's documented return
        contract (named verbatim in the issue and PRD), not a source property.
      • §2 asserts the TOP-LEVEL STATE FILE the SDLC run writes (the `workflowStage`
        field, read exactly as registered vocabulary T1 reads it — the state file
        is an artefact, a permitted read), the absence of any recorded PR-creation
        request on the mock GitHub API (the same recorded-request surface
        feature-541/feature-628 assert "zero PR creations" against), and the
        recorded branch-pointing comment on the mock GitHub API (T2/T3 — the same
        recorded-comment surface feature-639 §3 asserts its human-gated escalation
        comment against).
      • §3 drives the cron backlog filter (`evaluateIssue`) over a constructed
        issue whose injected stage resolver reports `review_failed`, and asserts
        the returned `FilterResult.eligible` is false — the #636/#637/#639 cron
        surface, reused verbatim.
      • §4 drives the `## Retry` directive handler and asserts the persisted
        top-level state (the written `workflowStage` and the cleared resume
        counter) — the feature-527/feature-639 retry surface.
      • §5 asserts the type-checker's verdict (registry T22).

    The stage strings in the steps (`review_failed`, `phase_timeout`,
    `review_running`, `build_completed`, `awaiting_merge`) are INPUT/OUTPUT test
    data — the value the system reads from or writes to a state-file artefact at
    runtime — exactly the category the Rot-Detection Rubric permits. The acceptance
    criterion "`review_failed` added to the workflow stage taxonomy" is therefore
    proven BEHAVIOURALLY (the SDLC run writes it to the state-file artefact in §2,
    the cron treats it as terminal-until-human in §3, and the compiler confirms its
    union+classification membership in §5), never by parsing the `WorkflowStage`
    union out of source — the same technique feature-639 used to prove `human_gated`
    and feature-527 used to prove `merge_blocked`.

  Scope notes:

    • THE PINNED BEHAVIOUR IS THE OBSERVABLE OUTCOME — the gate's decision, the
      written `workflowStage`, the absence of a PR, the branch-pointing comment,
      the cron eligibility, and the `## Retry` re-arm — NOT the internal
      `StageClass` label, the name or shape of the gate's return object, or the
      order in which the orchestrator writes state vs. posts the comment. An
      implementer may classify `review_failed` in any class and structure the
      decision object freely as long as these outcomes hold (the #636/#639
      "pin the decision, not the taxonomy" stance).
    • THE REVIEW-RE-RUN ITSELF IS OUT OF SCOPE here. §4 pins the `## Retry` re-arm
      to `phase_timeout` — the trigger. That the resumed run then RE-RUNS the review
      while completed plan/build/step-def phases stay skipped is a property of the
      pre-existing resume-in-place machinery (feature-637/#638) plus the review
      phase not being a skip-tracked phase (PRD §"## Retry recovery"); it is owned
      and tested there and is deliberately NOT re-proved by driving a full
      orchestrator subprocess. The re-arm is a surgical partial state write
      (`workflowStage` + resume counter only), so the completed-phase skip tracking
      — wherever it lives — is left untouched.
    • feature-719 IS NOT MODIFIED AND IS NOT RE-TAGGED. Its §1 asserts the
      pass→`awaiting_merge` / fail→not-`awaiting_merge` disposition, which #720's
      extension preserves (`review_failed` is still not `awaiting_merge`), so it
      stays green. #720 ADDS assertions on the NEW fields the failed decision now
      carries; it does not change what #719 pinned.
    • THE SDLC HAPPY PATH (a passing review → document → PR → `awaiting_merge`) is
      pre-existing and unchanged except that it is now gated behind the gate's
      skip signal. It is covered by `adw_sdlc_happy_path.feature` and is NOT
      re-driven here (its phases are heavy); §1's pass-path contrast proves the
      gate does not raise the skip signal on a passing review, which is the only
      new decision point on that path.
    • THE @regression MAINTENANCE SWEEP IS SKIPPED for this issue: `.adw/scenarios.md`
      configures a `## Regression Scenario Directory`, so promotion to the
      regression suite is a deliberate human decision and the agent never
      auto-promotes.

  Vocabulary note:

    Registered phrases reused (`features/regression/vocabulary.md`):
      G1  `the mock GitHub API is configured to accept issue comments`
      G4  `an issue {int} exists in the mock issue tracker`
      G6  `a state file exists for adwId {string} at stage {string}`
      G11 `the worktree for adwId {string} is initialised at branch {string}`
      G18 `the ADW codebase is checked out`
      T1  `the state file for adwId {string} records workflowStage {string}`
      T2  `the mock GitHub API recorded a comment on issue {int}`
      T3  `the mock GitHub API recorded a comment containing the text {string}`
      T22 `the ADW TypeScript type-check passes`

    Established phrases reused from sibling per-issue features (globally loaded,
    not yet in the registry) — deliberately reused verbatim so this slice proves
    the EXISTING surfaces consume `review_failed` with no new mechanism:
      from feature-719 (the shared post-review gate — the direct base):
        `the post-review outcome is decided for a passing review`
        `the post-review outcome is decided for a failing review`
      from feature-636 / feature-637 / feature-639 (cron backlog filter decision):
        `a backlog issue {int} idle past the cron grace period whose latest ADW run is recorded at stage {string}`
        `the cron backlog filter evaluates the issue`
        `the cron backlog filter excludes the issue from the sweep`
      from feature-541 / feature-628 (recorded PR-creation surface):
        `the mock harness recorded zero PR creations for issue {int}`
      from feature-527 / feature-639 (the `## Retry` re-entry — the direct analogue):
        `issue {int} carries an ADW comment naming adwId {string}`
        `issue {int} has a comment whose body is {string}`
        `the {string} directive is processed for issue {int}`
        `the state file for adwId {string} is seeded with a resume attempt count of {int}`
        `the state file for adwId {string} records a resume attempt count of {int}`

    Novel phrasing introduced here — the registry has no phrase for the failed
    decision's NEW fields or for the SDLC review-failure handoff. Surfaced to the
    maintainer in the agent Output:
      • `the post-review outcome selects the review_failed blocking stage`
      • `the post-review outcome signals the SDLC orchestrator to skip document and PR creation`
      • `the post-review outcome proceeds with document and PR creation`
      • `the SDLC post-review handoff is executed for adwId {string} on issue {int} after a failing review`

    Step-definition note for the maintainer:
      • §1 phase-imports `decidePostReviewOutcome(reviewPassed)` (already imported by
        feature-719.steps.ts) and asserts the returned decision. The two new Then
        phrases assert the failed decision's `review_failed` stage selection and its
        skip-doc/PR signal; the pass-path phrase asserts the passing decision does
        NOT raise the skip signal. They pin the documented disposition, not field
        names, so they survive a change to the decision object's shape.
      • §2 drives the SDLC review-failure outcome segment. That segment currently
        lives INLINE in `adwSdlc.tsx main()` (consult the gate → on skip, write
        `review_failed`, return BEFORE the document/PR phases). The maintainer
        should extract it into a thin, importable function — mirroring
        feature-719's `completePRReviewWorkflow` driver — and the step phase-imports
        it over a mocked `WorkflowConfig` seeded at a pre-handoff stage (G6) with a
        worktree+branch (G11). SPEC-vs-IMPL GAP, deliberately surfaced: User Story
        20 / AC4 require the issue to CARRY A COMMENT pointing at its branch so a
        human can inspect and push a fix; the inline segment today only `log()`s the
        branch to STDOUT and posts no GitHub comment. §2's T2/T3 assertions
        therefore DRIVE adding the carried comment (posted via the same recorded
        REST path feature-639 §3's escalation comment uses, with the branch name as
        the pointer). The "no PR" assertion reuses feature-541's recorded-request
        check and is already satisfied by the early return.
      • §3 reuses the feature-636/637/639 cron step verbatim: phase-import
        `evaluateIssue` with an injected `resolveStage` returning
        `{ stage: 'review_failed', adwId, lastActivityMs }`; assert the returned
        `FilterResult.eligible` is false (the implementer adds the `review_failed`
        exclusion branch alongside the existing `merge_blocked` / `human_gated`
        ones).
      • §4 reuses the feature-527/639 `## Retry` steps: phase-import
        `handleRetryDirective` (extended to recognise `review_failed`) and assert the
        persisted state records `phase_timeout` with `resumeAttempts: 0`; the no-op
        scenario seeds a non-human-gated stage and asserts the stage is left
        unchanged.

  Background:
    Given the ADW codebase is checked out

  # ── §1 Pure gate — fail selects review_failed + skip doc/PR (AC3) ─────────────
  #
  # #720 extends the failed branch of the #719 gate. A failed review now selects
  # the `review_failed` blocking stage AND signals the SDLC orchestrator to skip
  # document + PR creation. A passed review proceeds WITH document + PR creation —
  # the skip signal is the only new decision point on the happy path. These pin
  # AC3's contract directly on the value the gate returns.

  @adw-720 @adw-vba2wo-add-review-failed-bl
  Scenario: A failing review selects the review_failed stage and signals skip-doc-and-PR
    When the post-review outcome is decided for a failing review
    Then the post-review outcome selects the review_failed blocking stage
    And the post-review outcome signals the SDLC orchestrator to skip document and PR creation

  @adw-720 @adw-vba2wo-add-review-failed-bl
  Scenario: A passing review proceeds with document and PR creation and raises no skip signal
    When the post-review outcome is decided for a passing review
    Then the post-review outcome proceeds with document and PR creation

  # ── §2 SDLC review exhaustion blocks: review_failed, no PR, branch comment (AC4) ─
  #
  # THE end-to-end fix. An SDLC run whose review did not pass after the retry
  # budget honours the gate's skip signal: it records `review_failed` to top-level
  # state, creates NO PR, and posts a comment pointing at the branch so a human can
  # inspect and push a fix before posting `## Retry`. The run is seeded at a
  # pre-handoff stage with a worktree+branch; the failing handoff lands it at
  # `review_failed`. (Contract §2; User Stories 4, 9, 20.)

  @adw-720 @adw-vba2wo-add-review-failed-bl
  Scenario: An exhausted SDLC review blocks at review_failed without creating a PR and points a comment at the branch
    Given an issue 7201 exists in the mock issue tracker
    And the worktree for adwId "sdlc-720-fail" is initialised at branch "feature-issue-7201-rf"
    And a state file exists for adwId "sdlc-720-fail" at stage "review_running"
    And the mock GitHub API is configured to accept issue comments
    When the SDLC post-review handoff is executed for adwId "sdlc-720-fail" on issue 7201 after a failing review
    Then the state file for adwId "sdlc-720-fail" records workflowStage "review_failed"
    And the mock harness recorded zero PR creations for issue 7201
    And the mock GitHub API recorded a comment on issue 7201
    And the mock GitHub API recorded a comment containing the text "feature-issue-7201-rf"

  # ── §3 The money-fire pin — cron never re-fires a review_failed issue (AC2) ────
  #
  # Safety-critical. Once a run is blocked at `review_failed`, the cron backlog
  # sweep must leave it alone — it is neither re-spawned nor re-merged, no matter
  # how long it has sat idle. This is the explicit money-fire test the PRD calls
  # out (User Story 19): if `review_failed` ever slipped into the auto-spawn bucket,
  # a failing review would re-run a full orchestrator every tick with no human in
  # the loop. The direct mirror of feature-639 §4 (`human_gated` excluded) and
  # feature-527 §4 (`merge_blocked` excluded).

  @adw-720 @adw-vba2wo-add-review-failed-bl
  Scenario: The cron backlog filter leaves a review_failed workflow out of the sweep
    Given a backlog issue 7203 idle past the cron grace period whose latest ADW run is recorded at stage "review_failed"
    When the cron backlog filter evaluates the issue
    Then the cron backlog filter excludes the issue from the sweep

  # ── §4 ## Retry re-arms review_failed → phase_timeout; no-op otherwise (AC5/AC6) ─
  #
  # The human re-entry. A `## Retry` on a `review_failed` issue re-arms it to
  # `phase_timeout` and clears the resume counter — the stage from which the
  # existing resume-in-place machinery re-runs the review (the re-run itself is
  # owned by feature-637/#638, see Scope). The second scenario guards that adding
  # `review_failed` to the handler did not broaden it: a `## Retry` on a run at an
  # unrelated, non-human-gated stage leaves the stage untouched. Mirrors
  # feature-639 §5 and the retry-handler no-op contract.

  @adw-720 @adw-vba2wo-add-review-failed-bl
  Scenario: ## Retry on a review_failed SDLC issue re-arms it to phase_timeout and clears the resume counter
    Given an issue 7204 exists in the mock issue tracker
    And issue 7204 carries an ADW comment naming adwId "sdlc-720-retry"
    And a state file exists for adwId "sdlc-720-retry" at stage "review_failed"
    And the state file for adwId "sdlc-720-retry" is seeded with a resume attempt count of 2
    And issue 7204 has a comment whose body is "## Retry"
    When the "## Retry" directive is processed for issue 7204
    Then the state file for adwId "sdlc-720-retry" records workflowStage "phase_timeout"
    And the state file for adwId "sdlc-720-retry" records a resume attempt count of 0

  @adw-720 @adw-vba2wo-add-review-failed-bl
  Scenario: ## Retry is a no-op on a workflow that is not human-gated
    Given an issue 7205 exists in the mock issue tracker
    And issue 7205 carries an ADW comment naming adwId "sdlc-720-noop"
    And a state file exists for adwId "sdlc-720-noop" at stage "build_completed"
    And issue 7205 has a comment whose body is "## Retry"
    When the "## Retry" directive is processed for issue 7205
    Then the state file for adwId "sdlc-720-noop" records workflowStage "build_completed"

  # ── §5 Type-check backstop (AC1, AC7) ─────────────────────────────────────────
  #
  # The new `review_failed` stage joins the closed `WorkflowStage` union and is
  # given a `classifyStage` case, so the #636 `never`-exhaustiveness guard still
  # compiles. A backstop, consistent with feature-639 §6 and feature-719 §5 —
  # proving union + classification membership BEHAVIOURALLY via the compiler, never
  # by parsing source.

  @adw-720 @adw-vba2wo-add-review-failed-bl
  Scenario: The ADW TypeScript type-check passes with review_failed added to the stage taxonomy and classified
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
