@regression @surface
Feature: adwInit — workflowInit — edge: already initialised

  # Row 19: state file pre-exists at initialized; orchestrator should not reinitialize.
  # DEFERRED-RUNTIME-GAP: W1 subprocess fails due to (1) spawnOrchestrator passes adwId before
  # issueNumber in CLI args (reversed vs orchestrator expected order) and (2) fetchGitHubIssue
  # uses gh CLI with GraphQL/HTTPS which cannot reach the HTTP mock server. Both require
  # Issue #1 step-definition fixes. Vocabulary and step matching are correct (dry-run passes).
  Scenario: init orchestrator detects pre-existing initialised state and exits cleanly
    Given an issue 1019 exists in the mock issue tracker
    And a state file exists for adwId "surface-19" at stage "initialized"
    And the worktree for adwId "surface-19" is initialised at branch "surface-19"
    When the "init" orchestrator is invoked with adwId "surface-19" and issue 1019
    Then the orchestrator subprocess exited 0
