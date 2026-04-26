@regression @surface
Feature: adwChore — reviewPhase — happy path

  # Row 15: review phase within chore flow; orchestrator posts comment.
  # DEFERRED-RUNTIME-GAP: W1 subprocess fails due to (1) spawnOrchestrator passes adwId before
  # issueNumber in CLI args (reversed vs orchestrator expected order) and (2) fetchGitHubIssue
  # uses gh CLI with GraphQL/HTTPS which cannot reach the HTTP mock server. Both require
  # Issue #1 step-definition fixes. Vocabulary and step matching are correct (dry-run passes).
  Scenario: chore orchestrator completes review phase and posts a comment
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-sdlc-happy.json"
    And an issue 1015 exists in the mock issue tracker
    And the mock GitHub API records all PR-list calls
    And the claude-cli-stub is loaded with fixture "review-agent.json"
    And the worktree for adwId "surface-15" is initialised at branch "surface-15"
    When the "chore" orchestrator is invoked with adwId "surface-15" and issue 1015
    Then the mock GitHub API recorded a comment on issue 1015
    And the orchestrator subprocess exited 0
