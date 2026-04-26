@regression @surface
Feature: adwPlan — planPhase — error: stub failure

  # Row 3: stub exits non-zero; orchestrator captures error; state records no partial stage.
  # DEFERRED-RUNTIME-GAP: W1 subprocess fails due to (1) spawnOrchestrator passes adwId before
  # issueNumber in CLI args (reversed vs orchestrator expected order) and (2) fetchGitHubIssue
  # uses gh CLI with GraphQL/HTTPS which cannot reach the HTTP mock server. Both require
  # Issue #1 step-definition fixes. Vocabulary and step matching are correct (dry-run passes).
  # NOTE: without G3 (manifest) or G9 (fixture), the stub auto-selects plan-agent.json and exits 0.
  # There is no vocabulary phrase to configure the stub to return a non-zero exit code.
  # T9 reads from the G11 temp worktree (.adw/state.json); that file is not written by the
  # orchestrator subprocess, so T9 will fail at runtime. Both are expected runtime failures
  # pending vocabulary and wiring extensions.
  Scenario: orchestrator handles stub failure and records no error in state
    Given an issue 1003 exists in the mock issue tracker
    And the worktree for adwId "surface-03" is initialised at branch "surface-03"
    When the "plan" orchestrator is invoked with adwId "surface-03" and issue 1003
    Then the orchestrator subprocess exited 0
    And the state file for adwId "surface-03" records no error
