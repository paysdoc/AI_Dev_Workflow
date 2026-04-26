@regression @surface
Feature: adwMerge — depauditSetup — happy path

  # Row 35: dep-audit setup phase runs as precursor to merge checks; state advances to awaiting_merge.
  Scenario: merge orchestrator completes dep-audit setup phase and exits successfully
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-sdlc-happy.json"
    And an issue 1035 exists in the mock issue tracker
    And the claude-cli-stub is loaded with fixture "plan-agent.json"
    And the worktree for adwId "surface-35" is initialised at branch "surface-35"
    When the "merge" orchestrator is invoked with adwId "surface-35" and issue 1035
    Then the state file for adwId "surface-35" records workflowStage "awaiting_merge"
    And the orchestrator subprocess exited 0
