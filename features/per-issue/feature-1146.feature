@adw-1146
Feature: The owner's decision on a Promotion Proposal takes effect through one implementation issue for the approved candidates and a declined tag on the others
  The owner decides a Promotion Proposal by closing it; only candidates ticked when it is closed as completed are approved.

  @adw-1146 @subprocess @boundary-subprocess
  Scenario: The cron's decision pass, for a Promotion Proposal the owner closed as completed with two of its three candidates ticked, files one implementation issue naming the two ticked scenarios and declines the third through a merged sweep pull request
    Given the target repository's scenario configuration names the BDD framework "cucumber-js", the per-issue scenario directory "features/per-issue/" and the step definition directory "features/step_definitions"
    And the target repository holds the Per-Issue Scenario "features/per-issue/feature-114601.feature" of issue 114601, whose pull request merged 10 days ago, with the nominated scenario "An order is refunded"
    And the target repository holds the Per-Issue Scenario "features/per-issue/feature-114602.feature" of issue 114602, whose pull request merged 10 days ago, with the nominated scenario "An invoice is sent"
    And the target repository holds the Per-Issue Scenario "features/per-issue/feature-114603.feature" of issue 114603, whose pull request merged 10 days ago, with the nominated scenario "A parcel is shipped"
    And the owner closed as completed the Promotion Proposal offering those three scenarios, with "An order is refunded" and "An invoice is sent" ticked
    When the cron runs with its Promotion Proposal decision pass due
    Then the cron filed exactly one implementation issue in the target repository
    And that implementation issue carries the labels "adw:chore" and "regression-promotion" and not the label "hitl"
    And that implementation issue links the Promotion Proposal
    And that implementation issue names the scenario "An order is refunded" of issue 114601 and the scenario "An invoice is sent" of issue 114602
    And that implementation issue does not name the scenario "A parcel is shipped" of issue 114603
    And the cron's merged sweep pull request replaced "@nominated" with "@nomination-declined" on the scenario "A parcel is shipped" of issue 114603
    And the scenario "An order is refunded" of issue 114601 does not carry "@nomination-declined" on the target repository's default branch
    And the scenario "An invoice is sent" of issue 114602 does not carry "@nomination-declined" on the target repository's default branch

  @adw-1146 @subprocess @boundary-subprocess
  Scenario: The cron's decision pass, for a Promotion Proposal the owner closed as not planned with one of its two candidates ticked, files no implementation issue and declines both candidates through a merged sweep pull request
    Given the target repository's scenario configuration names the BDD framework "cucumber-js", the per-issue scenario directory "features/per-issue/" and the step definition directory "features/step_definitions"
    And the target repository holds the Per-Issue Scenario "features/per-issue/feature-114604.feature" of issue 114604, whose pull request merged 10 days ago, with the nominated scenario "A refund is approved"
    And the target repository holds the Per-Issue Scenario "features/per-issue/feature-114605.feature" of issue 114605, whose pull request merged 10 days ago, with the nominated scenario "A refund is rejected"
    And the owner closed as not planned the Promotion Proposal offering those two scenarios, with "A refund is approved" ticked
    When the cron runs with its Promotion Proposal decision pass due
    Then the cron filed no issue in the target repository
    And the cron's merged sweep pull request replaced "@nominated" with "@nomination-declined" on the scenario "A refund is approved" of issue 114604
    And the cron's merged sweep pull request replaced "@nominated" with "@nomination-declined" on the scenario "A refund is rejected" of issue 114605

  @adw-1146 @subprocess @boundary-subprocess
  Scenario: The cron's decision pass closes a Promotion Proposal left open for 30 days with a comment, files no implementation issue and declines its candidate through a merged sweep pull request
    Given the target repository's scenario configuration names the BDD framework "cucumber-js", the per-issue scenario directory "features/per-issue/" and the step definition directory "features/step_definitions"
    And the target repository holds the Per-Issue Scenario "features/per-issue/feature-114606.feature" of issue 114606, whose pull request merged 32 days ago, with the nominated scenario "A payment is captured"
    And the Promotion Proposal offering that scenario has been open for 30 days
    When the cron runs with its Promotion Proposal decision pass due
    Then the cron commented on that Promotion Proposal and closed it
    And the cron filed no issue in the target repository
    And the cron's merged sweep pull request replaced "@nominated" with "@nomination-declined" on the scenario "A payment is captured" of issue 114606

  @adw-1146 @subprocess @boundary-subprocess
  Scenario: The cron's weekly Promotion Proposal leaves out the scenario the owner declined, and its next Per-Issue Sweep removes the stale Per-Issue Scenario that holds the declined scenario
    Given the target repository's scenario configuration names the BDD framework "cucumber-js", the per-issue scenario directory "features/per-issue/" and the step definition directory "features/step_definitions"
    And the target repository holds the Per-Issue Scenario "features/per-issue/feature-114607.feature" of issue 114607, whose pull request merged 15 days ago, with the declined scenario "A parcel is returned"
    And the target repository holds the Per-Issue Scenario "features/per-issue/feature-114608.feature" of issue 114608, whose pull request merged 3 days ago, with the nominated scenario "A parcel is delivered"
    And the promotion analysis agent writes for each candidate why it qualifies and how it fits the existing Regression Suite, including overlap with scenarios already there
    When the cron runs with its weekly Promotion Proposal pass due
    And the cron runs again with its Per-Issue Sweep due, while the proposal its first run filed is still open
    Then the cron filed exactly one Promotion Proposal in the target repository
    And that proposal offers the scenario "A parcel is delivered" of issue 114608 with an unticked checkbox
    And that proposal does not offer the scenario "A parcel is returned" of issue 114607
    And the sweep's merged pull request removed "features/per-issue/feature-114607.feature" from the target repository's default branch

  @adw-1146 @subprocess @boundary-subprocess
  Scenario: adwChore, working the implementation issue the cron's decision pass files, starts no scenario agent, runs the Regression Suite and the review, and approves its pull request, leaving it to merge with no human gate
    Given the claude-cli-stub is loaded with manifest "test/fixtures/jsonl/manifests/adw-chore-regression-promotion.json"
    And the implementation issue 114610 that the cron's decision pass files for the approved scenario "A subscription is renewed" of issue 114609, labelled "adw:chore" and "regression-promotion", exists in the mock issue tracker
    And the target repository's workspace runs its scenarios by tag with a stand-in that passes every scenario
    When the "chore" orchestrator is invoked with adwId "promotion-chore-114610" and issue 114610
    Then the orchestrator subprocess exited 0
    And the scenario agent was not started
    And the stand-in ran the scenarios of "@regression"
    And the mock GitHub API recorded a comment containing the text "## :white_check_mark: Review Passed"
    And ADW approved the pull request for issue 114610
    And ADW applied no "hitl" label to issue 114610
    And the state file for adwId "promotion-chore-114610" records workflowStage "awaiting_merge"

  @adw-1146 @subprocess @boundary-subprocess @nominated
  Scenario: The cron acts once on a Promotion Proposal the owner closed as completed: restarted and run again, its decision pass files no second implementation issue and opens no second sweep pull request
    Given the target repository's scenario configuration names the BDD framework "cucumber-js", the per-issue scenario directory "features/per-issue/" and the step definition directory "features/step_definitions"
    And the target repository holds the Per-Issue Scenario "features/per-issue/feature-114611.feature" of issue 114611, whose pull request merged 10 days ago, with the nominated scenario "A voucher is redeemed"
    And the target repository holds the Per-Issue Scenario "features/per-issue/feature-114612.feature" of issue 114612, whose pull request merged 10 days ago, with the nominated scenario "A voucher expires"
    And the owner closed as completed the Promotion Proposal offering those two scenarios, with "A voucher is redeemed" ticked
    When the cron runs with its Promotion Proposal decision pass due
    And the cron is restarted and runs again with its Promotion Proposal decision pass due
    Then the cron filed exactly one implementation issue in the target repository
    And that implementation issue names the scenario "A voucher is redeemed" of issue 114611
    And the cron opened exactly one sweep pull request in the target repository
    And the cron's merged sweep pull request replaced "@nominated" with "@nomination-declined" on the scenario "A voucher expires" of issue 114612
