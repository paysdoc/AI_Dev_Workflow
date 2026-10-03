@regression @smoke @subprocess
Feature: Chore Orchestrator — Diff Verdict Paths

  The real chore orchestrator runs as a child process against the acme/widgets workspace, behind the
  gh shadow. The Claude CLI stub answers each slash command from the scenario's manifest: the plan
  lands where getPlanFilePath finds it and the build's edit is committed, so the diff evaluator
  judges a real diff. A safe verdict goes straight to the pull request. A regression_possible
  verdict posts the escalation comment, runs the review, which passes, and the document phase, then
  opens the pull request. Either way the run pre-approves the pull request, leaves the merge to the
  cron and records awaiting_merge.

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
