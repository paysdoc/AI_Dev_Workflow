@adw-254
Feature: Skip scenario writer and plan validation on Take action resume past plan validation

  When a user posts a `## Take action` comment to resume a workflow that has
  already progressed past the planning phase, the scenario writer and plan
  validation phases should skip rather than rerun. The `plan_validating` stage
  must be registered in `STAGE_ORDER` and `STAGE_HEADER_MAP` so the recovery
  system can detect it.

  Background:
    Given the ADW codebase is checked out

  # ── 1. Register plan_validating in the recovery system ──

  @adw-254 @regression
  Scenario: STAGE_ORDER includes plan_validating between plan_committing and build_running
    Given "adws/core/workflowCommentParsing.ts" is read
    Then the STAGE_ORDER array should contain "plan_validating"
    And "plan_validating" should appear after "plan_committing" in STAGE_ORDER
    And "plan_validating" should appear before "build_running" in STAGE_ORDER

  @adw-254 @regression
  Scenario: STAGE_HEADER_MAP maps the plan validation heading to plan_validating
    Given "adws/core/workflowCommentParsing.ts" is read
    Then the STAGE_HEADER_MAP should map ":mag: Validating Plan-Scenario Alignment" to "plan_validating"

  # ── 2. Recovery guard in scenario phase ──

  @adw-254 @regression
  Scenario: scenarioPhase.ts destructures recoveryState from config
    Given "adws/phases/scenarioPhase.ts" is read
    Then the file should destructure "recoveryState" from the config parameter

  @adw-254 @regression
  Scenario: scenarioPhase.ts guards execution with shouldExecuteStage for plan_validating
    Given "adws/phases/scenarioPhase.ts" is read
    Then the file should call shouldExecuteStage with "plan_validating" and recoveryState

  @adw-254 @regression
  Scenario: scenarioPhase.ts returns zero-cost result when recovery is past plan_validating
    Given "adws/phases/scenarioPhase.ts" is read
    Then the file should return a result with zero cost when the stage is skipped
    And the file should log a skip message when the stage is skipped

  # ── 3. Recovery guard in plan validation phase ──

  @adw-254 @regression
  Scenario: planValidationPhase.ts destructures recoveryState from config
    Given "adws/phases/planValidationPhase.ts" is read
    Then the file should destructure "recoveryState" from the config parameter

  @adw-254 @regression
  Scenario: planValidationPhase.ts guards execution with shouldExecuteStage for plan_validating
    Given "adws/phases/planValidationPhase.ts" is read
    Then the file should call shouldExecuteStage with "plan_validating" and recoveryState

  @adw-254 @regression
  Scenario: planValidationPhase.ts returns zero-cost result when recovery is past plan_validating
    Given "adws/phases/planValidationPhase.ts" is read
    Then the file should return a result with zero cost when the stage is skipped
    And the file should log a skip message when the stage is skipped

  # ── 4. No orchestrator changes required ──

  @adw-254 @adw-chpy1a-orchestrator-refacto
  Scenario: Orchestrators do not need modification for skip behavior
    Given the file "adws/adwSdlc.tsx" exists
    And the file "adws/adwPlanBuildTestReview.tsx" exists
    And the file "adws/adwPlanBuildReview.tsx" exists
    Then each orchestrator should invoke the scenario phase and plan validation phase without recovery guards
    And the phase-internal guards should handle skipping transparently

  # ── 5. Imports are correct ──

  @adw-254 @regression
  Scenario: scenarioPhase.ts imports shouldExecuteStage from core
    Given "adws/phases/scenarioPhase.ts" is read
    Then the file should import "shouldExecuteStage" from the core module

  @adw-254 @regression
  Scenario: planValidationPhase.ts imports shouldExecuteStage from core
    Given "adws/phases/planValidationPhase.ts" is read
    Then the file should import "shouldExecuteStage" from the core module

  # ── 6. TypeScript integrity ──

  @adw-254 @regression
  Scenario: TypeScript type-check passes after all changes
    Given the ADW codebase has been modified for issue 254
    When the TypeScript compiler runs with --noEmit
    Then the compilation should succeed with no errors
