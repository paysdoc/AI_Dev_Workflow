@regression @surface
Feature: adwPlan — planPhase — happy path

  Scenario: plan orchestrator's plan phase runs in-process, succeeds and posts its plan stage comments
    Given an issue 1002 exists in the mock issue tracker
    And the worktree for adwId "surface-02" is initialised at branch "surface-02"
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-plan-phase.json"
    When the "plan" phase of the "plan" orchestrator runs for adwId "surface-02"
    Then the "plan" phase run succeeded
    And the mock GitHub API recorded a comment on issue 1002
    And the mock GitHub API recorded a comment containing the text "## :pencil: Building Implementation Plan"
    And the mock GitHub API recorded a comment containing the text "## :white_check_mark: Implementation Plan Created"
    And the mock GitHub API recorded a comment containing the text "## :floppy_disk: Committing Plan"
