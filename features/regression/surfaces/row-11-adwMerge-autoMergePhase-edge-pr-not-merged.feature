@regression @surface
Feature: adwMerge — autoMergePhase — edge: PR not yet merged

  # Row 11: PR still open; orchestrator polls until timeout or exit; records at least one GET.
  # DEFERRED-RUNTIME-GAP: W1 subprocess fails due to (1) spawnOrchestrator passes adwId before
  # issueNumber in CLI args (reversed vs orchestrator expected order) and (2) fetchGitHubIssue
  # uses gh CLI with GraphQL/HTTPS which cannot reach the HTTP mock server. Both require
  # Issue #1 step-definition fixes. Vocabulary and step matching are correct (dry-run passes).
  Scenario: merge orchestrator exits cleanly when PR is still open
    Given an issue 1011 exists in the mock issue tracker
    And the mock GitHub API records all PR-list calls
    And the worktree for adwId "surface-11" is initialised at branch "surface-11"
    When the "merge" orchestrator is invoked with adwId "surface-11" and issue 1011
    Then the orchestrator subprocess exited 0
