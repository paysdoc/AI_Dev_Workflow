@regression @surface
Feature: adwPlan — orchestratorLock — acquired and released (happy path)

  # Row 31: lock acquired at start, released on success; exit 0.
  Scenario: plan orchestrator acquires spawn-gate lock and releases it on success
    Given an issue 1031 exists in the mock issue tracker
    And no spawn lock exists for issue 1031
    And the worktree for adwId "surface-31" is initialised at branch "surface-31"
    When the "plan" orchestrator is invoked with adwId "surface-31" and issue 1031
    Then the spawn-gate lock for issue 1031 is released
    And the orchestrator subprocess exited 0
