@regression @smoke @subprocess
Feature: SDLC Orchestrator — Pause and Resume Around Rate-Limit Detection

  The real SDLC orchestrator runs as a child process, and every agent call is answered rate-limited
  for the seven-day window. The branch-name fallback, the install phase and the scenario phase
  absorb the rejection. The plan agent's rejection reaches the phase runner, which hands any limit
  other than the five-hour window to the pause queue instead of sleeping in process. The run
  records paused, appends to the pause queue, posts the paused comment naming the limit, and
  exits 0. The harness puts the checkout's queue file back afterwards. Resuming is covered by
  features/regression/pause-queue/.

  Scenario: orchestrator records paused stage on rate-limit detection
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/rate-limit-pause-resume.json"
    And an issue 400 exists in the mock issue tracker
    When the "sdlc" orchestrator is invoked with adwId "rate-limit-smoke-400" and issue 400
    Then the state file for adwId "rate-limit-smoke-400" records workflowStage "paused"
    And the orchestrator subprocess exited 0
    And the mock GitHub API recorded a comment containing the text "`seven_day` rate limit detected"
