@adw-425
Feature: Replace ## Clear with ## Cancel: full issue cleanup directive

  The `## Cancel` directive replaces `## Clear`. It performs a full scorched-earth
  reset of all local state for an issue: killing agent processes, removing
  worktrees, deleting state directories, and clearing GitHub comments. The old
  `## Clear` directive is removed with no backwards compatibility.

  Background:
    Given the ADW codebase is checked out

  # ===================================================================
  # 1. Rename: CLEAR -> CANCEL in workflowCommentParsing.ts
  # ===================================================================

  @adw-425 @regression
  Scenario: CANCEL_COMMENT_PATTERN matches "## Cancel" case-insensitively
    Given "adws/core/workflowCommentParsing.ts" is read
    Then it exports a constant "CANCEL_COMMENT_PATTERN" with regex /^## Cancel$/mi

  @adw-425 @regression
  Scenario: isCancelComment function exists and uses CANCEL_COMMENT_PATTERN
    Given "adws/core/workflowCommentParsing.ts" is read
    Then it exports a function "isCancelComment" that tests the comment body against CANCEL_COMMENT_PATTERN

  @adw-425 @regression
  Scenario: CLEAR_COMMENT_PATTERN no longer exists in workflowCommentParsing.ts
    Given "adws/core/workflowCommentParsing.ts" is read
    Then the file does not export "CLEAR_COMMENT_PATTERN"
    And the file does not export "isClearComment"

  # ===================================================================
  # 2. Re-export chain updated
  # ===================================================================

  @adw-425 @regression
  Scenario: workflowComments.ts re-exports isCancelComment and CANCEL_COMMENT_PATTERN
    Given "adws/github/workflowComments.ts" is read
    Then the file re-exports "CANCEL_COMMENT_PATTERN" and "isCancelComment"
    And the file does not re-export "CLEAR_COMMENT_PATTERN" or "isClearComment"

  @adw-425 @regression
  Scenario: github/index.ts re-exports isCancelComment and CANCEL_COMMENT_PATTERN
    Given "adws/github/index.ts" is read
    Then the file re-exports "CANCEL_COMMENT_PATTERN" and "isCancelComment"
    And the file does not re-export "CLEAR_COMMENT_PATTERN" or "isClearComment"

  @adw-425 @regression
  Scenario: core/index.ts re-exports isCancelComment and CANCEL_COMMENT_PATTERN
    Given "adws/core/index.ts" is read
    Then the file re-exports "CANCEL_COMMENT_PATTERN" and "isCancelComment"
    And the file does not re-export "CLEAR_COMMENT_PATTERN" or "isClearComment"

  # ===================================================================
  # 3. New module: cancelHandler.ts exports
  # ===================================================================

  @adw-425 @regression
  Scenario: cancelHandler.ts exports MutableProcessedSets type
    Given "adws/triggers/cancelHandler.ts" is read
    Then the file exports a type "MutableProcessedSets" with "spawns: Set<number>" and "merges: Set<number>"

  @adw-425 @regression
  Scenario: cancelHandler.ts exports handleCancelDirective function
    Given "adws/triggers/cancelHandler.ts" is read
    Then the file exports a function "handleCancelDirective" accepting issueNumber, comments, repoInfo, optional cwd, and optional processedSets
    And the function returns a boolean

  # ===================================================================
  # 4. handleCancelDirective sequence: extract adwIds
  # ===================================================================

  @adw-425 @regression
  Scenario: handleCancelDirective extracts all adwIds from comments
    Given "adws/triggers/cancelHandler.ts" is read
    Then handleCancelDirective iterates over all comments and calls extractAdwIdFromComment for each
    And all unique non-null adwIds are collected

  # ===================================================================
  # 5. handleCancelDirective sequence: kill orchestrator PIDs
  # ===================================================================

  @adw-425 @regression
  Scenario: handleCancelDirective reads orchestrator PID from state file and kills it
    Given "adws/triggers/cancelHandler.ts" is read
    Then for each adwId, it reads the PID from "agents/{adwId}/state.json"
    And sends SIGTERM followed by SIGKILL to the orchestrator process

  @adw-425
  Scenario: handleCancelDirective gracefully handles missing state files
    Given "adws/triggers/cancelHandler.ts" is read
    Then handleCancelDirective does not throw when "agents/{adwId}/state.json" does not exist
    And continues processing the remaining adwIds

  # ===================================================================
  # 6. handleCancelDirective sequence: remove worktrees
  # ===================================================================

  @adw-425 @regression
  Scenario: handleCancelDirective calls removeWorktreesForIssue
    Given "adws/triggers/cancelHandler.ts" is read
    Then handleCancelDirective calls "removeWorktreesForIssue" with the issueNumber and optional cwd

  # ===================================================================
  # 7. handleCancelDirective sequence: delete state directories
  # ===================================================================

  @adw-425 @regression
  Scenario: handleCancelDirective deletes agent state directories for all adwIds
    Given "adws/triggers/cancelHandler.ts" is read
    Then for each adwId, it calls fs.rmSync on "agents/{adwId}/" with recursive and force options

  # ===================================================================
  # 8. handleCancelDirective sequence: clear comments
  # ===================================================================

  @adw-425 @regression
  Scenario: handleCancelDirective calls clearIssueComments
    Given "adws/triggers/cancelHandler.ts" is read
    Then handleCancelDirective calls "clearIssueComments" with the issueNumber and repoInfo

  # ===================================================================
  # 9. handleCancelDirective sequence: remove from processed sets
  # ===================================================================

  @adw-425 @regression
  Scenario: handleCancelDirective removes issue from processedSets when provided
    Given "adws/triggers/cancelHandler.ts" is read
    Then when processedSets is provided, handleCancelDirective deletes the issueNumber from both spawns and merges

  @adw-425
  Scenario: handleCancelDirective skips processedSets cleanup when not provided
    Given "adws/triggers/cancelHandler.ts" is read
    Then when processedSets is undefined, no set deletion is attempted

  # ===================================================================
  # 10. Cron integration: scan before filterEligibleIssues
  # ===================================================================

  @adw-425 @regression
  Scenario: Cron scans for ## Cancel on all fetched issues before filterEligibleIssues
    Given "adws/triggers/trigger_cron.ts" is read
    Then the cron trigger checks the latest comment of each issue for isCancelComment
    And this check occurs before the call to filterEligibleIssues

  @adw-425 @regression
  Scenario: Cron calls handleCancelDirective for issues with ## Cancel
    Given "adws/triggers/trigger_cron.ts" is read
    Then for each issue whose latest comment matches isCancelComment, handleCancelDirective is called

  @adw-425 @regression
  Scenario: Cancelled issues are added to processedSpawns to skip this cycle
    Given "adws/triggers/trigger_cron.ts" is read
    Then issue numbers that were cancelled are added to processedSpawns
    And filterEligibleIssues skips them in the current cycle

  @adw-425
  Scenario: Cancelled issues are re-eligible in the next cron cycle
    Given an issue with a "## Cancel" latest comment
    When the cron trigger processes the cancel directive
    Then the issue is skipped in the current cycle
    And the issue will be re-evaluated in the next cron cycle because processedSpawns is per-process

  @adw-425
  Scenario: Cron resolves target repo path via getTargetRepoWorkspacePath
    Given "adws/triggers/trigger_cron.ts" is read
    Then when --target-repo is set, the cwd for handleCancelDirective is resolved via getTargetRepoWorkspacePath
    And when --target-repo is not set, cwd is undefined

  # ===================================================================
  # 11. Cron does not touch processedPRs
  # ===================================================================

  @adw-425
  Scenario: Cancel directive does not affect processedPRs
    Given "adws/triggers/cancelHandler.ts" is read
    Then handleCancelDirective does not reference or modify processedPRs
    And the PR review cycle remains independent

  # ===================================================================
  # 12. Webhook integration: replace isClearComment with isCancelComment
  # ===================================================================

  @adw-425 @regression
  Scenario: Webhook imports isCancelComment instead of isClearComment
    Given "adws/triggers/trigger_webhook.ts" is read
    Then the file imports "isCancelComment" from the github module
    And the file does not import "isClearComment"

  @adw-425 @regression
  Scenario: Webhook calls handleCancelDirective instead of clearIssueComments
    Given "adws/triggers/trigger_webhook.ts" is read
    Then when isCancelComment matches, the handler calls handleCancelDirective
    And the handler does not directly call clearIssueComments for cancel directives

  @adw-425
  Scenario: Webhook does not pass processedSets to handleCancelDirective
    Given "adws/triggers/trigger_webhook.ts" is read
    Then the handleCancelDirective call in the webhook does not pass a processedSets argument

  @adw-425
  Scenario: Webhook resolves target repo cwd from payload
    Given "adws/triggers/trigger_webhook.ts" is read
    Then the cwd argument for handleCancelDirective is derived from the webhook payload

  # ===================================================================
  # 13. No backwards compatibility for ## Clear
  # ===================================================================

  @adw-425 @regression
  Scenario: No reference to "## Clear" pattern remains in the codebase
    Given the ADW codebase is checked out
    Then no TypeScript file in "adws/" contains the string "## Clear" in a regex pattern or constant

  @adw-425
  Scenario: A comment with "## Clear" is not recognized as a cancel directive
    Given a comment body containing "## Clear"
    When isCancelComment is called with that body
    Then it returns false

  # ===================================================================
  # 14. TypeScript compilation
  # ===================================================================

  @adw-425 @regression
  Scenario: TypeScript type-check passes after replacing Clear with Cancel
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0
