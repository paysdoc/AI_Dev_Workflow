@adw-509 @adw-tdauam-promotion-commenter
Feature: promotionCommenter MVP — score, tag, and comment on per-issue PR events

  Issue #509 lands the tracer-bullet slice of the promotion mechanism
  described in specs/prd/scenario-rot-prevention-and-promotion.md. A new
  orchestrator (working name `adwPromotionSweep.tsx`) wraps the
  `promotionCommenter` entry point and is wired into per-issue PR events.
  For each scenario block in the changed per-issue .feature files the
  orchestrator:

    1. parses the scenario via `scenarioParser`
    2. scores it via `promotionScorer` against the repo's vocabulary
       registry (`vocabularyParser`) and observability-surfaces examples
       block
    3. compares the score to the hardcoded threshold of 3 returned by
       `promotionThreshold` (auto-ramp arrives in slice #7)
    4. when score ≥ 3, inserts a `@promotion-suggested-<today>` tag
       colocated with the scenario block via `promotionTagWriter`
       (add-suggestion only; refresh/remove arrive in slice #5)
    5. posts a single comment on the per-issue PR identifying the
       promoted scenario

  The five backing deep modules — `vocabularyParser`, `scenarioParser`,
  `promotionScorer`, `promotionThreshold`, `promotionTagWriter` — are pure
  functions covered by their own unit tests under `adws/__tests__/`. The
  scenarios in this file exercise the orchestrator end-to-end through the
  existing mock GitHub harness and assert against the artefacts the
  orchestrator produces: the modified `.feature` file under the test
  worktree (an output of `promotionTagWriter`, not a framework source file)
  and the recorded comments captured by the mock GitHub API. No assertion
  in this file is made against any framework source file; deep-module
  correctness is unit-tested separately.

  Scoring weights are constants inside `promotionScorer`: surface match 3,
  subprocess pattern 3, phase-import pattern 2, extra phase 1, mock-query
  0. hitl labelling, duplicate-suppression, and score-drop withdrawal are
  intentionally out of scope here and arrive in slice #5.

  Background:
    Given the ADW codebase is checked out

  # ── §1 above-threshold scenario is tagged and commented ───────────────

  @adw-509 @adw-tdauam-promotion-commenter
  Scenario: A per-issue scenario using the subprocess pattern with all phrases in vocabulary is tagged and commented
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/promotion-sweep-high-score.json"
    And the worktree for adwId "promo-509-1" is initialised at branch "feature-9090"
    And an issue 9090 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And a per-issue feature file at "features/per-issue/feature-9090.feature" is seeded into the worktree for adwId "promo-509-1" from fixture "promotion/high-score-subprocess.feature"
    When the "promotionSweep" orchestrator is invoked with adwId "promo-509-1" and issue 9090
    Then the orchestrator subprocess exited 0
    And the artefact file at "features/per-issue/feature-9090.feature" in the worktree for adwId "promo-509-1" carries a "@promotion-suggested-" tag dated today on the seeded scenario
    And the mock GitHub API recorded a comment on issue 9090
    And the mock GitHub API recorded a comment containing the text "@promotion-suggested-"

  # ── §2 below-threshold scenario is left alone ─────────────────────────

  @adw-509 @adw-tdauam-promotion-commenter
  Scenario: A per-issue scenario below the threshold receives no tag and no comment
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/promotion-sweep-low-score.json"
    And the worktree for adwId "promo-509-2" is initialised at branch "feature-9091"
    And an issue 9091 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And a per-issue feature file at "features/per-issue/feature-9091.feature" is seeded into the worktree for adwId "promo-509-2" from fixture "promotion/low-score-mock-query.feature"
    When the "promotionSweep" orchestrator is invoked with adwId "promo-509-2" and issue 9091
    Then the orchestrator subprocess exited 0
    And the artefact file at "features/per-issue/feature-9091.feature" in the worktree for adwId "promo-509-2" carries no "@promotion-suggested-" tag on the seeded scenario
    And the mock harness recorded zero comment posts on issue 9091

  # ── §3 byte-exact preservation of surrounding scenario content ────────

  @adw-509 @adw-tdauam-promotion-commenter
  Scenario: Tag insertion preserves byte-exact positions of surrounding scenario content
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/promotion-sweep-byte-exact.json"
    And the worktree for adwId "promo-509-3" is initialised at branch "feature-9092"
    And an issue 9092 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And a per-issue feature file at "features/per-issue/feature-9092.feature" is seeded into the worktree for adwId "promo-509-3" from fixture "promotion/multi-scenario-byte-exact.feature"
    When the "promotionSweep" orchestrator is invoked with adwId "promo-509-3" and issue 9092
    Then the orchestrator subprocess exited 0
    And the artefact file at "features/per-issue/feature-9092.feature" in the worktree for adwId "promo-509-3" carries a "@promotion-suggested-" tag dated today on the targeted scenario
    And every line of the artefact file at "features/per-issue/feature-9092.feature" in the worktree for adwId "promo-509-3" that is not the inserted tag line is byte-identical to the pre-invocation contents

  # ── §4 mixed-content per-issue file: only above-threshold scenarios tagged ─

  @adw-509 @adw-tdauam-promotion-commenter
  Scenario: Only above-threshold scenarios receive tags in a file containing scenarios of mixed scores
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/promotion-sweep-mixed-scores.json"
    And the worktree for adwId "promo-509-4" is initialised at branch "feature-9093"
    And an issue 9093 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And a per-issue feature file at "features/per-issue/feature-9093.feature" is seeded into the worktree for adwId "promo-509-4" from fixture "promotion/mixed-scores.feature"
    When the "promotionSweep" orchestrator is invoked with adwId "promo-509-4" and issue 9093
    Then the orchestrator subprocess exited 0
    And the artefact file at "features/per-issue/feature-9093.feature" in the worktree for adwId "promo-509-4" carries a "@promotion-suggested-" tag dated today on every scenario whose score is at least 3
    And the artefact file at "features/per-issue/feature-9093.feature" in the worktree for adwId "promo-509-4" carries no "@promotion-suggested-" tag on any scenario whose score is below 3

  # ── §5 comment content references the promoted scenario ──────────────

  @adw-509 @adw-tdauam-promotion-commenter
  Scenario: The PR comment posted by the orchestrator identifies the scenario whose tag was inserted
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/promotion-sweep-comment-body.json"
    And the worktree for adwId "promo-509-5" is initialised at branch "feature-9094"
    And an issue 9094 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And a per-issue feature file at "features/per-issue/feature-9094.feature" is seeded into the worktree for adwId "promo-509-5" from fixture "promotion/single-named-scenario.feature"
    When the "promotionSweep" orchestrator is invoked with adwId "promo-509-5" and issue 9094
    Then the orchestrator subprocess exited 0
    And the mock GitHub API recorded a comment on issue 9094
    And the mock GitHub API recorded a comment containing the text "promotion suggested"
    And the mock GitHub API recorded a comment containing the seeded scenario name from fixture "promotion/single-named-scenario.feature"
