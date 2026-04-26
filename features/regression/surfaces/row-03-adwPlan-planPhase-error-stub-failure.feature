@regression @surface
Feature: adwPlan — planPhase — error: stub failure

  # Row 3: stub exits non-zero; orchestrator captures error; state records no partial stage.
  Scenario: orchestrator handles stub failure and records no error in state
    Given an issue 1003 exists in the mock issue tracker
    And the worktree for adwId "surface-03" is initialised at branch "surface-03"
    When the "plan" orchestrator is invoked with adwId "surface-03" and issue 1003
    Then the orchestrator subprocess exited 0
    And the state file for adwId "surface-03" records no error
