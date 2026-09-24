@regression @surface
Feature: adwBuild — orchestratorLock — re-entry (edge: concurrent execution detected)

  Scenario: build orchestrator exits when spawn-gate lock is already held
    Given an issue 1032 exists in the mock issue tracker
    And a state file exists for adwId "surface-32" at stage "initialized"
    And the worktree for adwId "surface-32" is initialised at branch "surface-32"
    When the "build" orchestrator is invoked with adwId "surface-32" and issue 1032
    Then the orchestrator subprocess exited 0
