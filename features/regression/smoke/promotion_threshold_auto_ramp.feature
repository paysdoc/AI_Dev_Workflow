@regression @smoke @subprocess
Feature: Promotion Threshold — Auto-Ramp N from 90-day Activity Ratio

  The real promotion sweep runs as a child process over the acme/widgets workspace, behind the gh
  shadow, and never invokes the Claude CLI stub. It scores each per-issue feature file on the
  workspace's default branch against the vocabulary that `.adw/scenarios.md` declares, and
  suggests a file for promotion when its best scenario scores at least N.
  N = 3 + round(4 × min(r, 0.5) / 0.5), where r is the number of promotion issues whose pull
  request merged in the last 90 days over the number of per-issue scenarios added to the default
  branch in that time. Both rows seed the same scenario, which scores 4. Young: no promotion, so
  r = 0 and N = 3. Mature: 1 promotion against the 4 scenarios added in the window,
  feature-9300's among them, so r = 0.25 and N = 5.

  Background:
    Given the target repository's workspace declares its regression vocabulary in ".adw/scenarios.md"
    And the target repository's workspace has committed "features/per-issue/feature-9300.feature" holding the scenario "A borderline scenario", which the promotion scorer rates 4

  Scenario: young repo — borderline-score scenario (score=4) is tagged because N = 3 (bootstrap)
    Given the target repository has 0 promotion issues whose pull request merged in the last 90 days
    When the "promotion-sweep" orchestrator is invoked with adwId "promotion-threshold-smoke-512" and issue 512
    Then the orchestrator subprocess exited 0
    And the orchestrator subprocess's output contains "promotionSweep: threshold 3, originated 1"
    And the artefact file at "features/per-issue/feature-9300.feature" in the worktree for adwId "promotion-threshold-smoke-512" carries a "@promotion-suggested-" tag dated today on the scenario named "A borderline scenario"

  Scenario: mature repo — same borderline-score scenario is NOT tagged because N rises to 5
    Given 3 more per-issue scenarios were added to, and since removed from, the target repository's default branch in the last 90 days
    And the target repository has 1 promotion issue whose pull request merged in the last 90 days
    When the "promotion-sweep" orchestrator is invoked with adwId "promotion-threshold-smoke-512" and issue 512
    Then the orchestrator subprocess exited 0
    And the orchestrator subprocess's output contains "promotionSweep: threshold 5, originated 0"
    And the artefact file at "features/per-issue/feature-9300.feature" in the worktree for adwId "promotion-threshold-smoke-512" carries no "@promotion-suggested-" tag on the scenario named "A borderline scenario"
    And the mock harness recorded zero PR-merge calls
