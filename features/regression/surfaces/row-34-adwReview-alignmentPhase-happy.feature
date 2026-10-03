@regression @surface
Feature: adwSdlc — alignmentPhase — happy path

  There is no adwReview orchestrator. adwSdlc runs the alignment phase, between the plan and the
  build, with no phase name.

  Scenario: sdlc orchestrator's alignment phase aligns the committed plan with the issue's committed scenario and posts its aligning and aligned comments
    Given an issue 1034 exists in the mock issue tracker
    And the worktree for adwId "surface-34" is initialised at branch "surface-34"
    And the worktree for adwId "surface-34" has the plan for issue 1034 committed on its branch
    And the worktree for adwId "surface-34" has a scenario for issue 1034 committed on its branch
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-alignment-phase.json"
    When the "alignment" phase of the "sdlc" orchestrator runs for adwId "surface-34"
    Then the "alignment" phase run succeeded
    And the mock GitHub API recorded a comment on issue 1034
    And the mock GitHub API recorded a comment containing the text "## :arrows_counterclockwise: Aligning Plan and Scenarios"
    And the mock GitHub API recorded a comment containing the text "Implementation plan and BDD scenarios have been aligned."
