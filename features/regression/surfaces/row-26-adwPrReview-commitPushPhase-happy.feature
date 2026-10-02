@regression @surface
Feature: adwPrReview — commitPushPhase — happy path

  Scenario: pr-review orchestrator's commit-push phase runs in-process, pushes the pull request's branch through the git-mock, records pr_review_commit_push_completed and posts its commit and push comments on the pull request
    Given an issue 1026 exists in the mock issue tracker
    And the worktree for adwId "surface-26" is initialised at branch "surface-26"
    And an open pull request 1126 for issue 1026 from the branch "surface-26" exists in the mock GitHub API, with one unaddressed review comment
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-pr-review-commit-push-phase.json"
    When the "pr_review_commit_push" phase of the "pr-review" orchestrator runs for adwId "surface-26"
    Then the git-mock recorded a push to branch "surface-26"
    And the state file for adwId "surface-26" records workflowStage "pr_review_commit_push_completed"
    And the mock GitHub API recorded a comment on pull request 1126
    And the mock GitHub API recorded a comment containing the text "## :floppy_disk: Committing Review Changes"
    And the mock GitHub API recorded a comment containing the text "## :rocket: Changes Pushed"
