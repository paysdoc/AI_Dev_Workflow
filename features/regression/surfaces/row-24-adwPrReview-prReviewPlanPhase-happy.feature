@regression @surface
Feature: adwPrReview — prReviewPlanPhase — happy path

  Scenario: pr-review orchestrator's plan phase runs in-process for a pull request with an unaddressed review comment, records pr_review_plan_completed and posts its planning comments on the pull request
    Given an issue 1024 exists in the mock issue tracker
    And the worktree for adwId "surface-24" is initialised at branch "surface-24"
    And an open pull request 1124 for issue 1024 from the branch "surface-24" exists in the mock GitHub API, with one unaddressed review comment
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-pr-review-plan-phase.json"
    When the "pr_review_plan" phase of the "pr-review" orchestrator runs for adwId "surface-24"
    Then the state file for adwId "surface-24" records workflowStage "pr_review_plan_completed"
    And the mock GitHub API recorded a comment on pull request 1124
    And the mock GitHub API recorded a comment containing the text "## :pencil: Planning PR Review Changes"
    And the mock GitHub API recorded a comment containing the text "## :white_check_mark: Revision Plan Created"
