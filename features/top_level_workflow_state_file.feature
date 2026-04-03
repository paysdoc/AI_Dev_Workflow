@adw-378
Feature: Top-level workflow state file with workflowStage and phases map

  Introduce a top-level state file at agents/<adwId>/state.json that serves as
  the canonical workflow state, distinct from per-orchestrator state files.
  The file tracks workflowStage transitions and a phases map updated by runPhase().

  Background:
    Given an ADW workflow with adwId "abc12345" and issue number 42
    And orchestrator "feature-orchestrator" is running

  # --- AgentState interface extension ---

  @adw-378 @regression
  Scenario: AgentState interface includes optional workflowStage field
    Given the AgentState interface in "adws/types/agentTypes.ts"
    Then it should have an optional "workflowStage" field of type string

  @adw-378 @regression
  Scenario: AgentState interface includes optional phases field
    Given the AgentState interface in "adws/types/agentTypes.ts"
    Then it should have an optional "phases" field of type "Record<string, PhaseExecutionState>"

  @adw-378
  Scenario: PhaseExecutionState type defines required and optional fields
    Given the PhaseExecutionState type in "adws/types/agentTypes.ts"
    Then it should have a required "status" field with values "pending", "running", "completed", "failed"
    And it should have a required "startedAt" field of type ISO 8601 string
    And it should have an optional "completedAt" field of type ISO 8601 string
    And it should have an optional "output" field of type string

  # --- Top-level state file creation ---

  @adw-378 @regression
  Scenario: Top-level state file created at workflow start
    When the orchestrator initializes the workflow
    Then a state file should exist at "agents/abc12345/state.json"
    And the state file should contain "adwId" set to "abc12345"
    And the state file should contain "issueNumber" set to 42
    And the state file should contain "orchestratorScript" set to "feature-orchestrator"

  @adw-378
  Scenario: Top-level state file is distinct from per-orchestrator state file
    When the orchestrator initializes the workflow
    Then a state file should exist at "agents/abc12345/state.json"
    And a state file should exist at "agents/abc12345/feature-orchestrator/state.json"
    And the two state files should be separate files with independent content

  # --- workflowStage tracking ---

  @adw-378 @regression
  Scenario: workflowStage written at each phase transition
    Given the top-level state file exists for "abc12345"
    When runPhase executes phase "install" successfully
    Then the top-level state file "workflowStage" should reflect the current stage
    When runPhase executes phase "plan" successfully
    Then the top-level state file "workflowStage" should reflect the current stage

  @adw-378
  Scenario: workflowStage set to granular stage values
    Given the top-level state file exists for "abc12345"
    When the orchestrator enters the build phase
    Then the top-level state file "workflowStage" should be "build_running"
    When the workflow completes successfully
    Then the top-level state file "workflowStage" should be "completed"

  @adw-378
  Scenario: workflowStage reflects failure state
    Given the top-level state file exists for "abc12345"
    When the orchestrator encounters a fatal error
    Then the top-level state file "workflowStage" should be "abandoned"

  # --- phases map updated by runPhase() ---

  @adw-378 @regression
  Scenario: runPhase sets phase status to running on start
    Given the top-level state file exists for "abc12345"
    When runPhase begins executing phase "build"
    Then the top-level state file phases map should contain "build" with status "running"
    And the phases map entry "build" should have a valid ISO 8601 "startedAt" timestamp

  @adw-378 @regression
  Scenario: runPhase sets phase status to completed on success
    Given the top-level state file exists for "abc12345"
    When runPhase executes phase "build" successfully
    Then the top-level state file phases map should contain "build" with status "completed"
    And the phases map entry "build" should have a valid ISO 8601 "completedAt" timestamp

  @adw-378 @regression
  Scenario: runPhase sets phase status to failed on error
    Given the top-level state file exists for "abc12345"
    When runPhase executes phase "build" and it fails with error "compilation error"
    Then the top-level state file phases map should contain "build" with status "failed"
    And the phases map entry "build" should have a valid ISO 8601 "completedAt" timestamp

  @adw-378
  Scenario: runPhase records optional output in phases map
    Given the top-level state file exists for "abc12345"
    When runPhase executes phase "test" successfully with output "all 42 tests passed"
    Then the top-level state file phases map entry "test" should have output "all 42 tests passed"

  @adw-378
  Scenario: Multiple phases tracked independently in phases map
    Given the top-level state file exists for "abc12345"
    When runPhase executes phase "install" successfully
    And runPhase executes phase "plan" successfully
    And runPhase begins executing phase "build"
    Then the phases map should contain 3 entries
    And phases "install" and "plan" should have status "completed"
    And phase "build" should have status "running"

  # --- Phase skip-on-resume using phases map ---

  @adw-378 @regression
  Scenario: Phase skip-on-resume reads from phases map
    Given the top-level state file exists for "abc12345"
    And the phases map contains "install" with status "completed"
    And the phases map contains "plan" with status "completed"
    When runPhase is called for phase "install"
    Then the phase function should not be executed
    And runPhase should return a zero-cost empty result

  @adw-378 @regression
  Scenario: Phase not skipped when phases map shows non-completed status
    Given the top-level state file exists for "abc12345"
    And the phases map contains "build" with status "failed"
    When runPhase is called for phase "build"
    Then the phase function should be executed

  @adw-378
  Scenario: Phase not skipped when not present in phases map
    Given the top-level state file exists for "abc12345"
    And the phases map does not contain "review"
    When runPhase is called for phase "review"
    Then the phase function should be executed

  # --- Backward compatibility with completedPhases ---

  @adw-378 @regression
  Scenario: completedPhases string array used as fallback for in-flight workflows
    Given an in-flight workflow with legacy state for "abc12345"
    And the orchestrator metadata contains completedPhases ["install", "plan"]
    And no phases map exists in the top-level state file
    When runPhase is called for phase "install"
    Then the phase function should not be executed
    And runPhase should return a zero-cost empty result

  @adw-378 @regression
  Scenario: phases map takes precedence over completedPhases
    Given the top-level state file exists for "abc12345"
    And the phases map contains "build" with status "failed"
    And the orchestrator metadata contains completedPhases ["build"]
    When runPhase is called for phase "build"
    Then the phase function should be executed
    Because the phases map status "failed" overrides the legacy "completed" signal

  @adw-378 @regression
  Scenario: New workflows use phases map exclusively after migration
    Given a fresh workflow with adwId "new12345"
    When the orchestrator completes the install phase
    Then the phases map should contain "install" with status "completed"
    And the completedPhases metadata array should also be updated for backward compat

  # --- writeState merge semantics ---

  @adw-378 @regression
  Scenario: Top-level state write merges and preserves existing fields
    Given the top-level state file exists for "abc12345" with workflowStage "build_running"
    And the phases map contains "install" with status "completed"
    When the top-level state is updated with only workflowStage "testing"
    Then the phases map should still contain "install" with status "completed"
    And "workflowStage" should be "testing"

  @adw-378 @regression
  Scenario: writeState merge preserves existing phases when adding a new phase
    Given the top-level state file exists for "abc12345"
    And the phases map contains "install" with status "completed"
    When a new phase "plan" is written with status "running"
    Then the phases map should contain both "install" and "plan"
    And "install" should retain status "completed"

  @adw-378 @regression
  Scenario: Existing callers unaffected by new optional fields
    Given an existing caller that writes state without workflowStage or phases
    When the caller invokes writeState with adwId and issueNumber only
    Then the write should succeed without error
    And existing workflowStage and phases fields should be preserved via merge

  # --- AgentStateManager access pattern ---

  @adw-378
  Scenario: All top-level state access goes through AgentStateManager
    Given the AgentStateManager class in "adws/core/agentState.ts"
    Then it should provide a method to read the top-level state at "agents/<adwId>/state.json"
    And it should provide a method to write the top-level state at "agents/<adwId>/state.json"

  # --- TypeScript compilation ---

  @adw-378
  Scenario: TypeScript compiles without errors after interface changes
    When the TypeScript compiler is run with "bunx tsc --noEmit"
    Then there should be no compilation errors

  @adw-378
  Scenario: TypeScript compiles without errors for adws project
    When the TypeScript compiler is run with "bunx tsc --noEmit -p adws/tsconfig.json"
    Then there should be no compilation errors
