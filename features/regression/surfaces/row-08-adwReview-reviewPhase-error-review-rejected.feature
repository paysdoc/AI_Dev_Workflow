@regression @surface
Feature: adwReview — reviewPhase — error: review rejected

  # Row 8: stub returns rejection; orchestrator records error stage without posting comment.
  # DEFERRED-RUNTIME-GAP: W1 subprocess fails due to (1) spawnOrchestrator passes adwId before
  # issueNumber in CLI args (reversed vs orchestrator expected order) and (2) fetchGitHubIssue
  # uses gh CLI with GraphQL/HTTPS which cannot reach the HTTP mock server. Both require
  # Issue #1 step-definition fixes. Vocabulary and step matching are correct (dry-run passes).
  # NOTE: T9 reads from the G11 temp worktree; the orchestrator subprocess writes state to a
  # different path, so T9 will fail at runtime until state-path wiring is extended.
  Scenario: review orchestrator handles review rejection and records no error in worktree state
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-sdlc-happy.json"
    And an issue 1008 exists in the mock issue tracker
    And the claude-cli-stub is loaded with fixture "review-agent.json"
    And the worktree for adwId "surface-08" is initialised at branch "surface-08"
    When the "review" orchestrator is invoked with adwId "surface-08" and issue 1008
    Then the orchestrator subprocess exited 0
    And the state file for adwId "surface-08" records no error
