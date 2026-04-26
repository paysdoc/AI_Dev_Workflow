@regression @surface
Feature: adwTest — scenarioFixPhase — error path

  # Row 23: failing scenario triggers fix phase; error recorded if unresolvable.
  # DEFERRED-RUNTIME-GAP: W1 subprocess fails due to (1) spawnOrchestrator passes adwId before
  # issueNumber in CLI args (reversed vs orchestrator expected order) and (2) fetchGitHubIssue
  # uses gh CLI with GraphQL/HTTPS which cannot reach the HTTP mock server. Both require
  # Issue #1 step-definition fixes. Vocabulary and step matching are correct (dry-run passes).
  # NOTE: T9 reads from the G11 temp worktree (.adw/state.json); the orchestrator subprocess
  # writes state to a different path. T9 will fail at runtime pending state-path wiring.
  Scenario: test orchestrator runs scenario fix phase and records no error in worktree state
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-sdlc-happy.json"
    And an issue 1023 exists in the mock issue tracker
    And the claude-cli-stub is loaded with fixture "plan-agent.json"
    And the worktree for adwId "surface-23" is initialised at branch "surface-23"
    When the "test" orchestrator is invoked with adwId "surface-23" and issue 1023
    Then the orchestrator subprocess exited 0
    And the state file for adwId "surface-23" records no error
