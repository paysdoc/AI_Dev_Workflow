@adw-306
Feature: Build agent routing and orchestrator pipeline restructure

  Wire the new /implement_tdd skill and alignment phase into the ADW pipeline
  end-to-end. The build agent conditionally selects /implement_tdd when BDD
  scenarios tagged @adw-{issueNumber} exist, falling back to /implement when
  they don't. Orchestrators drop executeStepDefPhase and use executeAlignmentPhase
  instead of executePlanValidationPhase.

  Background:
    Given the ADW codebase is checked out

  # ===================================================================
  # 1. Build agent routing — scenario detection
  # ===================================================================

  @adw-306 @regression
  Scenario: buildAgent.ts scans for @adw-{issueNumber} tagged feature files
    Given the file "adws/agents/buildAgent.ts" is read
    Then it imports or calls findScenarioFiles to detect .feature files tagged @adw-{issueNumber}
    And the detection uses the issue number passed to runBuildAgent

  @adw-306 @regression
  Scenario: buildAgent.ts selects /implement_tdd when scenarios exist
    Given the file "adws/agents/buildAgent.ts" is read
    And .feature files tagged @adw-{issueNumber} exist in the worktree
    When runBuildAgent is called
    Then the agent config uses "/implement_tdd" as the command

  @adw-306 @regression
  Scenario: buildAgent.ts falls back to /implement when no scenarios exist
    Given the file "adws/agents/buildAgent.ts" is read
    And no .feature files tagged @adw-{issueNumber} exist in the worktree
    When runBuildAgent is called
    Then the agent config uses "/implement" as the command

  @adw-306
  Scenario: buildAgent.ts logs which build mode was selected
    Given the file "adws/agents/buildAgent.ts" is read
    When runBuildAgent is called with or without scenarios present
    Then it logs whether TDD mode or standard mode was selected

  # ===================================================================
  # 2. Build agent routing — scenario file paths passed to TDD agent
  # ===================================================================

  @adw-306 @regression
  Scenario: buildAgent.ts passes scenario file paths to the build agent in TDD mode
    Given the file "adws/agents/buildAgent.ts" is read
    And .feature files tagged @adw-{issueNumber} exist in the worktree
    When runBuildAgent selects /implement_tdd
    Then the agent arguments include the scenario file paths
    And the scenario file paths are passed alongside the plan content

  @adw-306
  Scenario: buildAgent.ts does not pass scenario paths when using standard /implement
    Given the file "adws/agents/buildAgent.ts" is read
    And no .feature files tagged @adw-{issueNumber} exist in the worktree
    When runBuildAgent selects /implement
    Then the agent arguments do not include scenario file paths

  # ===================================================================
  # 3. Build phase passes scenario context to the build agent
  # ===================================================================

  @adw-306 @regression
  Scenario: buildPhase.ts passes worktree path and issue number to runBuildAgent
    Given the file "adws/phases/buildPhase.ts" is read
    Then runBuildAgent is called with the worktree path
    And runBuildAgent is called with the issue number or issue object
    And the build agent can use both to detect and read scenario files

  # ===================================================================
  # 4. /implement_tdd registered in SlashCommand type
  # ===================================================================

  @adw-306 @regression
  Scenario: SlashCommand type includes /implement_tdd
    Given the file "adws/types/issueTypes.ts" is read
    Then the SlashCommand union type includes "/implement_tdd"

  # ===================================================================
  # 5. /implement_tdd registered in model routing tables
  # ===================================================================

  @adw-306 @regression
  Scenario: /implement_tdd is mapped in SLASH_COMMAND_MODEL_MAP
    Given the file "adws/core/modelRouting.ts" is read
    Then SLASH_COMMAND_MODEL_MAP includes an entry for "/implement_tdd"

  @adw-306 @regression
  Scenario: /implement_tdd is mapped in SLASH_COMMAND_EFFORT_MAP
    Given the file "adws/core/modelRouting.ts" is read
    Then SLASH_COMMAND_EFFORT_MAP includes an entry for "/implement_tdd"

  @adw-306
  Scenario: /implement_tdd uses the same model as /implement in default mode
    Given the file "adws/core/modelRouting.ts" is read
    Then SLASH_COMMAND_MODEL_MAP maps "/implement_tdd" to the same model as "/implement"

  @adw-306
  Scenario: /implement_tdd uses the same effort as /implement
    Given the file "adws/core/modelRouting.ts" is read
    Then SLASH_COMMAND_EFFORT_MAP maps "/implement_tdd" to the same effort as "/implement"

  # ===================================================================
  # 6. Orchestrator: adwSdlc.tsx pipeline restructure
  # ===================================================================

  @adw-306 @regression
  Scenario: adwSdlc.tsx uses new pipeline with alignment, no step def phase
    Given the file "adws/adwSdlc.tsx" is read
    Then the phase ordering should be:
      | phase              |
      | install            |
      | plan + scenarios   |
      | alignment          |
      | build              |
      | test               |
      | review             |
      | document           |
      | pr                 |
      | kpi                |
    And executeStepDefPhase is not called
    And executePlanValidationPhase is not called

  @adw-306
  Scenario: adwSdlc.tsx preserves parallel plan + scenario execution
    Given the file "adws/adwSdlc.tsx" is read
    Then executePlanPhase and executeScenarioPhase run in parallel (Promise.all or equivalent)
    And executeAlignmentPhase runs after the parallel phase completes

  # ===================================================================
  # 7. Orchestrator: adwPlanBuildReview.tsx pipeline restructure
  # ===================================================================

  @adw-306 @regression
  Scenario: adwPlanBuildReview.tsx uses new pipeline with alignment, no step def phase
    Given the file "adws/adwPlanBuildReview.tsx" is read
    Then the phase ordering should be:
      | phase              |
      | install            |
      | plan + scenarios   |
      | alignment          |
      | build              |
      | test               |
      | review             |
      | pr                 |
    And executeStepDefPhase is not called
    And executePlanValidationPhase is not called

  # ===================================================================
  # 8. Orchestrator: adwPlanBuildTestReview.tsx pipeline restructure
  # ===================================================================

  @adw-306 @regression
  Scenario: adwPlanBuildTestReview.tsx uses new pipeline with alignment, no step def phase
    Given the file "adws/adwPlanBuildTestReview.tsx" is read
    Then the phase ordering should be:
      | phase              |
      | install            |
      | plan + scenarios   |
      | alignment          |
      | build              |
      | test               |
      | review             |
      | pr                 |
    And executeStepDefPhase is not called
    And executePlanValidationPhase is not called

  # ===================================================================
  # 9. Non-scenario orchestrators remain unchanged
  # ===================================================================

  @adw-306 @regression
  Scenario: adwPlanBuild.tsx continues working without scenario or alignment phases
    Given the file "adws/adwPlanBuild.tsx" is read
    Then it should not invoke executeScenarioPhase
    And it should not invoke executeAlignmentPhase
    And it should not invoke executeStepDefPhase
    And the phase ordering should be:
      | phase              |
      | install            |
      | plan               |
      | build              |
      | test               |
      | pr                 |

  @adw-306 @regression
  Scenario: adwPlanBuildTest.tsx continues working without scenario or alignment phases
    Given the file "adws/adwPlanBuildTest.tsx" is read
    Then it should not invoke executeScenarioPhase
    And it should not invoke executeAlignmentPhase
    And it should not invoke executeStepDefPhase
    And the phase ordering should be:
      | phase              |
      | install            |
      | plan               |
      | build              |
      | test               |
      | pr                 |

  # ===================================================================
  # 10. executeStepDefPhase removed from all orchestrators
  # ===================================================================

  @adw-306 @regression
  Scenario: executeStepDefPhase is not called in any orchestrator
    Given the files "adws/adwSdlc.tsx", "adws/adwPlanBuildReview.tsx", and "adws/adwPlanBuildTestReview.tsx" are read
    Then none of them import executeStepDefPhase
    And none of them call executeStepDefPhase

  # ===================================================================
  # 11. executePlanValidationPhase not called in any orchestrator
  # ===================================================================

  @adw-306 @regression
  Scenario: executePlanValidationPhase is not called in any orchestrator
    Given the files "adws/adwSdlc.tsx", "adws/adwPlanBuildReview.tsx", and "adws/adwPlanBuildTestReview.tsx" are read
    Then none of them import executePlanValidationPhase
    And none of them call executePlanValidationPhase

  # ===================================================================
  # 12. Build agent TDD config reuses existing agent identifier
  # ===================================================================

  @adw-306
  Scenario: Build agent TDD config reuses the existing build agent identifier
    Given the file "adws/agents/buildAgent.ts" is read
    Then buildAgentTddConfig uses the same agent name as the standard buildAgentConfig
    And no new AgentIdentifier value is required for TDD mode

  # ===================================================================
  # 15. TypeScript type-check passes
  # ===================================================================

  @adw-306 @regression
  Scenario: TypeScript type-check passes after all changes
    Given the ADW codebase with build agent routing implemented
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0
