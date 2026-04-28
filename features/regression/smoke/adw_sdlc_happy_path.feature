@regression @smoke
Feature: SDLC Orchestrator — Happy Path

  # Smoke 1: adwSdlc end-to-end (issue → plan → build → test → review → document → PR).
  # Manifest pre-seeds .adw/state.json with awaiting_merge so T1 validates wiring;
  # T5/T8/T2 assert real subprocess and mock-API interactions.
  # T1 resolves the orchestrator state file at agents/{adwId}/state.json (production location); the G11 worktree is used only as a fallback for G6-seeded scenarios.
  Scenario: adwSdlc completes the full pipeline end-to-end
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-sdlc-happy.json"
    And an issue 100 exists in the mock issue tracker
    And the worktree for adwId "sdlc-smoke-100" is initialised at branch "feature-100"
    And the mock GitHub API is configured to accept issue comments
    When the "sdlc" orchestrator is invoked with adwId "sdlc-smoke-100" and issue 100
    Then the state file for adwId "sdlc-smoke-100" records workflowStage "awaiting_merge"
    And the orchestrator subprocess exited 0
    And the mock GitHub API recorded a PR creation for issue 100
    And the mock GitHub API recorded a comment on issue 100
    And the state file for adwId "sdlc-smoke-100" records no error
