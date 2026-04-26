@regression @surface
Feature: adwPlan — workflowInit — happy path

  # Row 1: workflowInit called directly via W9 (phase-import); state file written at initialized stage.
  Scenario: workflow initialises and records initialized stage
    Given an issue 1001 exists in the mock issue tracker
    And the worktree for adwId "surface-01" is initialised at branch "surface-01"
    When the workflow is initialised with config "adwPlan-surface-01"
    Then the state file for adwId "surface-01" records workflowStage "initialized"
