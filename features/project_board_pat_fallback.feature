@adw-9tknkw-project-board-fall-b
Feature: Project board PAT fallback when app token cannot access Projects V2

  When the GitHub App installation token cannot access Projects V2 (e.g., user-owned
  projects), moveIssueToStatus should fall back to GITHUB_PAT for project board
  GraphQL calls. Additionally, non-fatal failure log messages should be promoted
  from info to warn, and the auth method used should be logged.

  Background:
    Given the ADW codebase is checked out

  # ── A: PAT fallback mechanism ──────────────────────────────────────────────────

  @adw-9tknkw-project-board-fall-b @regression
  Scenario: projectBoardApi.ts imports GITHUB_PAT from config
    Given "adws/github/projectBoardApi.ts" is read
    Then the file contains "GITHUB_PAT"
    And the file contains "from '../core/config'"

  @adw-9tknkw-project-board-fall-b @regression
  Scenario: moveIssueToStatus retries with GITHUB_PAT when findRepoProjectId returns null
    Given "adws/github/projectBoardApi.ts" is read
    Then moveIssueToStatus contains a GITHUB_PAT fallback after findRepoProjectId returns null

  @adw-9tknkw-project-board-fall-b @regression
  Scenario: PAT fallback restores original GH_TOKEN after project board operations
    Given "adws/github/projectBoardApi.ts" is read
    Then moveIssueToStatus restores the original GH_TOKEN after PAT fallback

  # ── B: Log level promotion ─────────────────────────────────────────────────────

  @adw-9tknkw-project-board-fall-b @regression
  Scenario: "No project linked" log message uses warn level
    Given "adws/github/projectBoardApi.ts" is read
    Then the "No project linked" log message in moveIssueToStatus uses warn level

  @adw-9tknkw-project-board-fall-b @regression
  Scenario: "status not found" log messages use warn level
    Given "adws/github/projectBoardApi.ts" is read
    Then all status-not-found log messages in moveIssueToStatus use warn level

  # ── C: Auth method logging ─────────────────────────────────────────────────────

  @adw-9tknkw-project-board-fall-b @regression
  Scenario: moveIssueToStatus logs which auth method was used for project board operations
    Given "adws/github/projectBoardApi.ts" is read
    Then moveIssueToStatus logs the auth method used for project board operations

  # ── D: GITHUB_PAT accessible in config ─────────────────────────────────────────

  @adw-9tknkw-project-board-fall-b @regression
  Scenario: GITHUB_PAT is exported from config.ts
    Given "adws/core/environment.ts" is read
    Then the file contains "export const GITHUB_PAT"
