@adw-427
Feature: Add BoardManager provider interface with board creation and Blocked status

  Adds a BoardManager provider interface that ensures a GitHub Projects V2 board
  exists with the required ADW columns. Extends BoardStatus with Blocked, Todo,
  and Done. Wires Blocked status on terminal workflow failures.

  Background:
    Given the ADW codebase is checked out

  # ── A: BoardManager interface ──────────────────────────────────────────────

  @adw-427 @regression
  Scenario: providers/types.ts exports a BoardManager interface
    Given "adws/providers/types.ts" is read
    Then the file contains "BoardManager"
    And the file contains "findBoard"
    And the file contains "createBoard"
    And the file contains "ensureColumns"

  @adw-427 @regression
  Scenario: BoardManager.findBoard returns Promise<string | null>
    Given "adws/providers/types.ts" is read
    Then the file contains "findBoard(): Promise<string | null>"

  @adw-427 @regression
  Scenario: BoardManager.createBoard accepts name and returns Promise<string>
    Given "adws/providers/types.ts" is read
    Then the file contains "createBoard(name: string): Promise<string>"

  @adw-427 @regression
  Scenario: BoardManager.ensureColumns accepts boardId and returns Promise<boolean>
    Given "adws/providers/types.ts" is read
    Then the file contains "ensureColumns(boardId: string): Promise<boolean>"

  # ── B: BoardStatus enum extension ──────────────────────────────────────────

  @adw-427 @regression
  Scenario: BoardStatus enum contains Blocked
    Given "adws/providers/types.ts" is read
    Then the file contains "Blocked = 'Blocked'"

  @adw-427 @regression
  Scenario: BoardStatus enum contains Todo
    Given "adws/providers/types.ts" is read
    Then the file contains "Todo = 'Todo'"

  @adw-427 @regression
  Scenario: BoardStatus enum contains Done
    Given "adws/providers/types.ts" is read
    Then the file contains "Done = 'Done'"

  @adw-427
  Scenario: BoardStatus enum retains InProgress and Review
    Given "adws/providers/types.ts" is read
    Then the file contains "InProgress = 'In Progress'"
    And the file contains "Review = 'Review'"

  # ── C: BOARD_COLUMNS constant ──────────────────────────────────────────────

  @adw-427 @regression
  Scenario: providers/types.ts exports a BOARD_COLUMNS constant
    Given "adws/providers/types.ts" is read
    Then the file contains "BOARD_COLUMNS"

  @adw-427
  Scenario: BOARD_COLUMNS defines all five statuses with order, color, and description
    Given "adws/providers/types.ts" is read
    Then the file contains "Blocked"
    And the file contains "Todo"
    And the file contains "In Progress"
    And the file contains "Review"
    And the file contains "Done"
    And the file contains "RED"
    And the file contains "GRAY"
    And the file contains "YELLOW"
    And the file contains "PURPLE"
    And the file contains "GREEN"

  # ── D: RepoContext includes boardManager ───────────────────────────────────

  @adw-427 @regression
  Scenario: RepoContext type includes boardManager property
    Given "adws/providers/types.ts" is read
    Then the file contains "boardManager"

  # ── E: GitHub BoardManager implementation ──────────────────────────────────

  @adw-427 @regression
  Scenario: GitHub provider directory contains a BoardManager implementation
    Given "adws/providers/github/githubBoardManager.ts" is read
    Then the file contains "BoardManager"

  @adw-427
  Scenario: githubBoardManager findBoard queries repository.projectsV2
    Given "adws/providers/github/githubBoardManager.ts" is read
    Then the file contains "projectsV2"

  @adw-427
  Scenario: githubBoardManager createBoard detects user vs org owner
    Given "adws/providers/github/githubBoardManager.ts" is read
    Then the file contains "createProjectV2"

  @adw-427
  Scenario: githubBoardManager ensureColumns adds missing columns with color and description
    Given "adws/providers/github/githubBoardManager.ts" is read
    Then the file contains "ensureColumns"
    And the file contains "color"
    And the file contains "description"

  @adw-427
  Scenario: GitHub provider index re-exports BoardManager
    Given "adws/providers/github/index.ts" is read
    Then the file contains "BoardManager" or "githubBoardManager"

  # ── F: Jira stub implementation ────────────────────────────────────────────

  @adw-427
  Scenario: Jira provider has a BoardManager stub
    Given "adws/providers/jira/jiraBoardManager.ts" is read
    Then the file contains "BoardManager"
    And the file contains "not implemented"

  # ── G: GitLab stub implementation ──────────────────────────────────────────

  @adw-427
  Scenario: GitLab provider has a BoardManager stub
    Given "adws/providers/gitlab/gitlabBoardManager.ts" is read
    Then the file contains "BoardManager"
    And the file contains "not implemented"

  # ── H: workflowInit board setup integration ────────────────────────────────

  @adw-427 @regression
  Scenario: initializeWorkflow calls board setup before worktree setup
    Given "adws/phases/workflowInit.ts" is read
    Then the file contains "boardManager"
    And the file contains "findBoard"

  @adw-427 @regression
  Scenario: Board setup failure does not block the workflow
    Given "adws/phases/workflowInit.ts" is read
    Then the board setup call is wrapped in a try-catch or .catch handler

  # ── I: Blocked status on workflow error ────────────────────────────────────

  @adw-427 @regression
  Scenario: handleWorkflowError moves issue to Blocked instead of InProgress
    Given "adws/phases/workflowCompletion.ts" is read
    Then the file contains "BoardStatus.Blocked"
    And the moveToStatus call in handleWorkflowError uses BoardStatus.Blocked

  @adw-427
  Scenario: handleWorkflowError no longer sets InProgress on error
    Given "adws/phases/workflowCompletion.ts" is read
    Then the handleWorkflowError function does not contain "BoardStatus.InProgress"

  # ── J: Blocked status on PR review workflow error ──────────────────────────

  @adw-427 @regression
  Scenario: handlePRReviewWorkflowError moves issue to Blocked
    Given "adws/phases/prReviewCompletion.ts" is read
    Then the file contains "BoardStatus.Blocked"
    And the file contains "moveToStatus"

  @adw-427
  Scenario: handlePRReviewWorkflowError uses config.base.issueNumber for board status
    Given "adws/phases/prReviewCompletion.ts" is read
    Then the file contains "config.base.issueNumber"

  # ── K: Rate limit pause retains InProgress ─────────────────────────────────

  @adw-427 @regression
  Scenario: handleRateLimitPause still moves issue to InProgress
    Given "adws/phases/workflowCompletion.ts" is read
    Then the handleRateLimitPause function contains "BoardStatus.InProgress"

  # ── L: Type-check passes ───────────────────────────────────────────────────

  @adw-427
  Scenario: TypeScript type-check passes after BoardManager changes
    Given the ADW codebase is checked out
    Then the ADW TypeScript type-check passes
