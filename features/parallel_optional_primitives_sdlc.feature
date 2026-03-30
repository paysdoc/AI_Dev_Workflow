@adw-bxch84-refactor-runner-para
Feature: parallel() + optional() runner primitives and adwSdlc declarative migration

  Add parallel() and optional() composition primitives to the declarative
  orchestrator runner, then migrate adwSdlc.tsx to a declarative definition
  using all three primitives (sequential, parallel, optional). Wire all SDLC
  phases to read/write namespaced structured state, including reviewRetry
  writing to state.review.* so downstream phases access review data from
  structured state instead of closure bindings.

  Background:
    Given the ADW codebase is checked out

  # ── 1: parallel() primitive ───────────────────────────────────────────────

  @adw-bxch84-refactor-runner-para @regression
  Scenario: parallel() runs phases concurrently and waits for all to complete
    Given an orchestrator is defined with a parallel() group containing phases "alpha" and "beta"
    When runOrchestrator is called with that definition
    Then "alpha" and "beta" execute concurrently
    And the runner waits for both "alpha" and "beta" to complete before proceeding to the next phase

  @adw-bxch84-refactor-runner-para @regression
  Scenario: parallel() accumulates costs from all concurrent phases
    Given an orchestrator is defined with a parallel() group containing phases "alpha" and "beta"
    And "alpha" reports costUsd = 0.05 and "beta" reports costUsd = 0.03
    When runOrchestrator is called with that definition
    Then the accumulated cost after the parallel group is 0.08
    And model usage from both phases is merged into the CostTracker

  @adw-bxch84-refactor-runner-para
  Scenario: parallel() merges model usage from all concurrent phases
    Given an orchestrator is defined with a parallel() group containing phases "alpha" and "beta"
    And "alpha" reports model usage for "claude-sonnet-4-20250514" and "beta" reports model usage for "claude-opus-4-20250514"
    When runOrchestrator is called with that definition
    Then the merged model usage contains entries for both models

  @adw-bxch84-refactor-runner-para @regression
  Scenario: parallel() propagates error when any phase fails
    Given an orchestrator is defined with a parallel() group containing phases "alpha" and "beta"
    And "beta" throws an error during execution
    When runOrchestrator is called with that definition
    Then handleWorkflowError is called with the error from "beta"
    And the pipeline does not continue to subsequent phases

  @adw-bxch84-refactor-runner-para
  Scenario: parallel() can be used within a sequential pipeline
    Given an orchestrator is defined with phases "install", parallel("plan", "scenario"), "build"
    When runOrchestrator is called with that definition
    Then "install" executes first
    Then "plan" and "scenario" execute concurrently after "install" completes
    Then "build" executes after both "plan" and "scenario" complete

  # ── 2: optional() primitive ───────────────────────────────────────────────

  @adw-bxch84-refactor-runner-para @regression
  Scenario: optional() catches phase errors and continues pipeline
    Given an orchestrator is defined with phases "alpha", optional("beta"), "gamma"
    And "beta" throws an error during execution
    When runOrchestrator is called with that definition
    Then the error from "beta" is caught and logged
    And "gamma" executes after the optional phase
    And completeWorkflow is called on success

  @adw-bxch84-refactor-runner-para @regression
  Scenario: optional() returns the phase result on success
    Given an orchestrator is defined with phases "alpha", optional("beta"), "gamma"
    And "beta" succeeds with costUsd = 0.02
    When runOrchestrator is called with that definition
    Then "beta" cost is accumulated into the CostTracker
    And the pipeline continues normally through "gamma"

  @adw-bxch84-refactor-runner-para
  Scenario: optional() returns zero-cost result when wrapped phase fails
    Given an orchestrator is defined with optional("beta") where "beta" throws
    When runOrchestrator executes the optional phase
    Then the optional phase contributes costUsd = 0 to the CostTracker
    And the pipeline continues without halting

  @adw-bxch84-refactor-runner-para
  Scenario: optional() can wrap a parallel() group
    Given an orchestrator is defined with optional(parallel("alpha", "beta"))
    And "alpha" throws an error during execution
    When runOrchestrator executes the optional-parallel group
    Then the error is caught and logged
    And the pipeline continues without halting

  # ── 3: adwSdlc.tsx declarative migration ──────────────────────────────────

  @adw-bxch84-refactor-runner-para @regression
  Scenario: adwSdlc.tsx is replaced with a declarative definition
    Given "adws/adwSdlc.tsx" is read
    Then it uses defineOrchestrator to declare its phase list
    And it does not contain manual CostTracker instantiation
    And it does not contain a try/catch block for phase execution
    And it does not contain direct calls to initializeWorkflow

  @adw-bxch84-refactor-runner-para @regression
  Scenario: adwSdlc uses parallel() for plan and scenario phases
    Given "adws/adwSdlc.tsx" is read
    Then the declarative definition includes a parallel() group
    And the parallel group contains the plan phase and the scenario phase
    And the parallel group is positioned after the install phase

  @adw-bxch84-refactor-runner-para
  Scenario: adwSdlc uses optional() for non-fatal phases
    Given "adws/adwSdlc.tsx" is read
    Then the declarative definition wraps the scenario writer phase with optional()
    And the declarative definition wraps the step definition generation phase with optional()
    And failures in optional phases do not halt the SDLC pipeline

  @adw-bxch84-refactor-runner-para @regression
  Scenario: adwSdlc declares all SDLC phases in correct order
    Given "adws/adwSdlc.tsx" is read
    Then the declarative definition includes the install phase
    And the declarative definition includes the plan phase
    And the declarative definition includes the scenario phase
    And the declarative definition includes the alignment phase
    And the declarative definition includes the build phase
    And the declarative definition includes the test phase
    And the declarative definition includes the review phase
    And the declarative definition includes the document phase
    And the declarative definition includes the KPI phase
    And the declarative definition includes the autoMerge phase
    And install precedes plan/scenario which precedes alignment which precedes build

  @adw-bxch84-refactor-runner-para @regression
  Scenario: adwSdlc works end-to-end on the new runner
    Given the declarative adwSdlc orchestrator is defined
    When "bunx tsx adws/adwSdlc.tsx <issueNumber>" is invoked
    Then the runner parses the issue number
    And initializeWorkflow is called with OrchestratorId.Sdlc
    And all SDLC phases execute in declared order
    And completeWorkflow is called on success

  # ── 4: Structured state namespaces for SDLC phases ────────────────────────

  @adw-bxch84-refactor-runner-para @regression
  Scenario: WorkflowState has namespaces for all SDLC phases
    Given the structured state type definition exists
    Then it contains a namespace for "scenario"
    And it contains a namespace for "stepDef"
    And it contains a namespace for "alignment"
    And it contains a namespace for "review"
    And it contains a namespace for "document"
    And it contains a namespace for "kpi"
    And it contains a namespace for "autoMerge"
    And each namespace is a typed TypeScript interface

  @adw-bxch84-refactor-runner-para
  Scenario: New SDLC namespaces are optional on the root state object
    Given the structured state type definition exists
    Then the scenario namespace is optional on the root state object
    And the stepDef namespace is optional on the root state object
    And the alignment namespace is optional on the root state object
    And the review namespace is optional on the root state object
    And the document namespace is optional on the root state object
    And the kpi namespace is optional on the root state object
    And the autoMerge namespace is optional on the root state object

  @adw-bxch84-refactor-runner-para
  Scenario: All SDLC phases read and write namespaced structured state
    Given the declarative adwSdlc orchestrator is running
    When each phase completes
    Then it writes its output to its own namespace of structured state
    And downstream phases read from upstream namespaces instead of closure bindings

  # ── 5: reviewRetry structured state ───────────────────────────────────────

  @adw-bxch84-refactor-runner-para @regression
  Scenario: reviewRetry writes to state.review.* namespaced fields
    Given the review phase has completed successfully
    Then state.review.screenshotUrls contains the review screenshot URLs
    And state.review.retries contains the total retry count
    And state.review.summaries contains the review summaries
    And state.review.nonBlockerIssues contains the non-blocker issues
    And state.review.allScreenshots contains all screenshot paths

  @adw-bxch84-refactor-runner-para @regression
  Scenario: Document phase reads state.review.screenshotUrls from structured state
    Given the review phase has written to state.review.screenshotUrls
    When the document phase executes
    Then it reads screenshot URLs from state.review.screenshotUrls
    And it does not receive screenshot URLs via a closure binding or wrapper function
    And it does not receive screenshot URLs via a function argument

  @adw-bxch84-refactor-runner-para @regression
  Scenario: KPI phase reads state.review.retries from structured state
    Given the review phase has written to state.review.retries
    When the KPI phase executes
    Then it reads the retry count from state.review.retries
    And it does not receive the retry count via a closure binding or wrapper function
    And it does not receive the retry count via a function argument

  @adw-bxch84-refactor-runner-para
  Scenario: ReviewRetryResult fields map to state.review namespace
    Given the ReviewRetryResult type is read
    And the ReviewPhaseState type is read
    Then state.review contains fields for: screenshotUrls, retries, summaries, nonBlockerIssues, allScreenshots
    And the review phase function writes ReviewRetryResult values into the state.review namespace

  # ── 6: Runner unit tests for parallel and optional ────────────────────────

  @adw-bxch84-refactor-runner-para @regression
  Scenario: Runner unit tests verify parallel execution with mock phases
    Given runner unit tests exist
    Then there is a test that defines mock phases in a parallel() group
    And the test verifies that the parallel phases run concurrently
    And the test verifies that costs are accumulated from all parallel phases

  @adw-bxch84-refactor-runner-para @regression
  Scenario: Runner unit tests verify optional error handling with mock phases
    Given runner unit tests exist
    Then there is a test that defines a mock phase wrapped in optional()
    And the test verifies that errors from the optional phase are caught
    And the test verifies that the pipeline continues after the optional phase fails

  @adw-bxch84-refactor-runner-para
  Scenario: Runner unit tests verify combined parallel + optional composition
    Given runner unit tests exist
    Then there is a test that uses optional(parallel("a", "b")) or parallel with optional phases
    And the test verifies correct behavior when composition primitives are nested

  # ── 7: Type safety ───────────────────────────────────────────────────────

  @adw-bxch84-refactor-runner-para @regression
  Scenario: parallel() and optional() have explicit TypeScript types
    Given the orchestrator runner module is read
    Then parallel() has an explicit parameter type and return type
    And optional() has an explicit parameter type and return type
    And neither function signature uses "any" or implicit shapes
    And the PhaseDefinition type supports sequential, parallel, and optional variants

  @adw-bxch84-refactor-runner-para
  Scenario: TypeScript type-check passes with parallel/optional primitives
    When "bunx tsc --noEmit" is run
    And "bunx tsc --noEmit -p adws/tsconfig.json" is run
    Then both commands exit with code 0
    And no type errors are reported
