@adw-400
Feature: Wire scenarioTestPhase + scenarioFixPhase into remaining orchestrators

  The four remaining orchestrators with test phases — adwPlanBuildTest,
  adwPlanBuildTestReview, adwChore, adwPrReview — are migrated to use the same
  scenarioTestPhase + scenarioFixPhase wiring as adwSdlc.tsx from #399. Each
  orchestrator adds scenarioTestPhase after unitTestPhase with an
  orchestrator-level retry loop calling scenarioFixPhase on blocker failures.
  adwPrReview uses phaseRunner (runPhase with config.base) from #398.
  After this change all five orchestrators follow the same pattern.

  Background:
    Given the ADW codebase is checked out

  # ===================================================================
  # 1. adwPlanBuildTest.tsx — imports and wiring
  # ===================================================================

  @adw-400
  Scenario: adwPlanBuildTest.tsx imports scenario phase functions
    Given the file "adws/adwPlanBuildTest.tsx" is read
    Then it imports "executeScenarioTestPhase" from workflowPhases or phases
    And it imports "executeScenarioFixPhase" from workflowPhases or phases

  @adw-400 @regression
  Scenario: adwPlanBuildTest.tsx runs the new phase sequence with scenarios
    Given the file "adws/adwPlanBuildTest.tsx" is read
    Then the phase ordering should be:
      | phase                         |
      | install                       |
      | plan                          |
      | build                         |
      | stepDef                       |
      | unitTest                      |
      | scenarioTest [-> fix -> loop] |
      | pr                            |

  @adw-400 @regression
  Scenario: adwPlanBuildTest.tsx has orchestrator-level scenario retry loop
    Given the file "adws/adwPlanBuildTest.tsx" is read
    Then the scenarioTest-scenarioFix retry loop uses MAX_TEST_RETRY_ATTEMPTS as its bound
    And the retry loop calls executeScenarioFixPhase when scenarioProof has hasBlockerFailures true
    And the retry loop re-runs executeScenarioTestPhase after fix

  @adw-400
  Scenario: adwPlanBuildTest.tsx calls executeUnitTestPhase before executeScenarioTestPhase
    Given the file "adws/adwPlanBuildTest.tsx" is read
    Then executeUnitTestPhase is called before executeScenarioTestPhase

  # ===================================================================
  # 2. adwPlanBuildTestReview.tsx — imports and wiring
  # ===================================================================

  @adw-400
  Scenario: adwPlanBuildTestReview.tsx imports scenario phase functions
    Given the file "adws/adwPlanBuildTestReview.tsx" is read
    Then it imports "executeScenarioTestPhase" from workflowPhases or phases
    And it imports "executeScenarioFixPhase" from workflowPhases or phases

  @adw-400 @regression
  Scenario: adwPlanBuildTestReview.tsx runs the new phase sequence with scenarios
    Given the file "adws/adwPlanBuildTestReview.tsx" is read
    Then the phase ordering should be:
      | phase                         |
      | install                       |
      | plan + scenarios              |
      | alignment                     |
      | build                         |
      | stepDef                       |
      | unitTest                      |
      | scenarioTest [-> fix -> loop] |
      | review                        |
      | pr                            |

  @adw-400 @regression
  Scenario: adwPlanBuildTestReview.tsx has orchestrator-level scenario retry loop
    Given the file "adws/adwPlanBuildTestReview.tsx" is read
    Then the scenarioTest-scenarioFix retry loop uses MAX_TEST_RETRY_ATTEMPTS as its bound
    And the retry loop calls executeScenarioFixPhase when scenarioProof has hasBlockerFailures true
    And the retry loop re-runs executeScenarioTestPhase after fix

  @adw-400 @regression
  Scenario: adwPlanBuildTestReview.tsx review phase receives empty scenariosMd
    Given the file "adws/adwPlanBuildTestReview.tsx" is read
    Then the review phase is called with empty scenariosMd
    And scenario execution is NOT part of the review retry loop

  @adw-400
  Scenario: adwPlanBuildTestReview.tsx calls executeUnitTestPhase before executeScenarioTestPhase
    Given the file "adws/adwPlanBuildTestReview.tsx" is read
    Then executeUnitTestPhase is called before executeScenarioTestPhase

  # ===================================================================
  # 3. adwChore.tsx — imports and wiring (with diff evaluator gate)
  # ===================================================================

  @adw-400
  Scenario: adwChore.tsx imports scenario phase functions
    Given the file "adws/adwChore.tsx" is read
    Then it imports "executeScenarioTestPhase" from workflowPhases or phases
    And it imports "executeScenarioFixPhase" from workflowPhases or phases

  @adw-400 @regression
  Scenario: adwChore.tsx runs the new phase sequence with scenarios and diff gate
    Given the file "adws/adwChore.tsx" is read
    Then the phase ordering should be:
      | phase                         |
      | install                       |
      | plan                          |
      | build                         |
      | stepDef                       |
      | unitTest                      |
      | scenarioTest [-> fix -> loop] |
      | diffEvaluation                |
      | review (conditional)          |
      | document (conditional)        |
      | pr                            |

  @adw-400 @regression
  Scenario: adwChore.tsx has orchestrator-level scenario retry loop
    Given the file "adws/adwChore.tsx" is read
    Then the scenarioTest-scenarioFix retry loop uses MAX_TEST_RETRY_ATTEMPTS as its bound
    And the retry loop calls executeScenarioFixPhase when scenarioProof has hasBlockerFailures true
    And the retry loop re-runs executeScenarioTestPhase after fix

  @adw-400 @regression
  Scenario: adwChore.tsx diff evaluator gate runs after scenario test retry loop
    Given the file "adws/adwChore.tsx" is read
    Then executeDiffEvaluationPhase is called after the scenario test retry loop completes
    And the diff evaluator verdict still gates the review and document phases
    And the diff evaluator gate is unchanged from its previous behaviour

  @adw-400
  Scenario: adwChore.tsx calls executeUnitTestPhase before executeScenarioTestPhase
    Given the file "adws/adwChore.tsx" is read
    Then executeUnitTestPhase is called before executeScenarioTestPhase

  # ===================================================================
  # 4. adwPrReview.tsx — imports and wiring (uses phaseRunner)
  # ===================================================================

  @adw-400
  Scenario: adwPrReview.tsx imports scenario phase functions
    Given the file "adws/adwPrReview.tsx" is read
    Then it imports "executeScenarioTestPhase" from workflowPhases or phases
    And it imports "executeScenarioFixPhase" from workflowPhases or phases

  @adw-400 @adw-402 @regression
  Scenario: adwPrReview.tsx runs the new phase sequence with scenarios via phaseRunner
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

  @adw-400 @regression
  Scenario: adwPrReview.tsx wires scenario phases through runPhase with config.base
    Given the file "adws/adwPrReview.tsx" is read
    Then executeScenarioTestPhase is called via runPhase with config.base as the first argument
    And executeScenarioFixPhase is called via runPhase with config.base as the first argument
    And no scenario phase call passes the full PRReviewWorkflowConfig directly

  @adw-400
  Scenario: adwPrReview.tsx uses closure-wrapper for scenario fix phase
    Given the file "adws/adwPrReview.tsx" is read
    Then the scenario fix phase is called via a closure wrapping executeScenarioFixPhase with scenarioProof

  @adw-400 @regression
  Scenario: adwPrReview.tsx has orchestrator-level scenario retry loop
    Given the file "adws/adwPrReview.tsx" is read
    Then the scenarioTest-scenarioFix retry loop uses MAX_TEST_RETRY_ATTEMPTS as its bound
    And the retry loop calls executeScenarioFixPhase when scenarioProof has hasBlockerFailures true
    And the retry loop re-runs executeScenarioTestPhase after fix

  @adw-400
  Scenario: adwPrReview.tsx calls executeUnitTestPhase before executeScenarioTestPhase
    Given the file "adws/adwPrReview.tsx" is read
    Then executeUnitTestPhase is called via runPhase with config.base
    And executeUnitTestPhase is called before executeScenarioTestPhase

  # ===================================================================
  # 5. Consistent pattern across all five orchestrators
  # ===================================================================

  @adw-400 @regression
  Scenario: All five orchestrators follow the same scenario test/fix pattern
    Given the files are read:
      | file                             |
      | adws/adwSdlc.tsx                 |
      | adws/adwPlanBuildTest.tsx         |
      | adws/adwPlanBuildTestReview.tsx   |
      | adws/adwChore.tsx                |
      | adws/adwPrReview.tsx             |
    Then each orchestrator imports executeScenarioTestPhase
    And each orchestrator imports executeScenarioFixPhase
    And each orchestrator has a scenarioTest-scenarioFix retry loop bounded by MAX_TEST_RETRY_ATTEMPTS
    And each orchestrator calls executeUnitTestPhase before executeScenarioTestPhase

  # ===================================================================
  # 6. Retry loop behaviour (cross-cutting)
  # ===================================================================

  @adw-400
  Scenario: Retry loop exits when scenarios pass on first attempt
    Given any of the four newly-wired orchestrators is executing the scenario retry loop
    When executeScenarioTestPhase returns scenarioProof with hasBlockerFailures false
    Then the retry loop exits immediately
    And executeScenarioFixPhase is never called

  @adw-400
  Scenario: Retry loop exits after maximum attempts exhausted
    Given any of the four newly-wired orchestrators is executing the scenario retry loop
    And MAX_TEST_RETRY_ATTEMPTS is 5
    When every scenarioTestPhase attempt returns scenarioProof with hasBlockerFailures true
    Then the retry loop exits after 5 fix-retest cycles
    And the workflow continues to the next phase

  # ===================================================================
  # 7. Existing tests still pass
  # ===================================================================

  @adw-400 @regression
  Scenario: TypeScript type-check passes after wiring scenarios into all orchestrators
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0

  @adw-400 @regression
  Scenario: All existing unit tests pass after wiring scenarios into all orchestrators
    When "bun run test" is run
    Then all unit tests pass
