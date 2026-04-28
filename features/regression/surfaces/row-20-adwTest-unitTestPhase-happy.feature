@regression @surface
Feature: adwTest — unitTestPhase — happy path

  # Row 20: test orchestrator drives unit test phase; state advances to awaiting_merge.
  Scenario: test orchestrator completes unit test phase and exits successfully
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-sdlc-happy.json"
    And an issue 1020 exists in the mock issue tracker
    And the claude-cli-stub is loaded with fixture "plan-agent.json"
    And the worktree for adwId "surface-20" is initialised at branch "surface-20"
    When the "test" orchestrator is invoked with adwId "surface-20" and issue 1020
    Then the state file for adwId "surface-20" records workflowStage "awaiting_merge"
    And the orchestrator subprocess exited 0
