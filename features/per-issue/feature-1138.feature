@adw-1138 @adw-5qy9es-layer-rule-in-the-sc
Feature: A workflow whose scenario agent writes no scenario runs through build, test and review

  @adw-1138 @adw-5qy9es-layer-rule-in-the-sc @subprocess
  Scenario: adwSdlc, whose scenario agent writes no scenario for the issue, runs through build, test and review and ends awaiting merge with its pull request open
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-sdlc-no-scenarios.json"
    And an issue 113801 exists in the mock issue tracker
    When the "sdlc" orchestrator is invoked with adwId "sdlc-smoke-113801" and issue 113801
    Then the orchestrator subprocess exited 0
    And the state file for adwId "sdlc-smoke-113801" records workflowStage "awaiting_merge"
    And the state file for adwId "sdlc-smoke-113801" records no error
    And the branch of the workflow for adwId "sdlc-smoke-113801" has no commit touching "features/"
    And the mock GitHub API recorded a comment containing the text "## :white_check_mark: Build Completed"
    And the mock GitHub API recorded a comment containing the text "## :white_check_mark: Review Passed"
    And the mock GitHub API recorded a PR creation for issue 113801
