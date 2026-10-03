@regression @surface
Feature: adwChore — reviewPhase — happy path

  Scenario: chore orchestrator's review phase runs in-process for a chore over a passing review and posts the review-passed comment
    Given an issue 1015 exists in the mock issue tracker
    And the worktree for adwId "surface-15" is initialised at branch "surface-15"
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-review-phase.json"
    When the "review" phase of the "chore" orchestrator runs for adwId "surface-15"
    Then the "review" phase run succeeded
    And the mock GitHub API recorded a comment on issue 1015
    And the mock GitHub API recorded a comment containing the text "## :mag: Review Running"
    And the mock GitHub API recorded a comment containing the text "## :white_check_mark: Review Passed"
