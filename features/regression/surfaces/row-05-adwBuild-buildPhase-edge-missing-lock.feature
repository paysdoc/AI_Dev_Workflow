@regression @surface
Feature: adwBuild — buildPhase — edge: missing lock (acquired and released)

  Scenario: build orchestrator's lifecycle holds the spawn-gate lock for the issue while it runs and releases it afterwards
    Given an issue 1005 exists in the mock issue tracker
    And no spawn lock exists for issue 1005
    And the worktree for adwId "surface-05" is initialised at branch "surface-05"
    When the "build" orchestrator's lifecycle runs for adwId "surface-05"
    Then the spawn-gate lock for issue 1005 was held by the orchestrator while its lifecycle ran
    And the spawn-gate lock for issue 1005 is released
