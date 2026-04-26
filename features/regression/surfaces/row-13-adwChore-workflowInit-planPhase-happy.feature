@regression @surface
Feature: adwChore — workflowInit + planPhase — happy path

  # Row 13: chore orchestrator: init + plan in one run; state at awaiting_merge.
  Scenario: chore orchestrator initialises workflow and completes plan phase
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-sdlc-happy.json"
    And an issue 1013 exists in the mock issue tracker
    And the claude-cli-stub is loaded with fixture "plan-agent.json"
    And the worktree for adwId "surface-13" is initialised at branch "surface-13"
    When the "chore" orchestrator is invoked with adwId "surface-13" and issue 1013
    Then the state file for adwId "surface-13" records workflowStage "awaiting_merge"
    And the orchestrator subprocess exited 0
