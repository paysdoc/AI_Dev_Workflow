@adw-test
Feature: High-score subprocess fixture

  @adw-test
  Scenario: A high-quality subprocess scenario
    When the "promotion-sweep" orchestrator is invoked with adwId "test" and issue 1
    Then the orchestrator subprocess exited 0
