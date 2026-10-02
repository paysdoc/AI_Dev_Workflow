@regression @surface @subprocess
Feature: adwSdlc — cron probe — happy path: dispatch

  Scenario: cron probe finds the eligible issue 1030 and launches the sdlc orchestrator for it, for the target repository
    Given an issue 1030 exists in the mock issue tracker
    And the cron sweep is configured with empty queue
    When the cron probe runs once
    Then the "sdlc" orchestrator was launched for issue 1030
    And that launch named the target repository "acme/widgets"
