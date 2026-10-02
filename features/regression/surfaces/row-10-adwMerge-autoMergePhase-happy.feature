@regression @surface @subprocess
Feature: adwMerge — autoMergePhase — happy path (PR already merged)

  Scenario: merge orchestrator finds the PR already merged, records the workflow completed and posts the completion comment without merging again
    Given an issue 1010 exists in the mock issue tracker
    And a workflow for adwId "surface-10" is awaiting merge of PR 1010 from branch "surface-10"
    And the mock GitHub API is configured to return PR 1010 as merged
    When the "merge" orchestrator is invoked with adwId "surface-10" and issue 1010
    Then the orchestrator subprocess exited 0
    And the state file for adwId "surface-10" records workflowStage "completed"
    And the mock GitHub API recorded a comment on issue 1010
    And the mock GitHub API recorded a comment containing the text "PR #1010 has been merged."
    And the mock harness recorded zero PR-merge calls
