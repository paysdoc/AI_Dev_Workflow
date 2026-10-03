@regression @surface
Feature: adwTest — unitTestPhase — happy path

  Scenario: test orchestrator's unit-test phase runs in-process under the phase name test, succeeds and records test_completed
    Given an issue 1020 exists in the mock issue tracker
    And the worktree for adwId "surface-20" is initialised at branch "surface-20"
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-unit-test-phase.json"
    When the "unit test" phase of the "test" orchestrator runs for adwId "surface-20"
    Then the "unit test" phase run succeeded
    And the state file for adwId "surface-20" records workflowStage "test_completed"
