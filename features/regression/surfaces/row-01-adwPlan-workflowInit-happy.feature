@regression @surface @subprocess
Feature: adwPlan — workflowInit — happy path

  Scenario: workflow init records the starting stage and posts the workflow-started comment
    Given an issue 1001 exists in the mock issue tracker
    When the workflow is initialised with config "adwPlan-surface-01"
    Then the orchestrator subprocess exited 0
    And the state file for adwId "surface-01" records workflowStage "starting"
    And the mock GitHub API recorded a comment on issue 1001
    And the mock GitHub API recorded a comment containing the text "## :rocket: ADW Workflow Started"
