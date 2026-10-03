@regression @surface
Feature: adwSdlc — reviewPhase — happy path

  There is no adwReview orchestrator. adwSdlc runs the review phase, with no phase name.

  Scenario: sdlc orchestrator's review phase runs in-process over a passing review and posts the review-passed comment carrying the review's summary
    Given an issue 1007 exists in the mock issue tracker
    And the worktree for adwId "surface-07" is initialised at branch "surface-07"
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-review-phase.json"
    When the "review" phase of the "sdlc" orchestrator runs for adwId "surface-07"
    Then the "review" phase run succeeded
    And the mock GitHub API recorded a comment on issue 1007
    And the mock GitHub API recorded a comment containing the text "## :mag: Review Running"
    And the mock GitHub API recorded a comment containing the text "## :white_check_mark: Review Passed"
    And the mock GitHub API recorded a comment containing the text "The surface review found no blockers."
