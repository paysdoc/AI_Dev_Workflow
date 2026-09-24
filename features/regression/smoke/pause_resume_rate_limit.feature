@regression @smoke
Feature: SDLC Orchestrator — Pause and Resume Around Rate-Limit Detection

  Scenario: orchestrator records paused stage on rate-limit detection
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/rate-limit-pause-resume.json"
    And an issue 400 exists in the mock issue tracker
    And the worktree for adwId "rate-limit-smoke-400" is initialised at branch "sdlc-400"
    And the mock GitHub API is configured to accept issue comments
    When the "sdlc" orchestrator is invoked with adwId "rate-limit-smoke-400" and issue 400
    Then the state file for adwId "rate-limit-smoke-400" records workflowStage "paused"
    And the orchestrator subprocess exited 0
