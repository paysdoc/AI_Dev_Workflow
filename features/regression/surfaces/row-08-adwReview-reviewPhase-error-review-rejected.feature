@regression @surface
Feature: adwSdlc — reviewPhase — error: review rejected

  There is no adwReview orchestrator. adwSdlc runs the review phase. A review that finds a blocker
  does not fail the phase run: the phase resolves, reports the review failed, and leaves the patch
  and the retry to the orchestrator.

  Scenario: sdlc orchestrator's review phase resolves over a review with a blocker, posts the review-failed comment naming the blocker, and posts no review-passed comment
    Given an issue 1008 exists in the mock issue tracker
    And the worktree for adwId "surface-08" is initialised at branch "surface-08"
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-review-phase-rejected.json"
    When the "review" phase of the "sdlc" orchestrator runs for adwId "surface-08"
    Then the "review" phase run succeeded
    And the mock GitHub API recorded a comment on issue 1008
    And the mock GitHub API recorded a comment containing the text "## :x: Review Failed"
    And the mock GitHub API recorded a comment containing the text "The surface handler swallows its error"
    And the mock harness recorded zero comment posts on issue 1008 containing the text "## :white_check_mark: Review Passed"
