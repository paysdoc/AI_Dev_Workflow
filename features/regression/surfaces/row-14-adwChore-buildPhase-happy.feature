@regression @surface
Feature: adwChore — buildPhase — happy path

  Scenario: chore orchestrator's build phase runs in-process under /chore over a committed plan, succeeds and posts its build stage comments
    Given an issue 1014 exists in the mock issue tracker
    And the worktree for adwId "surface-14" is initialised at branch "surface-14"
    And the worktree for adwId "surface-14" has the plan for issue 1014 committed on its branch
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-build-phase.json"
    When the "build" phase of the "chore" orchestrator runs for adwId "surface-14"
    Then the "build" phase run succeeded
    And the mock GitHub API recorded a comment on issue 1014
    And the mock GitHub API recorded a comment containing the text "## :hammer_and_wrench: Running Build"
    And the mock GitHub API recorded a comment containing the text "## :white_check_mark: Build Completed"
