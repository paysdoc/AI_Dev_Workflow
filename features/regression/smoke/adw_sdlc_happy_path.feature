@regression @smoke @subprocess
Feature: SDLC Orchestrator — Happy Path

  The real SDLC orchestrator runs every phase as a child process against the acme/widgets workspace,
  behind the gh shadow. Each agent is answered by its own entry in the scenario's manifest. The
  scenario proof runs no tag, because the manifest writes no step definition. The fixture's N/A
  unit-test command leaves no JUnit report, so the issue is labelled adw:unverified. The run ends
  awaiting_merge with the pull request open.

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
