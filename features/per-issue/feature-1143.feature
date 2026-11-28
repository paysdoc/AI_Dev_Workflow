@adw-1143
Feature: The Per-Issue Sweep files the removal chore for the unused Step Definitions of a cucumber-jvm repository

  @adw-1143 @subprocess @boundary-subprocess
  Scenario: The cron's Per-Issue Sweep files one chore issue for a cucumber-jvm repository, listing the Step Definition no feature file uses and leaving out the one the Regression Suite uses
    Given a cucumber-jvm repository whose ".adw/" is what "adw_init" writes for the application type "mobile:kotlincm", with its Step Definitions under "scenarios/src/test/kotlin"
    And the cucumber-jvm repository's Step Definition "an order is placed" in "scenarios/src/test/kotlin/steps/OrderSteps.kt" is used by the Regression Suite scenario "features/regression/orders.feature"
    And the cucumber-jvm repository's Step Definition "an order is cancelled" in "scenarios/src/test/kotlin/steps/OrderSteps.kt" is used by no feature file
    When the cron runs against the cucumber-jvm repository with its Per-Issue Sweep due
    Then the cron filed exactly one chore issue in the cucumber-jvm repository
    And that chore issue lists the Step Definition "an order is cancelled" in "scenarios/src/test/kotlin/steps/OrderSteps.kt"
    And that chore issue does not list the Step Definition "an order is placed"
