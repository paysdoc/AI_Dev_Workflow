@adw-modak4-refactor-structured
Feature: Structured state + declarative runner + adwPlanBuild migration

  Tracer bullet for the declarative orchestration architecture: replace flat
  WorkflowContext with namespaced structured state, introduce defineOrchestrator()
  / runOrchestrator() API with sequential phase execution, and migrate
  adwPlanBuild.tsx to a ~15-line declarative definition.

  Background:
    Given the ADW codebase is checked out

  # ── 1: Structured workflow state types ─────────────────────────────────────

  @adw-modak4-refactor-structured @regression
  Scenario: Structured state type has namespaced sections per phase
    Given the structured state type definition exists
    Then it contains a namespace for "install"
    And it contains a namespace for "plan"
    And it contains a namespace for "build"
    And it contains a namespace for "test"
    And it contains a namespace for "pr"
    And each namespace is a typed TypeScript interface

  @adw-modak4-refactor-structured @regression
  Scenario: Structured state is JSON-serializable
    Given the structured state type definition exists
    Then the full state object contains only JSON-serializable types
    And no namespace includes functions, classes, or non-serializable values

  @adw-modak4-refactor-structured @regression
  Scenario: Init-time data stays on WorkflowConfig separate from phase state
    Given the WorkflowConfig interface is read
    Then it contains "issueNumber", "adwId", "worktreePath", "branchName", "projectConfig", and "repoContext"
    And phase-produced data is not stored directly on WorkflowConfig
    And phase-produced data is accessed via the structured state object

  @adw-modak4-refactor-structured
  Scenario: Each phase namespace is an explicit TypeScript interface
    Given the structured state type definition exists
    Then the install namespace has an explicit interface with named fields
    And the plan namespace has an explicit interface with named fields
    And the build namespace has an explicit interface with named fields
    And the test namespace has an explicit interface with named fields
    And the pr namespace has an explicit interface with named fields

  @adw-modak4-refactor-structured
  Scenario: Structured state supports optional namespaces for phases not yet executed
    Given the structured state type definition exists
    Then each phase namespace is optional on the root state object
    And accessing a namespace that has not been populated returns undefined

  # ── 2: Declarative orchestrator runner ─────────────────────────────────────

  @adw-modak4-refactor-structured @regression
  Scenario: defineOrchestrator accepts an OrchestratorId and typed phase list
    Given a defineOrchestrator function is exported
    Then it accepts an OrchestratorId as the first argument
    And it accepts a typed array of phase definitions as the second argument
    And it returns an orchestrator definition object

  @adw-modak4-refactor-structured @regression
  Scenario: runOrchestrator executes phases sequentially in declared order
    Given an orchestrator is defined with phases "alpha", "beta", "gamma"
    When runOrchestrator is called with that definition
    Then "alpha" executes before "beta"
    And "beta" executes before "gamma"
    And all three phases complete in declared order

  @adw-modak4-refactor-structured @regression
  Scenario: Runner handles CLI arg parsing automatically
    Given an orchestrator is defined with defineOrchestrator
    When runOrchestrator is invoked from the command line with an issue number
    Then the runner parses the issue number from process.argv
    And passes it to initializeWorkflow without manual arg parsing in the definition

  @adw-modak4-refactor-structured @regression
  Scenario: Runner calls initializeWorkflow before executing phases
    Given an orchestrator is defined with phases
    When runOrchestrator is called
    Then initializeWorkflow is called before the first phase executes
    And the resulting WorkflowConfig is passed to every phase

  @adw-modak4-refactor-structured @regression
  Scenario: Runner manages CostTracker lifecycle automatically
    Given an orchestrator is defined with two phases that report costs
    When runOrchestrator is called
    Then a CostTracker is created before the first phase
    And each phase result is accumulated into the CostTracker
    And CostTracker.persist is called after each phase
    And the total cost is passed to completeWorkflow on success

  @adw-modak4-refactor-structured @regression
  Scenario: Runner calls completeWorkflow on successful execution
    Given an orchestrator with all phases succeeding
    When runOrchestrator finishes
    Then completeWorkflow is called with the accumulated cost and model usage
    And the workflow state is marked as completed

  @adw-modak4-refactor-structured @regression
  Scenario: Runner calls handleWorkflowError when a phase throws
    Given an orchestrator where the second phase throws an error
    When runOrchestrator is called
    Then handleWorkflowError is called with the error, accumulated cost, and model usage
    And subsequent phases are not executed

  @adw-modak4-refactor-structured
  Scenario: Runner skips completed phases on resume
    Given an orchestrator with phases "install", "plan", "build"
    And the workflow was previously paused after completing "install" and "plan"
    When runOrchestrator is called in resume mode
    Then "install" and "plan" are skipped
    And "build" executes normally

  @adw-modak4-refactor-structured
  Scenario: Runner handles RateLimitError with pause behavior
    Given an orchestrator where a phase throws a RateLimitError
    When runOrchestrator is called
    Then handleRateLimitPause is invoked with the phase name and accumulated costs
    And subsequent phases are not executed

  # ── 3: Type safety — no `any` at module boundaries ────────────────────────

  @adw-modak4-refactor-structured @regression
  Scenario: defineOrchestrator and runOrchestrator have explicit TypeScript types
    Given the orchestrator runner module is read
    Then defineOrchestrator has explicit parameter and return types
    And runOrchestrator has explicit parameter and return types
    And no function signature uses "any" or implicit shapes

  @adw-modak4-refactor-structured @regression
  Scenario: Phase definition interface has explicit types
    Given the phase definition type is read
    Then it specifies an explicit phase name type
    And it specifies an explicit phase function type accepting WorkflowConfig and structured state
    And the phase function return type extends PhaseResult

  @adw-modak4-refactor-structured
  Scenario: No any types at module boundaries in runner module
    Given all exported functions and types in the runner module are inspected
    Then none of them use the "any" type
    And all parameter types are explicitly annotated
    And all return types are explicitly annotated

  # ── 4: Migrate adwPlanBuild.tsx ────────────────────────────────────────────

  @adw-modak4-refactor-structured @regression
  Scenario: adwPlanBuild.tsx is replaced with a declarative definition
    Given "adws/adwPlanBuild.tsx" is read
    Then it uses defineOrchestrator to declare its phase list
    And the file is approximately 15 lines or fewer (excluding comments and imports)
    And it does not contain manual CostTracker instantiation
    And it does not contain a try/catch block for phase execution

  @adw-modak4-refactor-structured @regression
  Scenario: adwPlanBuild declares install, plan, build, test, PR phases
    Given "adws/adwPlanBuild.tsx" is read
    Then the declarative definition includes the install phase
    And the declarative definition includes the plan phase
    And the declarative definition includes the build phase
    And the declarative definition includes the test phase
    And the declarative definition includes the PR phase
    And the phases are declared in that order

  @adw-modak4-refactor-structured @regression
  Scenario: adwPlanBuild works end-to-end on the new runner
    Given the declarative adwPlanBuild orchestrator is defined
    When "bunx tsx adws/adwPlanBuild.tsx <issueNumber>" is invoked
    Then the runner parses the issue number
    And initializeWorkflow is called with OrchestratorId.PlanBuild
    And all five phases execute sequentially
    And completeWorkflow is called on success

  @adw-modak4-refactor-structured
  Scenario: adwPlanBuild phases read and write namespaced structured state
    Given the declarative adwPlanBuild orchestrator is running
    When the install phase completes
    Then it writes its output to the install namespace of structured state
    When the plan phase completes
    Then it writes its output to the plan namespace of structured state
    When the build phase completes
    Then it writes its output to the build namespace of structured state
    When the test phase completes
    Then it writes its output to the test namespace of structured state
    When the PR phase completes
    Then it writes its output to the pr namespace of structured state

  # ── 5: Runner unit tests ──────────────────────────────────────────────────

  @adw-modak4-refactor-structured @regression
  Scenario: Runner unit tests verify execution order with mock phases
    Given runner unit tests exist
    Then there is a test that defines mock phases and verifies they execute in declared order
    And the test uses mock phase functions that record their invocation sequence

  @adw-modak4-refactor-structured @regression
  Scenario: Runner unit tests verify CostTracker integration
    Given runner unit tests exist
    Then there is a test that verifies CostTracker accumulates costs from each mock phase
    And the final accumulated cost equals the sum of individual phase costs

  @adw-modak4-refactor-structured @regression
  Scenario: Runner unit tests verify completion handling
    Given runner unit tests exist
    Then there is a test that verifies completeWorkflow is called when all phases succeed
    And completeWorkflow receives the correct accumulated cost and model usage

  @adw-modak4-refactor-structured @regression
  Scenario: Runner unit tests verify error handling
    Given runner unit tests exist
    Then there is a test that verifies handleWorkflowError is called when a phase throws
    And the error, accumulated cost, and model usage are passed to handleWorkflowError

  @adw-modak4-refactor-structured @regression
  Scenario: Runner unit tests verify state serialization roundtrip
    Given runner unit tests exist
    Then there is a test that serializes structured state to JSON
    And deserializes it back to the typed state object
    And the roundtripped state is deeply equal to the original

  # ── 6: Backward compatibility ─────────────────────────────────────────────

  @adw-modak4-refactor-structured @regression
  Scenario: Existing orchestrators continue to work during migration
    Given "adws/adwSdlc.tsx" is read
    And "adws/adwPlanBuildTest.tsx" is read
    And "adws/adwPlanBuildReview.tsx" is read
    And "adws/adwChore.tsx" is read
    Then each orchestrator still compiles without errors
    And each orchestrator can still use the imperative runPhase pattern
    And WorkflowConfig is compatible with both old and new orchestrators

  @adw-modak4-refactor-structured
  Scenario: WorkflowContext remains available for orchestrators not yet migrated
    Given "adws/github/workflowCommentsIssue.ts" is read
    Then the WorkflowContext interface is still exported
    And orchestrators that have not migrated can still use WorkflowContext via config.ctx

  @adw-modak4-refactor-structured
  Scenario: TypeScript type-check passes for the full project
    When "bunx tsc --noEmit" is run
    And "bunx tsc --noEmit -p adws/tsconfig.json" is run
    Then both commands exit with code 0
    And no type errors are reported
