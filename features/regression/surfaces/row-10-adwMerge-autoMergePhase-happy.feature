@regression @surface
Feature: adwMerge — autoMergePhase — happy path (PR already merged)

  # Row 10: PR already merged in mock; auto-merge phase detects it; zero merge calls recorded.
  # DEFERRED-RUNTIME-GAP: W1 subprocess fails due to (1) spawnOrchestrator passes adwId before
  # issueNumber in CLI args (reversed vs orchestrator expected order) and (2) fetchGitHubIssue
  # uses gh CLI with GraphQL/HTTPS which cannot reach the HTTP mock server. Both require
  # Issue #1 step-definition fixes. Vocabulary and step matching are correct (dry-run passes).
  Scenario: merge orchestrator detects pre-merged PR and records zero merge calls
    Given an issue 1010 exists in the mock issue tracker
    And the mock GitHub API records all PR-list calls
    And the mock GitHub API is configured to return PR 1010 as merged
    And the worktree for adwId "surface-10" is initialised at branch "surface-10"
    When the "merge" orchestrator is invoked with adwId "surface-10" and issue 1010
    Then the orchestrator subprocess exited 0
    And the mock harness recorded zero PR-merge calls
