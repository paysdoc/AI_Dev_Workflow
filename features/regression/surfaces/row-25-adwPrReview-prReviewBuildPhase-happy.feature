@regression @surface
Feature: adwPrReview — prReviewBuildPhase — happy path

  # Row 25: build phase within PR-review flow; state advances to awaiting_merge.
  Scenario: pr-review orchestrator completes build phase and exits successfully
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-sdlc-happy.json"
    And an issue 1025 exists in the mock issue tracker
    And the claude-cli-stub is loaded with fixture "build-agent.json"
    And the worktree for adwId "surface-25" is initialised at branch "surface-25"
    When the "pr-review" orchestrator is invoked with adwId "surface-25" and issue 1025
    Then the state file for adwId "surface-25" records workflowStage "awaiting_merge"
    And the orchestrator subprocess exited 0
