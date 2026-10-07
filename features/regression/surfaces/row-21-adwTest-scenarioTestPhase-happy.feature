@regression @surface
Feature: adwSdlc — scenarioTestPhase — happy path

  adwTest runs only the unit-test phase. adwSdlc runs the scenario test phase, in its scenario
  test-and-fix loop. With step definitions in the worktree, the phase runs the cli-tool fixture's
  scenario command for the fixed regression tag. No feature file of the fixture carries the
  issue's own tag, so the per-issue tag is not run. The command keeps its sh code fence, so the
  shell exits 127 and the regression tag fails. A failed blocker tag is an outcome the loop acts
  on, not an error: the phase resolves and posts no comment.

  Scenario: sdlc orchestrator's scenario test phase runs the fixture's scenario command over the worktree's step definitions, resolves with the regression tag failed, and posts no comment
    Given an issue 1021 exists in the mock issue tracker
    And the worktree for adwId "surface-21" is initialised at branch "surface-21"
    And the worktree for adwId "surface-21" has step definitions committed on its branch
    When the "scenario test" phase of the "sdlc" orchestrator runs for adwId "surface-21"
    Then the "scenario test" phase run succeeded
    And the scenario proof records a blocker failure for the tag "@regression"
    And the mock harness recorded zero comment posts on issue 1021
