@regression @surface
Feature: adwPrReview — commitPushPhase — happy path

  Scenario: pr-review orchestrator's commit-push phase runs in-process, pushes the pull request's branch and records pr_review_commit_push_completed
    Given an issue 1026 exists in the mock issue tracker
    And the worktree for adwId "surface-26" is initialised at branch "surface-26"
    And a pull request 2026 for issue 1026 is open on the branch "surface-26" with a review comment to address
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-pr-review-commit-push.json"
    When the "pr_review_commit_push" phase of the "pr-review" orchestrator runs for adwId "surface-26"
    Then the git-mock recorded a push to branch "surface-26"
    And the state file for adwId "surface-26" records workflowStage "pr_review_commit_push_completed"
