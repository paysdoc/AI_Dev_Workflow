@regression @smoke
Feature: SDLC Orchestrator — Cancel Directive (Scorched-Earth Flow)

  Scenario: orchestrator writes cancelled stage when ## Cancel directive is present
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/cancel-directive.json"
    And an issue 500 exists in the mock issue tracker
    And the worktree for adwId "cancel-smoke-500" is initialised at branch "cancel-500"
    And the mock GitHub API is configured to accept issue comments
    When the "sdlc" orchestrator is invoked with adwId "cancel-smoke-500" and issue 500
    Then the state file for adwId "cancel-smoke-500" records workflowStage "cancelled"
    And the orchestrator subprocess exited 0
    And the mock GitHub API recorded a comment on issue 500
