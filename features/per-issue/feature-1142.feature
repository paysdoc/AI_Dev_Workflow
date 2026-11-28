@adw-1142 @adw-1wsrtn-per-issue-sweep-find
Feature: The Per-Issue Sweep files one chore issue listing the Step Definitions that no remaining feature file uses
  The Per-Issue Sweep is the cron's periodic removal of Per-Issue Scenarios whose issue's pull request merged more than 14 days ago.

  @adw-1142 @adw-1wsrtn-per-issue-sweep-find @subprocess @boundary-subprocess
  Scenario: In a target whose scenario configuration puts Per-Issue Scenarios in "e2e/per-issue/" and Step Definitions in "e2e/steps", the cron's Per-Issue Sweep removes the stale Per-Issue Scenario and its step definition file from those directories and files a chore issue listing the Step Definition in "e2e/steps" that no feature file uses any more
    Given the target repository's scenario configuration names the BDD framework "cucumber-js", the per-issue scenario directory "e2e/per-issue/" and the step definition directory "e2e/steps"
    And the target repository holds the Per-Issue Scenario "e2e/per-issue/feature-114201.feature" of issue 114201, whose pull request merged 15 days ago
    And the target repository holds the step definition file "e2e/steps/feature-114201.steps.js", which only the Per-Issue Scenario of issue 114201 uses
    And the Step Definition "the report is printed" on line 4 of "e2e/steps/report.steps.js" is used by no feature file but the Per-Issue Scenario of issue 114201
    When the cron runs with its Per-Issue Sweep due
    Then the sweep's merged pull request removed "e2e/per-issue/feature-114201.feature" from the target repository's default branch
    And the sweep's merged pull request removed "e2e/steps/feature-114201.steps.js" from the target repository's default branch
    And the cron filed exactly one chore issue in the target repository
    And that chore issue lists the Step Definition "the report is printed" at line 4 of "e2e/steps/report.steps.js"

  @adw-1142 @adw-1wsrtn-per-issue-sweep-find @subprocess @boundary-subprocess
  Scenario: The cron's Per-Issue Sweep files exactly one chore issue, listing with its file and line each Step Definition that only the stale Per-Issue Scenario used, and files none when it runs again while that issue is open
    Given the target repository's scenario configuration names the BDD framework "cucumber-js", the per-issue scenario directory "features/per-issue/" and the step definition directory "features/step_definitions"
    And the target repository holds the Per-Issue Scenario "features/per-issue/feature-114202.feature" of issue 114202, whose pull request merged 15 days ago
    And the Step Definition "an order is placed" on line 3 of "features/step_definitions/orders.steps.js" is used by no feature file but the Per-Issue Scenario of issue 114202
    And the Step Definition "the invoice is sent" on line 6 of "features/step_definitions/invoices.steps.js" is used by no feature file but the Per-Issue Scenario of issue 114202
    When the cron runs with its Per-Issue Sweep due
    And the cron runs again with its Per-Issue Sweep due, while the chore issue its first run filed is still open
    Then the cron filed exactly one chore issue in the target repository
    And that chore issue lists the Step Definition "an order is placed" at line 3 of "features/step_definitions/orders.steps.js"
    And that chore issue lists the Step Definition "the invoice is sent" at line 6 of "features/step_definitions/invoices.steps.js"

  @adw-1142 @adw-1wsrtn-per-issue-sweep-find @subprocess @boundary-subprocess
  Scenario: The cron's Per-Issue Sweep removes a stale Per-Issue Scenario whose Step Definitions the target's Regression Suite still uses, and files no issue
    Given the target repository's scenario configuration names the BDD framework "cucumber-js", the per-issue scenario directory "features/per-issue/" and the step definition directory "features/step_definitions"
    And the target repository holds the Per-Issue Scenario "features/per-issue/feature-114203.feature" of issue 114203, whose pull request merged 15 days ago
    And every Step Definition in "features/step_definitions", including each one the Per-Issue Scenario of issue 114203 uses, is also used by the Regression Suite scenario "features/regression/orders.feature"
    When the cron runs with its Per-Issue Sweep due
    Then the sweep's merged pull request removed "features/per-issue/feature-114203.feature" from the target repository's default branch
    And the cron filed no issue in the target repository

  @adw-1142 @adw-1wsrtn-per-issue-sweep-find @subprocess @boundary-subprocess
  Scenario: In a target whose BDD framework is "behave", the cron's Per-Issue Sweep still removes the stale Per-Issue Scenario, logs that finding unused Step Definitions is not supported for that framework, and files no issue
    Given the target repository's scenario configuration names the BDD framework "behave", the per-issue scenario directory "features/per-issue/" and the step definition directory "features/steps"
    And the target repository holds the Per-Issue Scenario "features/per-issue/feature-114204.feature" of issue 114204, whose pull request merged 15 days ago
    And the Step Definition "an order is placed" in "features/steps/orders.py" is used by no feature file but the Per-Issue Scenario of issue 114204
    When the cron runs with its Per-Issue Sweep due
    Then the sweep's merged pull request removed "features/per-issue/feature-114204.feature" from the target repository's default branch
    And the cron logged that finding unused Step Definitions is not supported for the BDD framework "behave"
    And the cron filed no issue in the target repository
