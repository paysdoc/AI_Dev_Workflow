@regression @surface @subprocess
Feature: adwMerge — autoMergePhase — edge: PR not yet merged

  Scenario: merge orchestrator merges the still-open PR, records the workflow completed and posts the completion comment
    Given an issue 1011 exists in the mock issue tracker
    And a workflow for adwId "surface-11" is awaiting merge of PR 1011 from branch "surface-11"
    When the "merge" orchestrator is invoked with adwId "surface-11" and issue 1011
    Then the orchestrator subprocess exited 0
    And the state file for adwId "surface-11" records workflowStage "completed"
    And the mock GitHub API recorded a merge of PR 1011
    And the mock GitHub API recorded a comment on issue 1011
    And the mock GitHub API recorded a comment containing the text "PR #1011 has been merged successfully."
