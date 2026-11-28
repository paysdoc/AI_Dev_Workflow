Feature: Every step

  Scenario: The steps the other features leave unused
    Given a returning customer
    And the shop closes at 18
    Then the order is rejected
