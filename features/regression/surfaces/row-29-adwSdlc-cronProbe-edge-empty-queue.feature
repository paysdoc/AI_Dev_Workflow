@regression @surface @subprocess
Feature: adwSdlc — cron probe — edge: empty queue

  Scenario: cron probe with no eligible issue in the queue launches no orchestrator
    Given the cron sweep is configured with empty queue
    When the cron probe runs once
    Then the cron launched no orchestrator
