@regression @surface
Feature: adwPrReview — commitPushPhase — happy path

  # Row 26: PR-review orchestrator pushes amended commit; git-mock records push.
  # DEFERRED-RUNTIME-GAP: W1 subprocess fails due to (1) spawnOrchestrator passes adwId before
  # issueNumber in CLI args (reversed vs orchestrator expected order) and (2) fetchGitHubIssue
  # uses gh CLI with GraphQL/HTTPS which cannot reach the HTTP mock server. Both require
  # Issue #1 step-definition fixes. Vocabulary and step matching are correct (dry-run passes).
  Scenario: pr-review orchestrator completes commit-push phase and git-mock records the push
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-sdlc-happy.json"
    And an issue 1026 exists in the mock issue tracker
    And the claude-cli-stub is loaded with fixture "review-agent.json"
    And the worktree for adwId "surface-26" is initialised at branch "surface-26"
    And the git-mock has a clean worktree at branch "surface-26"
    When the "pr-review" orchestrator is invoked with adwId "surface-26" and issue 1026
    Then the git-mock recorded a push to branch "surface-26"
    And the orchestrator subprocess exited 0
