@regression @surface
Feature: adwReview — alignmentPhase — happy path

  # Row 34: alignment phase ensures plan/implementation agreement; state advances to awaiting_merge.
  # DEFERRED-RUNTIME-GAP: W1 subprocess fails due to (1) spawnOrchestrator passes adwId before
  # issueNumber in CLI args (reversed vs orchestrator expected order) and (2) fetchGitHubIssue
  # uses gh CLI with GraphQL/HTTPS which cannot reach the HTTP mock server. Both require
  # Issue #1 step-definition fixes. Vocabulary and step matching are correct (dry-run passes).
  Scenario: review orchestrator completes alignment phase and exits successfully
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-sdlc-happy.json"
    And an issue 1034 exists in the mock issue tracker
    And the claude-cli-stub is loaded with fixture "review-agent.json"
    And the worktree for adwId "surface-34" is initialised at branch "surface-34"
    When the "review" orchestrator is invoked with adwId "surface-34" and issue 1034
    Then the state file for adwId "surface-34" records workflowStage "awaiting_merge"
    And the orchestrator subprocess exited 0
