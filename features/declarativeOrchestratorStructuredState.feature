@adw-346-declarative-orchestrator
Feature: Declarative Orchestrator with Structured State (#346)

  # -------------------------------------------------------------------------
  # Structured state types
  # -------------------------------------------------------------------------

  Scenario: Structured state type exists with namespaced phase sections
    Given the orchestrator state types are read
    Then a "WorkflowPhaseState" or "WorkflowState" type is defined
    And it contains namespaced sections for "install", "plan", "build", "test", and "pr"
    And each namespace is a typed interface (not an inline object type or any)

  Scenario: Each phase namespace interface is explicitly typed
    Given the orchestrator state types are read
    Then the install namespace has explicit typed fields
    And the plan namespace has explicit typed fields
    And the build namespace has explicit typed fields
    And the test namespace has explicit typed fields
    And the pr namespace has explicit typed fields

  Scenario: Structured state is JSON-serializable
    Given a structured state object with all namespaces populated
    When the structured state is serialized to JSON and deserialized
    Then the round-tripped state is deeply equal to the original

  Scenario: Init-time data stays on WorkflowConfig, not phase state
    Given the WorkflowConfig interface is read
    Then it still contains "issue", "adwId", "worktreePath", "branchName", "projectConfig"
    And the structured phase state does not duplicate these fields

  Scenario: Structured state type has no "any" types
    Given the orchestrator state type files are read
    Then no interface field is typed as "any"
    And no interface field uses implicit shapes

  # -------------------------------------------------------------------------
  # defineOrchestrator / runOrchestrator exports
  # -------------------------------------------------------------------------

  Scenario: defineOrchestrator function is exported from core
    Given the orchestrator runner module is read
    Then "defineOrchestrator" is exported as a named function
    And it accepts an OrchestratorId and a typed phase list

  Scenario: runOrchestrator function is exported from core
    Given the orchestrator runner module is read
    Then "runOrchestrator" is exported as a named function

  Scenario: defineOrchestrator returns a typed orchestrator definition
    Given the orchestrator runner module is read
    Then defineOrchestrator returns a value with an explicit TypeScript type
    And the return type includes the OrchestratorId and the phase list

  # -------------------------------------------------------------------------
  # Runner behaviour (static analysis)
  # -------------------------------------------------------------------------

  Scenario: Runner handles CLI arg parsing
    Given a declarative orchestrator definition
    When runOrchestrator is called
    Then it parses process.argv for issueNumber, adwId, and optional flags

  Scenario: Runner calls initializeWorkflow
    Given a declarative orchestrator definition
    When runOrchestrator is called
    Then it calls initializeWorkflow with the parsed arguments and OrchestratorId

  Scenario: Runner creates and manages CostTracker lifecycle
    Given a declarative orchestrator definition
    When runOrchestrator is called
    Then it instantiates a new CostTracker before phase execution
    And it passes the CostTracker to each phase via runPhase

  Scenario: Runner executes phases sequentially
    Given a declarative orchestrator with phases "[A, B, C]"
    When runOrchestrator is called
    Then phase A completes before phase B starts
    And phase B completes before phase C starts

  Scenario: Runner calls completeWorkflow on success
    Given a declarative orchestrator whose phases all succeed
    When runOrchestrator is called
    Then it calls completeWorkflow with tracker.totalCostUsd and tracker.totalModelUsage

  Scenario: Runner calls handleWorkflowError on phase failure
    Given a declarative orchestrator where a phase throws an error
    When runOrchestrator is called
    Then it catches the error
    And it calls handleWorkflowError with the error, tracker.totalCostUsd, and tracker.totalModelUsage

  Scenario: Runner wraps phase execution in try/catch
    Given a declarative orchestrator definition
    When runOrchestrator is called
    Then all phases execute inside a try block
    And the catch block delegates to handleWorkflowError

  # -------------------------------------------------------------------------
  # Runner unit tests (static analysis equivalents)
  # -------------------------------------------------------------------------

  Scenario: Runner unit tests verify execution order
    Given mock phases that record their invocation order
    When runOrchestrator executes the mock phases
    Then the recorded order matches the declared phase order

  Scenario: Runner unit tests verify cost tracking
    Given mock phases that return known cost values
    When runOrchestrator executes the mock phases
    Then CostTracker.totalCostUsd equals the sum of phase costs
    And CostTracker.totalModelUsage merges all phase model usage maps

  Scenario: Runner unit tests verify completion handling
    Given mock phases that all succeed
    When runOrchestrator executes the mock phases
    Then completeWorkflow is called exactly once

  Scenario: Runner unit tests verify error handling
    Given a mock phase that throws an Error
    When runOrchestrator executes the mock phases
    Then handleWorkflowError is called exactly once with the thrown error

  Scenario: Runner unit tests verify state serialization roundtrip
    Given mock phases that write structured state to each namespace
    When the structured state is serialized to JSON and deserialized
    Then each namespace retains its values after the roundtrip

  # -------------------------------------------------------------------------
  # adwPlanBuild.tsx declarative migration
  # -------------------------------------------------------------------------

  Scenario: adwPlanBuild.tsx uses defineOrchestrator instead of imperative boilerplate
    Given "adws/adwPlanBuild.tsx" is read
    Then the file calls "defineOrchestrator" or imports it
    And the file does not contain manual CostTracker instantiation
    And the file does not contain a manual try/catch block around phases

  Scenario: adwPlanBuild.tsx declarative definition is concise
    Given "adws/adwPlanBuild.tsx" is read
    Then the file is approximately 15 lines or fewer (excluding imports and comments)

  Scenario: adwPlanBuild.tsx declares install, plan, build, test, and PR phases
    Given "adws/adwPlanBuild.tsx" is read
    Then the phase list includes "executeInstallPhase"
    And the phase list includes "executePlanPhase"
    And the phase list includes "executeBuildPhase"
    And the phase list includes "executeTestPhase"
    And the phase list includes "executePRPhase"

  Scenario: adwPlanBuild.tsx uses OrchestratorId.PlanBuild
    Given "adws/adwPlanBuild.tsx" is read
    Then the defineOrchestrator call passes OrchestratorId.PlanBuild as the identifier

  Scenario: adwPlanBuild.tsx calls runOrchestrator as entry point
    Given "adws/adwPlanBuild.tsx" is read
    Then the file calls "runOrchestrator" as the main entry point

  # -------------------------------------------------------------------------
  # Phase dual-write to structured state
  # -------------------------------------------------------------------------

  Scenario: Install phase writes to structured state install namespace
    Given the install phase implementation is read
    Then it writes results to the "install" namespace of structured state

  Scenario: Plan phase writes to structured state plan namespace
    Given the plan phase implementation is read
    Then it writes results to the "plan" namespace of structured state

  Scenario: Build phase writes to structured state build namespace
    Given the build phase implementation is read
    Then it writes results to the "build" namespace of structured state

  Scenario: Test phase writes to structured state test namespace
    Given the test phase implementation is read
    Then it writes results to the "test" namespace of structured state

  Scenario: PR phase writes to structured state pr namespace
    Given the PR phase implementation is read
    Then it writes results to the "pr" namespace of structured state

  # -------------------------------------------------------------------------
  # Type safety
  # -------------------------------------------------------------------------

  Scenario: All module boundary types are explicit (no any)
    Given the runner module and state type files are read
    Then no exported function parameter is typed as "any"
    And no exported function return type is "any"
    And no exported interface field is typed as "any"

  Scenario: defineOrchestrator parameter types are explicit
    Given the orchestrator runner module is read
    Then the OrchestratorId parameter has an explicit type
    And the phase list parameter has an explicit typed array type
    And no parameter uses implicit shapes or "any"

  Scenario: PhaseFn type signature is preserved
    Given the phaseRunner module is read
    Then PhaseFn is still exported as "(config: WorkflowConfig) => Promise<PhaseResult>"
    And PhaseResult still contains costUsd, modelUsage, and optional phaseCostRecords

  # -------------------------------------------------------------------------
  # Backward compatibility
  # -------------------------------------------------------------------------

  Scenario: Existing orchestrators continue to work without migration
    Given the orchestrator files are read
    Then adwSdlc.tsx still uses the imperative CostTracker/runPhase pattern
    And adwPlanBuildReview.tsx still uses the imperative CostTracker/runPhase pattern
    And adwPlanBuildTestReview.tsx still uses the imperative CostTracker/runPhase pattern

  # -------------------------------------------------------------------------
  # TypeScript type-check
  # -------------------------------------------------------------------------

  Scenario: TypeScript type-check passes after declarative runner introduction
    Given the ADW codebase with the declarative runner
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0

  Scenario: TypeScript type-check passes with adws tsconfig after changes
    Given the ADW codebase with the declarative runner
    When "bunx tsc --noEmit -p adws/tsconfig.json" is run
    Then the command exits with code 0

  Scenario: All unit tests pass after declarative runner migration
    Given the ADW codebase with the declarative runner
    When "bun run test" is run
    Then all unit tests pass
