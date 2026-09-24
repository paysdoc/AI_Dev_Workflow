@adw-848 @adw-izqk31-review-phase-approve
Feature: The review phase leaves the pull request unapproved when the issue carries hitl, so a review pass can no longer open the human merge gate

  Issue #848. The merge gate (`adwMerge.tsx`, step 5b) holds a pull request while its issue carries
  `hitl` AND the pull request is not approved. `executeReviewPhase` approved every passing review's
  pull request without looking at the issue's labels, so on a `hitl` issue the review pass itself
  satisfied the gate's second clause. Observed on issue #840 / PR #843: the review phase approved
  three seconds after "Review passed!", and the chore orchestrator's own (correct) `hitl` check only
  ran five minutes later. The approval is served `GITHUB_PAT`, so GitHub records it as the human
  operator and nothing downstream can tell it from a human's — the fix has to live at the approval
  site, and the review must still count as passed.

  Each row is written to fail for a reason, not to restate an acceptance criterion:
    • the #840 reproduction fails while the phase approves regardless of labels — and for a fix that
      consults the repository's `.github/adw.yml` `hitl` flag (a different gate, for upgrade PRs,
      and `false` in this configuration) instead of the issue's label;
    • the "added after the workflow started" row fails for a fix that reads the labels frozen into
      the configuration's issue record at workflow init instead of asking the tracker when it
      approves. A human can add `hitl` at any point before the review passes; the chore
      orchestrator's check reads the tracker at that moment, and this site must too;
    • the unlabelled row fails for a fix that stops approving altogether (an inverted or
      over-broad condition);
    • the two non-fatal rows are GREEN TODAY and must stay green: a restructured approval block
      that calls the capability probe unguarded, or lets a failed approval escape, turns a passing
      review into a thrown phase;
    • the merge-gate row is the issue's regression proof. Its code host counts the approvals it
      submits as approving reviews — exactly as GitHub does with ADW's PAT-served approval — so
      the row fails whenever a review pass still approves, because the merge orchestrator then
      stops deferring. It is the candidate for promotion into the regression suite; promotion is
      a human decision.

  ── WHY THE UNIT-TEST CRITERION GETS NO SCENARIO ────────────────────────────────────────────
  "Unit tests cover both branches by asserting the `approvePullRequest` call" is an obligation on
  the vitest suite, discharged by the build and test phases. A scenario asserting that such a test
  exists would assert a source-file property, which the rot-prevention rule forbids; the behaviour
  those unit tests pin is asserted here directly, through recorded provider calls.

  ── HARNESS ─────────────────────────────────────────────────────────────────────────────────
  Reuses feature-796's recording launch boundary and feature-820's review-phase driver (the real
  `executeReviewPhase`, in-process, against the claude-cli-stub). feature-820's configuration
  phrase binds issue 42 on branch "feature-issue-42-void", which is why every issue below is 42
  and every pull request is 7 — distinct numbers, so a fix that asks for the labels of the pull
  request instead of the issue finds no `hitl` and fails the first row. The @adw-796/@adw-820
  hooks do not fire for @adw-848 rows; this feature's step definitions own their reset/cleanup.

  Background:
    Given the ADW codebase is checked out
    And a launch boundary for the repository "adw-fixture/void-848" whose providers record every call

  # ── §1  A hitl ISSUE'S PASSING REVIEW MUST NOT APPROVE (AC1) ──────────────────────────────
  #
  # Every row here reports that the code host CAN approve, so the issue's label is the only thing
  # left that can stop the approval. RED today: the phase approves pull request 7.

  @adw-848 @adw-izqk31-review-phase-approve
  Scenario: A passing review on an issue carrying hitl leaves the pull request unapproved and logs the skip naming the issue
    Given the recording code host reports that it can approve pull requests
    And a workflow configuration bound to that boundary whose pull request url names pull request 7
    And the issue record in that configuration carries the label "hitl"
    And issue 42 carries the label "hitl"
    And the ADW logger's output is captured
    When the review phase completes with no blocker issues for that configuration
    Then the boundary's code host recorded no approval
    And the review phase reported the review as passed
    And the captured log reports pull request approval skipped because issue 42 carries the "hitl" label

  @adw-848 @adw-izqk31-review-phase-approve
  Scenario: A hitl label a human added after the workflow started still stops the review phase approving
    Given the recording code host reports that it can approve pull requests
    And a workflow configuration bound to that boundary whose pull request url names pull request 7
    And the issue record in that configuration carries no labels
    And issue 42 carries the label "hitl"
    When the review phase completes with no blocker issues for that configuration
    Then the boundary's code host recorded no approval
    And the review phase reported the review as passed

  # ── §2  NO hitl — APPROVAL EXACTLY AS TODAY (AC2) ─────────────────────────────────────────

  @adw-848 @adw-izqk31-review-phase-approve
  Scenario: A passing review on an unlabelled issue approves the pull request exactly as before
    Given the recording code host reports that it can approve pull requests
    And a workflow configuration bound to that boundary whose pull request url names pull request 7
    And issue 42 carries no labels
    When the review phase completes with no blocker issues for that configuration
    Then the boundary's code host recorded an approval of pull request 7
    And the review phase reported the review as passed

  # ── §3  THE NON-FATAL PATHS STAY NON-FATAL (AC3) ──────────────────────────────────────────
  #
  # Both rows use an unlabelled issue so the approval path is actually reached whatever order the
  # fix checks the label and the capability in. In the first row the recording code host records
  # the approval request even though it reports the approval as failed — that recorded request is
  # what proves the failure path ran.

  @adw-848 @adw-izqk31-review-phase-approve
  Scenario: A failed approval on an unlabelled issue does not fail the passing review
    Given the recording code host reports that it can approve pull requests
    And the recording code host reports every pull request approval as failed
    And a workflow configuration bound to that boundary whose pull request url names pull request 7
    And issue 42 carries no labels
    When the review phase completes with no blocker issues for that configuration
    Then the boundary's code host recorded an approval of pull request 7
    And the review phase reported the review as passed

  @adw-848 @adw-izqk31-review-phase-approve
  Scenario: A code host that refuses the approval capability probe by name neither approves nor fails the passing review
    Given the recording code host refuses the approval capability probe by name
    And a workflow configuration bound to that boundary whose pull request url names pull request 7
    And issue 42 carries no labels
    When the review phase completes with no blocker issues for that configuration
    Then the boundary's code host recorded no approval
    And the review phase reported the review as passed

  # ── §4  THE hitl GATE SURVIVES A REVIEW PASS (AC5 — the regression proof) ──────────────────
  #
  # The review phase and the merge orchestrator share one recording boundary, so the merge gate
  # reads the same label and approval state the review phase left behind. RED today: the review
  # pass approves pull request 7, the code host then reports it approved, and the merge
  # orchestrator walks past the gate instead of deferring.

  @adw-848 @adw-izqk31-review-phase-approve
  Scenario: The hitl merge gate still defers the unapproved pull request after the review phase passes
    Given the recording code host reports that it can approve pull requests
    And the recording code host counts the approvals it submits as approving reviews
    And a workflow configuration bound to that boundary whose pull request url names pull request 7
    And issue 42 carries the label "hitl"
    And the branch "feature-issue-42-void" has a pull request numbered 7 in state "OPEN"
    And pull request 7 has no approving review
    And the merge orchestrator's production dependencies are built from that boundary
    When the review phase completes with no blocker issues for that configuration
    And the merge orchestrator runs for issue 42 under adw id "izqk31-void-merge"
    Then the merge orchestrator reports the outcome "abandoned" for reason "hitl_blocked_unapproved"
    And the boundary's code host recorded no approval
