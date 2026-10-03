@regression @surface @subprocess
Feature: adwPatch — planPhase — happy path

  Scenario: a full patch orchestrator run, which plans in its own patch phase, completes and opens a pull request for the issue
    Given an issue 1016 exists in the mock issue tracker
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-patch-run.json"
    When the "patch" orchestrator is invoked with adwId "surface-16" and issue 1016
    Then the orchestrator subprocess exited 0
    And the state file for adwId "surface-16" records workflowStage "completed"
    And the mock GitHub API recorded a PR creation for issue 1016
