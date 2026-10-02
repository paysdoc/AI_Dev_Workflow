@regression @surface
Feature: adwBuild — orchestratorLock — re-entry (edge: concurrent execution detected)

  Scenario: build orchestrator's lifecycle does not run the workflow while another live process holds the spawn-gate lock, and leaves that process holding it
    Given an issue 1032 exists in the mock issue tracker
    And the worktree for adwId "surface-32" is initialised at branch "surface-32"
    And another live process holds the spawn lock for issue 1032 in the repository "acme/widgets"
    When the "build" orchestrator's lifecycle runs for adwId "surface-32"
    Then the orchestrator's lifecycle for adwId "surface-32" did not run the workflow
    And the spawn-gate lock for issue 1032 is still held by the other live process
