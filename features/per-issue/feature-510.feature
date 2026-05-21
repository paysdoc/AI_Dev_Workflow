@adw-510 @adw-28aysq-hitl-label-tag-lifec
Feature: promotionCommenter lifecycle — hitl label, daily-cadence suppression, date refresh, score-drop withdrawal

  Issue #510 extends the slice-#509 promotion commenter with the full tag
  lifecycle and the HITL gate described in
  specs/prd/scenario-rot-prevention-and-promotion.md (user stories 9, 10, 13,
  14, 15). On every per-issue PR event the orchestrator (`adwPromotionSweep`)
  still invokes `promotionCommenter`, but the commenter now:

    1. applies the `hitl` label to the per-issue PR whenever any promotion
       comment is posted — so the PR cannot auto-merge until a human acts
    2. suppresses the comment for the current run when the scenario's
       existing `@promotion-suggested-<date>` tag carries today's date
       (no duplicate same-day reminders)
    3. refreshes the tag date to today and posts a reminder comment when
       the existing tag carries an older date and the scenario still scores
       at or above the threshold
    4. removes the `@promotion-suggested-<date>` tag entirely when a
       previously-tagged scenario now scores below the threshold

  The `promotionTagWriter` deep module gains `refresh-date` and
  `remove-suggestion` operations in this slice. Their pure-string-transform
  behaviour is covered by unit tests under `adws/promotion/__tests__/`;
  the scenarios in this file exercise the orchestrator end-to-end through
  the existing mock GitHub harness and assert against the artefacts the
  orchestrator produces — the modified `.feature` file under the test
  worktree (an output of `promotionTagWriter`, not a framework source file)
  and the recorded GitHub API calls (comment posts and label applications)
  captured by the mock harness.

  No assertion in this file is made against any framework source file;
  deep-module correctness is unit-tested separately. The `hitl` label
  application is observed through recorded mock-server label calls (an
  artefact of the orchestrator run, not a source-file property).

  Background:
    Given the ADW codebase is checked out

  # ── §1 hitl label application ────────────────────────────────────────

  @adw-510 @adw-28aysq-hitl-label-tag-lifec
  Scenario: An above-threshold scenario triggers the hitl label on the per-issue PR
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/promotion-sweep-high-score.json"
    And the worktree for adwId "promo-510-1" is initialised at branch "feature-9190"
    And an issue 9190 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the mock GitHub API is configured to accept label applications
    And a per-issue feature file at "features/per-issue/feature-9190.feature" is seeded into the worktree for adwId "promo-510-1" from fixture "promotion/high-score-subprocess.feature"
    When the "promotion-sweep" orchestrator is invoked with adwId "promo-510-1" and issue 9190
    Then the orchestrator subprocess exited 0
    And the mock GitHub API recorded a comment on issue 9190
    And the mock GitHub API recorded an application of the "hitl" label on issue 9190

  @adw-510 @adw-28aysq-hitl-label-tag-lifec
  Scenario: A below-threshold scenario does not trigger the hitl label
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/promotion-sweep-low-score.json"
    And the worktree for adwId "promo-510-2" is initialised at branch "feature-9191"
    And an issue 9191 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the mock GitHub API is configured to accept label applications
    And a per-issue feature file at "features/per-issue/feature-9191.feature" is seeded into the worktree for adwId "promo-510-2" from fixture "promotion/low-score-mock-query.feature"
    When the "promotion-sweep" orchestrator is invoked with adwId "promo-510-2" and issue 9191
    Then the orchestrator subprocess exited 0
    And the mock harness recorded zero comment posts on issue 9191
    And the mock harness recorded zero applications of the "hitl" label on issue 9191

  # ── §2 Daily-cadence suppression ─────────────────────────────────────

  @adw-510 @adw-28aysq-hitl-label-tag-lifec
  Scenario: A scenario already tagged with today's date receives no duplicate comment on the same day
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/promotion-sweep-high-score.json"
    And the worktree for adwId "promo-510-3" is initialised at branch "feature-9192"
    And an issue 9192 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the mock GitHub API is configured to accept label applications
    And a per-issue feature file at "features/per-issue/feature-9192.feature" is seeded into the worktree for adwId "promo-510-3" from fixture "promotion/high-score-subprocess.feature"
    And the seeded scenario in "features/per-issue/feature-9192.feature" in the worktree for adwId "promo-510-3" is pre-tagged with "@promotion-suggested-" dated today
    When the "promotion-sweep" orchestrator is invoked with adwId "promo-510-3" and issue 9192
    Then the orchestrator subprocess exited 0
    And the mock harness recorded zero comment posts on issue 9192
    And the mock harness recorded zero applications of the "hitl" label on issue 9192
    And the artefact file at "features/per-issue/feature-9192.feature" in the worktree for adwId "promo-510-3" carries a "@promotion-suggested-" tag dated today on the seeded scenario

  # ── §3 Date refresh on re-reminder ───────────────────────────────────

  @adw-510 @adw-28aysq-hitl-label-tag-lifec
  Scenario: A scenario tagged on a previous day with a still-high score has its tag refreshed to today and receives a reminder comment
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/promotion-sweep-high-score.json"
    And the worktree for adwId "promo-510-4" is initialised at branch "feature-9193"
    And an issue 9193 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the mock GitHub API is configured to accept label applications
    And a per-issue feature file at "features/per-issue/feature-9193.feature" is seeded into the worktree for adwId "promo-510-4" from fixture "promotion/high-score-subprocess.feature"
    And the seeded scenario in "features/per-issue/feature-9193.feature" in the worktree for adwId "promo-510-4" is pre-tagged with "@promotion-suggested-" dated 5 days ago
    When the "promotion-sweep" orchestrator is invoked with adwId "promo-510-4" and issue 9193
    Then the orchestrator subprocess exited 0
    And the artefact file at "features/per-issue/feature-9193.feature" in the worktree for adwId "promo-510-4" carries a "@promotion-suggested-" tag dated today on the seeded scenario
    And the artefact file at "features/per-issue/feature-9193.feature" in the worktree for adwId "promo-510-4" carries exactly one "@promotion-suggested-" tag on the seeded scenario
    And the mock GitHub API recorded a comment on issue 9193
    And the mock GitHub API recorded an application of the "hitl" label on issue 9193

  # ── §4 Score-drop withdrawal ─────────────────────────────────────────

  @adw-510 @adw-28aysq-hitl-label-tag-lifec
  Scenario: A previously-tagged scenario that now scores below the threshold has its tag removed and produces no new comment
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/promotion-sweep-low-score.json"
    And the worktree for adwId "promo-510-5" is initialised at branch "feature-9194"
    And an issue 9194 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the mock GitHub API is configured to accept label applications
    And a per-issue feature file at "features/per-issue/feature-9194.feature" is seeded into the worktree for adwId "promo-510-5" from fixture "promotion/low-score-mock-query.feature"
    And the seeded scenario in "features/per-issue/feature-9194.feature" in the worktree for adwId "promo-510-5" is pre-tagged with "@promotion-suggested-" dated 3 days ago
    When the "promotion-sweep" orchestrator is invoked with adwId "promo-510-5" and issue 9194
    Then the orchestrator subprocess exited 0
    And the artefact file at "features/per-issue/feature-9194.feature" in the worktree for adwId "promo-510-5" carries no "@promotion-suggested-" tag on the seeded scenario
    And the mock harness recorded zero comment posts on issue 9194
    And the mock harness recorded zero applications of the "hitl" label on issue 9194

  # ── §5 Mixed lifecycle in a single file ──────────────────────────────

  @adw-510 @adw-28aysq-hitl-label-tag-lifec
  Scenario: A multi-scenario file exercises refresh, suppress, and withdraw paths in a single orchestrator run
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/promotion-sweep-lifecycle-mixed.json"
    And the worktree for adwId "promo-510-6" is initialised at branch "feature-9195"
    And an issue 9195 exists in the mock issue tracker
    And the mock GitHub API is configured to accept issue comments
    And the mock GitHub API is configured to accept label applications
    And a per-issue feature file at "features/per-issue/feature-9195.feature" is seeded into the worktree for adwId "promo-510-6" from fixture "promotion/lifecycle-mixed.feature"
    And the seeded scenario named "Refresh path scenario" in "features/per-issue/feature-9195.feature" in the worktree for adwId "promo-510-6" is pre-tagged with "@promotion-suggested-" dated 5 days ago
    And the seeded scenario named "Suppress path scenario" in "features/per-issue/feature-9195.feature" in the worktree for adwId "promo-510-6" is pre-tagged with "@promotion-suggested-" dated today
    And the seeded scenario named "Withdraw path scenario" in "features/per-issue/feature-9195.feature" in the worktree for adwId "promo-510-6" is pre-tagged with "@promotion-suggested-" dated 3 days ago
    When the "promotion-sweep" orchestrator is invoked with adwId "promo-510-6" and issue 9195
    Then the orchestrator subprocess exited 0
    And the artefact file at "features/per-issue/feature-9195.feature" in the worktree for adwId "promo-510-6" carries a "@promotion-suggested-" tag dated today on the scenario named "Refresh path scenario"
    And the artefact file at "features/per-issue/feature-9195.feature" in the worktree for adwId "promo-510-6" carries a "@promotion-suggested-" tag dated today on the scenario named "Suppress path scenario"
    And the artefact file at "features/per-issue/feature-9195.feature" in the worktree for adwId "promo-510-6" carries no "@promotion-suggested-" tag on the scenario named "Withdraw path scenario"
    And the mock GitHub API recorded a comment on issue 9195 containing the seeded scenario name "Refresh path scenario"
    And the mock harness recorded zero comment posts on issue 9195 referencing the seeded scenario name "Suppress path scenario"
    And the mock harness recorded zero comment posts on issue 9195 referencing the seeded scenario name "Withdraw path scenario"
    And the mock GitHub API recorded an application of the "hitl" label on issue 9195
