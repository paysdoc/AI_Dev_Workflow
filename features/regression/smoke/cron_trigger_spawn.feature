@regression @smoke
Feature: SDLC Cron Probe — Trigger Spawn on Eligible Issue

  Scenario: cron probe dispatches a spawned orchestrator for an eligible issue
    Given an issue 300 exists in the mock issue tracker
    And the worktree for adwId "cron-smoke-300" is initialised at branch "cron-300"
    And the mock GitHub API is configured to accept issue comments
    When the cron probe runs once
    Then the mock GitHub API recorded a comment on issue 300
    And the orchestrator subprocess exited 0
