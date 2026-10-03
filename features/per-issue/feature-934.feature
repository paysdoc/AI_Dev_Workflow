@adw-934 @adw-0mdjtu-bug-promotion-sweep
Feature: Promotion sweep: the threshold ramps with merged promotions, every promotion marker reaches the default branch through a merged pull request, and promotion issues carry clean paths, current wording and the instruction to drop @adw- tags, which no regression scenario carries any more

  Issue #934 resolves the `## Divergence` section of ADR-0049 (items 1 and 2, and the defect under
  More Information) and item 5 of ADR-0037. The cron's promotion sweep (`runPromotionSweep`,
  `adws/triggers/promotionSweep.ts`) scores each `features/per-issue/feature-N.feature` on the
  default branch, stamps a marker on the file and files a promotion issue for the pipeline to
  carry out.

  §1  THE THRESHOLD RAMPS (ADR-0049, item 1). A candidate qualifies when its best scenario scores
      at least N, where N = 3 + round(4 × min(promoted ÷ added, 0.5) ÷ 0.5) over the last 90 days.
      `added` counts the scenarios added under `features/per-issue/`, `promoted` the promotions.
      N is 3 when nothing was added and never passes 7. Today `promoted` counts commits whose
      subject starts with `regression-promotion:`. Only the deleted `promotionMover` wrote them,
      so `promoted` is 0 and N stays 3. After the fix a promotion is a `regression-promotion`
      issue closed by a pull request that merged in the window. On ADW that is #760 (PR #761),
      #923 (PR #926) and #924 (PR #925). An open issue, an issue closed without a merged pull
      request, and a merge older than 90 days do not count.

  §2  EVERY MARKER GOES THROUGH A PULL REQUEST (ADR-0049, item 2). `tagAndCommit`
      (`adws/triggers/promotionSweepDefaults.ts`) writes the marker in the cron host's checkout,
      commits it there and pushes the default branch, which the repository ruleset refuses: the
      push fails and no issue is filed. On any other branch it skips the write and the sweep files
      the issue anyway, so the candidate carries no `@promotion-suggested-` tag and the 14-day
      per-issue sweep is free to delete it. After the fix every marker write (suggested, declined,
      withdrawn) goes the way the per-issue sweep and the docs-index sweep persist theirs
      (`perIssueSweepPersist.ts`): a worktree on a dedicated branch off the fresh default branch,
      a pull request, an immediate merge. The marker is written onto the default branch's current
      copy of the file. The issue is filed only once the pull request has merged. When it cannot
      merge, nothing is filed and nothing is pushed to the default branch. The cron host's
      checkout is never touched.

  §3  THE ISSUE BODY (ADR-0049, More Information; ADR-0037, item 1). `parseScenariosMd` keeps a
      section's whole body, so an HTML comment written next to a value becomes part of it. The
      body of #923 has the comment of `.adw/scenarios.md` inside its `git mv` commands and its
      vocabulary path. The sweep reads its vocabulary from the same value, so on ADW it reads none
      today and scores every candidate with an empty registry. Comments are stripped wherever they
      sit around the value. The body also stops calling per-issue scenarios "input-only, never
      executed": they run in their own workflow's test phase, by `@adw-{N}` tag.

  §4  NO @adw- TAG IN THE REGRESSION SUITE (ADR-0037, item 5). The promotion issue says to keep
      the moved feature's tags "for traceability". It now tells the agent to remove its `@adw-`
      tags, feature-level and scenario-level, and still to add `@regression`. The suite already
      carries leftovers: feature-537 and feature-729, named by the ADR, and feature-910 and
      feature-911, promoted on 2026-09-30 through #923 and #924 under the old instruction.
      Removing their tags also removes what their Before and After hooks are keyed on (the step
      definitions of 537, 729, 902, 910 and 911 under `features/regression/step_definitions/`).
      Those hooks reset the harness. The pause-queue ones also save and restore the host's queue
      state and auth gate and put a fake `gh` first on PATH, so they are re-keyed rather than left
      to stop applying.

  ADR-0049's Divergence section and item 5 of ADR-0037 are removed in the same pull request. No
  scenario asserts on the text of a decision record.

  Each group is written to fail for a specific wrong implementation:
    • the ramp rows fail while `promoted` still counts `regression-promotion:` commits. The mixed
      row fails for a count that takes every closed promotion issue, every issue in the label, or
      merges of any age;
    • the score-4 pair fails for a threshold stuck at 3, which suggests the candidate in both, and
      for one that rises without a merged promotion, which suggests it in neither;
    • the marker rows fail for today's direct push, for a write skipped because the cron host is
      on another branch, for a fallback to a direct push when the merge is refused, and for an
      issue filed before, or without, the merged pull request;
    • the stale-checkout row fails for a sweep that builds the tagged file from the cron host's
      copy and commits that whole copy onto the fresh branch, undoing a later change;
    • the per-issue sweep row fails whenever the marker does not reach the default branch;
    • the comment rows fail for a stripper that handles only one placement, or only one line;
    • the dry-run row fails if a regression scenario keeps an `@adw-` tag, if a file is deleted
      instead of cleaned, and if a hook is left keyed on a tag that is gone.

  Notes for the step definitions:
    • The target is a throwaway bare repository standing in for "acme/widgets". A hook in it
      refuses every direct push to "dev" and records the attempt. "dev" changes only when the
      fake code host merges a pull request, which it does with a real git merge. Givens that put
      content in the target commit it to "dev". The cron host's checkout is a clone, taken once
      those Givens have run unless a Given takes it earlier. The sweep runs in-process through
      `runPromotionSweep`, with a launch boundary whose GitContext is bound to that clone and
      whose issue tracker and code host are fakes recording every issue, label, pull request and
      merge in one ordered log. Nothing reaches GitHub.
    • "the target has N promotion issue(s) closed by a pull request merged D days ago": N closed
      issues labelled `regression-promotion`, each promoting a feature other than the scenario's
      candidates (`Promotes: feature-<n>`), each with a merged pull request whose body says
      `Closes #<issue>`, closed and merged D days before the sweep's clock.
    • "the target's history added N per-issue scenarios in the last 90 days" is the whole count
      in the window, a candidate seeded before it included. The step adds dated commits under
      `features/per-issue/` until the count is reached.
    • "with a best scenario whose promotion score is N" also writes, at the configured vocabulary
      registry path (`features/regression/vocabulary.md` when none is configured), a registry
      under which the real scorer gives the candidate's best scenario exactly N, and a
      step-definition sibling `features/per-issue/step_definitions/feature-612.steps.ts`.
    • A Cucumber dry run given `features/regression/` still lists the per-issue paths that
      `cucumber.js` configures. The listing keeps the scenarios whose file is under
      `features/regression/`. A scenario hook is a BEFORE_TEST_CASE or AFTER_TEST_CASE hook in the
      run's messages. It applies to a scenario when the dry run attaches it to that test case.

  Background:
    Given the ADW codebase is checked out

  @adw-934 @adw-0mdjtu-bug-promotion-sweep
  Scenario Outline: The promotion threshold rises from 3 as promotions merge: <promotions> merged in the last 90 days against 8 new per-issue scenarios gives <threshold>
    Given a promotion sweep target "acme/widgets" whose default branch "dev" accepts changes only through merged pull requests
    And the target's history added 8 per-issue scenarios in the last 90 days
    And the target has <promotions> closed by a pull request merged 10 days ago
    When the promotion sweep computes its threshold for the target
    Then the computed promotion threshold is <threshold>

    Examples:
      | promotions         | threshold |
      | 0 promotion issues | 3         |
      | 1 promotion issue  | 4         |
      | 2 promotion issues | 5         |
      | 4 promotion issues | 7         |

  @adw-934 @adw-0mdjtu-bug-promotion-sweep
  Scenario: Only promotion issues closed by a pull request that merged in the last 90 days raise the threshold
    Given a promotion sweep target "acme/widgets" whose default branch "dev" accepts changes only through merged pull requests
    And the target's history added 8 per-issue scenarios in the last 90 days
    And the target has 2 promotion issues closed by a pull request merged 10 days ago
    And the target has 2 promotion issues closed 15 days ago whose pull requests closed unmerged
    And the target has 1 open promotion issue
    And the target has 2 promotion issues closed by a pull request merged 120 days ago
    When the promotion sweep computes its threshold for the target
    Then the computed promotion threshold is 5

  @adw-934 @adw-0mdjtu-bug-promotion-sweep
  Scenario: A candidate scoring 4 is suggested while no promotion has merged, because the threshold is still 3
    Given a promotion sweep target "acme/widgets" whose default branch "dev" accepts changes only through merged pull requests
    And the remote default branch holds "features/per-issue/feature-612.feature" and its step definitions, with a best scenario whose promotion score is 4
    And the target's history added 8 per-issue scenarios in the last 90 days
    When the promotion sweep runs
    Then the sweep reports feature-612 as "originated"
    And feature-612 on the remote default branch carries a "@promotion-suggested-" tag dated today
    And the sweep filed 1 promotion issue for feature-612

  @adw-934 @adw-0mdjtu-bug-promotion-sweep
  Scenario: The same candidate is left alone once two merged promotions have raised the threshold to 5
    Given a promotion sweep target "acme/widgets" whose default branch "dev" accepts changes only through merged pull requests
    And the remote default branch holds "features/per-issue/feature-612.feature" and its step definitions, with a best scenario whose promotion score is 4
    And the target's history added 8 per-issue scenarios in the last 90 days
    And the target has 2 promotion issues closed by a pull request merged 10 days ago
    When the promotion sweep runs
    Then the sweep reports feature-612 as "left"
    And feature-612 on the remote default branch carries no promotion marker
    And the sweep filed 0 promotion issues for feature-612

  @adw-934 @adw-0mdjtu-bug-promotion-sweep
  Scenario: A suggested promotion's marker reaches the default branch through a merged pull request before the promotion issue is filed
    Given a promotion sweep target "acme/widgets" whose default branch "dev" accepts changes only through merged pull requests
    And the remote default branch holds "features/per-issue/feature-612.feature" and its step definitions, with a best scenario whose promotion score is 6
    When the promotion sweep runs
    Then the sweep reports feature-612 as "originated"
    And feature-612 on the remote default branch carries a "@promotion-suggested-" tag dated today
    And the marker change reached "dev" through a merged pull request from a dedicated branch
    And that pull request changed only "features/per-issue/feature-612.feature"
    And no direct push to "dev" was attempted
    And the sweep filed 1 promotion issue for feature-612
    And the promotion issue for feature-612 carries the labels "adw:feature", "regression-promotion" and "hitl"
    And the promotion issue for feature-612 was filed after that pull request merged
    And the cron host's checkout is still on "dev" at the commit it started on
    And the cron host's checkout has no uncommitted change
    And the sweep left no worktree behind in the cron host's checkout

  @adw-934 @adw-0mdjtu-bug-promotion-sweep
  Scenario: The marker lands while the cron host's checkout is on another branch with uncommitted work, which the sweep leaves as it found it
    Given a promotion sweep target "acme/widgets" whose default branch "dev" accepts changes only through merged pull requests
    And the remote default branch holds "features/per-issue/feature-612.feature" and its step definitions, with a best scenario whose promotion score is 6
    And the cron host's checkout is on the branch "feature-issue-77-unrelated", branched from "dev", with an uncommitted change to "README.md"
    When the promotion sweep runs
    Then feature-612 on the remote default branch carries a "@promotion-suggested-" tag dated today
    And the marker change reached "dev" through a merged pull request from a dedicated branch
    And the sweep filed 1 promotion issue for feature-612
    And the cron host's checkout is still on "feature-issue-77-unrelated" at the commit it started on
    And the cron host's checkout still holds its uncommitted change to "README.md"

  @adw-934 @adw-0mdjtu-bug-promotion-sweep
  Scenario: The marker is written onto the default branch's current copy of the feature, not onto the cron host's stale one
    Given a promotion sweep target "acme/widgets" whose default branch "dev" accepts changes only through merged pull requests
    And the remote default branch holds "features/per-issue/feature-612.feature" and its step definitions, with a best scenario whose promotion score is 6
    And after the cron host's checkout was taken, a commit on the remote default branch rewrote the description of "features/per-issue/feature-612.feature"
    When the promotion sweep runs
    Then feature-612 on the remote default branch carries a "@promotion-suggested-" tag dated today
    And feature-612 on the remote default branch still holds its rewritten description
    And no direct push to "dev" was attempted
    And the cron host's checkout is still on "dev" at the commit it started on

  @adw-934 @adw-0mdjtu-bug-promotion-sweep
  Scenario: Two candidates suggested in one sweep each get their marker on the default branch and their own promotion issue
    Given a promotion sweep target "acme/widgets" whose default branch "dev" accepts changes only through merged pull requests
    And the remote default branch holds "features/per-issue/feature-612.feature" and its step definitions, with a best scenario whose promotion score is 6
    And the remote default branch holds "features/per-issue/feature-613.feature" and its step definitions, with a best scenario whose promotion score is 6
    When the promotion sweep runs
    Then feature-612 on the remote default branch carries a "@promotion-suggested-" tag dated today
    And feature-613 on the remote default branch carries a "@promotion-suggested-" tag dated today
    And the sweep filed 1 promotion issue for feature-612
    And the sweep filed 1 promotion issue for feature-613
    And no direct push to "dev" was attempted

  @adw-934 @adw-0mdjtu-bug-promotion-sweep
  Scenario: When the marker pull request cannot be merged the sweep files no promotion issue and does not fall back to a direct push
    Given a promotion sweep target "acme/widgets" whose default branch "dev" accepts changes only through merged pull requests
    And the remote default branch holds "features/per-issue/feature-612.feature" and its step definitions, with a best scenario whose promotion score is 6
    And the code host refuses to merge pull requests
    When the promotion sweep runs
    Then feature-612 on the remote default branch carries no "@promotion-suggested-" tag
    And the sweep filed 0 promotion issues for feature-612
    And the sweep does not report feature-612 as "originated"
    And no direct push to "dev" was attempted

  @adw-934 @adw-0mdjtu-bug-promotion-sweep
  Scenario: A declined promotion's marker reaches the default branch through a merged pull request
    Given a promotion sweep target "acme/widgets" whose default branch "dev" accepts changes only through merged pull requests
    And the remote default branch holds "features/per-issue/feature-612.feature" and its step definitions, with a best scenario whose promotion score is 6
    And feature-612 on the remote default branch already carries a "@promotion-suggested-" tag dated 10 days ago
    And promotion issue 801 for feature-612 was closed 3 days ago and its pull request closed unmerged
    When the promotion sweep runs
    Then the sweep reports feature-612 as "declined"
    And feature-612 on the remote default branch carries the "@promotion-declined" tag and no "@promotion-suggested-" tag
    And the marker change reached "dev" through a merged pull request from a dedicated branch
    And no direct push to "dev" was attempted
    And the sweep filed 0 promotion issues for feature-612

  @adw-934 @adw-0mdjtu-bug-promotion-sweep
  Scenario: Withdrawing a suggestion that no longer qualifies reaches the default branch through a merged pull request
    Given a promotion sweep target "acme/widgets" whose default branch "dev" accepts changes only through merged pull requests
    And the remote default branch holds "features/per-issue/feature-612.feature" and its step definitions, with a best scenario whose promotion score is 2
    And feature-612 on the remote default branch already carries a "@promotion-suggested-" tag dated 10 days ago
    When the promotion sweep runs
    Then the sweep reports feature-612 as "withdrawn"
    And feature-612 on the remote default branch carries no promotion marker
    And the marker change reached "dev" through a merged pull request from a dedicated branch
    And no direct push to "dev" was attempted
    And the sweep filed 0 promotion issues for feature-612

  @adw-934 @adw-0mdjtu-bug-promotion-sweep
  Scenario: A candidate whose marker landed through the pull request is spared by the 14-day per-issue deletion sweep
    Given a promotion sweep target "acme/widgets" whose default branch "dev" accepts changes only through merged pull requests
    And the remote default branch holds "features/per-issue/feature-612.feature" and its step definitions, with a best scenario whose promotion score is 6
    And the pull request that resolved issue 612 merged 20 days ago
    When the promotion sweep runs
    And the per-issue scenario sweep runs
    Then the remote default branch still tracks "features/per-issue/feature-612.feature"
    And feature-612 on the remote default branch carries a "@promotion-suggested-" tag dated today
    And the per-issue scenario sweep removed no file

  @adw-934 @adw-0mdjtu-bug-promotion-sweep
  Scenario Outline: The promotion issue carries no HTML comment from the scenario configuration, with the comment placed <placement>
    Given a promotion sweep target "acme/widgets" whose default branch "dev" accepts changes only through merged pull requests
    And the target's ".adw/scenarios.md" sets the per-issue directory "features/per-issue/", the regression directory "features/regression-suite/" and the vocabulary registry "features/regression-suite/vocabulary.md", each annotated with an HTML comment placed "<placement>"
    And the remote default branch holds "features/per-issue/feature-612.feature" and its step definitions, with a best scenario whose promotion score is 6
    When the promotion sweep runs
    Then the sweep filed 1 promotion issue for feature-612
    And the promotion issue for feature-612 contains no HTML comment
    And the promotion issue for feature-612 moves "features/per-issue/feature-612.feature" with a git mv to a path under "features/regression-suite/"
    And the promotion issue for feature-612 holds the command "git mv features/per-issue/step_definitions/feature-612.steps.ts features/regression-suite/step_definitions/feature-612.steps.ts"
    And the promotion issue for feature-612 names the vocabulary registry "features/regression-suite/vocabulary.md"

    Examples:
      | placement                        |
      | above the value                  |
      | after the value on its line      |
      | below the value                  |
      | on several lines above the value |

  @adw-934 @adw-0mdjtu-bug-promotion-sweep
  Scenario: The promotion issue no longer calls per-issue scenarios input-only or never executed
    Given a promotion sweep target "acme/widgets" whose default branch "dev" accepts changes only through merged pull requests
    And the remote default branch holds "features/per-issue/feature-612.feature" and its step definitions, with a best scenario whose promotion score is 6
    When the promotion sweep runs
    Then the sweep filed 1 promotion issue for feature-612
    And the promotion issue for feature-612 does not contain the text "never executed"
    And the promotion issue for feature-612 does not contain the text "input-only"

  @adw-934 @adw-0mdjtu-bug-promotion-sweep
  Scenario: The promotion issue tells the agent to remove the moved feature's @adw- tags instead of keeping its existing tags
    Given a promotion sweep target "acme/widgets" whose default branch "dev" accepts changes only through merged pull requests
    And the remote default branch holds "features/per-issue/feature-612.feature" and its step definitions, with a best scenario whose promotion score is 6
    When the promotion sweep runs
    Then the sweep filed 1 promotion issue for feature-612
    And the promotion issue for feature-612 tells the agent to remove the "@adw-" tags from the moved feature
    And the promotion issue for feature-612 does not ask for the moved feature's existing tags to be kept
    And the promotion issue for feature-612 still tells the agent to add a feature-level "@regression" tag

  @adw-934 @adw-0mdjtu-bug-promotion-sweep
  Scenario: No scenario in the regression suite carries an @adw- tag, every one still carries @regression, and the suite's hooks still apply
    When Cucumber lists the scenarios under "features/regression/" in a dry run
    Then none of the listed scenarios carries a tag starting with "@adw-"
    And every listed scenario carries the tag "@regression"
    And the listing still holds scenarios from each of these files:
      | file                                                |
      | features/regression/hashing/feature-537.feature     |
      | features/regression/upgrade/feature-729.feature     |
      | features/regression/pause-queue/feature-910.feature |
      | features/regression/pause-queue/feature-911.feature |
    And every scenario hook defined under "features/regression/" applies to at least one listed scenario

  @adw-934 @adw-0mdjtu-bug-promotion-sweep
  Scenario: The ADW TypeScript type-check passes
    Then the ADW TypeScript type-check passes
