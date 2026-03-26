@adw-308
Feature: Unit test support in /implement_tdd when enabled in project config

  When `.adw/project.md` has `## Unit Tests: enabled`, the `/implement_tdd` skill
  integrates unit tests into the TDD loop alongside step definitions. Unit tests
  are written during the RED phase (test-first), verified during GREEN alongside
  BDD scenarios, and serve as finer-grained coverage. When unit tests are disabled
  or absent, only BDD scenarios drive the TDD loop.

  Background:
    Given the ADW codebase is at the current working directory
    And the file ".claude/skills/implement-tdd/SKILL.md" is read

  # ===================================================================
  # 1. SKILL.md reads the Unit Tests setting from .adw/project.md
  # ===================================================================

  @adw-308 @regression
  Scenario: SKILL.md instructs reading the Unit Tests setting from .adw/project.md
    When the content is inspected
    Then it contains instructions to check ".adw/project.md" for the "## Unit Tests" setting
    And the check happens before or during the TDD loop, not after

  # ===================================================================
  # 2. Unit tests integrated into the RED phase when enabled
  # ===================================================================

  @adw-308 @regression
  Scenario: SKILL.md integrates unit tests into the RED phase when enabled
    When the content is inspected for the red-green-refactor loop instructions
    Then the RED phase includes writing unit tests alongside step definitions when unit tests are enabled
    And unit tests are written before implementation code (test-first)

  @adw-308 @regression
  Scenario: SKILL.md instructs writing unit tests per scenario, not as a separate batch
    When the content is inspected for the red-green-refactor loop instructions
    Then unit tests are written as part of the vertical slice for each scenario
    And there is no separate post-loop section for writing all unit tests at once

  # ===================================================================
  # 3. GREEN phase verifies both unit tests and BDD scenarios
  # ===================================================================

  @adw-308 @regression
  Scenario: SKILL.md instructs verifying both unit test and scenario pass during GREEN
    When the content is inspected for the GREEN phase instructions
    Then the GREEN phase verifies that both the BDD scenario and unit tests pass
    And implementation is considered GREEN only when both pass

  # ===================================================================
  # 4. Unit tests skipped when disabled or absent
  # ===================================================================

  @adw-308 @regression
  Scenario: SKILL.md skips unit tests when setting is disabled
    When the content is inspected
    Then it describes skipping unit tests when the "## Unit Tests" setting is "disabled"
    And only BDD scenarios drive the TDD loop in this case

  @adw-308 @regression
  Scenario: SKILL.md skips unit tests when setting is absent
    When the content is inspected
    Then it describes skipping unit tests when the "## Unit Tests" section is absent from ".adw/project.md"
    And the behavior is identical to when unit tests are disabled

  # ===================================================================
  # 5. References to tests.md and mocking.md for unit test quality
  # ===================================================================

  @adw-308 @regression
  Scenario: SKILL.md references tests.md for unit test quality guidance
    When the content is inspected for unit test instructions
    Then it references "tests.md" for guidance on writing good unit tests

  @adw-308 @regression
  Scenario: SKILL.md references mocking.md for unit test mocking guidance
    When the content is inspected for unit test instructions
    Then it references "mocking.md" for guidance on mocking in unit tests

  # ===================================================================
  # 6. BDD scenarios remain the independent proof layer
  # ===================================================================

  @adw-308
  Scenario: SKILL.md positions BDD scenarios as the independent proof layer
    When the content is inspected
    Then it describes BDD scenarios as the independent proof layer
    And it distinguishes unit tests as finer-grained coverage written by the same agent
    And it does not elevate unit test status above BDD scenarios

  # ===================================================================
  # 7. TDD loop structure with unit tests enabled
  # ===================================================================

  @adw-308
  Scenario: SKILL.md describes the complete TDD loop when unit tests are enabled
    When the content is inspected for the red-green-refactor loop instructions
    Then the enabled-unit-test loop follows this structure:
      | phase    | activity                                        |
      | RED      | Write step definition + unit test                |
      | GREEN    | Implement code to pass both scenario and unit test |
      | REFACTOR | Clean up while keeping both green                |

  @adw-308
  Scenario: SKILL.md describes the TDD loop when unit tests are disabled
    When the content is inspected for the red-green-refactor loop instructions
    Then the disabled-unit-test loop follows this structure:
      | phase    | activity                              |
      | RED      | Write step definition                 |
      | GREEN    | Implement code to pass scenario       |
      | REFACTOR | Clean up while keeping scenario green |

  # ===================================================================
  # 8. Vertical slicing still enforced with unit tests
  # ===================================================================

  @adw-308
  Scenario: Vertical slicing applies to unit tests as well as step definitions
    When the content is inspected
    Then the vertical slicing instruction covers both step definitions and unit tests
    And it warns against writing all unit tests first then all implementation
