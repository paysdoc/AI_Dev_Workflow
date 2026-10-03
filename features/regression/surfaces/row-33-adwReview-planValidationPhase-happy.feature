@regression @surface
Feature: planValidationPhase — happy path, driven directly

  No orchestrator in adws/*.tsx runs executePlanValidationPhase. There is no adwReview, and adwSdlc
  and the review orchestrators run the alignment phase in its place. This row drives the phase
  directly, over a committed plan and a committed scenario for the issue.

  Scenario: the plan validation phase, driven directly, finds the committed plan and the issue's committed scenario aligned and posts its validating and validated comments
    Given an issue 1033 exists in the mock issue tracker
    And the worktree for adwId "surface-33" is initialised at branch "surface-33"
    And the worktree for adwId "surface-33" has the plan for issue 1033 committed on its branch
    And the worktree for adwId "surface-33" has a scenario for issue 1033 committed on its branch
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-plan-validation-phase.json"
    When the "plan validation" phase, which no orchestrator runs, is driven directly for adwId "surface-33"
    Then the "plan validation" phase run succeeded
    And the mock GitHub API recorded a comment on issue 1033
    And the mock GitHub API recorded a comment containing the text "## :mag: Validating Plan-Scenario Alignment"
    And the mock GitHub API recorded a comment containing the text "Implementation plan and BDD scenarios are aligned."
