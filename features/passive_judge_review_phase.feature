@adw-401
Feature: Review phase rewrite as passive judge

  The review phase is rewritten as a passive judge. executeReviewPhase is
  relocated from phases/workflowCompletion.ts to a new phases/reviewPhase.ts.
  It reads scenario_proof.md from the agent state directory, calls a single
  review agent (no parallelism) to judge the proof against issue requirements,
  and returns reviewIssues + success. It does not run tests, navigate the
  application, start a dev server, or invoke prepare_app. The review retry
  loop moves from agents/reviewRetry.ts to an orchestrator-level
  patch+build+retest loop. review.md is rewritten to Strategy A+B only.

  Background:
    Given the ADW codebase is checked out

  # ===================================================================
  # 1. phases/reviewPhase.ts — module existence and exports
  # ===================================================================

  @adw-401 @regression
  Scenario: reviewPhase.ts exists and exports executeReviewPhase
    Given "adws/phases/reviewPhase.ts" is read
    Then the module exports a function named "executeReviewPhase"

  @adw-401 @regression
  Scenario: executeReviewPhase accepts WorkflowConfig and scenarioProofPath
    Given "adws/phases/reviewPhase.ts" is read
    Then the function signature accepts a "WorkflowConfig" parameter
    And the function accepts a "scenarioProofPath" string parameter
    And the return type includes "costUsd", "modelUsage", "reviewPassed", and "phaseCostRecords"
    And the return type includes "reviewIssues"

  # ===================================================================
  # 2. phases/reviewPhase.ts — passive judge behaviour
  # ===================================================================

  @adw-401 @regression
  Scenario: reviewPhase reads scenario_proof.md and judges against issue requirements
    Given a workflow config for issue 42
    And scenario_proof.md exists in the agent state directory
    When executeReviewPhase is called with the scenarioProofPath
    Then the review agent receives the scenario proof content
    And the review agent judges the proof against the issue requirements

  @adw-401 @regression
  Scenario: reviewPhase does not run tests or start a dev server
    Given "adws/phases/reviewPhase.ts" is read
    Then the module does not import "withDevServer"
    And the module does not import "prepare_app"
    And the module does not call any test runner functions
    And the module does not start a dev server

  @adw-401
  Scenario: reviewPhase does not navigate the application or take screenshots
    Given "adws/phases/reviewPhase.ts" is read
    Then the module does not reference "applicationUrl"
    And the module does not capture UI screenshots
    And the module does not import screenshot-related functions

  @adw-401 @regression
  Scenario: reviewPhase calls a single review agent
    Given "adws/phases/reviewPhase.ts" is read
    Then the module calls "runReviewAgent" exactly once per review invocation
    And the module does not use "Promise.all" for parallel review agents
    And the module does not reference "REVIEW_AGENT_COUNT"

  @adw-401
  Scenario: reviewPhase returns reviewIssues and success
    Given a workflow config for issue 42
    And the review agent returns issues with severities
    When executeReviewPhase completes
    Then the result includes "reviewPassed" set to true when no blockers exist
    And the result includes "reviewIssues" with all issues found
    And the result includes "costUsd" and "modelUsage"

  # ===================================================================
  # 3. executeReviewPhase removed from workflowCompletion.ts
  # ===================================================================

  @adw-401 @regression
  Scenario: executeReviewPhase is removed from workflowCompletion.ts
    Given "adws/phases/workflowCompletion.ts" is read
    Then the module does NOT export a function named "executeReviewPhase"
    And the module does not contain a function definition for "executeReviewPhase"

  @adw-401 @regression
  Scenario: workflowCompletion.ts contains only terminal-state handlers
    Given "adws/phases/workflowCompletion.ts" is read
    Then the module exports "completeWorkflow"
    And the module exports "handleWorkflowError"
    And the module exports "handleRateLimitPause"
    And the module does not export review-related functions

  # ===================================================================
  # 4. agents/reviewAgent.ts — simplified (no parallelism, no screenshots)
  # ===================================================================

  @adw-401 @regression
  Scenario: reviewAgent.ts drops agentIndex parameter
    Given "adws/agents/reviewAgent.ts" is read
    Then the "runReviewAgent" function does not accept an "agentIndex" parameter
    And the function does not create display names like "Review #1", "Review #2"

  @adw-401 @regression
  Scenario: reviewAgent.ts drops screenshot capture
    Given "adws/agents/reviewAgent.ts" is read
    Then the module does not reference screenshot capture functions
    And the module does not import screenshot-related utilities

  @adw-401
  Scenario: reviewAgent.ts accepts scenarioProofPath as a single argument
    Given "adws/agents/reviewAgent.ts" is read
    Then the "runReviewAgent" function accepts a "scenarioProofPath" parameter
    And the scenarioProofPath is passed directly, not via strategy plumbing

  # ===================================================================
  # 5. agents/reviewRetry.ts — deleted
  # ===================================================================

  @adw-401 @regression
  Scenario: reviewRetry.ts is deleted
    Then the file "adws/agents/reviewRetry.ts" does NOT exist

  @adw-401 @regression
  Scenario: No imports of reviewRetry remain in the codebase
    When all TypeScript files under "adws/" are searched
    Then no file imports from "reviewRetry"
    And no file imports "runReviewWithRetry"
    And no file imports "mergeReviewResults"

  # ===================================================================
  # 6. REVIEW_AGENT_COUNT constant — deleted
  # ===================================================================

  @adw-401 @regression
  Scenario: REVIEW_AGENT_COUNT constant is deleted from core config
    Given "adws/core/config.ts" is read
    Then the file does not define "REVIEW_AGENT_COUNT"

  @adw-401
  Scenario: REVIEW_AGENT_COUNT is not referenced anywhere in the codebase
    When all TypeScript files under "adws/" are searched
    Then no file references "REVIEW_AGENT_COUNT"

  # ===================================================================
  # 7. .claude/commands/review.md — rewritten per Q44 sketch
  # ===================================================================

  @adw-401 @regression
  Scenario: review.md contains Strategy A (scenario proof from argument)
    Given the file ".claude/commands/review.md" is read
    Then it describes Strategy A for reading scenario_proof.md from the supplied path
    And Strategy A evaluates per-tag results from the proof markdown
    And Strategy A creates reviewIssues based on tag pass/fail

  @adw-401 @regression
  Scenario: review.md contains Strategy B (custom proof from .adw/review_proof.md)
    Given the file ".claude/commands/review.md" is read
    Then it describes Strategy B for following .adw/review_proof.md instructions
    And Strategy B is used when .adw/review_proof.md exists and is non-empty

  @adw-401 @regression
  Scenario: review.md does not contain Strategy C (UI navigation fallback)
    Given the file ".claude/commands/review.md" is read
    Then it does not contain a "Strategy C" or "Default UI Validation" section
    And it does not reference navigating to an application URL
    And it does not reference taking UI screenshots

  @adw-401 @regression
  Scenario: review.md does not invoke prepare_app
    Given the file ".claude/commands/review.md" is read
    Then it does not reference "prepare_app" or "prepare_app.md"
    And it does not reference starting a dev server

  @adw-401
  Scenario: review.md does not use applicationUrl variable
    Given the file ".claude/commands/review.md" is read
    Then it does not define an "applicationUrl" variable
    And it does not reference "localhost" or application URLs

  @adw-401 @regression
  Scenario: review.md output structure matches passive judge shape
    Given the file ".claude/commands/review.md" is read
    Then the output JSON includes "success", "reviewSummary", "reviewIssues"
    And the output JSON includes "screenshots" containing the proof file path
    And the output does not include UI screenshot paths

  # ===================================================================
  # 8. Orchestrator-level review patch+retest loop
  # ===================================================================

  @adw-401 @regression
  Scenario: adwSdlc.tsx has orchestrator-level review retry loop
    Given the file "adws/adwSdlc.tsx" is read
    Then the review phase is wrapped in a retry loop bounded by MAX_REVIEW_RETRY_ATTEMPTS
    And when review returns blockers the loop runs runPatchAgent per blocker
    And after patching the loop runs runBuildAgent
    And after building the loop commits and pushes
    And after pushing the loop re-runs scenarioTestPhase
    And after scenario tests pass the loop re-runs reviewPhase

  @adw-401 @regression
  Scenario: adwPlanBuildReview.tsx has orchestrator-level review retry loop
    Given the file "adws/adwPlanBuildReview.tsx" is read
    Then the review phase is wrapped in a retry loop bounded by MAX_REVIEW_RETRY_ATTEMPTS
    And when review returns blockers the loop runs runPatchAgent per blocker
    And after patching the loop runs runBuildAgent
    And after building the loop commits and pushes
    And after pushing the loop re-runs scenarioTestPhase
    And after scenario tests pass the loop re-runs reviewPhase

  @adw-401 @regression
  Scenario: adwPlanBuildTestReview.tsx has orchestrator-level review retry loop
    Given the file "adws/adwPlanBuildTestReview.tsx" is read
    Then the review phase is wrapped in a retry loop bounded by MAX_REVIEW_RETRY_ATTEMPTS
    And when review returns blockers the loop runs runPatchAgent per blocker
    And after patching the loop runs runBuildAgent
    And after building the loop commits and pushes
    And after pushing the loop re-runs scenarioTestPhase
    And after scenario tests pass the loop re-runs reviewPhase

  @adw-401 @regression
  Scenario: adwPrReview.tsx has orchestrator-level review retry loop via phaseRunner
    Given the file "adws/adwPrReview.tsx" is read
    Then the review phase is wrapped in a retry loop bounded by MAX_REVIEW_RETRY_ATTEMPTS
    And when review returns blockers the loop runs runPatchAgent per blocker
    And after patching the loop runs runBuildAgent
    And after building the loop commits and pushes
    And after pushing the loop re-runs scenarioTestPhase
    And after scenario tests pass the loop re-runs reviewPhase
    And the review phase is called via runPhase with config.base

  @adw-401 @regression
  Scenario: adwChore.tsx has orchestrator-level review retry loop on regression_possible path
    Given the file "adws/adwChore.tsx" is read
    And the diff evaluator returns "regression_possible"
    Then the review phase is wrapped in a retry loop bounded by MAX_REVIEW_RETRY_ATTEMPTS
    And when review returns blockers the loop runs runPatchAgent per blocker
    And after patching the loop runs runBuildAgent
    And after building the loop commits and pushes
    And after pushing the loop re-runs scenarioTestPhase
    And after scenario tests pass the loop re-runs reviewPhase

  # ===================================================================
  # 9. Review retry loop — behavioural scenarios
  # ===================================================================

  @adw-401
  Scenario: Review retry loop exits when review passes on first attempt
    Given any orchestrator with a review retry loop is executing
    When executeReviewPhase returns reviewPassed true
    Then the retry loop exits immediately
    And runPatchAgent is never called

  @adw-401
  Scenario: Review retry loop exits after MAX_REVIEW_RETRY_ATTEMPTS exhausted
    Given any orchestrator with a review retry loop is executing
    And MAX_REVIEW_RETRY_ATTEMPTS is 3
    When every reviewPhase attempt returns blockers
    Then the retry loop exits after 3 patch+retest cycles
    And the workflow continues with the remaining blocker issues

  @adw-401
  Scenario: Review retry loop re-runs scenario tests after patching
    Given a review retry loop iteration has patched a blocker
    And runBuildAgent has been called for the patch
    And the changes have been committed and pushed
    When scenarioTestPhase is re-run
    And scenario tests pass
    Then reviewPhase is re-run to verify the patch resolved the blocker

  @adw-401
  Scenario: Review retry loop handles scenario test failure after patch
    Given a review retry loop iteration has patched a blocker
    And runBuildAgent has been called for the patch
    When scenarioTestPhase is re-run after the patch
    And scenario tests fail
    Then the scenario fix loop runs before re-running review

  # ===================================================================
  # 10. Orchestrator review phase now receives scenarioProofPath
  # ===================================================================

  @adw-401 @regression
  Scenario: All orchestrators pass scenarioProofPath to executeReviewPhase
    Given the files are read:
      | file                             |
      | adws/adwSdlc.tsx                 |
      | adws/adwPlanBuildReview.tsx       |
      | adws/adwPlanBuildTestReview.tsx   |
      | adws/adwChore.tsx                |
      | adws/adwPrReview.tsx             |
    Then each orchestrator that calls executeReviewPhase passes a scenarioProofPath argument
    And the scenarioProofPath is the path from the scenarioTestPhase result

  # ===================================================================
  # 11. Re-exports and index updates
  # ===================================================================

  @adw-401
  Scenario: phases/index.ts exports executeReviewPhase from reviewPhase
    Given "adws/phases/index.ts" is read
    Then it exports "executeReviewPhase" from "./reviewPhase"
    And it does NOT export "executeReviewPhase" from "./workflowCompletion"

  @adw-401
  Scenario: agents/index.ts no longer exports reviewRetry functions
    Given "adws/agents/index.ts" is read
    Then it does NOT export "runReviewWithRetry"
    And it does NOT export "mergeReviewResults"
    And it does NOT re-export from "./reviewRetry"

  # ===================================================================
  # 12. Existing tests still pass
  # ===================================================================

  @adw-401 @regression
  Scenario: TypeScript type-check passes after review phase rewrite
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0

  @adw-401 @regression
  Scenario: All existing unit tests pass after review phase rewrite
    When "bun run test" is run
    Then all unit tests pass
