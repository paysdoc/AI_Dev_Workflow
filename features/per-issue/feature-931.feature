@adw-931 @adw-l1f01x-bug-restore-prompt-a
Feature: The framework upgrade gives a target repository the .github/adw.yml that holds its unit-test switch, and keeps the one it already has

  A target repository's first ADW set-up is also a framework upgrade.

  Background:
    Given the ADW codebase is checked out

  @adw-931 @adw-l1f01x-bug-restore-prompt-a
  Scenario Outline: A target repository <target repository> and without a .github/adw.yml gets one from its upgrade, with unit tests enabled
    Given a target repository <target repository>
    And the target repository's default branch has no ".github/adw.yml"
    And the "/adw_init" agent writes a complete ADW configuration and does not touch ".github/adw.yml"
    When the framework upgrade regenerates the target repository's ADW configuration
    Then the upgrade commits the regenerated configuration
    And the regen commit adds ".github/adw.yml"
    And ADW reads the unit-test switch in the regen commit's ".github/adw.yml" as enabled

    Examples:
      | target repository                         |
      | never initialised by ADW                  |
      | initialised by an older framework version |

  @adw-931 @adw-l1f01x-bug-restore-prompt-a
  Scenario: A target repository whose .github/adw.yml disables unit tests keeps that file unchanged through its upgrade
    Given a target repository initialised by an older framework version
    And the target repository's default branch has this ".github/adw.yml":
      """
      unitTests: false
      """
    And the "/adw_init" agent writes a complete ADW configuration and does not touch ".github/adw.yml"
    When the framework upgrade regenerates the target repository's ADW configuration
    Then the upgrade commits the regenerated configuration
    And the regen commit does not change ".github/adw.yml"
    And ADW reads the unit-test switch in the regen commit's ".github/adw.yml" as disabled

  @adw-931 @adw-l1f01x-bug-restore-prompt-a
  Scenario: The ADW TypeScript type-check passes once no file reads a unit-test switch from .adw/project.md
    Then the ADW TypeScript type-check passes
