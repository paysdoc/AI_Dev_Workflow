@regression @surface
Feature: adwBuild — buildPhase — happy path

  # Row 4: build orchestrator runs with stub fixture; state advances to awaiting_merge.
  # DEFERRED-RUNTIME-GAP: W1 subprocess fails due to (1) spawnOrchestrator passes adwId before
  # issueNumber in CLI args (reversed vs orchestrator expected order) and (2) fetchGitHubIssue
  # uses gh CLI with GraphQL/HTTPS which cannot reach the HTTP mock server. Both require
  # Issue #1 step-definition fixes. Vocabulary and step matching are correct (dry-run passes).
  Scenario: build orchestrator completes build phase and exits successfully
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-sdlc-happy.json"
    And an issue 1004 exists in the mock issue tracker
    And the claude-cli-stub is loaded with fixture "build-agent.json"
    And the worktree for adwId "surface-04" is initialised at branch "surface-04"
    When the "build" orchestrator is invoked with adwId "surface-04" and issue 1004
    Then the state file for adwId "surface-04" records workflowStage "awaiting_merge"
    And the orchestrator subprocess exited 0
