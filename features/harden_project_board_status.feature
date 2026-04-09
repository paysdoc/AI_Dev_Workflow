@adw-wrzj5j-harden-project-board
Feature: Harden project board status propagation

  Improves observability and reliability of project board status updates:
  - B1: Promotes error logging from warn to error on moveIssueToStatus failure
  - B2: moveIssueToStatus returns boolean (true=success, false=failure) across all providers
  - C1: Calls refreshTokenIfNeeded() before GraphQL calls to prevent token expiry
  - D: Adds intermediate status transitions for Build, Test, and PR phases

  Background:
    Given the ADW codebase is checked out

  # ── B1: Promote log level ────────────────────────────────────────────────────

  @adw-wrzj5j-harden-project-board @regression
  Scenario: moveIssueToStatus logs at error level on failure
    Given "adws/github/projectBoardApi.ts" is read
    Then the catch block in moveIssueToStatus logs at error level not warn

  # ── B2: Return boolean from moveIssueToStatus ────────────────────────────────

  @adw-wrzj5j-harden-project-board @regression
  Scenario: moveIssueToStatus return type is Promise<boolean>
    Given "adws/github/projectBoardApi.ts" is read
    Then the file contains "Promise<boolean>"

  @adw-wrzj5j-harden-project-board @regression
  Scenario: moveIssueToStatus returns true in the success path
    Given "adws/github/projectBoardApi.ts" is read
    Then moveIssueToStatus has a return true statement in the success path

  @adw-wrzj5j-harden-project-board @regression
  Scenario: moveIssueToStatus returns false in the catch block
    Given "adws/github/projectBoardApi.ts" is read
    Then moveIssueToStatus has a return false statement in the catch block

  @adw-wrzj5j-harden-project-board @regression
  Scenario: IssueTracker.moveToStatus declares Promise<boolean> return type
    Given "adws/providers/types.ts" is read
    Then the IssueTracker moveToStatus method returns Promise<boolean>

  @adw-wrzj5j-harden-project-board @regression
  Scenario: githubIssueTracker moveToStatus returns Promise<boolean>
    Given "adws/providers/github/githubIssueTracker.ts" is read
    Then the file contains "Promise<boolean>"

  @adw-wrzj5j-harden-project-board @regression
  Scenario: jiraIssueTracker moveToStatus returns Promise<boolean>
    Given "adws/providers/jira/jiraIssueTracker.ts" is read
    Then the file contains "Promise<boolean>"

  # ── C1: Token refresh before board updates ───────────────────────────────────

  @adw-wrzj5j-harden-project-board @regression
  Scenario: projectBoardApi.ts imports refreshTokenIfNeeded from githubAppAuth
    Given "adws/github/projectBoardApi.ts" is read
    Then the file contains "refreshTokenIfNeeded"

  @adw-wrzj5j-harden-project-board @regression
  Scenario: moveIssueToStatus calls refreshTokenIfNeeded before any GraphQL call
    Given "adws/github/projectBoardApi.ts" is read
    Then refreshTokenIfNeeded is called before findRepoProjectId in moveIssueToStatus

  # ── D: Intermediate status transitions ───────────────────────────────────────

  @adw-wrzj5j-harden-project-board @adw-tdlgz7-fix-boardstatus-enum @regression
  Scenario: buildPhase.ts calls moveToStatus with InProgress at phase entry
    Given "adws/phases/buildPhase.ts" is read
    Then the file contains "InProgress"

  @adw-wrzj5j-harden-project-board @adw-tdlgz7-fix-boardstatus-enum @regression
  Scenario: testPhase.ts calls moveToStatus with InProgress at phase entry
    Given "adws/phases/testPhase.ts" is read
    Then the file contains "InProgress"

  @adw-wrzj5j-harden-project-board @adw-7sunv4-fix-issue-status-pro @regression
  Scenario: prPhase.ts calls moveToStatus with Review after successful PR creation
    Given "adws/phases/prPhase.ts" is read
    Then the file contains "moveToStatus"
    And the file contains "BoardStatus.Review"

  # ── E: BoardStatus enum ───────────────────────────────────────────────────────

  @adw-wrzj5j-harden-project-board @regression
  Scenario: adws/providers/types.ts defines a BoardStatus enum
    Given "adws/providers/types.ts" is read
    Then the file contains "BoardStatus"

  @adw-wrzj5j-harden-project-board @adw-tdlgz7-fix-boardstatus-enum @adw-427 @regression
  Scenario: BoardStatus enum contains the expected values
    Given "adws/providers/types.ts" is read
    Then the file contains "In Progress"
    And the file contains "Review"
    And the file contains "Blocked"
    And the file contains "Todo"
    And the file contains "Done"
    And the file does not contain "Building"
    And the file does not contain "Testing"

  @adw-wrzj5j-harden-project-board @regression
  Scenario: Phase files use BoardStatus enum references instead of raw strings
    Given "adws/phases/planPhase.ts" is read
    Then the file contains "BoardStatus.InProgress"

  @adw-wrzj5j-harden-project-board @adw-tdlgz7-fix-boardstatus-enum @regression
  Scenario: buildPhase.ts uses BoardStatus enum reference
    Given "adws/phases/buildPhase.ts" is read
    Then the file contains "BoardStatus.InProgress"

  @adw-wrzj5j-harden-project-board @adw-tdlgz7-fix-boardstatus-enum @regression
  Scenario: testPhase.ts uses BoardStatus enum reference
    Given "adws/phases/testPhase.ts" is read
    Then the file contains "BoardStatus.InProgress"

  @adw-wrzj5j-harden-project-board @regression
  Scenario: TypeScript type-check passes after project board hardening changes
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes

  # ── F: PAT fallback for user-owned Projects V2 ───────────────────────────────

  @adw-wrzj5j-harden-project-board @regression
  Scenario: projectBoardApi.ts imports GITHUB_PAT from core config
    Given "adws/github/projectBoardApi.ts" is read
    Then the file contains "GITHUB_PAT"

  @adw-wrzj5j-harden-project-board @regression
  Scenario: projectBoardApi.ts imports isGitHubAppConfigured from githubAppAuth
    Given "adws/github/projectBoardApi.ts" is read
    Then the file contains "isGitHubAppConfigured"

  @adw-wrzj5j-harden-project-board @regression
  Scenario: moveIssueToStatus logs warn level when no project is found
    Given "adws/github/projectBoardApi.ts" is read
    Then the "No project linked" log in moveIssueToStatus uses warn level

  @adw-wrzj5j-harden-project-board @regression
  Scenario: moveIssueToStatus attempts PAT fallback when app token fails
    Given "adws/github/projectBoardApi.ts" is read
    Then the file contains "retrying with GITHUB_PAT"
