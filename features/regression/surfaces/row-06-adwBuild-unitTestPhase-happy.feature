@regression @surface
Feature: adwTest — unitTestPhase — happy path

  adwBuild runs no unit-test phase: adws/adwBuild.tsx runs install and build. adwTest runs it,
  under the phase name "test". Nothing in the cli-tool fixture writes a JUnit report, so the phase
  marks the run unverified, as it does in production, and completes.

  Scenario: test orchestrator's unit-test phase records test_completed and, with no JUnit report from the fixture, labels the issue adw:unverified and says why
    Given an issue 1006 exists in the mock issue tracker
    And the worktree for adwId "surface-06" is initialised at branch "surface-06"
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-unit-test-phase.json"
    When the "unit test" phase of the "test" orchestrator runs for adwId "surface-06"
    Then the state file for adwId "surface-06" records workflowStage "test_completed"
    And the mock GitHub API recorded an application of the "adw:unverified" label on issue 1006
    And the mock GitHub API recorded a comment on issue 1006
    And the mock GitHub API recorded a comment containing the text "## :warning: ADW Unverified — No JUnit Report Emitted"
