@adw-968 @adw-6zth7b-bug-run-the-full-pip
Feature: The chore, SDLC and rate-limit smoke scenarios run real orchestrators, and the regression suite runs with no pending, undefined or failed scenario

  Background:
    Given the ADW codebase is checked out

  @adw-968 @adw-6zth7b-bug-run-the-full-pip
  Scenario: Run by Cucumber in a process of its own, the scenarios tagged "@regression" report no pending, no undefined and no failed scenario, the run exits 0, and the chore, SDLC and rate-limit smoke scenarios pass in it
    When Cucumber runs the scenarios tagged "@regression" in a child process
    Then that run reports no pending, no undefined and no failed scenario, and exits 0
    And that run passed each of these smoke scenarios:
      | feature                         | scenario                                                                    |
      | adw_chore_diff_verdicts.feature | safe diff verdict — docs-only change completes without escalation           |
      | adw_chore_diff_verdicts.feature | regression_possible diff verdict — adws-touching change escalates to review |
      | adw_sdlc_happy_path.feature     | adwSdlc completes the full pipeline end-to-end                              |
      | pause_resume_rate_limit.feature | orchestrator records paused stage on rate-limit detection                   |

  @adw-968 @adw-6zth7b-bug-run-the-full-pip
  Scenario: The step definitions Cucumber loads define none of the retired When phrases W2 to W8 and W11, and exactly one of each of W1, W9 and W10
    When Cucumber dry-runs every feature its configuration loads
    Then the dry run loaded no step definition with any of these expressions:
      | expression                                                    |
      | the plan phase is executed with config {string}               |
      | the build phase is executed with config {string}              |
      | the review phase is executed with config {string}             |
      | the PR phase is executed with config {string}                 |
      | the auto-merge phase is executed with config {string}         |
      | the document phase is executed with config {string}           |
      | the install phase is executed with config {string}            |
      | the webhook handler receives a {string} event for issue {int} |
    And the dry run loaded exactly one step definition with each of these expressions:
      | expression                                                               |
      | the {string} orchestrator is invoked with adwId {string} and issue {int} |
      | the workflow is initialised with config {string}                         |
      | the cron probe runs once                                                 |

  @adw-968 @adw-6zth7b-bug-run-the-full-pip
  Scenario: The ADW TypeScript type-check passes with the smoke scenarios on real orchestrators and the retired When steps deleted
    Then the ADW TypeScript type-check passes
