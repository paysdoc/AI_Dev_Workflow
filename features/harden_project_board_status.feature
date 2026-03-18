@adw-c3urq8-harden-project-board
Feature: Harden project board status propagation

  Improves observability and reliability of project board status updates:
  - B1: Promotes error logging from warn to error on moveIssueToStatus failure
  - B2: moveIssueToStatus returns boolean (true=success, false=failure) across all providers
  - C1: Calls refreshTokenIfNeeded() before GraphQL calls to prevent token expiry
  - D: Adds intermediate status transitions for Build, Test, and PR phases

  Background:
    Given the ADW codebase is checked out

  # ── B1: Promote log level ────────────────────────────────────────────────────

  @adw-c3urq8-harden-project-board @regression
  Scenario: moveIssueToStatus logs at error level on failure
    Given "adws/github/projectBoardApi.ts" is read
    Then the catch block in moveIssueToStatus logs at error level not warn

  # ── B2: Return boolean from moveIssueToStatus ────────────────────────────────

  @adw-c3urq8-harden-project-board @regression
  Scenario: moveIssueToStatus return type is Promise<boolean>
    Given "adws/github/projectBoardApi.ts" is read
    Then the file contains "Promise<boolean>"

  @adw-c3urq8-harden-project-board @regression
  Scenario: moveIssueToStatus returns true in the success path
    Given "adws/github/projectBoardApi.ts" is read
    Then moveIssueToStatus has a return true statement in the success path

  @adw-c3urq8-harden-project-board @regression
  Scenario: moveIssueToStatus returns false in the catch block
    Given "adws/github/projectBoardApi.ts" is read
    Then moveIssueToStatus has a return false statement in the catch block

  @adw-c3urq8-harden-project-board @regression
  Scenario: IssueTracker.moveToStatus declares Promise<boolean> return type
    Given "adws/providers/types.ts" is read
    Then the IssueTracker moveToStatus method returns Promise<boolean>

  @adw-c3urq8-harden-project-board @regression
  Scenario: githubIssueTracker moveToStatus returns Promise<boolean>
    Given "adws/providers/github/githubIssueTracker.ts" is read
    Then the file contains "Promise<boolean>"

  @adw-c3urq8-harden-project-board @regression
  Scenario: jiraIssueTracker moveToStatus returns Promise<boolean>
    Given "adws/providers/jira/jiraIssueTracker.ts" is read
    Then the file contains "Promise<boolean>"

  # ── C1: Token refresh before board updates ───────────────────────────────────

  @adw-c3urq8-harden-project-board @regression
  Scenario: projectBoardApi.ts imports refreshTokenIfNeeded from githubAppAuth
    Given "adws/github/projectBoardApi.ts" is read
    Then the file contains "refreshTokenIfNeeded"

  @adw-c3urq8-harden-project-board @regression
  Scenario: moveIssueToStatus calls refreshTokenIfNeeded before any GraphQL call
    Given "adws/github/projectBoardApi.ts" is read
    Then refreshTokenIfNeeded is called before findRepoProjectId in moveIssueToStatus

  # ── D: Intermediate status transitions ───────────────────────────────────────

  @adw-c3urq8-harden-project-board @regression
  Scenario: buildPhase.ts calls moveToStatus with Building at phase entry
    Given "adws/phases/buildPhase.ts" is read
    Then the file contains "Building"

  @adw-c3urq8-harden-project-board @regression
  Scenario: testPhase.ts calls moveToStatus with Testing at phase entry
    Given "adws/phases/testPhase.ts" is read
    Then the file contains "Testing"

  @adw-c3urq8-harden-project-board @regression
  Scenario: prPhase.ts calls moveToStatus with In Review after PR creation
    Given "adws/phases/prPhase.ts" is read
    Then the file contains "In Review"

  @adw-c3urq8-harden-project-board @regression
  Scenario: TypeScript type-check passes after project board hardening changes
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
