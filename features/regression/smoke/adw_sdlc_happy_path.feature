@regression @smoke @subprocess
Feature: SDLC Orchestrator — Happy Path

  Scenario: adwSdlc completes the full pipeline end-to-end
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-sdlc-happy.json"
    And an issue 100 exists in the mock issue tracker
    When the "sdlc" orchestrator is invoked with adwId "sdlc-smoke-100" and issue 100
    Then the state file for adwId "sdlc-smoke-100" records workflowStage "awaiting_merge"
    And the orchestrator subprocess exited 0
    And the state file for adwId "sdlc-smoke-100" records no error
    And the mock GitHub API recorded a PR creation for issue 100
    And the mock GitHub API recorded a comment containing the text "## :white_check_mark: Review Passed"
    And the mock GitHub API recorded a comment containing the text "## :link: Pull Request Created"
    And the mock GitHub API recorded an application of the "adw:unverified" label on issue 100
