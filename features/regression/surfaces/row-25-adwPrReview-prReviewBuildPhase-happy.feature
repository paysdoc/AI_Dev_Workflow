@regression @surface
Feature: adwPrReview — prReviewBuildPhase — happy path

  Scenario: pr-review orchestrator's build phase runs in-process over a revision plan for a pull request with an unaddressed review comment, records pr_review_build_completed and posts its implementing comments on the pull request
    Given an issue 1025 exists in the mock issue tracker
    And the worktree for adwId "surface-25" is initialised at branch "surface-25"
    And an open pull request 1125 for issue 1025 from the branch "surface-25" exists in the mock GitHub API, with one unaddressed review comment
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-pr-review-build-phase.json"
    When the "pr_review_build" phase of the "pr-review" orchestrator runs for adwId "surface-25"
    Then the state file for adwId "surface-25" records workflowStage "pr_review_build_completed"
    And the mock GitHub API recorded a comment on pull request 1125
    And the mock GitHub API recorded a comment containing the text "## :hammer_and_wrench: Implementing Review Changes"
    And the mock GitHub API recorded a comment containing the text "## :white_check_mark: Review Changes Implemented"
