@regression @surface
Feature: adwDocument — kpiPhase — happy path

  # Row 28: KPI phase runs after documentation; artefact written; state advances to awaiting_merge.
  Scenario: document orchestrator completes KPI phase and exits successfully
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-sdlc-happy.json"
    And an issue 1028 exists in the mock issue tracker
    And the claude-cli-stub is loaded with fixture "plan-agent.json"
    And the worktree for adwId "surface-28" is initialised at branch "surface-28"
    When the "document" orchestrator is invoked with adwId "surface-28" and issue 1028
    Then the state file for adwId "surface-28" records workflowStage "awaiting_merge"
    And the orchestrator subprocess exited 0
