@regression @surface
Feature: adwPrReview — prReviewBuildPhase — happy path

  Scenario: pr-review orchestrator's build phase runs in-process over the revision plan and records pr_review_build_completed
    Given an issue 1025 exists in the mock issue tracker
    And the worktree for adwId "surface-25" is initialised at branch "surface-25"
    And a pull request 2025 for issue 1025 is open on the branch "surface-25" with a review comment to address
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-build-phase.json"
    When the "pr_review_build" phase of the "pr-review" orchestrator runs for adwId "surface-25"
    Then the state file for adwId "surface-25" records workflowStage "pr_review_build_completed"
