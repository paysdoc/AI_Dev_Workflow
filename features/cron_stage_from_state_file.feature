@adw-379
Feature: Cron reads workflow stage from state file instead of parsing issue comments

  The cron trigger currently determines an issue's workflow stage by parsing
  the latest ADW comment header via getIssueWorkflowStage(). This feature
  migrates that logic to read workflowStage from the top-level state file
  (agents/<adwId>/state.json) via AgentStateManager. The adw-id is still
  extracted from issue comments via regex, but the stage itself comes from
  the state file. Issues with no adw-id or no state file are treated as
  fresh candidates.

  Background:
    Given the ADW codebase is checked out

  # ===================================================================
  # 1. adw-id extraction from comments (minimal comment dependency)
  # ===================================================================

  @adw-379 @regression
  Scenario: Cron extracts adw-id from issue comments using extractAdwIdFromComment
    Given the file "adws/triggers/trigger_cron.ts" is read
    Then it should import or use extractAdwIdFromComment from workflowCommentParsing
    And the adw-id is extracted from issue comments to locate the state file

  @adw-379 @regression
  Scenario: adw-id extraction uses the existing regex pattern
    Given an issue comment body containing "**ADW ID:** `gq51dc-migrate-cron-stage-d`"
    When extractAdwIdFromComment parses the comment
    Then the extracted adw-id is "gq51dc-migrate-cron-stage-d"

  @adw-379
  Scenario: adw-id extraction returns null for non-ADW comments
    Given an issue comment body containing "This is a regular comment"
    When extractAdwIdFromComment parses the comment
    Then the extracted adw-id is null

  # ===================================================================
  # 2. Stage read from state file via AgentStateManager
  # ===================================================================

  @adw-379 @regression
  Scenario: evaluateIssue reads workflowStage from the top-level state file
    Given an issue with adw-id "abc12345" extracted from comments
    And a state file exists at "agents/abc12345/state.json" with workflowStage "build_running"
    When the cron trigger evaluates the issue
    Then the workflow stage is read from the state file via AgentStateManager
    And the stage value used for filtering is "build_running"

  @adw-379 @regression
  Scenario: evaluateIssue does not use parseWorkflowStageFromComment for stage determination
    Given the file "adws/triggers/trigger_cron.ts" is read
    Then the evaluateIssue function does not call parseWorkflowStageFromComment to determine stage
    And stage determination relies on AgentStateManager.readTopLevelState

  # ===================================================================
  # 3. Fresh candidate handling (no adw-id / no state file)
  # ===================================================================

  @adw-379 @regression
  Scenario: Issue with no ADW comments is treated as a fresh candidate
    Given an issue with no ADW workflow comments
    When the cron trigger evaluates eligibility
    Then the issue is considered eligible as a fresh candidate

  @adw-379 @regression
  Scenario: Issue with adw-id but no state file is treated as a fresh candidate
    Given an issue with adw-id "orphan123" extracted from comments
    And no state file exists at "agents/orphan123/state.json"
    When the cron trigger evaluates eligibility
    Then the issue is considered eligible as a fresh candidate

  @adw-379
  Scenario: Issue with adw-id and empty state file is treated as a fresh candidate
    Given an issue with adw-id "empty12345" extracted from comments
    And a state file exists at "agents/empty12345/state.json" without a workflowStage field
    When the cron trigger evaluates eligibility
    Then the issue is considered eligible as a fresh candidate

  # ===================================================================
  # 4. ACTIVE_STAGES and RETRIABLE_STAGES filtering from state file
  # ===================================================================

  @adw-379 @regression
  Scenario Outline: Issue with active stage "<stage>" from state file is excluded
    Given an issue with adw-id "active123" extracted from comments
    And a state file exists at "agents/active123/state.json" with workflowStage "<stage>"
    When the cron trigger evaluates eligibility
    Then the issue is not eligible for re-processing
    And the filter reason includes "active"

    Examples:
      | stage            |
      | starting         |
      | build_running    |
      | review_running   |
      | pr_creating      |
      | install_running  |

  @adw-379 @regression
  Scenario Outline: Issue with retriable stage "<stage>" from state file is re-eligible
    Given an issue with adw-id "retry123" extracted from comments
    And a state file exists at "agents/retry123/state.json" with workflowStage "<stage>"
    When the cron trigger evaluates eligibility
    Then the issue is considered eligible for re-processing

    Examples:
      | stage          |
      | error          |
      | review_failed  |
      | build_failed   |

  @adw-379 @regression
  Scenario: Issue with completed stage from state file is excluded
    Given an issue with adw-id "done12345" extracted from comments
    And a state file exists at "agents/done12345/state.json" with workflowStage "completed"
    When the cron trigger evaluates eligibility
    Then the issue is not eligible for re-processing
    And the filter reason includes "completed"

  @adw-379
  Scenario: Issue with unknown stage from state file is excluded
    Given an issue with adw-id "unknown123" extracted from comments
    And a state file exists at "agents/unknown123/state.json" with workflowStage "some_unknown_stage"
    When the cron trigger evaluates eligibility
    Then the issue is not eligible for re-processing

  # ===================================================================
  # 5. Grace period check uses state file timestamps
  # ===================================================================

  @adw-379 @regression
  Scenario: Grace period uses state file timestamp instead of issue updatedAt
    Given an issue with adw-id "grace12345" extracted from comments
    And a state file exists at "agents/grace12345/state.json" with a recent updatedAt timestamp
    When the cron trigger checks the grace period
    Then the grace period is evaluated against the state file timestamp
    And the issue is excluded due to grace period

  @adw-379 @regression
  Scenario: Issue outside state file grace period is not excluded
    Given an issue with adw-id "old1234567" extracted from comments
    And a state file exists at "agents/old1234567/state.json" with an updatedAt timestamp older than the grace period
    When the cron trigger checks the grace period
    Then the issue is not excluded by grace period

  @adw-379
  Scenario: Grace period falls back to issue updatedAt when no state file exists
    Given an issue with no ADW comments and a recent updatedAt timestamp
    When the cron trigger checks the grace period
    Then the grace period is evaluated against the issue updatedAt
    And the issue is excluded due to grace period

  # ===================================================================
  # 6. Verbose poll logging still works with state file source
  # ===================================================================

  @adw-379
  Scenario: Poll logging reflects state file sourced filtering
    Given the cron trigger polls and finds issues with various state file stages
    When the poll cycle completes evaluation
    Then it logs a one-liner in format "POLL: N open, N candidates [#list], filtered: #N(reason) ..."
    And filter reasons may include "active", "completed", or "grace_period"

  # ===================================================================
  # 7. TypeScript compilation
  # ===================================================================

  @adw-379 @regression
  Scenario: TypeScript type-check passes after cron state file migration
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0
