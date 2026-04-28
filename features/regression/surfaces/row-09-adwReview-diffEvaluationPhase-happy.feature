@regression @surface
Feature: adwReview — diffEvaluationPhase — happy path

  # Row 9: diff evaluation phase runs post-review; state updated to awaiting_merge.
  Scenario: review orchestrator runs diff evaluation phase and exits successfully
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-sdlc-happy.json"
    And an issue 1009 exists in the mock issue tracker
    And the claude-cli-stub is loaded with fixture "review-agent.json"
    And the worktree for adwId "surface-09" is initialised at branch "surface-09"
    When the "review" orchestrator is invoked with adwId "surface-09" and issue 1009
    Then the state file for adwId "surface-09" records workflowStage "awaiting_merge"
    And the orchestrator subprocess exited 0
