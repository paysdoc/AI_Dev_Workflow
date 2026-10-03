@regression @smoke @subprocess
Feature: SDLC Orchestrator — Pause and Resume Around Rate-Limit Detection

  Scenario: orchestrator records paused stage on rate-limit detection
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/rate-limit-pause-resume.json"
    And an issue 400 exists in the mock issue tracker
    When the "sdlc" orchestrator is invoked with adwId "rate-limit-smoke-400" and issue 400
    Then the state file for adwId "rate-limit-smoke-400" records workflowStage "paused"
    And the orchestrator subprocess exited 0
    And the mock GitHub API recorded a comment containing the text "`seven_day` rate limit detected"
