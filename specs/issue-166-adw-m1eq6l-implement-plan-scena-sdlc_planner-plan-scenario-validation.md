# Feature: Plan-Scenario Validation and Resolution

## Metadata
issueNumber: `166`
adwId: `m1eq6l-implement-plan-scena`
issueJson: `{"number":166,"title":"Implement Plan-Scenario Validation and Resolution: align plan against BDD scenarios using GitHub issue as arbiter","body":"## Context\n\nAfter the Plan Agent and Scenario Planner Agent have both completed, a validation step is needed to ensure the implementation plan and the BDD scenarios are aligned. If they diverge, a Resolution Agent reconciles them using the GitHub issue as the sole source of truth.\n\n## Depends on\n\n- #164 (BDD scenario configuration and tagging conventions)\n- #165 (Scenario Planner Agent)\n\n## Requirements\n\n### Validation Agent\n\n- Reads the implementation plan (spec file)\n- Reads all scenarios tagged \\`@adw-{issueNumber}\\`\n- Identifies mismatches: plan describes behaviour X but scenarios test Y, or plan commits to something not covered by scenarios\n- If aligned: passes through without intervention\n- If mismatched: triggers the Resolution Agent\n\n### Resolution Agent\n\n- Takes as input: the GitHub issue, the plan, the scenarios, and the identified mismatches\n- **The GitHub issue is the sole arbiter of truth** — not the plan, not the scenarios\n- May output: an updated plan, updated scenarios, or both\n- Documents the resolution decision and the reasoning\n- After resolution, validation runs again to confirm alignment before proceeding\n\n### Integration\n\n- New phase: \\`adws/phases/planValidationPhase.ts\\`\n- Runs after both the Plan Agent and Scenario Planner Agent complete (sequential after the parallel pair)\n- Runs before the build phase\n\n## Acceptance Criteria\n\n- Validation correctly identifies plan-scenario mismatches\n- Resolution uses the GitHub issue as truth, not the plan or scenarios\n- Post-resolution validation confirms alignment before build proceeds\n- Resolution decisions are logged to ADW state\n- The phase integrates cleanly between planning and build in all relevant orchestrators","state":"OPEN","author":"paysdoc","labels":["enhancement"],"createdAt":"2026-03-13T07:02:01Z","comments":[],"actionableComment":null}`

## Feature Description
This feature adds a validation and resolution step between the planning/scenario-planning phases and the build phase. After both the Plan Agent (which produces the implementation spec) and the Scenario Planner Agent (which generates BDD scenarios tagged `@adw-{issueNumber}`) complete, a Validation Agent compares the two artifacts. If they are aligned, the workflow proceeds. If mismatches are found (e.g., the plan describes behaviour not covered by scenarios, or scenarios test something the plan doesn't commit to), a Resolution Agent reconciles them using the GitHub issue as the sole source of truth. Post-resolution, validation re-runs to confirm alignment before the build phase begins.

## User Story
As an ADW workflow operator
I want the plan and BDD scenarios to be validated for alignment before implementation begins
So that the build phase implements exactly what was specified in the issue without plan-scenario drift

## Problem Statement
When the Plan Agent and Scenario Planner Agent run independently (potentially in parallel), their outputs can diverge. The plan might describe behaviour that no scenario tests, or scenarios might test something the plan doesn't commit to. Without a validation step, this drift goes undetected until review or testing, wasting implementation effort.

## Solution Statement
Introduce a `planValidationPhase.ts` that runs a Validation Agent to compare the plan spec against BDD scenarios. If mismatches are detected, a Resolution Agent reconciles them against the GitHub issue (the single source of truth). The phase loops: validate → resolve → re-validate until alignment is confirmed or a maximum retry limit is reached. This runs after planning and before building, preventing drift from propagating.

## Relevant Files
Use these files to implement the feature:

- `adws/phases/planPhase.ts` — Existing plan phase pattern to follow for the new validation phase structure
- `adws/phases/kpiPhase.ts` — Simpler phase pattern reference (agent init, state tracking, error handling)
- `adws/phases/buildPhase.ts` — Build phase that the new phase runs before; useful for understanding phase composition
- `adws/phases/index.ts` — Phase barrel exports; must be updated with new exports
- `adws/phases/phaseCommentHelpers.ts` — Helper for posting stage comments via RepoContext
- `adws/phases/__tests__/planPhase.test.ts` — Reference for phase test patterns (mocking, makeConfig, makeRepoContext)
- `adws/phases/__tests__/helpers/makeRepoContext.ts` — Test helper for mock RepoContext
- `adws/workflowPhases.ts` — Top-level barrel re-exporting all phases; must be updated
- `adws/agents/planAgent.ts` — Plan agent pattern for reading plan files and running Claude agents
- `adws/agents/claudeAgent.ts` — Base agent runner functions (`runClaudeAgent`, `runClaudeAgentWithCommand`)
- `adws/agents/index.ts` — Agent barrel exports; must be updated with new agent exports
- `adws/types/agentTypes.ts` — `AgentIdentifier` union type; must add new identifiers
- `adws/types/workflowTypes.ts` — `WorkflowStage` union type; must add new stages
- `adws/core/constants.ts` — Orchestrator ID constants (no changes needed for phase-only additions)
- `adws/core/config.ts` — `SLASH_COMMAND_MODEL_MAP` and `SLASH_COMMAND_EFFORT_MAP`; not needed if using `runClaudeAgent` directly
- `adws/core/agentState.ts` — State management for agent state directories
- `adws/phases/workflowInit.ts` — `WorkflowConfig` interface; reference for phase config shape
- `adws/adwSdlc.tsx` — Full SDLC orchestrator; must integrate the new phase between plan and build
- `adws/adwPlanBuild.tsx` — Plan+Build orchestrator; must integrate the new phase
- `adws/adwPlanBuildTest.tsx` — Plan+Build+Test orchestrator; must integrate the new phase
- `adws/adwPlanBuildReview.tsx` — Plan+Build+Review orchestrator; must integrate the new phase
- `adws/adwPlanBuildDocument.tsx` — Plan+Build+Document orchestrator; must integrate the new phase
- `adws/adwPlanBuildTestReview.tsx` — Plan+Build+Test+Review orchestrator; must integrate the new phase
- `guidelines/coding_guidelines.md` — Must follow these coding guidelines

### New Files
- `adws/agents/validationAgent.ts` — Validation and resolution agent functions
- `adws/agents/__tests__/validationAgent.test.ts` — Tests for validation agent
- `adws/phases/planValidationPhase.ts` — Plan validation phase implementation
- `adws/phases/__tests__/planValidationPhase.test.ts` — Tests for plan validation phase

## Implementation Plan
### Phase 1: Foundation
Add the type system extensions needed for the new agents and workflow stages:
- Add `'validation-agent'` and `'resolution-agent'` to the `AgentIdentifier` union in `agentTypes.ts`
- Add validation workflow stages (`'plan_validating'`, `'plan_validated'`, `'plan_resolving'`, `'plan_resolution_failed'`) to the `WorkflowStage` union in `workflowTypes.ts`

### Phase 2: Core Implementation
Build the validation and resolution agent functions and the phase:
- Create `validationAgent.ts` with functions for reading plan files, discovering BDD scenario files tagged `@adw-{issueNumber}`, comparing them, and running validation/resolution via Claude agents
- Create `planValidationPhase.ts` with the `executePlanValidationPhase()` function that orchestrates the validate-resolve-revalidate loop
- The validation agent uses `runClaudeAgent()` with a structured prompt to compare plan vs scenarios and return a JSON result indicating alignment or listing mismatches
- The resolution agent uses `runClaudeAgent()` with a prompt containing the issue, plan, scenarios, and mismatches, and outputs updated plan/scenario content

### Phase 3: Integration
Wire the new phase into existing orchestrators:
- Export the new phase from `phases/index.ts` and `workflowPhases.ts`
- Export the new agent functions from `agents/index.ts`
- Insert `executePlanValidationPhase(config)` between `executePlanPhase(config)` and `executeBuildPhase(config)` in all relevant orchestrators

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Extend type system with new identifiers and stages
- In `adws/types/agentTypes.ts`, add `'validation-agent'` and `'resolution-agent'` to the `AgentIdentifier` union type
- In `adws/types/workflowTypes.ts`, add the following to the `WorkflowStage` union:
  - `'plan_validating'` — Validation agent is running
  - `'plan_validated'` — Plan and scenarios are aligned
  - `'plan_resolving'` — Resolution agent is reconciling mismatches
  - `'plan_resolution_failed'` — Resolution could not align plan and scenarios

### Step 2: Create the validation agent module
- Create `adws/agents/validationAgent.ts` with:
  - `findScenarioFiles(issueNumber: number, worktreePath: string): string[]` — Discovers BDD `.feature` files containing the `@adw-{issueNumber}` tag by scanning the worktree
  - `readScenarioFiles(filePaths: string[]): string` — Reads and concatenates scenario file contents
  - `ValidationResult` interface — `{ aligned: boolean; mismatches: string[]; reasoning: string }`
  - `ResolutionResult` interface — `{ updatedPlan?: string; updatedScenarios?: Array<{ path: string; content: string }>; reasoning: string; decision: string }`
  - `runValidationAgent(planContent: string, scenarioContent: string, logsDir: string, statePath?: string, cwd?: string): Promise<AgentResult & { validation?: ValidationResult }>` — Runs a Claude agent with a structured prompt comparing plan vs scenarios, parses JSON from output
  - `runResolutionAgent(issueBody: string, planContent: string, scenarioContent: string, mismatches: string[], logsDir: string, statePath?: string, cwd?: string): Promise<AgentResult & { resolution?: ResolutionResult }>` — Runs a Claude agent to reconcile mismatches using issue as truth
  - Both agent functions use `runClaudeAgent()` directly (not slash commands) with model `'sonnet'` and effort `'high'`
- Export all types and functions from `adws/agents/index.ts`

### Step 3: Create tests for the validation agent
- Create `adws/agents/__tests__/validationAgent.test.ts` with tests for:
  - `findScenarioFiles` — finds `.feature` files with correct tag, ignores files without the tag
  - `readScenarioFiles` — concatenates file contents with separators
  - `runValidationAgent` — mock `runClaudeAgent`, verify prompt contains plan and scenario content, parse aligned result, parse mismatched result
  - `runResolutionAgent` — mock `runClaudeAgent`, verify prompt contains issue body, plan, scenarios, and mismatches, parse resolution result

### Step 4: Create the plan validation phase
- Create `adws/phases/planValidationPhase.ts` with:
  - `MAX_VALIDATION_RETRIES = 2` — Maximum resolution attempts before failing
  - `executePlanValidationPhase(config: WorkflowConfig): Promise<{ costUsd: number; modelUsage: ModelUsageMap }>` that:
    1. Reads the plan file content using `getPlanFilePath()` and `fs.readFileSync()`
    2. Discovers and reads scenario files using `findScenarioFiles()` and `readScenarioFiles()`
    3. If no scenario files found, logs info and returns early (no validation needed)
    4. Runs the validation agent — posts `'plan_validating'` stage comment
    5. If aligned: posts `'plan_validated'` stage comment and returns
    6. If mismatched: enters resolve loop (up to `MAX_VALIDATION_RETRIES`):
       - Posts `'plan_resolving'` stage comment
       - Runs the resolution agent with the issue body, plan, scenarios, and mismatches
       - Applies resolution: writes updated plan/scenario files to disk
       - Re-runs validation to check alignment
       - If now aligned: posts `'plan_validated'` and returns
    7. If max retries exceeded without alignment: posts `'plan_resolution_failed'` and throws
    8. Tracks cost and model usage across all agent invocations
    9. Logs resolution decisions to ADW state via `AgentStateManager.appendLog()`
- Follow the patterns from `kpiPhase.ts` for state management and from `planPhase.ts` for cost tracking

### Step 5: Create tests for the plan validation phase
- Create `adws/phases/__tests__/planValidationPhase.test.ts` following the pattern from `planPhase.test.ts`:
  - Mock `../../core`, `../../agents` (including new validation agent functions)
  - Use `makeConfig()` and `makeRepoContext()` helpers
  - Test cases:
    - Returns early with zero cost when no scenario files found
    - Runs validation and returns when plan/scenarios are aligned
    - Runs resolution when mismatches detected, re-validates, and returns on success
    - Throws after max retries when resolution cannot achieve alignment
    - Writes updated plan file when resolution provides one
    - Writes updated scenario files when resolution provides them
    - Posts correct stage comments at each step
    - Accumulates cost and model usage across validation and resolution runs
    - Logs resolution decisions to agent state

### Step 6: Update barrel exports
- In `adws/phases/index.ts`, add: `export { executePlanValidationPhase, MAX_VALIDATION_RETRIES } from './planValidationPhase';`
- In `adws/workflowPhases.ts`, add `executePlanValidationPhase` and `MAX_VALIDATION_RETRIES` to the re-export from `'./phases'`

### Step 7: Integrate into orchestrators
- In each orchestrator that has a plan phase followed by a build phase, insert the plan validation phase between them:
  - `adws/adwPlanBuild.tsx` — Add `executePlanValidationPhase` import and call after `executePlanPhase`, before `executeBuildPhase`, with cost/model usage accumulation
  - `adws/adwPlanBuildTest.tsx` — Same integration pattern
  - `adws/adwPlanBuildReview.tsx` — Same integration pattern
  - `adws/adwPlanBuildDocument.tsx` — Same integration pattern
  - `adws/adwPlanBuildTestReview.tsx` — Same integration pattern
  - `adws/adwSdlc.tsx` — Same integration pattern
- Integration pattern for each orchestrator (insert after `executePlanPhase` block):
  ```typescript
  config.totalModelUsage = totalModelUsage;
  const validationResult = await executePlanValidationPhase(config);
  totalCostUsd += validationResult.costUsd;
  totalModelUsage = mergeModelUsageMaps(totalModelUsage, validationResult.modelUsage);
  persistTokenCounts(config.orchestratorStatePath, totalCostUsd, totalModelUsage);
  if (RUNNING_TOKENS) config.ctx.runningTokenTotal = computeDisplayTokens(totalModelUsage);
  ```

### Step 8: Run validation commands
- Run the validation commands listed below to ensure the implementation is correct with zero regressions.

## Testing Strategy
### Unit Tests
- **validationAgent.test.ts**: Tests for `findScenarioFiles` (file discovery with tag matching), `readScenarioFiles` (content concatenation), `runValidationAgent` (prompt construction, JSON parsing from output), `runResolutionAgent` (prompt construction, resolution output parsing)
- **planValidationPhase.test.ts**: Tests for the full phase lifecycle — early return on no scenarios, aligned pass-through, mismatch resolution loop, max retry failure, file writing on resolution, cost accumulation, state logging, stage comment posting

### Edge Cases
- No scenario files exist for the issue (early return, no validation needed)
- Plan file cannot be read (throws meaningful error)
- Validation agent returns malformed JSON (handles gracefully, treats as mismatched)
- Resolution agent fails (error propagates with context)
- Resolution produces an updated plan but no updated scenarios (only writes plan)
- Resolution produces updated scenarios but no updated plan (only writes scenarios)
- Resolution achieves alignment on first retry (exits loop early)
- Resolution never achieves alignment (throws after MAX_VALIDATION_RETRIES)
- Scenario files are in nested directories within the worktree

## Acceptance Criteria
- Validation correctly identifies plan-scenario mismatches by comparing plan content against BDD scenario content
- Resolution uses the GitHub issue body as the sole source of truth when reconciling
- Post-resolution validation re-runs and confirms alignment before the build phase proceeds
- Resolution decisions (reasoning, changes made) are logged to ADW state via `AgentStateManager.appendLog()`
- The phase integrates cleanly between planning and build in all six orchestrators
- All existing tests continue to pass (zero regressions)
- New tests cover the validation agent, resolution agent, and phase lifecycle
- When no BDD scenario files exist for the issue, the phase returns early without blocking

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Run TypeScript type checker on root config
- `bunx tsc --noEmit -p adws/tsconfig.json` — Run TypeScript type checker on adws config
- `bun run test` — Run full test suite to validate zero regressions

## Notes
- This feature depends on #164 (BDD scenario configuration and tagging conventions) and #165 (Scenario Planner Agent). The implementation assumes those are complete and that `.feature` files tagged with `@adw-{issueNumber}` exist in the worktree after scenario planning.
- The validation and resolution agents use `runClaudeAgent()` directly rather than slash commands, since their prompts are constructed programmatically from the plan/scenario content and don't need a separate `.md` template.
- The validation agent should use model `'sonnet'` (fast, structured comparison) and the resolution agent should use model `'opus'` (complex reasoning for reconciliation).
- `guidelines/coding_guidelines.md` must be strictly followed: files under 300 lines, immutability, type safety, pure functions, explicit error handling.
- The phase is designed to be non-blocking when no scenarios exist (returns early with zero cost), making it safe to add to all orchestrators regardless of whether the target project uses BDD scenarios.
