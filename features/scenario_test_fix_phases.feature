@adw-399
Feature: scenarioTestPhase + scenarioFixPhase wired into adwSdlc

  Two new phases — scenarioTestPhase and scenarioFixPhase — are introduced and
  wired into adwSdlc.tsx as the first consumer. scenarioTestPhase reads the
  scenario-by-tag command, conditionally wraps execution in withDevServer, spawns
  the scenario runner, and produces scenario_proof.md. scenarioFixPhase takes
  failures from scenarioTestPhase and invokes the resolver agent. Several renames
  align naming with the new architecture: testPhase -> unitTestPhase,
  runResolveE2ETestAgent -> runResolveScenarioAgent, resolve_failed_e2e_test.md
  -> resolve_failed_scenario.md. Only adwSdlc.tsx is rewired; other orchestrators
  are untouched.

  Background:
    Given the ADW codebase is checked out

  # ===================================================================
  # 1. scenarioTestPhase.ts — module existence and exports
  # ===================================================================

  @adw-399 @regression
  Scenario: scenarioTestPhase.ts exists and exports executeScenarioTestPhase
    Given "adws/phases/scenarioTestPhase.ts" is read
    Then the module exports a function named "executeScenarioTestPhase"

  @adw-399 @regression
  Scenario: executeScenarioTestPhase accepts WorkflowConfig and returns structured result
    Given "adws/phases/scenarioTestPhase.ts" is read
    Then the function signature accepts a "WorkflowConfig" parameter
    And the return type includes "costUsd", "modelUsage", "scenarioProof", and "phaseCostRecords"
    And "scenarioProof" includes "hasBlockerFailures" and the path to the proof file

  # ===================================================================
  # 2. scenarioTestPhase — tag filter and command reading
  # ===================================================================

  @adw-399 @regression
  Scenario: scenarioTestPhase reads Run Scenarios by Tag from commands config
    Given "adws/phases/scenarioTestPhase.ts" is read
    Then it reads the "runScenariosByTag" command from the project config
    And it constructs the tag filter using the issue number

  @adw-399
  Scenario: scenarioTestPhase runs scenarios with @adw-{issue} tag
    Given a workflow config for issue 42
    When executeScenarioTestPhase is called
    Then scenarios tagged "@adw-42" are executed via the tag command

  @adw-399
  Scenario: scenarioTestPhase runs scenarios with @regression tag
    Given a workflow config for issue 42
    When executeScenarioTestPhase is called
    Then scenarios tagged "@regression" are also executed via the tag command

  # ===================================================================
  # 3. scenarioTestPhase — withDevServer conditional wrapping
  # ===================================================================

  @adw-399 @regression
  Scenario: scenarioTestPhase wraps execution in withDevServer when Start Dev Server is configured
    Given "adws/phases/scenarioTestPhase.ts" is read
    And the project config has a non-N/A "startDevServer" command
    When executeScenarioTestPhase is called
    Then the scenario execution is wrapped in "withDevServer"
    And the dev server is started before scenarios run
    And the dev server is stopped after scenarios complete

  @adw-399 @regression
  Scenario: scenarioTestPhase does not use withDevServer when Start Dev Server is N/A
    Given "adws/phases/scenarioTestPhase.ts" is read
    And the project config has "startDevServer" set to "N/A"
    When executeScenarioTestPhase is called
    Then the scenario execution is NOT wrapped in "withDevServer"
    And scenarios run directly without a dev server

  # ===================================================================
  # 4. scenarioTestPhase — proof generation
  # ===================================================================

  @adw-399 @regression
  Scenario: scenarioTestPhase produces scenario_proof.md in agent state directory
    Given "adws/phases/scenarioTestPhase.ts" is read
    When executeScenarioTestPhase completes
    Then a "scenario_proof.md" file is written to the agent state directory
    And the proof file contains pass/fail results per tag

  @adw-399
  Scenario: scenarioTestPhase returns scenarioProof with path to generated proof file
    Given a workflow config for issue 42
    When executeScenarioTestPhase completes successfully
    Then the result includes a "scenarioProof" property
    And the scenarioProof contains the path to scenario_proof.md in the agent state directory

  # ===================================================================
  # 5. scenarioTestPhase — pass/fail return
  # ===================================================================

  @adw-399
  Scenario: scenarioTestPhase returns hasBlockerFailures false when all scenarios pass
    Given all @adw-42 and @regression scenarios pass
    When executeScenarioTestPhase completes
    Then the result scenarioProof has hasBlockerFailures set to false

  @adw-399
  Scenario: scenarioTestPhase returns hasBlockerFailures true when blocker scenarios fail
    Given some @adw-42 scenarios fail with blocker status
    When executeScenarioTestPhase completes
    Then the result scenarioProof has hasBlockerFailures set to true
    And the scenarioProof includes the failure details per tag

  # ===================================================================
  # 6. scenarioFixPhase.ts — module existence and exports
  # ===================================================================

  @adw-399 @regression
  Scenario: scenarioFixPhase.ts exists and exports executeScenarioFixPhase
    Given "adws/phases/scenarioFixPhase.ts" is read
    Then the module exports a function named "executeScenarioFixPhase"

  @adw-399
  Scenario: executeScenarioFixPhase accepts failure list from scenarioTestPhase
    Given "adws/phases/scenarioFixPhase.ts" is read
    Then the function accepts the failure list from a previous scenarioTestPhase run
    And it accepts a WorkflowConfig parameter

  # ===================================================================
  # 7. scenarioFixPhase — resolver invocation
  # ===================================================================

  @adw-399 @regression
  Scenario: scenarioFixPhase invokes runResolveScenarioAgent for each failed scenario
    Given "adws/phases/scenarioFixPhase.ts" is read
    Then it calls "runResolveScenarioAgent" for each failed scenario in the failure list

  @adw-399
  Scenario: scenarioFixPhase commits fixes after resolution
    Given a scenarioFixPhase run with 2 failing scenarios
    When the resolver agent resolves both failures
    Then fixes are committed to the worktree

  # ===================================================================
  # 8. Rename: runResolveE2ETestAgent -> runResolveScenarioAgent
  # ===================================================================

  @adw-399 @regression
  Scenario: runResolveE2ETestAgent is renamed to runResolveScenarioAgent in testAgent.ts
    Given "adws/agents/testAgent.ts" is read
    Then the module exports a function named "runResolveScenarioAgent"
    And the module does NOT export a function named "runResolveE2ETestAgent"

  @adw-399 @regression
  Scenario: All callers use runResolveScenarioAgent instead of runResolveE2ETestAgent
    When all TypeScript files under "adws/" are searched
    Then no file imports or calls "runResolveE2ETestAgent"
    And files that previously used "runResolveE2ETestAgent" now use "runResolveScenarioAgent"

  # ===================================================================
  # 9. Rename: resolve_failed_e2e_test.md -> resolve_failed_scenario.md
  # ===================================================================

  @adw-399 @regression
  Scenario: resolve_failed_e2e_test.md is renamed to resolve_failed_scenario.md
    Then the file ".claude/commands/resolve_failed_scenario.md" exists
    And the file ".claude/commands/resolve_failed_e2e_test.md" does NOT exist

  @adw-399
  Scenario: runResolveScenarioAgent references the new command name
    Given "adws/agents/testAgent.ts" is read
    Then runResolveScenarioAgent uses the command "/resolve_failed_scenario"
    And it does not reference "/resolve_failed_e2e_test"

  # ===================================================================
  # 10. Rename: testPhase.ts -> unitTestPhase.ts
  # ===================================================================

  @adw-399 @regression
  Scenario: testPhase.ts is renamed to unitTestPhase.ts
    Then the file "adws/phases/unitTestPhase.ts" exists
    And the file "adws/phases/testPhase.ts" does NOT exist

  @adw-399 @regression
  Scenario: executeTestPhase is renamed to executeUnitTestPhase
    Given "adws/phases/unitTestPhase.ts" is read
    Then the module exports a function named "executeUnitTestPhase"
    And the module does NOT export a function named "executeTestPhase"

  @adw-399 @regression
  Scenario: All imports of executeTestPhase are updated to executeUnitTestPhase
    When all TypeScript files under "adws/" are searched
    Then no file imports "executeTestPhase"
    And files that previously imported "executeTestPhase" now import "executeUnitTestPhase"

  # ===================================================================
  # 11. Wire into adwSdlc.tsx — imports
  # ===================================================================

  @adw-399
  Scenario: adwSdlc.tsx imports executeUnitTestPhase
    Given the file "adws/adwSdlc.tsx" is read
    Then it imports "executeUnitTestPhase" from workflowPhases or phases
    And it does NOT import "executeTestPhase"

  @adw-399
  Scenario: adwSdlc.tsx imports executeScenarioTestPhase
    Given the file "adws/adwSdlc.tsx" is read
    Then it imports "executeScenarioTestPhase" from workflowPhases or phases

  @adw-399
  Scenario: adwSdlc.tsx imports executeScenarioFixPhase
    Given the file "adws/adwSdlc.tsx" is read
    Then it imports "executeScenarioFixPhase" from workflowPhases or phases

  # ===================================================================
  # 12. Wire into adwSdlc.tsx — phase ordering
  # ===================================================================

  @adw-399 @regression
  Scenario: adwSdlc.tsx runs the new phase sequence
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

  @adw-399
  Scenario: unitTestPhase runs before scenarioTestPhase
    Given the file "adws/adwSdlc.tsx" is read
    Then executeUnitTestPhase is called before executeScenarioTestPhase

  @adw-399
  Scenario: scenarioTestPhase runs before reviewPhase
    Given the file "adws/adwSdlc.tsx" is read
    Then executeScenarioTestPhase is called before executeReviewPhase

  # ===================================================================
  # 13. Wire into adwSdlc.tsx — retry loop
  # ===================================================================

  @adw-399 @regression
  Scenario: Orchestrator-level retry loop bounded by MAX_TEST_RETRY_ATTEMPTS
    Given the file "adws/adwSdlc.tsx" is read
    Then the scenarioTest-scenarioFix retry loop uses MAX_TEST_RETRY_ATTEMPTS as its bound
    And the retry loop calls executeScenarioFixPhase on scenarioTestPhase failure
    And the retry loop re-runs executeScenarioTestPhase after fix

  @adw-399
  Scenario: Retry loop exits when scenarios pass
    Given adwSdlc.tsx is executing the scenario retry loop
    When executeScenarioTestPhase returns scenarioProof with hasBlockerFailures false
    Then the retry loop exits
    And the workflow proceeds to the review phase

  @adw-399
  Scenario: Retry loop exits after maximum attempts exhausted
    Given adwSdlc.tsx is executing the scenario retry loop
    And MAX_TEST_RETRY_ATTEMPTS is 5
    When every scenarioTestPhase attempt returns scenarioProof with hasBlockerFailures true
    Then the retry loop exits after 5 fix-retest cycles
    And the workflow reports scenario failure

  # ===================================================================
  # 14. Review phase — empty scenariosMd for SDLC
  # ===================================================================

  @adw-399 @regression
  Scenario: Review phase receives empty scenariosMd in SDLC orchestrator
    Given the file "adws/adwSdlc.tsx" is read
    Then the review phase is called with empty scenariosMd
    And scenario execution is NOT part of the review retry loop

  # ===================================================================
  # 15. Other orchestrators untouched
  # ===================================================================

  @adw-399 @regression
  Scenario: adwPlanBuildTest.tsx does not wire scenario phases
    Given the file "adws/adwPlanBuildTest.tsx" is read
    Then it does NOT import "executeScenarioTestPhase"
    And it does NOT import "executeScenarioFixPhase"
    And it does NOT call executeScenarioTestPhase or executeScenarioFixPhase

  @adw-399 @regression
  Scenario: adwPlanBuildTestReview.tsx does not wire scenario phases
    Given the file "adws/adwPlanBuildTestReview.tsx" is read
    Then it does NOT import "executeScenarioTestPhase"
    And it does NOT import "executeScenarioFixPhase"
    And it does NOT call executeScenarioTestPhase or executeScenarioFixPhase

  @adw-399 @regression
  Scenario: adwChore.tsx does not wire scenario phases
    Given the file "adws/adwChore.tsx" is read
    Then it does NOT import "executeScenarioTestPhase"
    And it does NOT import "executeScenarioFixPhase"
    And it does NOT call executeScenarioTestPhase or executeScenarioFixPhase

  @adw-399 @regression
  Scenario: adwPrReview.tsx does not wire scenario phases
    Given the file "adws/adwPrReview.tsx" is read
    Then it does NOT import "executeScenarioTestPhase"
    And it does NOT import "executeScenarioFixPhase"
    And it does NOT call executeScenarioTestPhase or executeScenarioFixPhase

  # ===================================================================
  # 16. TypeScript type-check passes
  # ===================================================================

  @adw-399 @regression
  Scenario: TypeScript type-check passes after all changes
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0
