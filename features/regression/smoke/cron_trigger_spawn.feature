@regression @smoke @subprocess
Feature: SDLC Cron Probe — Trigger Spawn on Eligible Issue

  The real cron trigger runs as a child process against the acme/widgets workspace, behind the gh
  shadow, until its first poll. Issue 300 is open, labelled adw:feature and an hour old, past the
  cron's grace period. The launch recorder catches the orchestrator launch the cron makes for it
  instead of running it. The harness then kills the cron, so no exit code is read.

  Scenario: cron probe launches the sdlc orchestrator for the eligible issue 300, for the target repository
    Given an issue 300 exists in the mock issue tracker
    When the cron probe runs once
    Then the "sdlc" orchestrator was launched for issue 300
    And that launch named the target repository "acme/widgets"
