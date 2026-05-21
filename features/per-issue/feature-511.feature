@adw-511 @adw-2wrg9y-promotion-mover-prom
Feature: promotionMover — @promotion tag opens separate PR moving scenario to regression directory

  Issue #511 completes the HITL promotion loop described in
  specs/prd/scenario-rot-prevention-and-promotion.md. Building on the
  promotionCommenter slice landed by issue #509, this slice adds the
  `promotionMover` orchestrator that consumes the human approval signal:

    1. on per-issue PR events, scan changed `.feature` files for the
       `@promotion` tag with NO date suffix (the human-applied signal
       produced by editing `@promotion-suggested-<date>` to
       `@promotion`)
    2. for each detected scenario, open a SEPARATE PR that moves the
       scenario block from the per-issue file into the regression
       directory resolved from `.adw/scenarios.md`; the `@promotion`
       tag is stripped in the destination
    3. apply the `regression-promotion` label to the new PR so its
       purpose is visible in PR lists

  `promotionMover` is wired into the existing per-issue PR event entry
  point alongside `promotionCommenter`. On every per-issue PR event the
  orchestrator (working name `adwPromotionSweep.tsx`, invoked as the
  `promotion-sweep` orchestrator) runs the commenter first (scoring +
  suggestion) and then the mover (move on explicit human approval).

  Scenarios in this file exercise the orchestrator end-to-end through
  the existing mock GitHub harness and assert against the artefacts
  the orchestrator produces: the recorded PR creation calls and label
  application calls captured by the mock GitHub API, the git-mock
  recorded branch/commit/push activity, and the per-issue and
  regression `.feature` files staged on the move branch under the test
  worktree (outputs of `promotionMover`, not framework source files).
  No assertion in this file is made against any framework source file;
  deep-module correctness (parsing, tag stripping) is unit-tested
  separately.

  The README documentation acceptance criterion — covering the
  `@promotion-suggested-<date>` and `@promotion` vocabulary, the human
  edit gate, and the resulting move PR — is verified by human PR
  review of the README change and is not encoded as a scenario here;
  asserting against README source content would be the rot pattern
  this PRD was designed to stop.

  Background:
    Given the ADW codebase is checked out

  # ── §1 single @promotion tag triggers a separate move PR ──────────────

  @adw-511 @adw-2wrg9y-promotion-mover-prom
  Scenario: A per-issue scenario carrying @promotion (no date) triggers a regression-move PR
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/promotion-mover-single-move.json"
    And the worktree for adwId "promo-mv-511-1" is initialised at branch "feature-9095"
    And an issue 9095 exists in the mock issue tracker
    And the mock GitHub API is configured to accept PR creation
    And a per-issue feature file at "features/per-issue/feature-9095.feature" is seeded into the worktree for adwId "promo-mv-511-1" from fixture "promotion-mover/single-approved.feature"
    When the "promotion-sweep" orchestrator is invoked with adwId "promo-mv-511-1" and issue 9095
    Then the orchestrator subprocess exited 0
    And the mock GitHub API recorded a PR creation distinct from the per-issue PR for issue 9095
    And the mock GitHub API recorded zero PR creation calls modifying the per-issue PR head branch for issue 9095

  # ── §2 the move PR carries the regression-promotion label ─────────────

  @adw-511 @adw-2wrg9y-promotion-mover-prom
  Scenario: The move PR opened by promotionMover carries the regression-promotion label
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/promotion-mover-labeled.json"
    And the worktree for adwId "promo-mv-511-2" is initialised at branch "feature-9096"
    And an issue 9096 exists in the mock issue tracker
    And the mock GitHub API is configured to accept PR creation
    And the mock GitHub API is configured to accept label application
    And a per-issue feature file at "features/per-issue/feature-9096.feature" is seeded into the worktree for adwId "promo-mv-511-2" from fixture "promotion-mover/single-approved.feature"
    When the "promotion-sweep" orchestrator is invoked with adwId "promo-mv-511-2" and issue 9096
    Then the orchestrator subprocess exited 0
    And the mock GitHub API recorded a label application of "regression-promotion" on the move PR opened by promotionMover

  # ── §3 the moved scenario in the regression artefact has @promotion stripped ─

  @adw-511 @adw-2wrg9y-promotion-mover-prom
  Scenario: The moved scenario in the destination regression file does not carry the @promotion tag
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/promotion-mover-strip-tag.json"
    And the worktree for adwId "promo-mv-511-3" is initialised at branch "feature-9097"
    And an issue 9097 exists in the mock issue tracker
    And the mock GitHub API is configured to accept PR creation
    And a per-issue feature file at "features/per-issue/feature-9097.feature" is seeded into the worktree for adwId "promo-mv-511-3" from fixture "promotion-mover/single-approved.feature"
    When the "promotion-sweep" orchestrator is invoked with adwId "promo-mv-511-3" and issue 9097
    Then the orchestrator subprocess exited 0
    And the regression-bound artefact file produced by promotionMover for adwId "promo-mv-511-3" contains the seeded scenario from fixture "promotion-mover/single-approved.feature"
    And the regression-bound artefact file produced by promotionMover for adwId "promo-mv-511-3" carries no "@promotion" tag on the moved scenario
    And the regression-bound artefact file produced by promotionMover for adwId "promo-mv-511-3" carries no "@promotion-suggested-" tag on the moved scenario

  # ── §4 the original per-issue file no longer contains the moved scenario ──

  @adw-511 @adw-2wrg9y-promotion-mover-prom
  Scenario: The per-issue file on the move branch no longer contains the moved scenario block
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/promotion-mover-removes-source.json"
    And the worktree for adwId "promo-mv-511-4" is initialised at branch "feature-9098"
    And an issue 9098 exists in the mock issue tracker
    And the mock GitHub API is configured to accept PR creation
    And a per-issue feature file at "features/per-issue/feature-9098.feature" is seeded into the worktree for adwId "promo-mv-511-4" from fixture "promotion-mover/single-approved.feature"
    When the "promotion-sweep" orchestrator is invoked with adwId "promo-mv-511-4" and issue 9098
    Then the orchestrator subprocess exited 0
    And the per-issue artefact file at "features/per-issue/feature-9098.feature" on the move branch produced by promotionMover for adwId "promo-mv-511-4" no longer contains the moved scenario block

  # ── §5 @promotion-suggested-<date> alone does NOT trigger a move ──────

  @adw-511 @adw-2wrg9y-promotion-mover-prom
  Scenario: A scenario carrying only @promotion-suggested-<date> (with date suffix) does not trigger a move PR
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/promotion-mover-suggested-only.json"
    And the worktree for adwId "promo-mv-511-5" is initialised at branch "feature-9099"
    And an issue 9099 exists in the mock issue tracker
    And the mock GitHub API is configured to accept PR creation
    And a per-issue feature file at "features/per-issue/feature-9099.feature" is seeded into the worktree for adwId "promo-mv-511-5" from fixture "promotion-mover/suggested-only.feature"
    When the "promotion-sweep" orchestrator is invoked with adwId "promo-mv-511-5" and issue 9099
    Then the orchestrator subprocess exited 0
    And the mock harness recorded zero move PRs opened by promotionMover for adwId "promo-mv-511-5"

  # ── §6 no promotion tags → no move PR opened ──────────────────────────

  @adw-511 @adw-2wrg9y-promotion-mover-prom
  Scenario: A per-issue file with no promotion tags produces no move PR
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/promotion-mover-no-action.json"
    And the worktree for adwId "promo-mv-511-6" is initialised at branch "feature-9100"
    And an issue 9100 exists in the mock issue tracker
    And the mock GitHub API is configured to accept PR creation
    And a per-issue feature file at "features/per-issue/feature-9100.feature" is seeded into the worktree for adwId "promo-mv-511-6" from fixture "promotion-mover/no-promotion-tags.feature"
    When the "promotion-sweep" orchestrator is invoked with adwId "promo-mv-511-6" and issue 9100
    Then the orchestrator subprocess exited 0
    And the mock harness recorded zero move PRs opened by promotionMover for adwId "promo-mv-511-6"

  # ── §7 multiple @promotion tags → one separate move PR per scenario ───

  @adw-511 @adw-2wrg9y-promotion-mover-prom
  Scenario: A per-issue file with multiple @promotion-tagged scenarios opens one separate move PR per scenario
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/promotion-mover-multiple-approvals.json"
    And the worktree for adwId "promo-mv-511-7" is initialised at branch "feature-9101"
    And an issue 9101 exists in the mock issue tracker
    And the mock GitHub API is configured to accept PR creation
    And the mock GitHub API is configured to accept label application
    And a per-issue feature file at "features/per-issue/feature-9101.feature" is seeded into the worktree for adwId "promo-mv-511-7" from fixture "promotion-mover/two-approved.feature"
    When the "promotion-sweep" orchestrator is invoked with adwId "promo-mv-511-7" and issue 9101
    Then the orchestrator subprocess exited 0
    And the mock harness recorded 2 move PRs opened by promotionMover for adwId "promo-mv-511-7"
    And every move PR opened by promotionMover for adwId "promo-mv-511-7" carries the "regression-promotion" label

  # ── §8 mixed-tag file: only @promotion (no date) is moved ─────────────

  @adw-511 @adw-2wrg9y-promotion-mover-prom
  Scenario: In a mixed-tag file, only scenarios with @promotion (no date) are moved; @promotion-suggested-<date> scenarios stay
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/promotion-mover-mixed-tags.json"
    And the worktree for adwId "promo-mv-511-8" is initialised at branch "feature-9102"
    And an issue 9102 exists in the mock issue tracker
    And the mock GitHub API is configured to accept PR creation
    And a per-issue feature file at "features/per-issue/feature-9102.feature" is seeded into the worktree for adwId "promo-mv-511-8" from fixture "promotion-mover/mixed-approval-and-suggestion.feature"
    When the "promotion-sweep" orchestrator is invoked with adwId "promo-mv-511-8" and issue 9102
    Then the orchestrator subprocess exited 0
    And the mock harness recorded 1 move PR opened by promotionMover for adwId "promo-mv-511-8"
    And the per-issue artefact file at "features/per-issue/feature-9102.feature" on the move branch produced by promotionMover for adwId "promo-mv-511-8" still contains every scenario tagged "@promotion-suggested-"
