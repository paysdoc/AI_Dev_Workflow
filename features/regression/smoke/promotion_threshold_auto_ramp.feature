@regression @smoke
Feature: Promotion Threshold — Auto-Ramp N from 90-day Activity Ratio

  Background:
    Given the mock GitHub API is configured to accept issue comments
    And an issue 512 exists in the mock issue tracker
    And the worktree for adwId "promotion-threshold-smoke-512" is initialised at branch "feature-512"

  Scenario: young repo — borderline-score scenario (score=4) is tagged because N = 3 (bootstrap)
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/promotion-threshold-young-repo.json"
    When the "promotion-sweep" orchestrator is invoked with adwId "promotion-threshold-smoke-512" and issue 512
    Then the orchestrator subprocess exited 0
    And the mock GitHub API recorded a comment on issue 512

  Scenario: mature repo — same borderline-score scenario is NOT tagged because N rises to 5
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/promotion-threshold-mature-repo.json"
    When the "promotion-sweep" orchestrator is invoked with adwId "promotion-threshold-smoke-512" and issue 512
    Then the orchestrator subprocess exited 0
    And the mock harness recorded zero PR-merge calls
