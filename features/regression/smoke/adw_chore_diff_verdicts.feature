@regression @smoke @subprocess
Feature: Chore Orchestrator — Diff Verdict Paths

  Background:
    Given an issue 200 exists in the mock issue tracker

  Scenario: safe diff verdict — docs-only change completes without escalation
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/safe-verdict.json"
    When the "chore" orchestrator is invoked with adwId "chore-smoke-200" and issue 200
    Then the state file for adwId "chore-smoke-200" records workflowStage "awaiting_merge"
    And the orchestrator subprocess exited 0
    And the mock GitHub API recorded a comment containing the text "The diff changes README.md only."
    And the mock harness recorded zero comment posts on issue 200 containing the text "Chore Escalation: Regression Possible"
    And the mock GitHub API recorded a PR creation for issue 200
    And the mock harness recorded zero PR-merge calls

  Scenario: regression_possible diff verdict — adws-touching change escalates to review
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/regression-possible-verdict.json"
    When the "chore" orchestrator is invoked with adwId "chore-smoke-200" and issue 200
    Then the state file for adwId "chore-smoke-200" records workflowStage "awaiting_merge"
    And the orchestrator subprocess exited 0
    And the mock GitHub API recorded a comment containing the text "The diff adds adws/smoke-stub.ts."
    And the mock GitHub API recorded a comment containing the text "Chore Escalation: Regression Possible"
    And the mock GitHub API recorded a comment containing the text "## :white_check_mark: Review Passed"
    And the mock GitHub API recorded a PR creation for issue 200
