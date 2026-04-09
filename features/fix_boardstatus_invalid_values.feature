@adw-tdlgz7-fix-boardstatus-enum
Feature: Fix BoardStatus enum contains only valid project board statuses

  The BoardStatus enum must only contain statuses that actually exist on the
  GitHub project board: Todo, In Progress, Review, and Done. The removed
  Building and Testing values caused silent failures when moveToStatus()
  could not match them via the fuzzy matcher in projectBoardApi.ts.

  Background:
    Given the ADW codebase is checked out

  # ── Enum correctness ────────────────────────────────────────────────────────

  @adw-tdlgz7-fix-boardstatus-enum @regression
  Scenario: BoardStatus enum does not contain Building
    Given "adws/providers/types.ts" is read
    Then the file does not contain "Building"

  @adw-tdlgz7-fix-boardstatus-enum @regression
  Scenario: BoardStatus enum does not contain Testing
    Given "adws/providers/types.ts" is read
    Then the file does not contain "Testing"

  @adw-tdlgz7-fix-boardstatus-enum @adw-427 @regression
  Scenario: BoardStatus enum contains InProgress and Review
    Given "adws/providers/types.ts" is read
    Then the file contains "InProgress = 'In Progress'"
    And the file contains "Review = 'Review'"
    And the file contains "Blocked = 'Blocked'"
    And the file contains "Todo = 'Todo'"
    And the file contains "Done = 'Done'"

  # ── Phase files use InProgress ──────────────────────────────────────────────

  @adw-tdlgz7-fix-boardstatus-enum @regression
  Scenario: buildPhase.ts uses BoardStatus.InProgress instead of BoardStatus.Building
    Given "adws/phases/buildPhase.ts" is read
    Then the file contains "BoardStatus.InProgress"
    And the file does not contain "BoardStatus.Building"

  @adw-tdlgz7-fix-boardstatus-enum @regression
  Scenario: testPhase.ts uses BoardStatus.InProgress instead of BoardStatus.Testing
    Given "adws/phases/testPhase.ts" is read
    Then the file contains "BoardStatus.InProgress"
    And the file does not contain "BoardStatus.Testing"

  @adw-tdlgz7-fix-boardstatus-enum @regression
  Scenario: buildPhase.ts does not reference Building status string
    Given "adws/phases/buildPhase.ts" is read
    Then the file does not contain "Building"

  @adw-tdlgz7-fix-boardstatus-enum @regression
  Scenario: testPhase.ts does not reference Testing status string
    Given "adws/phases/testPhase.ts" is read
    Then the file does not contain "Testing"

  # ── Jira provider alignment ─────────────────────────────────────────────────

  @adw-tdlgz7-fix-boardstatus-enum @regression
  Scenario: Jira issue tracker does not reference Building or Testing statuses
    Given "adws/providers/jira/jiraIssueTracker.ts" is read
    Then the file does not contain "Building"
    And the file does not contain "Testing"

