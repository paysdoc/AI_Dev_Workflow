@regression @surface
Feature: adwMerge — autoMergePhase — edge: PR not yet merged

  # Row 11: PR still open; orchestrator polls until timeout or exit; records at least one GET.
  Scenario: merge orchestrator exits cleanly when PR is still open
    Given an issue 1011 exists in the mock issue tracker
    And the mock GitHub API records all PR-list calls
    And the worktree for adwId "surface-11" is initialised at branch "surface-11"
    When the "merge" orchestrator is invoked with adwId "surface-11" and issue 1011
    Then the orchestrator subprocess exited 0
