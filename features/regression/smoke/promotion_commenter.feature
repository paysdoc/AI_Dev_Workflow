@regression @smoke
Feature: Promotion Commenter — Sweep Orchestrator Paths

  # Smoke: two scenarios verifying the promotion sweep orchestrator.
  # Background: G1, G4 issue 509, G11 worktree at branch feature-509.
  # Manifests pre-seed per-issue feature files for scoring.

  Background:
    Given the mock GitHub API is configured to accept issue comments
    And an issue 509 exists in the mock issue tracker
    And the worktree for adwId "promotion-smoke-509" is initialised at branch "feature-509"

  Scenario: high-score scenario — subprocess pattern scenario receives promotion tag and comment
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/promotion-sweep-high-score.json"
    When the "promotion-sweep" orchestrator is invoked with adwId "promotion-smoke-509" and issue 509
    Then the orchestrator subprocess exited 0
    And the mock GitHub API recorded a comment on issue 509
    And the mock GitHub API recorded an application of the "hitl" label on issue 509

  Scenario: low-score scenario — below-threshold scenario receives no tag and no comment
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/promotion-sweep-low-score.json"
    When the "promotion-sweep" orchestrator is invoked with adwId "promotion-smoke-509" and issue 509
    Then the orchestrator subprocess exited 0
    And the mock harness recorded zero PR-merge calls

  Scenario: same-day suppression — scenario already tagged today receives no duplicate comment
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/promotion-sweep-high-score.json"
    And a per-issue feature file at "features/per-issue/feature-509.feature" is seeded into the worktree for adwId "promotion-smoke-509" from fixture "promotion/high-score-subprocess.feature"
    And the seeded scenario in "features/per-issue/feature-509.feature" in the worktree for adwId "promotion-smoke-509" is pre-tagged with "@promotion-suggested-" dated today
    When the "promotion-sweep" orchestrator is invoked with adwId "promotion-smoke-509" and issue 509
    Then the orchestrator subprocess exited 0
    And the mock harness recorded zero comment posts on issue 509
    And the mock harness recorded zero applications of the "hitl" label on issue 509

  Scenario: date refresh — scenario tagged earlier with still-high score has tag refreshed and comment posted
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/promotion-sweep-high-score.json"
    And a per-issue feature file at "features/per-issue/feature-509.feature" is seeded into the worktree for adwId "promotion-smoke-509" from fixture "promotion/high-score-subprocess.feature"
    And the seeded scenario in "features/per-issue/feature-509.feature" in the worktree for adwId "promotion-smoke-509" is pre-tagged with "@promotion-suggested-" dated 5 days ago
    When the "promotion-sweep" orchestrator is invoked with adwId "promotion-smoke-509" and issue 509
    Then the orchestrator subprocess exited 0
    And the mock GitHub API recorded a comment on issue 509
    And the mock GitHub API recorded an application of the "hitl" label on issue 509

  Scenario: score-drop withdrawal — previously-tagged scenario now below threshold has tag removed and no comment posted
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/promotion-sweep-low-score.json"
    And a per-issue feature file at "features/per-issue/feature-509.feature" is seeded into the worktree for adwId "promotion-smoke-509" from fixture "promotion/low-score-mock-query.feature"
    And the seeded scenario in "features/per-issue/feature-509.feature" in the worktree for adwId "promotion-smoke-509" is pre-tagged with "@promotion-suggested-" dated 3 days ago
    When the "promotion-sweep" orchestrator is invoked with adwId "promotion-smoke-509" and issue 509
    Then the orchestrator subprocess exited 0
    And the mock harness recorded zero comment posts on issue 509
    And the artefact file at "features/per-issue/feature-509.feature" in the worktree for adwId "promotion-smoke-509" carries no "@promotion-suggested-" tag on the seeded scenario
