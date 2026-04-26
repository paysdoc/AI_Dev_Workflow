@regression @surface
Feature: adwPlan — workflowInit — happy path

  # Row 1: workflowInit called directly via W9 (phase-import); state file written at initialized stage.
  # DEFERRED-RUNTIME-GAP: W9 step calls initializeWorkflow(partialConfig) where partialConfig is
  # a plain object {mockGithubApiUrl}. However initializeWorkflow's first parameter is issueNumber:number,
  # so the object is coerced to "[object Object]" and gh issue view fails. Additionally, T1 reads
  # .adw/state.json from the G11 temp worktree but initializeWorkflow writes to agents/{adwId}/state.json
  # at CWD. Both gaps require Issue #1 step-definition fixes before this scenario can pass.
  # T5 removed: W9 is phase-import (not subprocess); lastExitCode is never set by W9.
  Scenario: workflow initialises and records initialized stage
    Given an issue 1001 exists in the mock issue tracker
    And the worktree for adwId "surface-01" is initialised at branch "surface-01"
    When the workflow is initialised with config "adwPlan-surface-01"
    Then the state file for adwId "surface-01" records workflowStage "initialized"
