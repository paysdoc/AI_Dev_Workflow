@regression @surface
Feature: adwChore — planPhase — happy path

  Scenario: chore orchestrator's plan phase runs in-process under /chore, succeeds and posts its plan stage comments
    Given an issue 1013 exists in the mock issue tracker
    And the worktree for adwId "surface-13" is initialised at branch "surface-13"
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-chore-plan-phase.json"
    When the "plan" phase of the "chore" orchestrator runs for adwId "surface-13"
    Then the "plan" phase run succeeded
    And the mock GitHub API recorded a comment on issue 1013
    And the mock GitHub API recorded a comment containing the text "Issue classified as: **chore**"
    And the mock GitHub API recorded a comment containing the text "## :pencil: Building Implementation Plan"
    And the mock GitHub API recorded a comment containing the text "## :white_check_mark: Implementation Plan Created"
    And the mock GitHub API recorded a comment containing the text "## :floppy_disk: Committing Plan"
