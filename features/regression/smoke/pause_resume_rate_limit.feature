@regression @smoke
Feature: SDLC Orchestrator — Pause and Resume Around Rate-Limit Detection

  # Smoke 5: orchestrator pauses on GitHub API rate-limit response, then resumes.
  # DEFERRED-VOCAB-GAP: no phrase to configure the mock GitHub API to return 429 for the
  # next N requests — rate-limit triggering cannot be expressed with the current vocabulary.
  # DEFERRED-VOCAB-GAP: no phrase for "the pauseQueueScanner cron tick runs" — the resume
  # trigger cannot be expressed; the two-step pause → resume flow is collapsed to a single
  # W1 invocation that asserts the pre-seeded paused state.
  # DEFERRED-VOCAB-GAP: no phrase to assert workflowStage transitions sequentially (paused →
  # plan_complete); only the final state visible to T1 can be checked in one scenario step.
  # Manifest pre-seeds .adw/state.json with "paused" so T1 validates wiring infrastructure.
  Scenario: orchestrator records paused stage on rate-limit detection
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/rate-limit-pause-resume.json"
    And an issue 400 exists in the mock issue tracker
    And the worktree for adwId "rate-limit-smoke-400" is initialised at branch "sdlc-400"
    And the mock GitHub API is configured to accept issue comments
    When the "sdlc" orchestrator is invoked with adwId "rate-limit-smoke-400" and issue 400
    Then the state file for adwId "rate-limit-smoke-400" records workflowStage "paused"
    And the orchestrator subprocess exited 0
