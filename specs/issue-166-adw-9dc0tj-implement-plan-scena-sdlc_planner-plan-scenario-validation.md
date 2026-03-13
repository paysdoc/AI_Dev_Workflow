# Feature: Plan-Scenario Validation and Resolution

## Metadata
issueNumber: `166`
adwId: `9dc0tj-implement-plan-scena`
issueJson: `{"number":166,"title":"Implement Plan-Scenario Validation and Resolution: align plan against BDD scenarios using GitHub issue as arbiter","body":"## Context\n\nAfter the Plan Agent and Scenario Planner Agent have both completed, a validation step is needed to ensure the implementation plan and the BDD scenarios are aligned. If they diverge, a Resolution Agent reconciles them using the GitHub issue as the sole source of truth.\n\n## Depends on\n\n- #164 (BDD scenario configuration and tagging conventions)\n- #165 (Scenario Planner Agent)\n\n## Requirements\n\n### Validation Agent\n\n- Reads the implementation plan (spec file)\n- Reads all scenarios tagged \\`@adw-{issueNumber}\\`\n- Identifies mismatches: plan describes behaviour X but scenarios test Y, or plan commits to something not covered by scenarios\n- If aligned: passes through without intervention\n- If mismatched: triggers the Resolution Agent\n\n### Resolution Agent\n\n- Takes as input: the GitHub issue, the plan, the scenarios, and the identified mismatches\n- **The GitHub issue is the sole arbiter of truth** — not the plan, not the scenarios\n- May output: an updated plan, updated scenarios, or both\n- Documents the resolution decision and the reasoning\n- After resolution, validation runs again to confirm alignment before proceeding\n\n### Integration\n\n- New phase: \\`adws/phases/planValidationPhase.ts\\`\n- Runs after both the Plan Agent and Scenario Planner Agent complete (sequential after the parallel pair)\n- Runs before the build phase\n\n## Acceptance Criteria\n\n- Validation correctly identifies plan-scenario mismatches\n- Resolution uses the GitHub issue as truth, not the plan or scenarios\n- Post-resolution validation confirms alignment before build proceeds\n- Resolution decisions are logged to ADW state\n- The phase integrates cleanly between planning and build in all relevant orchestrators","state":"OPEN","author":"paysdoc","labels":["enhancement"],"createdAt":"2026-03-13T07:02:01Z","comments":[],"actionableComment":null}`

## Feature Description
This feature introduces a validation and resolution phase that ensures the implementation plan (spec file) and BDD scenarios (created by the Scenario Planner Agent from #165) are aligned before the build phase begins. A Validation Agent reads both artifacts and identifies mismatches — behaviors described in the plan but not covered by scenarios, or scenarios testing behaviors not in the plan. If aligned, the workflow proceeds. If mismatched, a Resolution Agent reconciles the two artifacts using the GitHub issue as the sole arbiter of truth, potentially updating the plan, the scenarios, or both. After resolution, validation runs again to confirm alignment. This forms a validate-resolve loop (with a bounded retry limit) that guarantees plan-scenario coherence before implementation begins.

## User Story
As a developer using ADW
I want the workflow to automatically validate that my implementation plan and BDD scenarios are aligned
So that the build phase implements exactly what the scenarios will test, avoiding wasted effort on mismatched artifacts

## Problem Statement
After the Plan Agent and Scenario Planner Agent run (potentially in parallel), their outputs may diverge: the plan may describe behaviors not covered by scenarios, or scenarios may test behaviors not in the plan. Without a validation step, this misalignment propagates into the build phase, where the implementation may pass unit tests but fail BDD scenarios, or vice versa. This wastes compute and developer time.

## Solution Statement
Introduce a `planValidationPhase` that runs after both the Plan Agent and Scenario Planner Agent complete but before the build phase. The phase uses a Validation Agent (Claude agent with a `/validate_plan_scenarios` prompt) to compare the plan and scenarios, producing a structured validation result. If mismatches are found, a Resolution Agent (Claude agent with a `/resolve_plan_scenarios` prompt) reconciles them using the GitHub issue as the sole source of truth, outputting updated artifacts. The loop repeats until validation passes or a maximum retry count is reached. Resolution decisions are logged to ADW state for auditability.

## Relevant Files
Use these files to implement the feature:

### Existing Files
- `adws/phases/planPhase.ts` — Pattern reference for phase implementation; the new phase follows the same structure (WorkflowConfig input, cost/modelUsage return, stage comments, state management)
- `adws/phases/buildPhase.ts` — Pattern reference; the new phase runs immediately before this phase
- `adws/phases/testPhase.ts` — Pattern reference for retry logic and phase return types
- `adws/phases/kpiPhase.ts` — Pattern reference for a recently-added phase, shows latest conventions
- `adws/phases/index.ts` — Must be updated to export the new phase
- `adws/phases/phaseCommentHelpers.ts` — Used for posting stage comments via RepoContext
- `adws/workflowPhases.ts` — Must be updated to re-export the new phase
- `adws/agents/index.ts` — Must be updated to export the new validation/resolution agents
- `adws/agents/claudeAgent.ts` — Base agent runner; new agents use `runClaudeAgent()` for free-form prompts
- `adws/agents/planAgent.ts` — Pattern reference for agent implementation and plan file reading utilities (`readPlanFile`, `getPlanFilePath`)
- `adws/types/agentTypes.ts` — Must add new `AgentIdentifier` entries for `validation-agent` and `resolution-agent`
- `adws/types/workflowTypes.ts` — Must add new `WorkflowStage` entries for validation/resolution stages
- `adws/core/constants.ts` — No changes needed (orchestrator IDs unchanged)
- `adws/core/config.ts` — Must add model/effort mappings for the new slash commands
- `adws/core/index.ts` — Must export new config entries if any new constants are added
- `adws/types/issueTypes.ts` — Must add new `SlashCommand` entries for `/validate_plan_scenarios` and `/resolve_plan_scenarios`
- `adws/adwSdlc.tsx` — Must integrate the new phase between plan and build
- `adws/adwPlanBuild.tsx` — Must integrate the new phase between plan and build
- `adws/adwPlanBuildTest.tsx` — Must integrate the new phase between plan and build
- `adws/adwPlanBuildReview.tsx` — Must integrate the new phase between plan and build
- `adws/adwPlanBuildDocument.tsx` — Must integrate the new phase between plan and build
- `adws/adwPlanBuildTestReview.tsx` — Must integrate the new phase between plan and build
- `adws/phases/__tests__/helpers/makeRepoContext.ts` — Shared test helper for mock RepoContext
- `adws/phases/__tests__/testPhase.test.ts` — Pattern reference for phase unit tests
- `guidelines/coding_guidelines.md` — Must follow these coding guidelines
- `adws/README.md` — Must be updated to document the new phase
- `.claude/commands/conditional_docs.md` — Reference for conditional docs patterns

### New Files
- `adws/agents/validationAgent.ts` — Validation Agent that compares plan and scenarios for alignment
- `adws/agents/resolutionAgent.ts` — Resolution Agent that reconciles mismatches using the GitHub issue as truth
- `adws/phases/planValidationPhase.ts` — Plan-Scenario Validation phase implementation
- `adws/phases/__tests__/planValidationPhase.test.ts` — Unit tests for the validation phase
- `adws/agents/__tests__/validationAgent.test.ts` — Unit tests for the validation agent
- `adws/agents/__tests__/resolutionAgent.test.ts` — Unit tests for the resolution agent

## Implementation Plan
### Phase 1: Foundation
1. Add new type definitions:
   - `AgentIdentifier` entries: `'validation-agent'` and `'resolution-agent'`
   - `WorkflowStage` entries: `'plan_validating'`, `'plan_validated'`, `'plan_resolving'`, `'plan_resolved'`, `'plan_validation_failed'`
   - `SlashCommand` entries: `'/validate_plan_scenarios'` and `'/resolve_plan_scenarios'`
2. Add model and effort mappings in `config.ts` for the two new commands:
   - `/validate_plan_scenarios` → `opus` model, `high` effort (complex reasoning to compare plan vs scenarios)
   - `/resolve_plan_scenarios` → `opus` model, `high` effort (complex reasoning to reconcile using issue as truth)
3. Add a `MAX_VALIDATION_RETRY_ATTEMPTS` config constant (default: 3) for bounding the validate-resolve loop

### Phase 2: Core Implementation
1. Create `validationAgent.ts`:
   - `runValidationAgent()` function that constructs a prompt containing the plan content, scenario file contents, and issue context
   - Uses `runClaudeAgent()` (free-form prompt, not a slash command) to ask Claude to compare the plan and scenarios
   - Parses the agent output for a structured validation result: `{ aligned: boolean; mismatches: MismatchItem[] }`
   - `MismatchItem` type: `{ type: 'plan_only' | 'scenario_only' | 'conflicting'; description: string; planReference?: string; scenarioReference?: string }`
2. Create `resolutionAgent.ts`:
   - `runResolutionAgent()` function that constructs a prompt containing the GitHub issue body, the plan, the scenarios, and the identified mismatches
   - Uses `runClaudeAgent()` to ask Claude to reconcile, using the issue as the sole arbiter of truth
   - The agent is instructed to output updated plan content and/or updated scenario content
   - Returns `{ updatedPlan?: string; updatedScenarios?: { path: string; content: string }[]; reasoning: string }`
3. Create `planValidationPhase.ts`:
   - `executePlanValidationPhase(config: WorkflowConfig)` following the same signature pattern as other phases
   - Reads the plan file using `readPlanFile()`
   - Discovers scenario files tagged `@adw-{issueNumber}` (reads from the worktree's feature directory)
   - Runs the Validation Agent
   - If aligned: logs success, returns cost/usage
   - If mismatched: runs the Resolution Agent, writes updated plan/scenarios to disk, then re-validates (bounded loop up to `MAX_VALIDATION_RETRY_ATTEMPTS`)
   - Posts stage comments at each transition (`plan_validating`, `plan_validated`, `plan_resolving`, `plan_resolved`, `plan_validation_failed`)
   - Logs resolution decisions to ADW state via `AgentStateManager.appendLog()`
   - Commits updated artifacts after successful resolution via `runCommitAgent()`

### Phase 3: Integration
1. Export the new phase from `phases/index.ts` and `workflowPhases.ts`
2. Export the new agents from `agents/index.ts`
3. Integrate `executePlanValidationPhase()` into all orchestrators that have both plan and build phases:
   - `adwPlanBuild.tsx` — after `executePlanPhase()`, before `executeBuildPhase()`
   - `adwPlanBuildTest.tsx` — after `executePlanPhase()`, before `executeBuildPhase()`
   - `adwPlanBuildReview.tsx` — after `executePlanPhase()`, before `executeBuildPhase()`
   - `adwPlanBuildDocument.tsx` — after `executePlanPhase()`, before `executeBuildPhase()`
   - `adwPlanBuildTestReview.tsx` — after `executePlanPhase()`, before `executeBuildPhase()`
   - `adwSdlc.tsx` — after `executePlanPhase()`, before `executeBuildPhase()`
4. Update `adws/README.md` to document the new phase in the workflow descriptions

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add Type Definitions
- In `adws/types/agentTypes.ts`, add `'validation-agent'` and `'resolution-agent'` to the `AgentIdentifier` union type
- In `adws/types/workflowTypes.ts`, add `'plan_validating'`, `'plan_validated'`, `'plan_resolving'`, `'plan_resolved'`, and `'plan_validation_failed'` to the `WorkflowStage` union type
- In `adws/types/issueTypes.ts`, add `'/validate_plan_scenarios'` and `'/resolve_plan_scenarios'` to the `SlashCommand` union type

### Step 2: Add Configuration
- In `adws/core/config.ts`:
  - Add `MAX_VALIDATION_RETRY_ATTEMPTS` constant (default: 3, parsed from `process.env.MAX_VALIDATION_RETRY_ATTEMPTS`)
  - Add entries for `/validate_plan_scenarios` and `/resolve_plan_scenarios` in `SLASH_COMMAND_MODEL_MAP` (both `opus`)
  - Add entries in `SLASH_COMMAND_MODEL_MAP_FAST` (both `opus` — complex reasoning, no downgrade)
  - Add entries in `SLASH_COMMAND_EFFORT_MAP` (both `high`)
  - Add entries in `SLASH_COMMAND_EFFORT_MAP_FAST` (both `high`)
- In `adws/core/index.ts`, export `MAX_VALIDATION_RETRY_ATTEMPTS`

### Step 3: Create Validation Agent Types
- Define the `ValidationResult` interface in `adws/agents/validationAgent.ts`:
  ```typescript
  interface MismatchItem {
    type: 'plan_only' | 'scenario_only' | 'conflicting';
    description: string;
    planReference?: string;
    scenarioReference?: string;
  }

  interface ValidationResult {
    aligned: boolean;
    mismatches: MismatchItem[];
    summary: string;
  }
  ```

### Step 4: Create Validation Agent
- Create `adws/agents/validationAgent.ts`:
  - Implement `findScenarioFiles(issueNumber: number, worktreePath: string): string[]` — discovers `.feature` files containing `@adw-{issueNumber}` tag by scanning the worktree
  - Implement `readScenarioContents(scenarioPaths: string[], worktreePath: string): string` — reads and concatenates scenario file contents
  - Implement `buildValidationPrompt(planContent: string, scenarioContent: string, issueContext: string): string` — constructs the validation prompt instructing the agent to compare plan vs scenarios and output a JSON `ValidationResult`
  - Implement `parseValidationResult(agentOutput: string): ValidationResult` — extracts the JSON validation result from the agent's output using `extractJson()` from `core/jsonParser.ts`
  - Implement `runValidationAgent(planContent: string, scenarioContent: string, issueContext: string, logsDir: string, statePath?: string, cwd?: string, issueBody?: string): Promise<AgentResult & { validationResult: ValidationResult }>` — orchestrates the validation agent call
  - The agent uses `runClaudeAgent()` with the model from `getModelForCommand('/validate_plan_scenarios')` and effort from `getEffortForCommand('/validate_plan_scenarios')`
- Write unit tests in `adws/agents/__tests__/validationAgent.test.ts`:
  - Test `findScenarioFiles` with mock filesystem
  - Test `buildValidationPrompt` output structure
  - Test `parseValidationResult` with valid JSON, missing JSON, malformed JSON
  - Test `runValidationAgent` with mocked Claude agent (aligned case, mismatched case)

### Step 5: Create Resolution Agent
- Create `adws/agents/resolutionAgent.ts`:
  - Define `ResolutionResult` interface:
    ```typescript
    interface ResolutionResult {
      updatedPlan?: string;
      updatedScenarios?: Array<{ path: string; content: string }>;
      reasoning: string;
      decision: 'plan_updated' | 'scenarios_updated' | 'both_updated';
    }
    ```
  - Implement `buildResolutionPrompt(issueBody: string, planContent: string, scenarioContent: string, mismatches: MismatchItem[]): string` — constructs the resolution prompt emphasizing the GitHub issue as sole source of truth
  - Implement `parseResolutionResult(agentOutput: string): ResolutionResult` — extracts the JSON resolution result from the agent's output
  - Implement `runResolutionAgent(issueBody: string, planContent: string, scenarioContent: string, mismatches: MismatchItem[], logsDir: string, statePath?: string, cwd?: string, issueBody?: string): Promise<AgentResult & { resolutionResult: ResolutionResult }>` — orchestrates the resolution agent call
  - The agent uses `runClaudeAgent()` with the model from `getModelForCommand('/resolve_plan_scenarios')` and effort from `getEffortForCommand('/resolve_plan_scenarios')`
- Write unit tests in `adws/agents/__tests__/resolutionAgent.test.ts`:
  - Test `buildResolutionPrompt` output structure (ensure issue body is prominent, labeled as "source of truth")
  - Test `parseResolutionResult` with valid JSON, missing fields, malformed JSON
  - Test `runResolutionAgent` with mocked Claude agent

### Step 6: Create Plan Validation Phase
- Create `adws/phases/planValidationPhase.ts`:
  - Implement `executePlanValidationPhase(config: WorkflowConfig): Promise<{ costUsd: number; modelUsage: ModelUsageMap }>` following the pattern established by other phases
  - Phase flow:
    1. Read plan content via `readPlanFile(issueNumber, worktreePath)`
    2. Discover scenario files via `findScenarioFiles(issueNumber, worktreePath)`
    3. If no scenarios found, log info and return early (graceful skip when Scenario Planner has not run)
    4. Read scenario contents via `readScenarioContents()`
    5. Format issue context from `config.issue`
    6. Post `plan_validating` stage comment
    7. Run Validation Agent
    8. If aligned: post `plan_validated` stage comment, log success, return
    9. If mismatched: enter resolve loop (bounded by `MAX_VALIDATION_RETRY_ATTEMPTS`):
       a. Post `plan_resolving` stage comment
       b. Run Resolution Agent with mismatches, plan, scenarios, and issue body
       c. Write updated plan file to disk (if `updatedPlan` present)
       d. Write updated scenario files to disk (if `updatedScenarios` present)
       e. Log resolution reasoning to ADW state
       f. Post `plan_resolved` stage comment
       g. Re-run Validation Agent
       h. If aligned: post `plan_validated`, break loop
       i. If still mismatched and retries exhausted: post `plan_validation_failed`, throw error
    10. Commit updated artifacts via `runCommitAgent()` if any changes were made
  - Track and accumulate cost/modelUsage across all agent calls in the loop
  - Initialize agent state paths for each agent invocation

### Step 7: Write Plan Validation Phase Tests
- Create `adws/phases/__tests__/planValidationPhase.test.ts`:
  - Follow the pattern from `testPhase.test.ts` (mock core, agents, github modules)
  - Use `makeRepoContext()` from the shared helpers
  - Test cases:
    - **Aligned on first check**: validation passes, no resolution needed, returns cost
    - **No scenarios found**: graceful skip, no agent calls, returns zero cost
    - **Mismatch resolved in one attempt**: validation fails, resolution runs, re-validation passes
    - **Mismatch resolved after multiple attempts**: validate-resolve loop runs multiple times
    - **Max retries exhausted**: throws error after `MAX_VALIDATION_RETRY_ATTEMPTS` resolution attempts
    - **Stage comments posted correctly**: verify `postIssueStageComment` called with correct stages
    - **State logging**: verify `AgentStateManager.appendLog` called with resolution reasoning
    - **Cost accumulation**: verify costs accumulate across validation + resolution agent calls
    - **Model usage merging**: verify model usage maps merge correctly

### Step 8: Export New Agents and Phase
- In `adws/agents/index.ts`:
  - Add exports for `runValidationAgent`, `ValidationResult`, `MismatchItem`, `findScenarioFiles`, `readScenarioContents`
  - Add exports for `runResolutionAgent`, `ResolutionResult`
- In `adws/phases/index.ts`:
  - Add export for `executePlanValidationPhase`
- In `adws/workflowPhases.ts`:
  - Add re-export for `executePlanValidationPhase`

### Step 9: Integrate into Orchestrators
- In each orchestrator that runs plan then build, add the plan validation phase between them:
  - `adws/adwPlanBuild.tsx` — add `executePlanValidationPhase(config)` after `executePlanPhase()` and before `executeBuildPhase()`, accumulate cost/modelUsage
  - `adws/adwPlanBuildTest.tsx` — same insertion point
  - `adws/adwPlanBuildReview.tsx` — same insertion point
  - `adws/adwPlanBuildDocument.tsx` — same insertion point
  - `adws/adwPlanBuildTestReview.tsx` — same insertion point
  - `adws/adwSdlc.tsx` — same insertion point
- Follow the established pattern for cost accumulation:
  ```typescript
  const validationResult = await executePlanValidationPhase(config);
  totalCostUsd += validationResult.costUsd;
  totalModelUsage = mergeModelUsageMaps(totalModelUsage, validationResult.modelUsage);
  persistTokenCounts(config.orchestratorStatePath, totalCostUsd, totalModelUsage);
  if (RUNNING_TOKENS) config.ctx.runningTokenTotal = computeDisplayTokens(totalModelUsage);
  ```

### Step 10: Update README Documentation
- In `adws/README.md`:
  - Add the plan validation phase to the workflow step descriptions for each orchestrator that includes it
  - Add a brief section documenting the Validation Agent and Resolution Agent under Technical Details > Agents
  - Update the workflow phase listing under Phases

### Step 11: Run Validation Commands
- Run `bun run lint` to check for lint errors
- Run `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` to check for type errors
- Run `bun run test` to validate all tests pass with zero regressions

## Testing Strategy
### Unit Tests
- **validationAgent.test.ts**: Test scenario file discovery (`findScenarioFiles`), prompt construction (`buildValidationPrompt`), result parsing (`parseValidationResult`), and the full agent runner (`runValidationAgent`) with mocked Claude CLI
- **resolutionAgent.test.ts**: Test prompt construction (`buildResolutionPrompt` — verify issue body is prominent and labeled as source of truth), result parsing (`parseResolutionResult`), and the full agent runner (`runResolutionAgent`) with mocked Claude CLI
- **planValidationPhase.test.ts**: Test the full phase lifecycle including aligned path, resolution path, retry loop, max retry exhaustion, graceful skip when no scenarios exist, stage comment posting, state logging, and cost accumulation

### Edge Cases
- No scenario files found (Scenario Planner Agent hasn't run yet) — graceful skip
- Plan file missing or empty — should throw a clear error
- Validation agent returns malformed JSON — should handle gracefully with a fallback or error
- Resolution agent fails — should propagate error to orchestrator
- Resolution produces no changes (empty updatedPlan and updatedScenarios) — should still re-validate
- Maximum validation retry attempts exceeded — should throw descriptive error with context about remaining mismatches
- Scenarios tagged with wrong issue number — should not be picked up by `findScenarioFiles`
- Multiple scenario files for the same issue — all should be included in validation

## Acceptance Criteria
- Validation correctly identifies plan-scenario mismatches by comparing behaviors described in both artifacts
- Resolution uses the GitHub issue body as the sole arbiter of truth, not defaulting to the plan or scenarios
- Post-resolution validation confirms alignment before the build phase proceeds
- Resolution decisions and reasoning are logged to ADW state via `AgentStateManager.appendLog()`
- The phase integrates cleanly between planning and build in all six orchestrators (`adwPlanBuild`, `adwPlanBuildTest`, `adwPlanBuildReview`, `adwPlanBuildDocument`, `adwPlanBuildTestReview`, `adwSdlc`)
- When no scenario files are found, the phase skips gracefully without blocking the workflow
- The validate-resolve loop is bounded by `MAX_VALIDATION_RETRY_ATTEMPTS` to prevent infinite loops
- All existing tests continue to pass with zero regressions
- Type checking passes with `bunx tsc --noEmit`
- Lint passes with `bun run lint`

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Root-level type check
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific type check
- `bun run test` — Run all tests to validate the feature works with zero regressions

## Notes
- This feature depends on #164 (BDD scenario configuration and tagging conventions) and #165 (Scenario Planner Agent). The `findScenarioFiles()` function must align with whatever tagging convention #164 establishes (expected: `@adw-{issueNumber}` tag in `.feature` files). If those features have not been merged yet, the validation phase will gracefully skip (no scenarios found).
- The validation and resolution agents use free-form `runClaudeAgent()` prompts rather than slash commands, since the prompts are dynamically constructed from the plan, scenarios, and issue context. The `/validate_plan_scenarios` and `/resolve_plan_scenarios` entries in the SlashCommand type and config maps exist for model/effort routing consistency but are not backed by `.claude/commands/` files.
- The `guidelines/coding_guidelines.md` must be followed: strict TypeScript, functional patterns, immutability, files under 300 lines, meaningful error messages, and unit tests for all components.
- Resolution agent output is unbounded in principle — the implementation should truncate the `reasoning` field when logging to state to avoid bloating state files (use the 1000-char truncation pattern from existing agents).
