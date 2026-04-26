@regression @smoke
Feature: SDLC Orchestrator — Cancel Directive (Scorched-Earth Flow)

  # Smoke 4: ## Cancel directive causes the orchestrator to discard the worktree.
  # DEFERRED-VOCAB-GAP: no phrase to set issue body to "## Cancel" — G4 seeds an empty body;
  # the cancel directive will not trigger at runtime until vocabulary is extended with a
  # "Given the issue {int} has body {string}" phrase (or similar mock-state setter).
  # DEFERRED-VOCAB-GAP: no phrase to assert "the worktree was discarded" — worktree-discard
  # verification requires either a filesystem assertion phrase or a mock-recorded API call phrase.
  # Manifest pre-seeds .adw/state.json with "cancelled" so T1 validates wiring infrastructure;
  # the real cancellation flow is not exercised until the vocab gaps above are closed.
  Scenario: orchestrator writes cancelled stage when ## Cancel directive is present
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/cancel-directive.json"
    And an issue 500 exists in the mock issue tracker
    And the worktree for adwId "cancel-smoke-500" is initialised at branch "cancel-500"
    And the mock GitHub API is configured to accept issue comments
    When the "sdlc" orchestrator is invoked with adwId "cancel-smoke-500" and issue 500
    Then the state file for adwId "cancel-smoke-500" records workflowStage "cancelled"
    And the orchestrator subprocess exited 0
    And the mock GitHub API recorded a comment on issue 500
