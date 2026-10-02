@regression @surface
Feature: adwPlan — orchestratorLock — acquired and released (happy path)

  Scenario: plan orchestrator's lifecycle holds the spawn-gate lock for the issue while it runs and releases it afterwards
    Given an issue 1031 exists in the mock issue tracker
    And no spawn lock exists for issue 1031
    And the worktree for adwId "surface-31" is initialised at branch "surface-31"
    When the "plan" orchestrator's lifecycle runs for adwId "surface-31"
    Then the spawn-gate lock for issue 1031 was held by the orchestrator while its lifecycle ran
    And the spawn-gate lock for issue 1031 is released
