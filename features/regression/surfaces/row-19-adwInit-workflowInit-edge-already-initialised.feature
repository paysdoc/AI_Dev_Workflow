@regression @surface @subprocess
Feature: adwPlan — workflowInit — edge: already initialised, for another repository

  Scenario: adwPlan's workflow init for an adwId whose prior run recorded another repository fails closed, leaving the prior stage as it was and posting nothing
    Given an issue 1019 exists in the mock issue tracker
    And a prior run for adwId "surface-19" recorded workflowStage "build_completed" for the repository "acme/gadgets"
    When the workflow is initialised with config "adwPlan-surface-19"
    Then the orchestrator subprocess exited 1
    And the orchestrator subprocess's output contains "Repo identity mismatch: launch=acme/widgets persisted=acme/gadgets"
    And the state file for adwId "surface-19" records workflowStage "build_completed"
    And the mock harness recorded zero comment posts on issue 1019
