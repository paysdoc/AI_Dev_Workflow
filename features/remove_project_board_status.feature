@adw-2tlgjj-remove-project-board
Feature: Remove project board status management from ADW

  ADW must not manage project board status transitions. The issue tracker's
  built-in project automations are the sole authority for board status
  management. All `moveToStatus` calls, the `IssueTracker.moveToStatus`
  interface method, its provider implementations, and `projectBoardApi.ts`
  must be fully removed.

  Background:
    Given the ADW codebase is checked out

  # ── 1. File deletion ──────────────────────────────────────────────────────────

  @adw-2tlgjj-remove-project-board @regression
  Scenario: projectBoardApi.ts is deleted from adws/github/
    When the filesystem is checked for "adws/github/projectBoardApi.ts"
    Then the file does not exist

  # ── 2. Provider interface cleanup ────────────────────────────────────────────

  @adw-2tlgjj-remove-project-board @regression
  Scenario: IssueTracker interface does not declare moveToStatus
    Given "adws/providers/types.ts" is read
    When searching for "moveToStatus"
    Then the file does not contain "moveToStatus"

  # ── 3. Phase call removal ─────────────────────────────────────────────────────

  @adw-2tlgjj-remove-project-board @regression
  Scenario: planPhase.ts does not call moveToStatus
    Given "adws/phases/planPhase.ts" is read
    When searching for "moveToStatus"
    Then the file does not contain "moveToStatus"

  @adw-2tlgjj-remove-project-board @regression
  Scenario: workflowCompletion.ts does not call moveToStatus
    Given "adws/phases/workflowCompletion.ts" is read
    When searching for "moveToStatus"
    Then the file does not contain "moveToStatus"

  @adw-2tlgjj-remove-project-board @regression
  Scenario: prReviewCompletion.ts does not call moveToStatus
    Given "adws/phases/prReviewCompletion.ts" is read
    When searching for "moveToStatus"
    Then the file does not contain "moveToStatus"

  # ── 4. Provider implementation cleanup ───────────────────────────────────────

  @adw-2tlgjj-remove-project-board @regression
  Scenario: githubIssueTracker.ts does not implement moveToStatus
    Given "adws/providers/github/githubIssueTracker.ts" is read
    When searching for "moveToStatus"
    Then the file does not contain "moveToStatus"

  @adw-2tlgjj-remove-project-board @regression
  Scenario: jiraIssueTracker.ts does not implement moveToStatus
    Given "adws/providers/jira/jiraIssueTracker.ts" is read
    When searching for "moveToStatus"
    Then the file does not contain "moveToStatus"

  # ── 5. Export cleanup ─────────────────────────────────────────────────────────

  @adw-2tlgjj-remove-project-board @regression
  Scenario: moveIssueToStatus is not re-exported from adws/github/index.ts
    Given "adws/github/index.ts" is read
    When searching for "moveIssueToStatus"
    Then the file does not contain "moveIssueToStatus"

  # ── 6. No remaining imports of projectBoardApi ────────────────────────────────

  @adw-2tlgjj-remove-project-board @regression
  Scenario: githubIssueTracker.ts does not import from projectBoardApi
    Given "adws/providers/github/githubIssueTracker.ts" is read
    When searching for "projectBoardApi"
    Then the file does not contain "projectBoardApi"

  # ── 7. Build integrity ────────────────────────────────────────────────────────

  @adw-2tlgjj-remove-project-board @regression
  Scenario: TypeScript type-check passes after removing project board status management
    Given all project board status management code has been removed
    When "bunx tsc --noEmit" and "bunx tsc --noEmit -p adws/tsconfig.json" are run
    Then both type-check commands exit with code 0
    And no "Module ... has no exported member" errors are reported
