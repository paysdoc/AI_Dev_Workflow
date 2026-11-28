Feature: Orders

  Background:
    Given the shop is open

  Scenario: A customer orders apples
    When a customer orders 2 "apples"
    Then the order is accepted

  Scenario Outline: A customer orders pears
    When a customer orders <count> "pears"

    Examples:
      | count |
      | 1     |
      | 3     |
