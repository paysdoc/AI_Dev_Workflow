@regression @surface
Feature: adwMerge — prPhase — happy path

  # Row 12: stub returns PR payload; PR creation recorded in mock.
  # DEFERRED-RUNTIME-GAP: W1 subprocess fails due to (1) spawnOrchestrator passes adwId before
  # issueNumber in CLI args (reversed vs orchestrator expected order) and (2) fetchGitHubIssue
  # uses gh CLI with GraphQL/HTTPS which cannot reach the HTTP mock server. Both require
  # Issue #1 step-definition fixes. Vocabulary and step matching are correct (dry-run passes).
  Scenario: merge orchestrator creates PR via prPhase and mock records it
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-sdlc-happy.json"
    And an issue 1012 exists in the mock issue tracker
    And the claude-cli-stub is loaded with fixture "plan-agent.json"
    And the worktree for adwId "surface-12" is initialised at branch "surface-12"
    When the "merge" orchestrator is invoked with adwId "surface-12" and issue 1012
    Then the mock GitHub API recorded a PR creation for issue 1012
    And the orchestrator subprocess exited 0
