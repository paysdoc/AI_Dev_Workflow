@adw-1145
Feature: The cron's weekly Promotion Proposal gathers a repository's Nominations into one issue for the owner to decide
  A Promotion Proposal is an issue ADW does not work, offering each nominated Per-Issue Scenario with a checkbox the owner ticks to promote it.

  @adw-1145 @subprocess @boundary-subprocess
  Scenario: The cron's weekly Promotion Proposal pass files one proposal offering each of the repository's Nominations with an unticked checkbox and its analysis, and files none when it runs again a week later while that proposal is still open
    Given the target repository's scenario configuration names the BDD framework "cucumber-js", the per-issue scenario directory "features/per-issue/" and the step definition directory "features/step_definitions"
    And the target repository holds the Per-Issue Scenario "features/per-issue/feature-114501.feature" of issue 114501, whose pull request merged 3 days ago, with the nominated scenario "An order is refunded"
    And the target repository holds the Per-Issue Scenario "features/per-issue/feature-114502.feature" of issue 114502, whose pull request merged 2 days ago, with the nominated scenario "An invoice is sent"
    And the promotion analysis agent writes for each candidate why it qualifies and how it fits the existing Regression Suite, including overlap with scenarios already there
    When the cron runs with its weekly Promotion Proposal pass due
    And the cron runs again a week later with its weekly Promotion Proposal pass due, while the proposal its first run filed is still open
    Then the cron filed exactly one Promotion Proposal in the target repository
    And that proposal offers the scenario "An order is refunded" of issue 114501 with an unticked checkbox
    And that proposal offers the scenario "An invoice is sent" of issue 114502 with an unticked checkbox
    And that proposal gives, under each candidate, the analysis the promotion analysis agent wrote for it

  @adw-1145 @subprocess @boundary-subprocess
  Scenario: The cron's weekly Promotion Proposal offers the nominated scenario whose issue has merged and leaves out the nominated scenario whose issue's pull request is still open
    Given the target repository's scenario configuration names the BDD framework "cucumber-js", the per-issue scenario directory "features/per-issue/" and the step definition directory "features/step_definitions"
    And the target repository holds the Per-Issue Scenario "features/per-issue/feature-114503.feature" of issue 114503, whose pull request merged 3 days ago, with the nominated scenario "A refund is approved"
    And the target repository holds the Per-Issue Scenario "features/per-issue/feature-114504.feature" of issue 114504, whose pull request is still open, with the nominated scenario "A refund is rejected"
    And the promotion analysis agent writes for each candidate why it qualifies and how it fits the existing Regression Suite, including overlap with scenarios already there
    When the cron runs with its weekly Promotion Proposal pass due
    Then the cron filed exactly one Promotion Proposal in the target repository
    And that proposal offers the scenario "A refund is approved" of issue 114503 with an unticked checkbox
    And that proposal does not offer the scenario "A refund is rejected" of issue 114504

  @adw-1145 @subprocess @boundary-subprocess @nominated
  Scenario: The cron files the weekly Promotion Proposal labelled adw:none and as a Promotion Proposal, and launches no orchestrator for it on a later poll, once it is past the cron's grace period
    Given the target repository's scenario configuration names the BDD framework "cucumber-js", the per-issue scenario directory "features/per-issue/" and the step definition directory "features/step_definitions"
    And the target repository holds the Per-Issue Scenario "features/per-issue/feature-114505.feature" of issue 114505, whose pull request merged 3 days ago, with the nominated scenario "A payment is captured"
    And the promotion analysis agent writes for each candidate why it qualifies and how it fits the existing Regression Suite, including overlap with scenarios already there
    When the cron runs with its weekly Promotion Proposal pass due
    And the cron polls again while the proposal its first run filed is still open and older than the cron's grace period
    Then the cron filed exactly one Promotion Proposal in the target repository
    And that proposal carries the label "adw:none" and the Promotion Proposal label
    And the cron launched no orchestrator for that proposal

  @adw-1145 @subprocess @boundary-subprocess
  Scenario: The cron's Per-Issue Sweep keeps the stale Per-Issue Scenario whose nominated scenario is a candidate of the open Promotion Proposal, and the chore issue it files for the scenario it removes does not list that candidate's Step Definition
    Given the target repository's scenario configuration names the BDD framework "cucumber-js", the per-issue scenario directory "features/per-issue/" and the step definition directory "features/step_definitions"
    And the target repository holds the Per-Issue Scenario "features/per-issue/feature-114506.feature" of issue 114506, whose pull request merged 15 days ago, with the nominated scenario "A parcel is shipped"
    And the Step Definition "a parcel is shipped" on line 3 of "features/step_definitions/parcels.steps.js" is used by no feature file but the Per-Issue Scenario of issue 114506
    And the target repository holds the Per-Issue Scenario "features/per-issue/feature-114507.feature" of issue 114507, whose pull request merged 15 days ago
    And the Step Definition "a parcel is returned" on line 3 of "features/step_definitions/returns.steps.js" is used by no feature file but the Per-Issue Scenario of issue 114507
    And an open Promotion Proposal in the target repository offers the scenario "A parcel is shipped" of issue 114506
    When the cron runs with its Per-Issue Sweep due while that Promotion Proposal is open
    Then the sweep's merged pull request removed "features/per-issue/feature-114507.feature" from the target repository's default branch
    And the target repository's default branch still holds "features/per-issue/feature-114506.feature"
    And the cron filed exactly one chore issue in the target repository
    And that chore issue lists the Step Definition "a parcel is returned" at line 3 of "features/step_definitions/returns.steps.js"
    And that chore issue does not list the Step Definition "a parcel is shipped"
