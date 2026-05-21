@adw-test
Feature: Lifecycle mixed fixture

  @adw-test
  Scenario: Refresh path scenario
    When the "promotion-sweep" orchestrator is invoked with adwId "test" and issue 1
    Then the orchestrator subprocess exited 0

  @adw-test
  Scenario: Suppress path scenario
    When the "promotion-sweep" orchestrator is invoked with adwId "test" and issue 1
    Then the orchestrator subprocess exited 0

  Scenario: Withdraw path scenario
    Given some unregistered setup step
    When some unregistered action happens
    Then some unregistered assertion is made
