@regression @surface
Feature: adwPatch — buildPhase — happy path

  Scenario: patch orchestrator's build phase runs in-process over a committed plan and records build_completed
    Given an issue 1017 exists in the mock issue tracker
    And the worktree for adwId "surface-17" is initialised at branch "surface-17"
    And the worktree for adwId "surface-17" has the plan for issue 1017 committed on its branch
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-build-phase.json"
    When the "build" phase of the "patch" orchestrator runs for adwId "surface-17"
    Then the state file for adwId "surface-17" records workflowStage "build_completed"
