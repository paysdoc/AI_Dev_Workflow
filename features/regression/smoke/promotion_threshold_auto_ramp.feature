@regression @smoke
Feature: Promotion Threshold — Auto-Ramp N from 90-day Activity Ratio

  # Smoke: two scenarios verifying that the auto-ramping threshold N changes
  # based on the repo's 90-day promotion-activity ratio.
  # Background: G1, G4 (issue 512), G11 worktree at branch feature-512.
  # Manifests pre-seed per-issue feature files and synthetic git history.
  #
  # Both scenarios use a borderline-score scenario (score = 4):
  #   young repo:  N = 3 (bootstrap) → 4 ≥ 3 → scenario IS tagged
  #   mature repo: N = 5 (ratio 5/20 = 0.25) → 4 < 5 → scenario is NOT tagged
  #
  # The W1 step stays pending behind the ISSUE-3-CUTOVER stub in whenSteps.ts.
  # The scenario shape is the documented contract for the next cutover.

  Background:
    Given the mock GitHub API is configured to accept issue comments
    And an issue 512 exists in the mock issue tracker
    And the worktree for adwId "promotion-threshold-smoke-512" is initialised at branch "feature-512"

  Scenario: young repo — borderline-score scenario (score=4) is tagged because N = 3 (bootstrap)
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/promotion-threshold-young-repo.json"
    When the "promotion-sweep" orchestrator is invoked with adwId "promotion-threshold-smoke-512" and issue 512
    Then the orchestrator subprocess exited 0
    And the mock GitHub API recorded a comment on issue 512

  Scenario: mature repo — same borderline-score scenario is NOT tagged because N rises to 5
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/promotion-threshold-mature-repo.json"
    When the "promotion-sweep" orchestrator is invoked with adwId "promotion-threshold-smoke-512" and issue 512
    Then the orchestrator subprocess exited 0
    And the mock harness recorded zero PR-merge calls
