@adw-chpy1a-orchestrator-refacto
Feature: Generic Pipeline Runner

  Refactor all orchestrator scripts into a single generic pipeline runner
  that accepts declarative OrchestratorDefinition objects. Each orchestrator
  becomes a thin entry point defining its phase sequence, and the runner
  handles init, phase loop, skip-on-resume, pause-on-rate-limit, and completion.

  Background:
    Given the ADW codebase is checked out

  # ===================================================================
  # 1. Pipeline runner module structure
  # ===================================================================

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario: pipelineRunner.ts exports OrchestratorDefinition interface
    Given the file "adws/core/pipelineRunner.ts" exists
    Then it exports an OrchestratorDefinition interface
    And OrchestratorDefinition has an "id" field of type OrchestratorIdType
    And OrchestratorDefinition has a "phases" field of type (PhaseFn | PhaseFn[])[]

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario: pipelineRunner.ts exports runPipeline function
    Given the file "adws/core/pipelineRunner.ts" exists
    Then it exports a runPipeline function
    And runPipeline accepts an OrchestratorDefinition parameter

  # ===================================================================
  # 2. Phase execution semantics
  # ===================================================================

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario: Phases execute in declared order
    Given an OrchestratorDefinition with sequential phases [A, B, C]
    When runPipeline executes the definition
    Then phase A completes before phase B starts
    And phase B completes before phase C starts

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario: Parallel phases run concurrently
    Given an OrchestratorDefinition with phases [A, [B, C], D]
    When runPipeline executes the definition
    Then phases B and C run concurrently via Promise.all or equivalent
    And both B and C complete before phase D starts

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario: Completed phases are skipped on resume
    Given an OrchestratorDefinition with phases [A, B, C, D]
    And state.json contains completedPhases ["A", "B"]
    And state.json contains pausedAtPhase "C"
    When runPipeline executes the definition
    Then phases A and B are not executed
    And execution resumes from phase C

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario: Cross-phase data flows via state.json metadata
    Given a phase writes metadata key "screenshotsDir" to state.json
    When a subsequent phase reads state.json metadata
    Then it can access the "screenshotsDir" value written by the earlier phase

  # ===================================================================
  # 3. Error handling
  # ===================================================================

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario: Pipeline error handling delegates to handleWorkflowError
    Given an OrchestratorDefinition with phases [A, B]
    When phase B throws a non-rate-limit error
    Then runPipeline delegates to handleWorkflowError with the error details
    And no subsequent phases execute

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario: Rate limit during phase triggers pause instead of error
    Given an OrchestratorDefinition with phases [A, B, C]
    And phase A has completed successfully
    When phase B returns rateLimited: true
    Then runPipeline delegates to handleRateLimitPause
    And phase C is not executed

  # ===================================================================
  # 4. Orchestrator entry points use generic runner
  # ===================================================================

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario Outline: <orchestrator>.tsx uses the generic pipeline runner
    Given the file "adws/<orchestrator>.tsx" exists
    Then it imports runPipeline from core/pipelineRunner
    And it defines an OrchestratorDefinition with the correct phases
    And it calls runPipeline with the definition

    Examples:
      | orchestrator          |
      | adwPlan               |
      | adwBuild              |
      | adwTest               |
      | adwPatch              |
      | adwDocument           |
      | adwPlanBuild          |
      | adwPlanBuildTest       |
      | adwPlanBuildDocument   |
      | adwPlanBuildReview     |
      | adwPlanBuildTestReview |
      | adwSdlc               |
      | adwPrReview           |

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario: Outlier orchestrators are forced into the generic runner
    Given the files "adws/adwBuild.tsx", "adws/adwPatch.tsx", "adws/adwPrReview.tsx", "adws/adwTest.tsx"
    Then each uses runPipeline from core/pipelineRunner
    And each defines an OrchestratorDefinition

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario: Orchestrator entry points contain no imperative phase sequencing
    Given any orchestrator file "adws/adw*.tsx"
    Then its primary logic is defining an OrchestratorDefinition and calling runPipeline
    And it does not directly invoke phase functions in sequence

  # ===================================================================
  # 5. TypeScript compilation
  # ===================================================================

  @adw-chpy1a-orchestrator-refacto @regression
  Scenario: TypeScript type-check passes after pipeline runner refactor
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0
