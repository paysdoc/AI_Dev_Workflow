@adw-305
Feature: Single-pass alignment command and phase (replaces plan validation loop)

  Replace the multi-round plan validation loop (validate -> resolve -> re-validate,
  up to MAX_VALIDATION_RETRY_ATTEMPTS) with a single-pass alignment step. After the
  parallel plan + scenario phase completes, one agent reads both the plan and the
  .feature files tagged @adw-{issueNumber}, identifies conflicts between them, and
  resolves them in a single pass. The GitHub issue remains the source of truth for
  conflict resolution.

  Background:
    Given the ADW codebase is checked out

  # --- 1: /align_plan_scenarios command exists ---

  @adw-305 @regression
  Scenario: /align_plan_scenarios command file exists
    Given the file ".claude/commands/align_plan_scenarios.md" exists
    Then the file contains "target: false" in its frontmatter
    And the file defines arguments for adwId, issueNumber, planFilePath, scenarioGlob, and issueJson

  @adw-305
  Scenario: /align_plan_scenarios command instructs the agent to output raw JSON
    Given the file ".claude/commands/align_plan_scenarios.md" exists
    Then the command instructions require the agent to output a JSON object as its final message
    And the JSON object must include "aligned", "warnings", "changes", and "summary" fields

  @adw-305
  Scenario: /align_plan_scenarios command uses the GitHub issue as sole source of truth
    Given the file ".claude/commands/align_plan_scenarios.md" exists
    Then the command instructions state the GitHub issue is the sole arbiter of truth
    And conflict resolution favours the issue body over both the plan and scenarios

  # --- 2: executeAlignmentPhase function exists ---

  @adw-305 @regression
  Scenario: executeAlignmentPhase function is exported from adws/phases
    Given the file "adws/phases/index.ts" is read
    Then the module exports "executeAlignmentPhase" from "./alignmentPhase"

  @adw-305 @regression
  Scenario: executeAlignmentPhase is re-exported from adws/workflowPhases
    Given the file "adws/workflowPhases.ts" is read
    Then "executeAlignmentPhase" is re-exported from the module

  # --- 3: Single agent invocation reads both plan and scenarios ---

  @adw-305 @regression
  Scenario: Alignment phase reads the plan file
    Given the alignment phase is configured with a valid plan file
    When executeAlignmentPhase is called
    Then the phase reads the plan file content via readPlanFile before invoking the agent

  @adw-305 @regression
  Scenario: Alignment phase discovers scenario files tagged with the issue number
    Given the alignment phase is configured with scenario files tagged @adw-{issueNumber}
    When executeAlignmentPhase is called
    Then the phase calls findScenarioFiles with the issue number and worktree path
    And only scenario files containing the @adw-{issueNumber} tag are included

  @adw-305
  Scenario: Alignment phase invokes a single agent with both plan and scenarios
    Given the alignment phase has discovered the plan file and scenario files
    When the alignment agent is run
    Then runAlignmentAgent is called exactly once
    And the agent receives the plan file path, worktree path, and issue JSON

  # --- 4: Conflicts resolved using GitHub issue as source of truth ---

  @adw-305
  Scenario: Alignment agent resolves a plan-scenario conflict using the issue body
    Given a plan file and a scenario file that describe the same behaviour differently
    And the GitHub issue body supports the scenario's version
    When the alignment agent runs
    Then the plan is updated to match the scenario
    And the change is recorded in the "changes" array of the alignment result

  @adw-305
  Scenario: Alignment agent resolves a conflict by updating the scenario
    Given a plan file and a scenario file that describe the same behaviour differently
    And the GitHub issue body supports the plan's version
    When the alignment agent runs
    Then the scenario is updated to match the plan
    And the change is recorded in the "changes" array of the alignment result

  # --- 5: Unresolvable conflicts are flagged as warnings ---

  @adw-305 @regression
  Scenario: Unresolvable conflicts are flagged as warnings, not errors
    Given the alignment agent encounters a conflict it cannot resolve from the issue
    When the alignment agent produces its result
    Then the "warnings" array contains a description of the unresolvable conflict
    And the "aligned" field is false
    And the workflow does not throw an error

  @adw-305
  Scenario: Unresolvable conflicts are inserted as inline HTML comments in the plan
    Given the alignment agent encounters an unresolvable conflict
    When the alignment agent updates the plan file
    Then the plan contains an inline "<!-- ADW-WARNING:" comment at the relevant location

  @adw-305 @regression
  Scenario: Alignment phase logs warnings but does not halt the workflow
    Given the alignment agent returns warnings for unresolvable conflicts
    When executeAlignmentPhase processes the alignment result
    Then each warning is logged at "warn" level
    And the phase returns successfully without throwing

  # --- 6: No retry loop — single pass only ---

  @adw-305 @regression
  Scenario: Alignment phase does not contain a retry loop
    Given the file "adws/phases/alignmentPhase.ts" is read
    Then the file does not contain "MAX_VALIDATION_RETRY" or "MAX_ALIGNMENT_RETRY"
    And the file does not contain a while loop or for loop around the agent invocation
    And runAlignmentAgent is called at most once per phase execution

  @adw-305
  Scenario: Alignment agent is invoked exactly once regardless of conflict count
    Given the alignment agent encounters multiple conflicts
    When the alignment phase completes
    Then the alignment agent was invoked exactly once
    And all conflicts (resolvable and unresolvable) are addressed in that single invocation

  # --- 7: PhaseCostRecord production ---

  @adw-305 @regression
  Scenario: Alignment phase produces PhaseCostRecord entries
    Given the alignment phase completes successfully
    When the phase result is returned
    Then the result includes a "phaseCostRecords" array
    And each record has phase set to "alignment"
    And each record has a valid workflowId, issueNumber, status, and durationMs

  @adw-305
  Scenario: Alignment phase cost includes the alignment agent cost
    Given the alignment agent completes with totalCostUsd = 0.05
    When the alignment phase result is returned
    Then the phase costUsd is at least 0.05
    And the modelUsage map includes entries from the alignment agent

  @adw-305
  Scenario: Alignment phase produces PhaseCostRecord even when skipped
    Given the plan file does not exist for the given issue
    When executeAlignmentPhase is called
    Then the phase returns phaseCostRecords with status "success"
    And the costUsd is 0

  # --- 8: Workflow integration ---

  @adw-305 @regression
  Scenario: Alignment phase runs after parallel plan + scenario phase in orchestrators
    Given the file "adws/adwPlanBuildReview.tsx" is read
    Then executePlanPhase and executeScenarioPhase run in parallel
    And executeAlignmentPhase runs immediately after the parallel phase completes
    And executeAlignmentPhase runs before executeBuildPhase

  @adw-305
  Scenario: Alignment phase runs in the SDLC orchestrator
    Given the file "adws/adwSdlc.tsx" is read
    Then executeAlignmentPhase is called after the parallel plan + scenario phase
    And executeAlignmentPhase is called before executeBuildPhase

  @adw-305
  Scenario: Alignment phase runs in the PlanBuildTestReview orchestrator
    Given the file "adws/adwPlanBuildTestReview.tsx" is read
    Then executeAlignmentPhase is called after the parallel plan + scenario phase
    And executeAlignmentPhase is called before executeBuildPhase

  # --- 9: WorkflowStage type includes alignment stages ---

  @adw-305 @regression
  Scenario: WorkflowStage type includes plan_aligning and plan_aligned
    Given the file "adws/types/workflowTypes.ts" is read
    Then the WorkflowStage union type includes "plan_aligning"
    And the WorkflowStage union type includes "plan_aligned"

  @adw-305
  Scenario: STAGE_HEADER_MAP includes alignment stage entries
    Given the file "adws/core/workflowCommentParsing.ts" is read
    Then the STAGE_HEADER_MAP maps a header to "plan_aligning"
    And the STAGE_HEADER_MAP maps a header to "plan_aligned"

  @adw-305
  Scenario: STAGE_ORDER includes plan_aligning in the correct position
    Given the file "adws/core/workflowCommentParsing.ts" is read
    Then the STAGE_ORDER array includes "plan_aligning"
    And "plan_aligning" appears after "plan_committing" and before "implementing"

  # --- 10: Alignment agent type definitions ---

  @adw-305 @regression
  Scenario: AlignmentResult interface is exported from the agents module
    Given the file "adws/agents/index.ts" is read
    Then the module exports "AlignmentResult" from "./alignmentAgent"
    And the module exports "runAlignmentAgent" from "./alignmentAgent"
    And the module exports "parseAlignmentResult" from "./alignmentAgent"

  @adw-305
  Scenario: AlignmentResult interface includes required fields
    Given the file "adws/agents/alignmentAgent.ts" is read
    Then AlignmentResult includes field "aligned" of type boolean
    And AlignmentResult includes field "warnings" as an array of strings
    And AlignmentResult includes field "changes" as an array of strings
    And AlignmentResult includes field "summary" of type string

  @adw-305 @regression
  Scenario: AgentIdentifier type includes alignment-agent
    Given the file "adws/types/agentTypes.ts" is read
    Then the AgentIdentifier union type includes "alignment-agent"

  # --- 11: Model routing for alignment command ---

  @adw-305 @regression
  Scenario: /align_plan_scenarios is mapped in the model routing table
    Given the file "adws/core/modelRouting.ts" is read
    Then SLASH_COMMAND_MODEL_MAP includes an entry for "/align_plan_scenarios"
    And SLASH_COMMAND_EFFORT_MAP includes an entry for "/align_plan_scenarios"

  @adw-305
  Scenario: /align_plan_scenarios uses opus model in default mode
    Given the file "adws/core/modelRouting.ts" is read
    Then SLASH_COMMAND_MODEL_MAP maps "/align_plan_scenarios" to "opus"

  @adw-305
  Scenario: /align_plan_scenarios effort is set to high
    Given the file "adws/core/modelRouting.ts" is read
    Then SLASH_COMMAND_EFFORT_MAP maps "/align_plan_scenarios" to "high"

  # --- 12: SlashCommand type includes alignment command ---

  @adw-305 @regression
  Scenario: SlashCommand type includes /align_plan_scenarios
    Given the file "adws/types/issueTypes.ts" is read
    Then the SlashCommand union type includes "/align_plan_scenarios"

  # --- 13: Graceful handling of missing inputs ---

  @adw-305
  Scenario: Alignment phase skips gracefully when no plan file exists
    Given no plan file exists for the current issue
    When executeAlignmentPhase is called
    Then the phase logs "No plan file found" and returns
    And no alignment agent is invoked

  @adw-305
  Scenario: Alignment phase skips gracefully when no scenario files exist
    Given a plan file exists but no scenario files are tagged @adw-{issueNumber}
    When executeAlignmentPhase is called
    Then the phase logs "No BDD scenario files" and returns
    And no alignment agent is invoked

  # --- 14: Alignment phase posts stage comments ---

  @adw-305
  Scenario: Alignment phase posts plan_aligning and plan_aligned stage comments
    Given the alignment phase is configured with a valid repoContext
    When executeAlignmentPhase runs successfully
    Then a "plan_aligning" stage comment is posted to the GitHub issue
    And a "plan_aligned" stage comment is posted after alignment completes

  # --- 15: Recovery state support ---

  @adw-305 @regression
  Scenario: Alignment phase respects recovery state skip
    Given the recovery state indicates "plan_aligning" has already been completed
    When executeAlignmentPhase is called
    Then the phase is skipped
    And the phase returns costUsd = 0 and empty phaseCostRecords

  # --- 16: Alignment agent parses non-JSON output gracefully ---

  @adw-305 @regression
  Scenario: parseAlignmentResult returns a safe default for non-JSON agent output
    Given the alignment agent returns non-JSON text output
    When parseAlignmentResult is called
    Then the result has aligned = true
    And the result has a single warning describing the parse failure
    And the result has empty changes array

  # --- 17: Commits updated artifacts ---

  @adw-305
  Scenario: Alignment phase commits changes when the agent made modifications
    Given the alignment agent returns changes to plan or scenario files
    When executeAlignmentPhase processes the result
    Then runCommitAgent is called to commit the updated artifacts

  @adw-305
  Scenario: Alignment phase does not commit when no changes were made
    Given the alignment agent returns an empty changes array
    When executeAlignmentPhase processes the result
    Then runCommitAgent is not called

  # --- 18: Type-check passes ---

  @adw-305 @regression
  Scenario: TypeScript type-check passes with alignment phase changes
    Given the ADW codebase with alignment phase implemented
    When "bunx tsc --noEmit" is run
    Then the command exits with code 0
    And "bunx tsc --noEmit -p adws/tsconfig.json" also exits with code 0
