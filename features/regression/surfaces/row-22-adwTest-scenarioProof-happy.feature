@regression @surface
Feature: adwSdlc — scenarioProof — happy path

  adwTest runs only the unit-test phase. adwSdlc runs the scenario proof, through its scenario test
  phase. Once it finds step definitions in the worktree, the proof runs the cli-tool fixture's
  scenario command for the fixed regression tag. No scenario of the fixture carries the issue's own
  tag, so the per-issue tag is not run. The command keeps its sh code fence, so the shell exits
  127, and the proof records the regression tag as a blocker failure for the scenario test-and-fix
  loop to hand to the fix phase.

  Scenario: sdlc orchestrator's scenario test phase runs the scenario proof over the worktree's step definitions, and the proof records the regression tag as a blocker failure
    Given an issue 1022 exists in the mock issue tracker
    And the worktree for adwId "surface-22" is initialised at branch "surface-22"
    And the worktree for adwId "surface-22" has step definitions committed on its branch
    When the "scenario test" phase of the "sdlc" orchestrator runs for adwId "surface-22"
    Then the scenario proof records a blocker failure for the tag "@regression"
