@regression @surface
Feature: adwSdlc — cron probe — edge: empty queue

  # Row 29: cron sweep with no issues; only the issue-list request is made.
  Scenario: cron probe with empty issue queue makes exactly one API call and exits
    Given the cron sweep is configured with empty queue
    When the cron probe runs once
    Then the mock GitHub API recorded 1 total API calls
    And the orchestrator subprocess exited 0
