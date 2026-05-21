@adw-512 @adw-y8r69q-auto-ramping-thresho
Feature: promotionThreshold — auto-ramping N from 90-day promotion-activity ratio

  Issue #512 replaces the hardcoded `N = 3` returned by
  `promotionThreshold.computeThreshold` (landed by slice #509) with an
  auto-ramping formula derived from the repo's 90-day promotion-activity
  ratio, as described in
  specs/prd/scenario-rot-prevention-and-promotion.md (User Stories 6, 7;
  §"Activity ratio formula").

    • Numerator   — count of scenarios moved into the regression directory
                    by `promotionMover` over the last 90 days, computed
                    from git history of `regression-promotion`-labelled
                    PRs.
    • Denominator — count of per-issue scenarios written by
                    `scenario_writer` over the last 90 days, computed
                    from git history of per-issue feature files.
    • Bootstrap   — when the denominator is zero, `computeThreshold`
                    returns the framework default of 3.
    • Above bootstrap — N is a monotonically non-decreasing function of
                    the ratio, bounded by an upper-bound constant inside
                    `promotionThreshold`. The exact curve is a framework
                    constant and is not per-repo overridable.

  The threshold is consumed by the `promotion-sweep` orchestrator
  (working name `adwPromotionSweep.tsx`) — the same entry point covered
  by issues #509 (commenter) and #511 (mover). The orchestrator passes
  the computed N to `promotionScorer`'s tag-state decision, so the
  observable signal of N at runtime is whether a seeded scenario whose
  `promotionScorer` score is fixed receives a `@promotion-suggested-`
  tag on the next invocation.

  Each scenario below seeds a synthetic 90-day git history into the test
  worktree (a fixed number of per-issue scenario commits and a fixed
  number of `regression-promotion`-labelled PR commits dated within the
  last 90 days), seeds a per-issue `.feature` file containing a
  scenario calibrated to a known `promotionScorer` score, invokes
  `promotion-sweep`, and asserts whether the
  `@promotion-suggested-<today>` tag is present on the seeded
  scenario in the post-invocation artefact file.

  No assertion in this file is made against the contents of
  `adws/promotion/promotionThreshold.ts`, `.adw/scenarios.md`, the
  `scenario_writer.md` prompt, or any other framework source file.
  Correctness of the curve constants (bootstrap value, mid-ratio shape,
  upper bound) is unit-tested separately at
  `adws/promotion/__tests__/promotionThreshold.test.ts` against
  synthetic `PromotionStats` — that test file is the canonical
  acceptance check for AC bullet 5 (unit tests cover bootstrap,
  low-ratio, mid-ratio, high-ratio, and bound conditions). AC bullet 6
  ("no `.adw/scenarios.md` knob for overriding N") is verified by
  inspection of the `scenario_writer.md` prompt during PR review;
  asserting against prompt or config source content here would be the
  rot pattern the parent PRD was designed to stop.

  Background:
    Given the ADW codebase is checked out

  # ── §1 bootstrap: zero denominator → N = 3 ────────────────────────────

  @adw-512 @adw-y8r69q-auto-ramping-thresho
  Scenario: A young repo with no per-issue scenarios in the 90-day window triggers bootstrap N = 3 and tags a scoring-3 scenario
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/promotion-threshold-bootstrap.json"
    And the worktree for adwId "promo-thr-512-1" is initialised at branch "feature-9200"
    And an issue 9200 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the worktree git history records 0 per-issue scenarios written in the last 90 days
    And the worktree git history records 0 regression-promotion PRs merged in the last 90 days
    And a per-issue feature file at "features/per-issue/feature-9200.feature" is seeded into the worktree for adwId "promo-thr-512-1" with one scenario scoring exactly 3
    When the "promotion-sweep" orchestrator is invoked with adwId "promo-thr-512-1" and issue 9200
    Then the orchestrator subprocess exited 0
    And the artefact file at "features/per-issue/feature-9200.feature" in the worktree for adwId "promo-thr-512-1" carries a "@promotion-suggested-" tag dated today on the seeded scenario

  @adw-512 @adw-y8r69q-auto-ramping-thresho
  Scenario: A young repo with no per-issue scenarios in the 90-day window leaves a scoring-2 scenario untagged because bootstrap N = 3
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/promotion-threshold-bootstrap-below.json"
    And the worktree for adwId "promo-thr-512-2" is initialised at branch "feature-9201"
    And an issue 9201 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the worktree git history records 0 per-issue scenarios written in the last 90 days
    And the worktree git history records 0 regression-promotion PRs merged in the last 90 days
    And a per-issue feature file at "features/per-issue/feature-9201.feature" is seeded into the worktree for adwId "promo-thr-512-2" with one scenario scoring exactly 2
    When the "promotion-sweep" orchestrator is invoked with adwId "promo-thr-512-2" and issue 9201
    Then the orchestrator subprocess exited 0
    And the artefact file at "features/per-issue/feature-9201.feature" in the worktree for adwId "promo-thr-512-2" carries no "@promotion-suggested-" tag on the seeded scenario

  # ── §2 low ratio: per-issue activity but no promotions → N stays at 3 ──

  @adw-512 @adw-y8r69q-auto-ramping-thresho
  Scenario: A repo with per-issue activity but zero promotions in 90 days still tags a scoring-3 scenario (low ratio keeps N at the floor)
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/promotion-threshold-low-ratio.json"
    And the worktree for adwId "promo-thr-512-3" is initialised at branch "feature-9202"
    And an issue 9202 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the worktree git history records 12 per-issue scenarios written in the last 90 days
    And the worktree git history records 0 regression-promotion PRs merged in the last 90 days
    And a per-issue feature file at "features/per-issue/feature-9202.feature" is seeded into the worktree for adwId "promo-thr-512-3" with one scenario scoring exactly 3
    When the "promotion-sweep" orchestrator is invoked with adwId "promo-thr-512-3" and issue 9202
    Then the orchestrator subprocess exited 0
    And the artefact file at "features/per-issue/feature-9202.feature" in the worktree for adwId "promo-thr-512-3" carries a "@promotion-suggested-" tag dated today on the seeded scenario

  # ── §3 high ratio: N rises above 3 → scoring-3 scenario no longer tagged ─

  @adw-512 @adw-y8r69q-auto-ramping-thresho
  Scenario: A mature repo with a high promotion ratio leaves a scoring-3 scenario untagged because N has risen above 3
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/promotion-threshold-high-ratio.json"
    And the worktree for adwId "promo-thr-512-4" is initialised at branch "feature-9203"
    And an issue 9203 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the worktree git history records 10 per-issue scenarios written in the last 90 days
    And the worktree git history records 8 regression-promotion PRs merged in the last 90 days
    And a per-issue feature file at "features/per-issue/feature-9203.feature" is seeded into the worktree for adwId "promo-thr-512-4" with one scenario scoring exactly 3
    When the "promotion-sweep" orchestrator is invoked with adwId "promo-thr-512-4" and issue 9203
    Then the orchestrator subprocess exited 0
    And the artefact file at "features/per-issue/feature-9203.feature" in the worktree for adwId "promo-thr-512-4" carries no "@promotion-suggested-" tag on the seeded scenario

  # ── §4 monotonic non-decreasing: raising the ratio never lowers N ──────

  @adw-512 @adw-y8r69q-auto-ramping-thresho
  Scenario: A scoring-K scenario tagged at low ratio remains tagged at the same ratio with extra denominator activity that does not raise the ratio
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/promotion-threshold-monotonic-floor.json"
    And the worktree for adwId "promo-thr-512-5" is initialised at branch "feature-9204"
    And an issue 9204 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the worktree git history records 20 per-issue scenarios written in the last 90 days
    And the worktree git history records 0 regression-promotion PRs merged in the last 90 days
    And a per-issue feature file at "features/per-issue/feature-9204.feature" is seeded into the worktree for adwId "promo-thr-512-5" with one scenario scoring exactly 3
    When the "promotion-sweep" orchestrator is invoked with adwId "promo-thr-512-5" and issue 9204
    Then the orchestrator subprocess exited 0
    And the artefact file at "features/per-issue/feature-9204.feature" in the worktree for adwId "promo-thr-512-5" carries a "@promotion-suggested-" tag dated today on the seeded scenario

  @adw-512 @adw-y8r69q-auto-ramping-thresho
  Scenario: Raising the promotion ratio from low to high does not lower the tagging-bar — a scoring-3 scenario tagged at low ratio is no longer tagged at high ratio
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/promotion-threshold-monotonic-rises.json"
    And the worktree for adwId "promo-thr-512-6" is initialised at branch "feature-9205"
    And an issue 9205 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the worktree git history records 10 per-issue scenarios written in the last 90 days
    And the worktree git history records 9 regression-promotion PRs merged in the last 90 days
    And a per-issue feature file at "features/per-issue/feature-9205.feature" is seeded into the worktree for adwId "promo-thr-512-6" with one scenario scoring exactly 3
    When the "promotion-sweep" orchestrator is invoked with adwId "promo-thr-512-6" and issue 9205
    Then the orchestrator subprocess exited 0
    And the artefact file at "features/per-issue/feature-9205.feature" in the worktree for adwId "promo-thr-512-6" carries no "@promotion-suggested-" tag on the seeded scenario

  # ── §5 bounded: extreme ratio caps N at the upper bound constant ───────

  @adw-512 @adw-y8r69q-auto-ramping-thresho
  Scenario: A scenario scoring at the upper bound of N is tagged even at an extreme promotion ratio approaching 1.0 (curve is bounded)
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/promotion-threshold-bound-tagged.json"
    And the worktree for adwId "promo-thr-512-7" is initialised at branch "feature-9206"
    And an issue 9206 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the worktree git history records 10 per-issue scenarios written in the last 90 days
    And the worktree git history records 10 regression-promotion PRs merged in the last 90 days
    And a per-issue feature file at "features/per-issue/feature-9206.feature" is seeded into the worktree for adwId "promo-thr-512-7" with one scenario scoring exactly the upper bound of N
    When the "promotion-sweep" orchestrator is invoked with adwId "promo-thr-512-7" and issue 9206
    Then the orchestrator subprocess exited 0
    And the artefact file at "features/per-issue/feature-9206.feature" in the worktree for adwId "promo-thr-512-7" carries a "@promotion-suggested-" tag dated today on the seeded scenario

  @adw-512 @adw-y8r69q-auto-ramping-thresho
  Scenario: Even at an extreme promotion ratio, the threshold does not exceed the upper bound — a scenario scoring exactly one above the upper bound remains tagged
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/promotion-threshold-above-bound-tagged.json"
    And the worktree for adwId "promo-thr-512-8" is initialised at branch "feature-9207"
    And an issue 9207 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the worktree git history records 50 per-issue scenarios written in the last 90 days
    And the worktree git history records 50 regression-promotion PRs merged in the last 90 days
    And a per-issue feature file at "features/per-issue/feature-9207.feature" is seeded into the worktree for adwId "promo-thr-512-8" with one scenario scoring exactly one above the upper bound of N
    When the "promotion-sweep" orchestrator is invoked with adwId "promo-thr-512-8" and issue 9207
    Then the orchestrator subprocess exited 0
    And the artefact file at "features/per-issue/feature-9207.feature" in the worktree for adwId "promo-thr-512-8" carries a "@promotion-suggested-" tag dated today on the seeded scenario

  # ── §6 stats come from git history, not from an external state file ────

  @adw-512 @adw-y8r69q-auto-ramping-thresho
  Scenario: Threshold computation responds to a change in git history alone — no external state file is read or written by promotionThreshold
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/promotion-threshold-git-history-only.json"
    And the worktree for adwId "promo-thr-512-9" is initialised at branch "feature-9208"
    And an issue 9208 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And no promotion-stats state file exists anywhere under the worktree for adwId "promo-thr-512-9"
    And the worktree git history records 0 per-issue scenarios written in the last 90 days
    And the worktree git history records 0 regression-promotion PRs merged in the last 90 days
    And a per-issue feature file at "features/per-issue/feature-9208.feature" is seeded into the worktree for adwId "promo-thr-512-9" with one scenario scoring exactly 3
    When the "promotion-sweep" orchestrator is invoked with adwId "promo-thr-512-9" and issue 9208
    Then the orchestrator subprocess exited 0
    And the artefact file at "features/per-issue/feature-9208.feature" in the worktree for adwId "promo-thr-512-9" carries a "@promotion-suggested-" tag dated today on the seeded scenario
    And no promotion-stats state file is present anywhere under the worktree for adwId "promo-thr-512-9" after the invocation

  # ── §7 90-day window: activity older than 90 days is excluded ──────────

  @adw-512 @adw-y8r69q-auto-ramping-thresho
  Scenario: Promotion activity older than 90 days does not affect N — an old high-promotion history with no recent activity behaves like a young repo
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/promotion-threshold-stale-history.json"
    And the worktree for adwId "promo-thr-512-10" is initialised at branch "feature-9209"
    And an issue 9209 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the worktree git history records 20 per-issue scenarios written more than 90 days ago
    And the worktree git history records 18 regression-promotion PRs merged more than 90 days ago
    And the worktree git history records 0 per-issue scenarios written in the last 90 days
    And the worktree git history records 0 regression-promotion PRs merged in the last 90 days
    And a per-issue feature file at "features/per-issue/feature-9209.feature" is seeded into the worktree for adwId "promo-thr-512-10" with one scenario scoring exactly 3
    When the "promotion-sweep" orchestrator is invoked with adwId "promo-thr-512-10" and issue 9209
    Then the orchestrator subprocess exited 0
    And the artefact file at "features/per-issue/feature-9209.feature" in the worktree for adwId "promo-thr-512-10" carries a "@promotion-suggested-" tag dated today on the seeded scenario

  # ── Type-check ────────────────────────────────────────────────────────

  @adw-512 @adw-y8r69q-auto-ramping-thresho
  Scenario: TypeScript type-check passes after the promotionThreshold auto-ramp changes
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
