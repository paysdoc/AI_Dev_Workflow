@adw-991 @adw-gfv9kt-feat-the-application
Feature: The application type decides the evidence through a framework-owned mapping, and an issue whose repository declares no application type ADW knows parks until "adw_init" is re-run

  The application type is the "## Application Type" section of ".adw/project.md".

  Background:
    Given the ADW codebase is checked out

  @adw-991 @adw-gfv9kt-feat-the-application
  Scenario: The mapping runs a "cli" application's scenarios with the runner ".adw/scenarios.md" describes and asks for no image as evidence
    When the application-type mapping is consulted for the application type "cli"
    Then the mapping chooses the scenario runner that ".adw/scenarios.md" describes
    And the mapping asks for no image as evidence

  @adw-991 @adw-gfv9kt-feat-the-application
  Scenario: The mapping runs a "web" application's scenarios on ADW's Playwright project and asks for an image of each per-issue scenario as evidence
    When the application-type mapping is consulted for the application type "web"
    Then the mapping chooses ADW's Playwright project as the scenario runner
    And the mapping asks for an image of each per-issue scenario as evidence

  @adw-991 @adw-gfv9kt-feat-the-application
  Scenario: The mapping gives "cli" and "web" each a review guidance section of its own
    When the application-type mapping is consulted for the application type "cli"
    And the application-type mapping is consulted for the application type "web"
    Then each of those consultations chose a review guidance section, and no two chose the same one

  @adw-991 @adw-gfv9kt-feat-the-application
  Scenario: The mapping parks the issue when there is no application type, and records that none was found
    When the application-type mapping is consulted with no application type
    Then the mapping decides to park the issue for the reason "missing_application_type"
    And the park records that no application type was found

  @adw-991 @adw-gfv9kt-feat-the-application
  Scenario Outline: The mapping parks the issue for the application type "<value>", which it does not know, and records the value it found
    When the application-type mapping is consulted for the application type "<value>"
    Then the mapping decides to park the issue for the reason "missing_application_type"
    And the park records that the application type "<value>" was found

    Examples:
      | value      |
      | desktop    |
      | cli or web |

  @adw-991 @adw-gfv9kt-feat-the-application
  Scenario: ADW reads no application type, and not "cli", from a ".adw/project.md" that has no "## Application Type" section
    Given a repository whose ".adw/project.md" has no "## Application Type" section
    When ADW reads the repository's project configuration
    Then the project configuration names no application type

  @adw-991 @adw-gfv9kt-feat-the-application
  Scenario: ADW reads no application type, and not "cli", from a repository that has no ".adw/" directory
    Given a repository that has no ".adw/" directory
    When ADW reads the repository's project configuration
    Then the project configuration names no application type

  @adw-991 @adw-gfv9kt-feat-the-application
  Scenario: ADW's own repository declares the application type "cli", so the mapping runs its scenarios with the runner ".adw/scenarios.md" describes and asks for no image
    When ADW reads the project configuration of its own repository
    And the application-type mapping is consulted with that repository's application type
    Then the project configuration names the application type "cli"
    And the mapping chooses the scenario runner that ".adw/scenarios.md" describes
    And the mapping asks for no image as evidence

  @adw-991 @adw-gfv9kt-feat-the-application
  Scenario: An issue in a repository whose ".adw/project.md" has no "## Application Type" section is parked as "human_gated" when its workflow starts, with a comment that says the section is missing and to re-run "adw_init"
    Given a workflow for issue 9911 whose repository's ".adw/project.md" has no "## Application Type" section
    When the workflow for issue 9911 starts
    Then the workflow's start did not complete
    And the workflow for issue 9911 is parked as "human_gated"
    And the park comment posted on issue 9911 says that "## Application Type" is missing
    And the park comment posted on issue 9911 says to re-run "adw_init"

  @adw-991 @adw-gfv9kt-feat-the-application
  Scenario Outline: An issue in a repository whose ".adw/project.md" declares the application type "<value>", which ADW does not know, is parked as "human_gated" when its workflow starts, with a comment that names the value and says to re-run "adw_init"
    Given a workflow for issue <issue> whose repository's ".adw/project.md" declares the application type "<value>"
    When the workflow for issue <issue> starts
    Then the workflow's start did not complete
    And the workflow for issue <issue> is parked as "human_gated"
    And the park comment posted on issue <issue> names "## Application Type"
    And the park comment posted on issue <issue> names "<value>"
    And the park comment posted on issue <issue> says to re-run "adw_init"

    Examples:
      | issue | value      |
      | 9912  | desktop    |
      | 9913  | cli or web |

  @adw-991 @adw-gfv9kt-feat-the-application
  Scenario: An issue in a repository whose "## Application Type" section is empty is parked as "human_gated" when its workflow starts, with a comment that says to re-run "adw_init"
    Given a workflow for issue 9914 whose repository's ".adw/project.md" holds:
      """
      # ADW Project Configuration

      ## Project Overview
      A command-line tool that prints invoices.

      ## Application Type

      ## Framework Notes
      A TypeScript command-line tool run with Bun.
      """
    When the workflow for issue 9914 starts
    Then the workflow's start did not complete
    And the workflow for issue 9914 is parked as "human_gated"
    And the park comment posted on issue 9914 names "## Application Type"
    And the park comment posted on issue 9914 says to re-run "adw_init"

  @adw-991 @adw-gfv9kt-feat-the-application
  Scenario Outline: An issue in a repository whose ".adw/project.md" declares the application type "<type>" is not parked when its workflow starts
    Given a workflow for issue <issue> whose repository's ".adw/project.md" declares the application type "<type>"
    When the workflow for issue <issue> starts
    Then the workflow's start completed
    And the workflow for issue <issue> is not parked
    And no park comment was posted on issue <issue>

    Examples:
      | issue | type |
      | 9915  | cli  |
      | 9916  | web  |

  @adw-991 @adw-gfv9kt-feat-the-application
  Scenario: "## Retry" on an issue parked for a missing application type re-reads "## Application Type": once the repository's default branch declares "cli", the resumed workflow starts and is not parked again
    Given a workflow for issue 9917 whose repository's ".adw/project.md" has no "## Application Type" section
    And the workflow for issue 9917 has started and been parked as "human_gated"
    And the repository's default branch has since gained a commit whose ".adw/project.md" declares the application type "cli"
    When "## Retry" is posted on issue 9917
    And the resumed workflow starts
    Then the workflow's start completed
    And the workflow for issue 9917 is not parked
    And exactly one park comment was posted on issue 9917

  @adw-991 @adw-gfv9kt-feat-the-application
  Scenario Outline: The framework upgrade of a target repository never initialised by ADW commits the "## Application Type" its "/adw_init" agent wrote, and ADW reads "<type>" from the regen commit
    Given a target repository never initialised by ADW
    And the "/adw_init" agent writes a complete ADW configuration whose ".adw/project.md" declares the application type "<type>"
    When the framework upgrade regenerates the target repository's ADW configuration
    Then the upgrade commits the regenerated configuration
    And ADW reads the application type "<type>" from the regen commit's ".adw/project.md"

    Examples:
      | type |
      | cli  |
      | web  |

  @adw-991 @adw-gfv9kt-feat-the-application
  Scenario Outline: When the "/adw_init" agent cannot decide the application type, the framework upgrade of a target repository <history> still commits the regenerated configuration and writes no default "## Application Type"
    Given a target repository <history>
    And the "/adw_init" agent writes a complete ADW configuration whose ".adw/project.md" has no "## Application Type" section
    When the framework upgrade regenerates the target repository's ADW configuration
    Then the upgrade commits the regenerated configuration
    And ADW reads no application type from the regen commit's ".adw/project.md"

    Examples:
      | history                                   |
      | never initialised by ADW                  |
      | initialised by an older framework version |

  @adw-991 @adw-gfv9kt-feat-the-application
  Scenario: The ADW TypeScript type-check passes once the application type has no default
    Then the ADW TypeScript type-check passes
