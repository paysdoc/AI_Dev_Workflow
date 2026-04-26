@regression @surface
Feature: adwTest — scenarioTestPhase — happy path

  # Row 21: scenario test phase runs; state advances to awaiting_merge.
  # DEFERRED-RUNTIME-GAP: W1 subprocess fails due to (1) spawnOrchestrator passes adwId before
  # issueNumber in CLI args (reversed vs orchestrator expected order) and (2) fetchGitHubIssue
  # uses gh CLI with GraphQL/HTTPS which cannot reach the HTTP mock server. Both require
  # Issue #1 step-definition fixes. Vocabulary and step matching are correct (dry-run passes).
  Scenario: test orchestrator completes scenario test phase and exits successfully
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-sdlc-happy.json"
    And an issue 1021 exists in the mock issue tracker
    And the claude-cli-stub is loaded with fixture "plan-agent.json"
    And the worktree for adwId "surface-21" is initialised at branch "surface-21"
    When the "test" orchestrator is invoked with adwId "surface-21" and issue 1021
    Then the state file for adwId "surface-21" records workflowStage "awaiting_merge"
    And the orchestrator subprocess exited 0
