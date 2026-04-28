@regression @smoke
Feature: Chore Orchestrator — Diff Verdict Paths

  # Smoke 2: two scenarios sharing common setup via Background.
  # Background: G1, G4 issue 200, G11 worktree at branch chore-200.
  # Manifests pre-seed .adw/state.json with awaiting_merge; T1 validates wiring.

  Background:
    Given the mock GitHub API is configured to accept issue comments
    And an issue 200 exists in the mock issue tracker
    And the worktree for adwId "chore-smoke-200" is initialised at branch "chore-200"

  Scenario: safe diff verdict — docs-only change completes without escalation
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/safe-verdict.json"
    When the "chore" orchestrator is invoked with adwId "chore-smoke-200" and issue 200
    Then the state file for adwId "chore-smoke-200" records workflowStage "awaiting_merge"
    And the orchestrator subprocess exited 0
    And the mock harness recorded zero PR-merge calls

  Scenario: regression_possible diff verdict — adws-touching change escalates to review
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/regression-possible-verdict.json"
    When the "chore" orchestrator is invoked with adwId "chore-smoke-200" and issue 200
    Then the state file for adwId "chore-smoke-200" records workflowStage "awaiting_merge"
    And the orchestrator subprocess exited 0
    And the mock GitHub API recorded a comment on issue 200
