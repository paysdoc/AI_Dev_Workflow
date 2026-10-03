@regression @surface
Feature: adwPlan — planPhase — error: stub failure

  Scenario: plan orchestrator's plan phase fails when the stub answers the plan agent with an error, and posts no plan-created comment
    Given an issue 1003 exists in the mock issue tracker
    And the worktree for adwId "surface-03" is initialised at branch "surface-03"
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-plan-phase-error.json"
    When the "plan" phase of the "plan" orchestrator runs for adwId "surface-03"
    Then the "plan" phase run failed
    And the mock GitHub API recorded a comment on issue 1003
    And the mock GitHub API recorded a comment containing the text "## :pencil: Building Implementation Plan"
    And the mock harness recorded zero comment posts on issue 1003 containing the text "## :white_check_mark: Implementation Plan Created"
