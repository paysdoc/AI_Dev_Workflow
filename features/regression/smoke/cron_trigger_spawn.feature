@regression @smoke
Feature: SDLC Cron Probe — Trigger Spawn on Eligible Issue

  # Smoke 3: cron probe finds issue 300 and dispatches a spawned orchestrator.
  # DEFERRED-VOCAB-GAP: no phrase to discover the spawned subprocess's adwId; T1 assertion
  # for the spawned orchestrator state (workflowStage = "initialized") cannot be expressed
  # with the current vocabulary — the cron probe generates a new adwId at runtime.
  # DEFERRED-VOCAB-GAP: T2 (comment on issue 300) may not be recorded synchronously by the
  # cron probe itself; the comment is posted by the spawned orchestrator which runs in the
  # background. Assertion retained as a target; may need timing/polling vocabulary in follow-up.
  Scenario: cron probe dispatches a spawned orchestrator for an eligible issue
    Given an issue 300 exists in the mock issue tracker
    And the worktree for adwId "cron-smoke-300" is initialised at branch "cron-300"
    And the mock GitHub API is configured to accept issue comments
    When the cron probe runs once
    Then the mock GitHub API recorded a comment on issue 300
    And the orchestrator subprocess exited 0
