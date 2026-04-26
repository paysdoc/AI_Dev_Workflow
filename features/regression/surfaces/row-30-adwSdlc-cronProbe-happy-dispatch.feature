@regression @surface
Feature: adwSdlc — cron probe — happy path: dispatch

  # Row 30: cron sweep finds one eligible issue and dispatches; comment posted.
  Scenario: cron probe finds eligible issue and dispatches orchestrator with comment
    Given an issue 1030 exists in the mock issue tracker
    And the cron sweep is configured with empty queue
    When the cron probe runs once
    Then the mock GitHub API recorded a comment on issue 1030
    And the orchestrator subprocess exited 0
