@regression @surface
Feature: adwPrReview — prReviewPlanPhase — happy path

  # Row 24: PR-review orchestrator posts a review comment.
  # DEFERRED-RUNTIME-GAP: W1 subprocess fails due to (1) spawnOrchestrator passes adwId before
  # issueNumber in CLI args (reversed vs orchestrator expected order) and (2) fetchGitHubIssue
  # uses gh CLI with GraphQL/HTTPS which cannot reach the HTTP mock server. Both require
  # Issue #1 step-definition fixes. Vocabulary and step matching are correct (dry-run passes).
  Scenario: pr-review orchestrator completes plan phase and posts a review comment
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-sdlc-happy.json"
    And an issue 1024 exists in the mock issue tracker
    And the mock GitHub API records all PR-list calls
    And the claude-cli-stub is loaded with fixture "review-agent.json"
    And the worktree for adwId "surface-24" is initialised at branch "surface-24"
    When the "pr-review" orchestrator is invoked with adwId "surface-24" and issue 1024
    Then the mock GitHub API recorded a comment on issue 1024
    And the orchestrator subprocess exited 0
