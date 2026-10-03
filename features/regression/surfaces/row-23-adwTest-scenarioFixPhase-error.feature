@regression @surface
Feature: adwSdlc — scenarioFixPhase — error path

  adwTest runs only the unit-test phase. adwSdlc runs the scenario fix phase, in its scenario
  test-and-fix loop, which hands it the proof of a run whose blocker scenarios failed. The stub
  answers every agent with an error. The resolver's failure is logged and the phase goes on; the
  commit agent's failure fails the phase run.

  Scenario: sdlc orchestrator's scenario fix phase fails at the commit when the stub answers every agent it starts with an error
    Given an issue 1023 exists in the mock issue tracker
    And the worktree for adwId "surface-23" is initialised at branch "surface-23"
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-scenario-fix-phase-error.json"
    When the "scenario fix" phase of the "sdlc" orchestrator runs for adwId "surface-23"
    Then the "scenario fix" phase run failed with an error that names "Commit agent 'scenario-fix-agent'"
