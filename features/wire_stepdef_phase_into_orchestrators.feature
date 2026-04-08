@adw-397
Feature: Wire executeStepDefPhase into orchestrators

  The existing executeStepDefPhase is dead code — exported but never called by
  any orchestrator. Wire it into every orchestrator that uses scenarios so step
  definitions are generated against built code and exist before scenarios run.
  Each orchestrator inserts the phase between build and test.

  Background:
    Given the ADW codebase is checked out

  # ===================================================================
  # 1. adwSdlc.tsx — stepDefPhase wired between build and test
  # ===================================================================

  @adw-397 @adw-399 @regression
  Scenario: adwSdlc.tsx includes stepDefPhase between build and unitTest
    Given the file "adws/adwSdlc.tsx" is read
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
      | document                      |
      | kpi                           |
      | pr                            |

  @adw-397
  Scenario: adwSdlc.tsx imports executeStepDefPhase
    Given the file "adws/adwSdlc.tsx" is read
    Then it should import executeStepDefPhase from workflowPhases or phases

  @adw-397
  Scenario: adwSdlc.tsx calls executeStepDefPhase via runPhase
    Given the file "adws/adwSdlc.tsx" is read
    Then it should call runPhase with executeStepDefPhase as the phase function

  # ===================================================================
  # 2. adwPlanBuildTest.tsx — stepDefPhase wired between build and test
  # ===================================================================

  @adw-397 @regression
  Scenario: adwPlanBuildTest.tsx includes stepDefPhase between build and test
    Given the file "adws/adwPlanBuildTest.tsx" is read
    Then the phase ordering should be:
      | phase              |
      | install            |
      | plan               |
      | build              |
      | stepDef            |
      | test               |
      | pr                 |

  @adw-397
  Scenario: adwPlanBuildTest.tsx imports executeStepDefPhase
    Given the file "adws/adwPlanBuildTest.tsx" is read
    Then it should import executeStepDefPhase from workflowPhases or phases

  # ===================================================================
  # 3. adwPlanBuildTestReview.tsx — stepDefPhase wired between build and test
  # ===================================================================

  @adw-397 @regression
  Scenario: adwPlanBuildTestReview.tsx includes stepDefPhase between build and test
    Given the file "adws/adwPlanBuildTestReview.tsx" is read
    Then the phase ordering should be:
      | phase              |
      | install            |
      | plan + scenarios   |
      | alignment          |
      | build              |
      | stepDef            |
      | test               |
      | review             |
      | pr                 |

  @adw-397
  Scenario: adwPlanBuildTestReview.tsx imports executeStepDefPhase
    Given the file "adws/adwPlanBuildTestReview.tsx" is read
    Then it should import executeStepDefPhase from workflowPhases or phases

  # ===================================================================
  # 4. adwChore.tsx — stepDefPhase wired between build and test
  # ===================================================================

  @adw-397 @regression
  Scenario: adwChore.tsx includes stepDefPhase between build and test
    Given the file "adws/adwChore.tsx" is read
    Then the phase ordering should be:
      | phase              |
      | install            |
      | plan               |
      | build              |
      | stepDef            |
      | test               |
      | diffEvaluation     |
      | review (conditional) |
      | document (conditional) |
      | pr                 |

  @adw-397
  Scenario: adwChore.tsx imports executeStepDefPhase
    Given the file "adws/adwChore.tsx" is read
    Then it should import executeStepDefPhase from workflowPhases or phases

  # ===================================================================
  # 5. adwPrReview.tsx — stepDefPhase wired between build and test
  # ===================================================================

  @adw-397 @regression
  Scenario: adwPrReview.tsx includes stepDefPhase between build and test
    Given the file "adws/adwPrReview.tsx" is read
    Then executeStepDefPhase should be called after executePRReviewBuildPhase
    And executeStepDefPhase should be called before executePRReviewTestPhase

  @adw-397
  Scenario: adwPrReview.tsx imports executeStepDefPhase
    Given the file "adws/adwPrReview.tsx" is read
    Then it should import executeStepDefPhase from workflowPhases or phases

  # ===================================================================
  # 6. Phase appears in workflow state ledger
  # ===================================================================

  @adw-397 @regression
  Scenario: stepDefPhase records status in the top-level state file phases map
    Given the top-level state file exists for a workflow
    When runPhase executes executeStepDefPhase
    Then the phases map should contain a "stepDef" entry with status "running" during execution
    And the phases map should contain a "stepDef" entry with status "completed" after success

  @adw-397
  Scenario: stepDefPhase records failure in the top-level state file phases map
    Given the top-level state file exists for a workflow
    When runPhase executes executeStepDefPhase and the phase fails
    Then the phases map should contain a "stepDef" entry with status "failed"

  # ===================================================================
  # 7. Step definitions generated before test phase runs
  # ===================================================================

  @adw-397
  Scenario: Step definitions exist before the test phase starts
    Given an SDLC workflow running against a feature issue with @adw-{N} scenarios
    When the build phase completes successfully
    Then executeStepDefPhase runs and generates step definitions
    And the test phase does not start until step definition generation completes

  # ===================================================================
  # 8. Existing tests still pass
  # ===================================================================

  @adw-397 @regression
  Scenario: TypeScript type-check passes after wiring stepDefPhase
    Given the ADW codebase with stepDefPhase wired into orchestrators
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0
