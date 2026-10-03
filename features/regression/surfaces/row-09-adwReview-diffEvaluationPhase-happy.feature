@regression @surface
Feature: adwChore — diffEvaluationPhase — happy path

  There is no adwReview orchestrator. adwChore runs the diff evaluation phase, before it decides
  whether to escalate to review. A branch with no diff is ruled safe without asking the diff
  evaluator, so the row commits a plan on the branch first.

  Scenario: chore orchestrator's diff evaluation phase hands the branch's diff to the diff evaluator and posts its verdict and reason
    Given an issue 1009 exists in the mock issue tracker
    And the worktree for adwId "surface-09" is initialised at branch "surface-09"
    And the worktree for adwId "surface-09" has the plan for issue 1009 committed on its branch
    And the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/surface-diff-evaluation-phase.json"
    When the "diff evaluation" phase of the "chore" orchestrator runs for adwId "surface-09"
    Then the "diff evaluation" phase run succeeded
    And the mock GitHub API recorded a comment on issue 1009
    And the mock GitHub API recorded a comment containing the text "## Diff Evaluation"
    And the mock GitHub API recorded a comment containing the text "**Reason:** The surface diff adds only a plan file."
    And the mock GitHub API recorded a comment containing the text "Auto-approving and merging."
