@regression
Feature: Calculator

  Scenario: Add two numbers
    Given I have the number 2
    And I have the number 3
    When I add them
    Then the result is 5

  Scenario: Subtract two numbers
    Given I have the number 5
    And I have the number 3
    When I subtract them
    Then the result is 2
