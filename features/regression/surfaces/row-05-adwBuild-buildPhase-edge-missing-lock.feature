@regression @surface
Feature: adwBuild — buildPhase — edge: missing lock (acquired and released)

  # Row 5: no prior lock exists; orchestrator acquires lock, runs, releases lock on success.
  Scenario: build orchestrator acquires spawn-gate lock and releases it on success
    Given an issue 1005 exists in the mock issue tracker
    And no spawn lock exists for issue 1005
    And the worktree for adwId "surface-05" is initialised at branch "surface-05"
    When the "build" orchestrator is invoked with adwId "surface-05" and issue 1005
    Then the orchestrator subprocess exited 0
    And the spawn-gate lock for issue 1005 is released
