# Feature: Plan-Scenario Validation and Resolution

## Metadata
issueNumber: `166`
adwId: `1773386483053-jl2amw`
issueJson: `{"number":166,"title":"Implement Plan-Scenario Validation and Resolution: align plan against BDD scenarios using GitHub issue as arbiter","body":"## Context\n\nAfter the Plan Agent and Scenario Planner Agent have both completed, a validation step is needed to ensure the implementation plan and the BDD scenarios are aligned. If they diverge, a Resolution Agent reconciles them using the GitHub issue as the sole source of truth.\n\n## Depends on\n\n- #164 (BDD scenario configuration and tagging conventions)\n- #165 (Scenario Planner Agent)\n\n## Requirements\n\n### Validation Agent\n\n- Reads the implementation plan (spec file)\n- Reads all scenarios tagged \\`@adw-{issueNumber}\\`\n- Identifies mismatches: plan describes behaviour X but scenarios test Y, or plan commits to something not covered by scenarios\n- If aligned: passes through without intervention\n- If mismatched: triggers the Resolution Agent\n\n### Resolution Agent\n\n- Takes as input: the GitHub issue, the plan, the scenarios, and the identified mismatches\n- **The GitHub issue is the sole arbiter of truth** — not the plan, not the scenarios\n- May output: an updated plan, updated scenarios, or both\n- Documents the resolution decision and the reasoning\n- After resolution, validation runs again to confirm alignment before proceeding\n\n### Integration\n\n- New phase: \\`adws/phases/planValidationPhase.ts\\`\n- Runs after both the Plan Agent and Scenario Planner Agent complete (sequential after the parallel pair)\n- Runs before the build phase\n\n## Acceptance Criteria\n\n- Validation correctly identifies plan-scenario mismatches\n- Resolution uses the GitHub issue as truth, not the plan or scenarios\n- Post-resolution validation confirms alignment before build proceeds\n- Resolution decisions are logged to ADW state\n- The phase integrates cleanly between planning and build in all relevant orchestrators","state":"OPEN","author":"paysdoc","labels":["enhancement"],"createdAt":"2026-03-13T07:02:01Z","comments":[],"actionableComment":null}`

## Feature Description
This feature introduces a Plan-Scenario Validation and Resolution system that runs after both the Plan Agent and Scenario Planner Agent complete, but before the Build phase. It ensures the implementation plan (spec file) and the BDD scenarios tagged `@adw-{issueNumber}` are aligned. When mismatches are detected, a Resolution Agent reconciles them using the GitHub issue as the sole source of truth. The validation loop re-runs after resolution to confirm alignment before the build proceeds.

## User Story
As a workflow orchestrator
I want to automatically validate that my implementation plan and BDD scenarios are aligned
So that the build phase always operates from a consistent, issue-faithful plan and scenario set

## Problem Statement
After the Plan Agent generates an implementation plan and the Scenario Planner Agent generates BDD scenarios, these two artifacts may diverge: the plan may describe behaviour not covered by scenarios, or scenarios may test behaviour the plan doesn't commit to. Without a validation gate, the build phase could produce an implementation that satisfies one artifact but not the other, leading to test failures or incomplete features.

## Solution Statement
Introduce a `planValidationPhase` that runs between planning and building. It uses a Validation Agent to compare the plan and scenarios, and if mismatches are found, invokes a Resolution Agent that reads the GitHub issue (the sole arbiter of truth) and produces updated plan, scenarios, or both. After resolution, validation re-runs to confirm alignment. The phase integrates into all relevant orchestrators using the same composable pattern as existing phases.

## Relevant Files
Use these files to implement the feature:

### Existing Files to Read/Modify
- `adws/phases/planPhase.ts` — Reference for phase implementation pattern (recovery, state, comments, cost tracking)
- `adws/phases/kpiPhase.ts` — Reference for non-fatal phase pattern and simpler agent invocation
- `adws/phases/testPhase.ts` — Reference for phase with retry/loop logic
- `adws/phases/index.ts` — Must add exports for the new phase
- `adws/phases/phaseCommentHelpers.ts` — Used to post workflow stage comments
- `adws/phases/workflowLifecycle.ts` — Contains `WorkflowConfig` type used by all phases
- `adws/workflowPhases.ts` — Must re-export the new phase for orchestrator consumption
- `adws/agents/index.ts` — Must export the new agent functions
- `adws/agents/claudeAgent.ts` — Base agent runner (`runClaudeAgentWithCommand`)
- `adws/agents/reviewAgent.ts` — Reference for agent with structured JSON output parsing
- `adws/agents/planAgent.ts` — Provides `getPlanFilePath`, `readPlanFile` for reading the spec file
- `adws/types/agentTypes.ts` — Must add new `AgentIdentifier` entries
- `adws/types/workflowTypes.ts` — Must add new `WorkflowStage` entries
- `adws/types/issueTypes.ts` — Must add new `SlashCommand` entries
- `adws/core/config.ts` — Must add entries to `SLASH_COMMAND_MODEL_MAP`, `SLASH_COMMAND_EFFORT_MAP`, and their fast variants
- `adws/core/constants.ts` — Reference for `OrchestratorId` (no changes needed)
- `adws/core/index.ts` — Verify new config exports are available
- `adws/github/workflowCommentsIssue.ts` — Must add comment formatters for new workflow stages
- `adws/adwSdlc.tsx` — Must integrate the new phase between plan and build
- `adws/adwPlanBuild.tsx` — Must integrate the new phase between plan and build
- `adws/adwPlanBuildTest.tsx` — Must integrate the new phase between plan and build (if it exists)
- `adws/adwPlanBuildReview.tsx` — Must integrate the new phase between plan and build (if it exists)
- `adws/adwPlanBuildDocument.tsx` — Must integrate the new phase between plan and build (if it exists)
- `adws/adwPlanBuildTestReview.tsx` — Must integrate the new phase between plan and build (if it exists)
- `adws/core/jsonParser.ts` — Reference for `extractJson` utility used in parsing structured agent output
- `guidelines/coding_guidelines.md` — Must follow all coding guidelines
- `app_docs/feature-add-resoning-effort-4wna6z-reasoning-effort-slash-commands.md` — Reference for how to add new slash commands with effort/model maps

### New Files
- `adws/phases/planValidationPhase.ts` — The new plan validation phase
- `adws/agents/planValidationAgent.ts` — Validation Agent runner + Resolution Agent runner
- `.claude/commands/validate_plan_scenarios.md` — Slash command prompt for the Validation Agent
- `.claude/commands/resolve_plan_scenarios.md` — Slash command prompt for the Resolution Agent
- `adws/__tests__/planValidationPhase.test.ts` — Unit tests for the plan validation phase
- `adws/__tests__/planValidationAgent.test.ts` — Unit tests for the validation and resolution agents

## Implementation Plan

### Phase 1: Foundation — Types, Config, and Slash Commands
Add the type system foundations: new `AgentIdentifier` entries, `WorkflowStage` entries, `SlashCommand` entries, model/effort map entries. Create the slash command prompt files that define what the Validation Agent and Resolution Agent do.

### Phase 2: Core Implementation — Agent Runners and Phase Logic
Implement the agent runner functions (`runPlanValidationAgent`, `runPlanResolutionAgent`) following the existing pattern from `reviewAgent.ts`. Implement the `planValidationPhase.ts` with the validation-resolution loop: validate → if mismatched → resolve → re-validate → confirm alignment.

### Phase 3: Integration — Orchestrators and Comments
Wire the new phase into orchestrators between plan and build. Add workflow comment formatters for the new stages. Export the phase from `index.ts` and `workflowPhases.ts`.

## Step by Step Tasks

### Step 1: Add Type Definitions
- Add `'plan-validation-agent'` and `'plan-resolution-agent'` to the `AgentIdentifier` union in `adws/types/agentTypes.ts`
- Add `'scenario_validating'`, `'scenario_validated'`, `'scenario_resolving'`, `'scenario_resolved'`, and `'scenario_validation_failed'` to the `WorkflowStage` union in `adws/types/workflowTypes.ts`
- Add `'/validate_plan_scenarios'` and `'/resolve_plan_scenarios'` to the `SlashCommand` union in `adws/types/issueTypes.ts`

### Step 2: Add Model and Effort Map Entries
- In `adws/core/config.ts`, add entries for `'/validate_plan_scenarios'` and `'/resolve_plan_scenarios'` to:
  - `SLASH_COMMAND_MODEL_MAP` — both should use `'opus'` (complex reasoning required)
  - `SLASH_COMMAND_MODEL_MAP_FAST` — both should use `'sonnet'` for cost optimization
  - `SLASH_COMMAND_EFFORT_MAP` — both should use `'high'`
  - `SLASH_COMMAND_EFFORT_MAP_FAST` — both should use `'high'` (validation accuracy is critical even in fast mode)

### Step 3: Create Slash Command Prompt Files
- Create `.claude/commands/validate_plan_scenarios.md`:
  - Accepts args: `adwId`, `issueNumber`, `planFilePath`, `scenarioGlob` (the glob pattern to find `@adw-{issueNumber}` tagged scenario files)
  - Instructions: Read the plan file, read all scenario files matching the tag, compare each plan section against scenario coverage, identify mismatches (plan behaviour not covered by scenarios, scenarios testing behaviour not in plan)
  - Output: JSON with `{ aligned: boolean, mismatches: Array<{ type: 'plan_uncovered' | 'scenario_untested', description: string, planSection?: string, scenarioFile?: string }> }`
- Create `.claude/commands/resolve_plan_scenarios.md`:
  - Accepts args: `adwId`, `issueNumber`, `planFilePath`, `scenarioGlob`, `issueJson`, `mismatches` (JSON string of mismatches from validation)
  - Instructions: The GitHub issue is the **sole arbiter of truth**. Read the issue, plan, and scenarios. For each mismatch, determine which artifact (plan, scenarios, or both) must change to align with the issue. Write updated files directly.
  - Output: JSON with `{ resolved: boolean, decisions: Array<{ mismatch: string, action: 'updated_plan' | 'updated_scenarios' | 'updated_both', reasoning: string }> }`

### Step 4: Create Agent Runner Functions
- Create `adws/agents/planValidationAgent.ts`:
  - `formatValidationArgs(adwId, issueNumber, planFilePath, scenarioGlob): string[]` — formats args as JSON string array
  - `runPlanValidationAgent(adwId, issueNumber, planFilePath, scenarioGlob, logsDir, statePath?, cwd?, issueBody?): Promise<PlanValidationAgentResult>` — runs `/validate_plan_scenarios` via `runClaudeAgentWithCommand`, parses JSON result with `extractJson`
  - `PlanValidationResult` interface: `{ aligned: boolean, mismatches: PlanScenarioMismatch[] }`
  - `PlanScenarioMismatch` interface: `{ type: 'plan_uncovered' | 'scenario_untested', description: string, planSection?: string, scenarioFile?: string }`
  - `PlanValidationAgentResult` interface: extends `AgentResult` with `validationResult: PlanValidationResult | null`
  - `formatResolutionArgs(adwId, issueNumber, planFilePath, scenarioGlob, issueJson, mismatches): string[]` — formats args as JSON string array
  - `runPlanResolutionAgent(adwId, issueNumber, planFilePath, scenarioGlob, issueJson, mismatches, logsDir, statePath?, cwd?, issueBody?): Promise<PlanResolutionAgentResult>` — runs `/resolve_plan_scenarios` via `runClaudeAgentWithCommand`, parses JSON result
  - `PlanResolutionResult` interface: `{ resolved: boolean, decisions: ResolutionDecision[] }`
  - `ResolutionDecision` interface: `{ mismatch: string, action: 'updated_plan' | 'updated_scenarios' | 'updated_both', reasoning: string }`
  - `PlanResolutionAgentResult` interface: extends `AgentResult` with `resolutionResult: PlanResolutionResult | null`
- Export all new types and functions from `adws/agents/index.ts`

### Step 5: Create the Plan Validation Phase
- Create `adws/phases/planValidationPhase.ts`:
  - `MAX_VALIDATION_ATTEMPTS = 3` — maximum validation-resolution loop iterations
  - `executePlanValidationPhase(config: WorkflowConfig): Promise<{ costUsd: number; modelUsage: ModelUsageMap }>`
  - Phase logic:
    1. Check `shouldExecuteStage('scenario_validated', recoveryState)` — skip if already completed
    2. Initialize agent state for `'plan-validation-agent'`
    3. Read plan file path from `config.ctx.planPath` or `getPlanFilePath(issueNumber, worktreePath)`
    4. Construct scenario glob pattern (e.g., `**/*.feature` files containing `@adw-{issueNumber}` tag)
    5. Post `'scenario_validating'` comment via `postIssueStageComment`
    6. Run validation loop (up to `MAX_VALIDATION_ATTEMPTS`):
       a. Run `runPlanValidationAgent` to check alignment
       b. If `aligned === true`: break loop, post `'scenario_validated'` comment
       c. If mismatched: post `'scenario_resolving'` comment, run `runPlanResolutionAgent`
       d. If resolution fails or max attempts reached: post `'scenario_validation_failed'` comment, throw error
    7. Log resolution decisions to agent state metadata
    8. Update orchestrator state, return cost and modelUsage
  - Follow the same cost/modelUsage accumulation pattern as `testPhase.ts` (merge across loop iterations)

### Step 6: Add Workflow Comment Formatters
- In `adws/github/workflowCommentsIssue.ts`:
  - Add `formatScenarioValidatingComment(ctx)` — "Validating plan-scenario alignment..."
  - Add `formatScenarioValidatedComment(ctx)` — "Plan and scenarios are aligned."
  - Add `formatScenarioResolvingComment(ctx)` — "Resolving plan-scenario mismatches using issue as arbiter..."
  - Add `formatScenarioResolvedComment(ctx)` — "Plan-scenario mismatches resolved."
  - Add `formatScenarioValidationFailedComment(ctx)` — "Plan-scenario validation failed after max attempts."
  - Add cases for all new stages in `formatWorkflowComment()` switch statement
- Optionally add `validationMismatches?: number` and `resolutionDecisions?: string[]` fields to `WorkflowContext` interface for richer comments

### Step 7: Export the New Phase
- In `adws/phases/index.ts`, add: `export { executePlanValidationPhase, MAX_VALIDATION_ATTEMPTS } from './planValidationPhase';`
- In `adws/workflowPhases.ts`, add `executePlanValidationPhase` and `MAX_VALIDATION_ATTEMPTS` to the re-export list

### Step 8: Integrate into Orchestrators
- In `adws/adwSdlc.tsx`:
  - Import `executePlanValidationPhase` from `'./workflowPhases'`
  - Insert after `executePlanPhase` result handling and before `executeBuildPhase`:
    ```typescript
    config.totalModelUsage = totalModelUsage;
    const validationResult = await executePlanValidationPhase(config);
    totalCostUsd += validationResult.costUsd;
    totalModelUsage = mergeModelUsageMaps(totalModelUsage, validationResult.modelUsage);
    persistTokenCounts(config.orchestratorStatePath, totalCostUsd, totalModelUsage);
    if (RUNNING_TOKENS) config.ctx.runningTokenTotal = computeDisplayTokens(totalModelUsage);
    ```
- Apply the same insertion pattern to all orchestrators that have both Plan and Build phases:
  - `adws/adwPlanBuild.tsx`
  - Any other `adwPlanBuild*.tsx` orchestrator files

### Step 9: Write Unit Tests for Agent Runners
- Create `adws/__tests__/planValidationAgent.test.ts`:
  - Test `formatValidationArgs` returns correct JSON string array
  - Test `formatResolutionArgs` returns correct JSON string array
  - Test `runPlanValidationAgent` calls `runClaudeAgentWithCommand` with correct slash command, model, effort
  - Test `runPlanValidationAgent` parses aligned result correctly
  - Test `runPlanValidationAgent` parses mismatched result correctly
  - Test `runPlanValidationAgent` handles invalid JSON output gracefully (returns null validationResult)
  - Test `runPlanResolutionAgent` calls `runClaudeAgentWithCommand` with correct args
  - Test `runPlanResolutionAgent` parses resolved result correctly
  - Mock `runClaudeAgentWithCommand` and `extractJson` using `vi.mock`

### Step 10: Write Unit Tests for the Phase
- Create `adws/__tests__/planValidationPhase.test.ts`:
  - Mock `../core` (log, AgentStateManager, shouldExecuteStage, emptyModelUsageMap, mergeModelUsageMaps)
  - Mock `../agents` (runPlanValidationAgent, runPlanResolutionAgent, getPlanFilePath)
  - Mock `./phaseCommentHelpers` (postIssueStageComment)
  - Test happy path: validation passes on first attempt (aligned=true), returns cost
  - Test resolution path: validation fails, resolution runs, re-validation passes
  - Test max attempts: validation fails repeatedly, phase throws error
  - Test recovery skip: `shouldExecuteStage` returns false, phase returns early with zero cost
  - Test cost accumulation: multiple loop iterations accumulate cost correctly
  - Test state logging: verify `AgentStateManager.appendLog` and `writeState` calls
  - Test comment posting: verify correct stage comments are posted at each step

### Step 11: Run Validation Commands
- Execute all validation commands to confirm zero regressions

## Testing Strategy

### Unit Tests
- **Agent runner tests** (`planValidationAgent.test.ts`): Verify argument formatting, agent invocation, JSON parsing, and error handling for both validation and resolution agents.
- **Phase tests** (`planValidationPhase.test.ts`): Verify the validation-resolution loop logic, recovery state handling, cost accumulation, state management, and comment posting.
- **Type coverage**: The new `SlashCommand` entries are checked at compile time by existing `Record<SlashCommand, ...>` maps in `config.ts` — missing entries will cause TypeScript compilation errors.

### Edge Cases
- Plan file does not exist (phase should throw a clear error)
- No scenario files found matching `@adw-{issueNumber}` tag (validation should report as a mismatch — plan has no scenario coverage)
- Validation agent returns invalid JSON (phase should handle gracefully with a clear error message)
- Resolution agent fails to resolve (phase should retry up to `MAX_VALIDATION_ATTEMPTS` then fail)
- Resolution agent resolves but re-validation still finds mismatches (phase should continue the loop)
- Recovery state indicates phase already completed (phase should skip with zero cost)
- `repoContext` is undefined (comments should be skipped without errors)

## Acceptance Criteria
- Validation correctly identifies plan-scenario mismatches by comparing plan sections against tagged BDD scenarios
- Resolution uses the GitHub issue body as the sole source of truth, not the plan or scenarios
- Post-resolution validation re-runs and confirms alignment before the build phase proceeds
- Resolution decisions (mismatch, action taken, reasoning) are logged to ADW agent state metadata
- The phase integrates cleanly between planning and build in `adwSdlc.tsx`, `adwPlanBuild.tsx`, and all other orchestrators with both plan and build phases
- `MAX_VALIDATION_ATTEMPTS` (default 3) prevents infinite validation-resolution loops
- All existing tests pass with zero regressions
- TypeScript compiles without errors (`bunx tsc --noEmit`)
- New unit tests cover happy path, resolution path, max attempts, recovery skip, and cost accumulation

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type check the entire project (catches missing SlashCommand map entries)
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check the adws module specifically
- `bun run test` — Run all tests to validate zero regressions
- `bun run build` — Build the application to verify no build errors

## Notes
- This feature depends on #164 (BDD scenario configuration and tagging conventions) and #165 (Scenario Planner Agent). The implementation assumes scenario files exist and follow the `@adw-{issueNumber}` tagging convention established by those issues. If those issues are not yet merged, the scenario glob pattern and tag parsing logic should be designed to be configurable.
- The slash command prompt files (`.claude/commands/validate_plan_scenarios.md` and `.claude/commands/resolve_plan_scenarios.md`) are the most critical design artifacts — they define what the Claude agent actually does. Invest time in making these prompts precise about the JSON output format and the arbiter-of-truth principle.
- When adding to `SLASH_COMMAND_MODEL_MAP` and `SLASH_COMMAND_EFFORT_MAP`, TypeScript's `Record<SlashCommand, ...>` constraint will force you to also add to the `_FAST` variants, ensuring nothing is missed.
- The validation phase is **fatal** (not non-fatal like KPI). If validation cannot pass after max attempts, the workflow should stop — proceeding to build with misaligned artifacts would produce incorrect results.
- Follow all coding guidelines in `guidelines/coding_guidelines.md`: keep files under 300 lines, strict TypeScript, immutability, pure functions at core, side effects at boundaries.
