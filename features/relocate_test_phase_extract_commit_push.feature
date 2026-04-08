@adw-402
Feature: executePRReviewTestPhase relocation + commit+push extraction

  Two cleanups targeting prReviewCompletion.ts, both leaving it with only
  terminal handlers:

  1. Move executePRReviewTestPhase from prReviewCompletion.ts to prReviewPhase.ts
     (pure relocation, no behavior change).
  2. Extract commit+push from completePRReviewWorkflow into a new dedicated phase
     (executePRReviewCommitPushPhase) in prReviewPhase.ts, wired into
     adwPrReview.tsx via runPhase between the scenario test loop and completion.

  After this slice, prReviewCompletion.ts contains only terminal-state handlers
  (completePRReviewWorkflow, handlePRReviewWorkflowError).

  Background:
    Given the ADW codebase is checked out

  # ===================================================================
  # 1. executePRReviewTestPhase relocated to prReviewPhase.ts
  # ===================================================================

  @adw-402 @regression
  Scenario: executePRReviewTestPhase is defined in prReviewPhase.ts
    Given "adws/phases/prReviewPhase.ts" is read
    Then the module defines the function "executePRReviewTestPhase"
    And the function is not imported from prReviewCompletion

  @adw-402 @regression
  Scenario: executePRReviewTestPhase is removed from prReviewCompletion.ts
    Given "adws/phases/prReviewCompletion.ts" is read
    Then the module does NOT define a function named "executePRReviewTestPhase"
    And the module does NOT export "executePRReviewTestPhase"

  @adw-402 @regression
  Scenario: No backward-compat re-exports of executePRReviewTestPhase from prReviewCompletion
    Given "adws/phases/prReviewPhase.ts" is read
    Then the file does not re-export "executePRReviewTestPhase" from "./prReviewCompletion"

  @adw-402
  Scenario: All barrel exports resolve executePRReviewTestPhase from prReviewPhase
    When all TypeScript files under "adws/" are searched for "executePRReviewTestPhase"
    Then every re-export chain traces back to "adws/phases/prReviewPhase.ts"
    And no re-export chain traces back to "adws/phases/prReviewCompletion.ts"

  # ===================================================================
  # 2. New executePRReviewCommitPushPhase function
  # ===================================================================

  @adw-402 @regression
  Scenario: executePRReviewCommitPushPhase exists and is exported from prReviewPhase.ts
    Given "adws/phases/prReviewPhase.ts" is read
    Then the module exports a function named "executePRReviewCommitPushPhase"

  @adw-402 @regression
  Scenario: executePRReviewCommitPushPhase calls runCommitAgent and pushBranch
    Given "adws/phases/prReviewPhase.ts" is read
    Then the function "executePRReviewCommitPushPhase" calls "runCommitAgent"
    And the function "executePRReviewCommitPushPhase" calls "pushBranch"

  @adw-402
  Scenario: executePRReviewCommitPushPhase accepts PRReviewWorkflowConfig
    Given "adws/phases/prReviewPhase.ts" is read
    Then executePRReviewCommitPushPhase accepts a "PRReviewWorkflowConfig" parameter

  @adw-402
  Scenario: executePRReviewCommitPushPhase returns PhaseResult-compatible object
    Given "adws/phases/prReviewPhase.ts" is read
    Then executePRReviewCommitPushPhase returns an object with "costUsd", "modelUsage", and "phaseCostRecords"

  @adw-402
  Scenario: executePRReviewCommitPushPhase posts stage comments for committing and pushed
    Given "adws/phases/prReviewPhase.ts" is read
    Then executePRReviewCommitPushPhase posts "pr_review_committing" before the commit
    And executePRReviewCommitPushPhase posts "pr_review_pushed" after the push

  # ===================================================================
  # 3. completePRReviewWorkflow is now a true terminal handler
  # ===================================================================

  @adw-402 @regression
  Scenario: completePRReviewWorkflow no longer calls runCommitAgent
    Given "adws/phases/prReviewCompletion.ts" is read
    Then the function "completePRReviewWorkflow" does not call "runCommitAgent"
    And the file does not import "runCommitAgent"

  @adw-402 @regression
  Scenario: completePRReviewWorkflow no longer calls pushBranch
    Given "adws/phases/prReviewCompletion.ts" is read
    Then the function "completePRReviewWorkflow" does not call "pushBranch"
    And the file does not import "pushBranch"

  @adw-402
  Scenario: completePRReviewWorkflow only performs terminal-handler duties
    Given "adws/phases/prReviewCompletion.ts" is read
    Then completePRReviewWorkflow calls "buildPRReviewCostSection" to build the cost section
    And completePRReviewWorkflow calls "AgentStateManager.writeState" to write final state
    And completePRReviewWorkflow posts "pr_review_completed" comment
    And completePRReviewWorkflow logs a completion banner

  @adw-402
  Scenario: completePRReviewWorkflow no longer posts pr_review_committing or pr_review_pushed
    Given "adws/phases/prReviewCompletion.ts" is read
    Then completePRReviewWorkflow does not post "pr_review_committing"
    And completePRReviewWorkflow does not post "pr_review_pushed"

  # ===================================================================
  # 4. prReviewCompletion.ts contains only terminal-state handlers
  # ===================================================================

  @adw-402 @regression
  Scenario: prReviewCompletion.ts exports only terminal-state handlers
    Given "adws/phases/prReviewCompletion.ts" is read
    Then the module exports "completePRReviewWorkflow"
    And the module exports "handlePRReviewWorkflowError"
    And the module does not export any function prefixed with "execute"

  # ===================================================================
  # 5. adwPrReview.tsx wiring
  # ===================================================================

  @adw-402 @regression
  Scenario: adwPrReview.tsx imports executePRReviewCommitPushPhase
    Given the file "adws/adwPrReview.tsx" is read
    Then it imports "executePRReviewCommitPushPhase" from workflowPhases or phases

  @adw-402 @regression
  Scenario: adwPrReview.tsx wires commit+push phase via runPhase after scenario test loop
    Given the file "adws/adwPrReview.tsx" is read
    Then executePRReviewCommitPushPhase is called via runPhase after the scenario test retry loop
    And executePRReviewCommitPushPhase is called before completePRReviewWorkflow

  @adw-402
  Scenario: adwPrReview.tsx uses closure-wrapper for commit+push phase
    Given the file "adws/adwPrReview.tsx" is read
    Then the commit+push phase is called via a closure wrapping executePRReviewCommitPushPhase with config
    And the closure passes config.base to runPhase as the first argument

  @adw-402 @regression
  Scenario: adwPrReview.tsx updated phase ordering includes commit_push
    Given the file "adws/adwPrReview.tsx" is read
    Then the phase ordering should be:
      | phase                         |
      | install                       |
      | pr_review_plan                |
      | pr_review_build               |
      | stepDef                       |
      | unitTest                      |
      | scenarioTest [-> fix -> loop] |
      | commit_push                   |

  # ===================================================================
  # 6. No import of runCommitAgent or pushBranch from prReviewCompletion
  # ===================================================================

  @adw-402
  Scenario: prReviewCompletion.ts does not import commit/push utilities
    Given "adws/phases/prReviewCompletion.ts" is read
    Then the file does not import "runCommitAgent" from agents
    And the file does not import "pushBranch" from vcs
    And the file does not import "inferIssueTypeFromBranch" from vcs

  # ===================================================================
  # 7. Type checks and unit tests pass
  # ===================================================================

  @adw-402 @regression
  Scenario: TypeScript type-check passes after relocation and extraction
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0

  @adw-402 @regression
  Scenario: All existing unit tests pass after relocation and extraction
    When "bun run test" is run
    Then all unit tests pass
