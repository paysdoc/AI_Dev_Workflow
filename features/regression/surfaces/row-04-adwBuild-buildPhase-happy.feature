@regression @surface
Feature: adwBuild — buildPhase — happy path

  Scenario: build orchestrator's build phase runs in-process over a committed plan, records build_completed and posts its build stage comments
    Given an issue 1004 exists in the mock issue tracker
    And the worktree for adwId "surface-04" is initialised at branch "surface-04"
    And the worktree for adwId "surface-04" has the plan for issue 1004 committed on its branch
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-build-phase.json"
    When the "build" phase of the "build" orchestrator runs for adwId "surface-04"
    Then the state file for adwId "surface-04" records workflowStage "build_completed"
    And the mock GitHub API recorded a comment on issue 1004
    And the mock GitHub API recorded a comment containing the text "## :hammer_and_wrench: Running Build"
    And the mock GitHub API recorded a comment containing the text "## :white_check_mark: Build Completed"
