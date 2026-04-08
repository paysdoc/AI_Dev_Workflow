@adw-398
Feature: Migrate adwPrReview to phaseRunner (resolves 4 disparities)

  Refactor adwPrReview.tsx to use runPhase()/CostTracker from core/phaseRunner.ts
  instead of hand-rolled cost bookkeeping. PR-specific phases use the closure-wrapper
  pattern to pass PRReviewWorkflowConfig through runPhase, while shared phases
  (e.g. install) call runPhase directly. This resolves four prior disparities:
  top-level state tracking, rate-limit pause/resume, D1 cost posting, and
  distributed board moves readiness.

  Background:
    Given the ADW codebase is checked out
    And issue #396 (PRReviewWorkflowConfig composition) has been merged

  # --- 1: CostTracker replaces hand-rolled accumulation ---

  @adw-398 @regression
  Scenario: adwPrReview uses CostTracker instead of manual totalCostUsd/totalModelUsage
    Given "adws/adwPrReview.tsx" is read
    Then the file imports "CostTracker" from the phaseRunner module
    And the file creates a CostTracker instance
    And the file does not declare a local "totalCostUsd" variable
    And the file does not declare a local "totalModelUsage" variable

  @adw-398 @regression
  Scenario: adwPrReview does not manually call mergeModelUsageMaps
    Given "adws/adwPrReview.tsx" is read
    Then the file does not call "mergeModelUsageMaps"
    And the file does not call "persistTokenCounts"
    And the file does not call "computeDisplayTokens"

  # --- 2: runPhase replaces direct phase calls ---

  @adw-398 @regression
  Scenario: adwPrReview uses runPhase for all phase executions
    Given "adws/adwPrReview.tsx" is read
    Then the file imports "runPhase" from the phaseRunner module
    And every phase execution is wrapped in a runPhase call
    And the file does not directly call executePRReviewPlanPhase outside a runPhase wrapper
    And the file does not directly call executePRReviewBuildPhase outside a runPhase wrapper
    And the file does not directly call executePRReviewTestPhase outside a runPhase wrapper

  # --- 3: Closure-wrapper pattern for PR-specific phases ---

  @adw-398 @regression
  Scenario: PR-specific phases use closure-wrapper to pass PRReviewWorkflowConfig
    Given "adws/adwPrReview.tsx" is read
    Then the PR review plan phase is called via a closure: runPhase(config.base, tracker, _ => executePRReviewPlanPhase(config))
    And the PR review build phase is called via a closure wrapping executePRReviewBuildPhase
    And the PR review test phase is called via a closure wrapping executePRReviewTestPhase

  @adw-398
  Scenario: runPhase receives config.base (WorkflowConfig) not config (PRReviewWorkflowConfig)
    Given "adws/adwPrReview.tsx" is read
    Then each runPhase call passes "config.base" as the first argument
    And no runPhase call passes the full PRReviewWorkflowConfig as the first argument

  # --- 4: Shared install phase uses runPhase directly ---

  @adw-398 @regression
  Scenario: Install phase is called through runPhase instead of inline agent invocation
    Given "adws/adwPrReview.tsx" is read
    Then the file does not call "runInstallAgent" directly
    And the file does not call "extractInstallContext" directly
    And the install phase is invoked via runPhase with executeInstallPhase or a closure

  @adw-398
  Scenario: Inline install agent code block removed from adwPrReview
    Given "adws/adwPrReview.tsx" is read
    Then the file does not contain "AgentStateManager.initializeState" for install-agent
    And the file does not contain "install_cache.md" file writes
    And the file does not contain "installResult.totalCostUsd"

  # --- 5: Inline postCostRecordsToD1 removed from prReviewCompletion ---

  @adw-398 @regression
  Scenario: prReviewCompletion no longer calls postCostRecordsToD1 inline
    Given "adws/phases/prReviewCompletion.ts" is read
    Then the file does not import "postCostRecordsToD1" from the d1Client module
    And the file does not call "postCostRecordsToD1" directly
    And cost records are posted via the phaseRunner's tracker.commit path instead

  @adw-398
  Scenario: prReviewCompletion still builds cost section for comments
    Given "adws/phases/prReviewCompletion.ts" is read
    Then the function "buildPRReviewCostSection" still generates PhaseCostRecords
    And the function still calls "formatCostCommentSection" for the GitHub comment
    And the cost comment section is still stored in ctx for downstream use

  # --- 6: Manual RateLimitError catch block removed ---

  @adw-398 @regression
  Scenario: adwPrReview does not manually catch RateLimitError
    Given "adws/adwPrReview.tsx" is read
    Then the file does not contain a catch block that checks "instanceof RateLimitError"
    And the file does not call "process.exit(0)" for rate limit handling
    And rate limit errors are handled by phaseRunner's runPhase catch clause

  @adw-398
  Scenario: adwPrReview does not import RateLimitError
    Given "adws/adwPrReview.tsx" is read
    Then the file does not import "RateLimitError" from agentTypes

  # --- 7: Top-level state written for each PR review phase ---

  @adw-398 @regression
  Scenario: PR review install phase writes top-level state transitions
    Given a PR review workflow is running with adwId "prrev001"
    When runPhase executes the install phase for the PR review workflow
    Then the top-level state file for "prrev001" records "install" with status "running" before execution
    And the top-level state file for "prrev001" records "install" with status "completed" after success

  @adw-398 @regression
  Scenario: PR review plan phase writes top-level state transitions
    Given a PR review workflow is running with adwId "prrev001"
    When runPhase executes the plan phase for the PR review workflow
    Then the top-level state file for "prrev001" records "pr_review_plan" with status "running"
    And the top-level state file for "prrev001" records "pr_review_plan" with status "completed" after success

  @adw-398
  Scenario: PR review build phase writes top-level state transitions
    Given a PR review workflow is running with adwId "prrev001"
    When runPhase executes the build phase for the PR review workflow
    Then the top-level state file for "prrev001" records "pr_review_build" with status "running"
    And the top-level state file for "prrev001" records "pr_review_build" with status "completed" after success

  @adw-398
  Scenario: PR review test phase writes top-level state transitions
    Given a PR review workflow is running with adwId "prrev001"
    When runPhase executes the test phase for the PR review workflow
    Then the top-level state file for "prrev001" records "pr_review_test" with status "running"
    And the top-level state file for "prrev001" records "pr_review_test" with status "completed" after success

  # --- 8: Rate-limit pause/resume in PR review ---

  @adw-398 @regression
  Scenario: PR review workflow pauses on rate limit via phaseRunner
    Given a PR review workflow is running with adwId "prrev002"
    When the PR review plan phase encounters a RateLimitError
    Then handleRateLimitPause is called by phaseRunner with the phase name
    And the workflow is enqueued in the pause queue
    And a "paused" comment is posted on the GitHub issue
    And the process exits with code 0

  @adw-398
  Scenario: PR review workflow resumes after rate limit clears
    Given a PR review workflow was paused at "pr_review_plan" with completed phases ["install"]
    When the cron probe detects the rate limit has cleared
    And the PR review workflow is respawned
    Then runPhase skips the "install" phase (already completed)
    And runPhase executes the "pr_review_plan" phase

  # --- 9: D1 cost records posted via phaseRunner ---

  @adw-398 @regression
  Scenario: D1 cost records posted for each PR review phase via tracker.commit
    Given a PR review workflow completes all phases successfully
    Then cost records for the install phase are posted to D1 via tracker.commit
    And cost records for the plan phase are posted to D1 via tracker.commit
    And cost records for the build phase are posted to D1 via tracker.commit
    And cost records for the test phase are posted to D1 via tracker.commit

  @adw-398
  Scenario: D1 cost posting failure does not crash PR review workflow
    Given a PR review workflow is running
    When the D1 cost API returns an error during phase cost commit
    Then the error is logged but the workflow continues
    And subsequent phases still execute

  # --- 10: Phase result compatibility ---

  @adw-398 @adw-402 @regression
  Scenario: PR review phase functions return PhaseResult-compatible objects
    Given the PR review phase functions in "adws/phases/prReviewPhase.ts"
    Then executePRReviewPlanPhase returns an object extending PhaseResult
    And executePRReviewBuildPhase returns an object extending PhaseResult
    And executePRReviewTestPhase returns an object extending PhaseResult
    And executePRReviewCommitPushPhase returns an object extending PhaseResult
    And each return value includes costUsd and modelUsage fields

  @adw-398
  Scenario: PR review plan phase closure preserves planOutput in return value
    Given the PR review plan phase is called via closure-wrapper
    When the plan phase completes successfully
    Then the runPhase return value includes the planOutput field
    And the planOutput is available to pass to the build phase

  # --- 11: completePRReviewWorkflow uses tracker totals ---

  @adw-398
  Scenario: completePRReviewWorkflow receives cost totals from CostTracker
    Given "adws/adwPrReview.tsx" is read
    Then completePRReviewWorkflow is called with tracker.totalModelUsage
    And the completion function does not receive hand-rolled totalModelUsage

  # --- 12: Error handling uses phaseRunner pattern ---

  @adw-398
  Scenario: Non-rate-limit errors still call handlePRReviewWorkflowError
    Given a PR review workflow is running
    When a phase throws a non-RateLimitError exception
    Then the error propagates out of runPhase
    And handlePRReviewWorkflowError is called with tracker cost totals

  # --- 13: Type checks pass ---

  @adw-398 @regression
  Scenario: TypeScript type-check passes after phaseRunner migration
    Given the ADW codebase with PR review phaseRunner migration applied
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0

  @adw-398 @regression
  Scenario: TypeScript type-check passes for adws project after migration
    Given the ADW codebase with PR review phaseRunner migration applied
    When "bunx tsc --noEmit -p adws/tsconfig.json" is run
    Then the command exits with code 0

  # --- 14: Vitest unit tests pass ---

  @adw-398 @regression
  Scenario: All existing unit tests pass after migration
    Given the ADW codebase with PR review phaseRunner migration applied
    When "bun run test" is run
    Then all unit tests pass
