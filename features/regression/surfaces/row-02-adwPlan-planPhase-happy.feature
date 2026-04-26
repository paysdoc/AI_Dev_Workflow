@regression @surface
Feature: adwPlan — planPhase — happy path

  # Row 2: plan orchestrator runs with stub fixture; state advances to awaiting_merge.
  Scenario: plan orchestrator completes plan phase and exits successfully
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-sdlc-happy.json"
    And an issue 1002 exists in the mock issue tracker
    And the claude-cli-stub is loaded with fixture "plan-agent.json"
    And the worktree for adwId "surface-02" is initialised at branch "surface-02"
    When the "plan" orchestrator is invoked with adwId "surface-02" and issue 1002
    Then the state file for adwId "surface-02" records workflowStage "awaiting_merge"
    And the orchestrator subprocess exited 0
