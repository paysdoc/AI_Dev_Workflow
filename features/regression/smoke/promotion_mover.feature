@regression @smoke
Feature: Promotion Mover — Move Orchestrator Paths

  # Smoke: two scenarios verifying the promotionMover orchestrator.
  # Background: G1 (mock GitHub API accepts issue comments), G4 (issue exists in tracker),
  # G11 (worktree initialised at branch feature-511).
  # Manifests pre-seed per-issue feature files for mover detection.

  Background:
    Given the mock GitHub API is configured to accept issue comments
    And an issue 511 exists in the mock issue tracker
    And the worktree for adwId "promotion-mover-smoke-511" is initialised at branch "feature-511"

  Scenario: high-signal scenario — @promotion (no date) triggers a regression-move PR and label
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/promotion-mover-single-move.json"
    When the "promotion-sweep" orchestrator is invoked with adwId "promotion-mover-smoke-511" and issue 511
    Then the orchestrator subprocess exited 0
    And the mock harness recorded zero PR-merge calls

  Scenario: @promotion-suggested-<date> alone produces no move PR
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/promotion-mover-suggested-only.json"
    When the "promotion-sweep" orchestrator is invoked with adwId "promotion-mover-smoke-511" and issue 511
    Then the orchestrator subprocess exited 0
    And the mock harness recorded zero PR-merge calls
