# Feature: Single-pass alignment command + phase (replaces plan validation loop)

## Metadata
issueNumber: `305`
adwId: `a1vf0g-single-pass-alignmen`
issueJson: `{"number":305,"title":"Single-pass alignment command + phase (replaces plan validation loop)","body":"## Parent PRD\n\n`specs/prd/tdd-bdd-integration.md`\n\n## What to build\n\nReplace the multi-round plan validation loop (validate → resolve → re-validate, up to MAX_VALIDATION_RETRY_ATTEMPTS) with a single-pass alignment step.\n\nCreate a new `/align_plan_scenarios` command/skill and a corresponding `executeAlignmentPhase` function. After the parallel plan + scenario phase completes, one agent reads both the plan and the `.feature` files tagged `@adw-{issueNumber}`, identifies conflicts between them, and resolves them in a single pass. The GitHub issue remains the source of truth for conflict resolution.\n\nNo retry loop. If the agent cannot resolve a conflict, it flags it as a warning in the plan for the build agent.\n\nSee PRD section: \"Single-pass alignment (replaces plan validation)\" for full details.\n\n## Acceptance criteria\n\n- [ ] New `/align_plan_scenarios` command or skill exists\n- [ ] New `executeAlignmentPhase` function exists in `adws/phases/`\n- [ ] The alignment phase reads both plan and scenario files in a single agent invocation\n- [ ] Conflicts are resolved using the GitHub issue as source of truth\n- [ ] Unresolvable conflicts are flagged as warnings in the plan (not thrown as errors)\n- [ ] No retry loop — single pass only\n- [ ] The phase produces `PhaseCostRecord` entries consistent with existing cost tracking\n- [ ] Existing BDD regression scenarios continue to pass\n\n## Blocked by\n\nNone - can start immediately\n\n## User stories addressed\n\n- User story 4\n- User story 12","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-25T13:49:02Z","comments":[],"actionableComment":null}`

## Feature Description
Replace the multi-round plan validation loop (`executePlanValidationPhase` — validate → resolve → re-validate, up to `MAX_VALIDATION_RETRY_ATTEMPTS`) with a single-pass alignment step. A new `/align_plan_scenarios` slash command and a corresponding `executeAlignmentPhase` function read both the implementation plan and BDD `.feature` files tagged `@adw-{issueNumber}`, identify conflicts between them, resolve them using the GitHub issue as the sole source of truth, and flag unresolvable conflicts as inline warnings in the plan. No retry loop — single pass only. This simplifies the workflow, reduces token usage, and eliminates the multi-agent coordination overhead of the old loop.

## User Story
As an ADW workflow operator
I want plan-scenario alignment to happen in a single pass instead of a multi-round validation loop
So that the workflow is faster, cheaper, and never blocks on unresolvable plan-scenario conflicts

## Problem Statement
The current plan validation phase uses a multi-round loop (`validation → resolution → re-validation`) up to `MAX_VALIDATION_RETRY_ATTEMPTS` (default 3). This is expensive (multiple agent invocations), fragile (can exhaust retries and throw an error that halts the workflow), and overly complex for its purpose. Most conflicts can be resolved in a single pass when the agent has access to the GitHub issue as the source of truth.

## Solution Statement
Replace the multi-round loop with a single-pass alignment agent that:
1. Reads the plan file and all `.feature` files tagged `@adw-{issueNumber}` in one invocation
2. Identifies conflicts between plan behaviours and scenario coverage
3. Resolves conflicts using the GitHub issue body as the sole arbiter
4. Flags unresolvable conflicts as inline `<!-- ADW-WARNING: -->` comments in the plan
5. Never throws — the workflow always continues, with warnings visible to the build agent

## Relevant Files
Use these files to implement the feature:

- `adws/phases/alignmentPhase.ts` — **New file**: the single-pass alignment phase implementation
- `adws/agents/alignmentAgent.ts` — **New file**: alignment agent (thin wrapper calling `/align_plan_scenarios` command)
- `.claude/commands/align_plan_scenarios.md` — **New file**: slash command prompt for the alignment agent
- `adws/types/workflowTypes.ts` — Add `plan_aligning` and `plan_aligned` workflow stages
- `adws/types/agentTypes.ts` — Add `alignment-agent` to `AgentIdentifier` union
- `adws/types/issueTypes.ts` — Add `/align_plan_scenarios` to `SlashCommand` union
- `adws/core/modelRouting.ts` — Add `/align_plan_scenarios` to all four routing maps (model, model_fast, effort, effort_fast)
- `adws/core/workflowCommentParsing.ts` — Add `plan_aligning` to `STAGE_ORDER` and `STAGE_HEADER_MAP`
- `adws/github/workflowCommentsIssue.ts` — Add `formatPlanAligningComment` and `formatPlanAlignedComment` formatters and wire into `formatWorkflowComment` switch
- `adws/phases/index.ts` — Export `executeAlignmentPhase`
- `adws/agents/index.ts` — Export `runAlignmentAgent`, `parseAlignmentResult`, `AlignmentResult`
- `adws/workflowPhases.ts` — Re-export `executeAlignmentPhase`
- `adws/adwSdlc.tsx` — Replace `executePlanValidationPhase` with `executeAlignmentPhase` after parallel plan+scenario phase
- `adws/adwPlanBuildReview.tsx` — Replace `executePlanValidationPhase` with `executeAlignmentPhase`
- `adws/adwPlanBuildTestReview.tsx` — Replace `executePlanValidationPhase` with `executeAlignmentPhase`
- `adws/phases/planValidationPhase.ts` — Reference only: existing multi-round validation pattern to replace
- `adws/agents/validationAgent.ts` — Reference only: reuse `findScenarioFiles` utility; re-export from `alignmentAgent.ts`
- `adws/agents/resolutionAgent.ts` — Reference only: existing resolution pattern
- `guidelines/coding_guidelines.md` — Coding guidelines to follow

### New Files
- `adws/phases/alignmentPhase.ts` — Single-pass alignment phase
- `adws/agents/alignmentAgent.ts` — Alignment agent wrapper
- `.claude/commands/align_plan_scenarios.md` — Slash command prompt

## Implementation Plan
### Phase 1: Foundation
Add the alignment-related type definitions and routing configuration to the shared type system, model routing maps, stage ordering, and comment formatting. This establishes the infrastructure that the alignment agent and phase will depend on.

### Phase 2: Core Implementation
Create the `/align_plan_scenarios` slash command, the `alignmentAgent.ts` thin wrapper, and the `alignmentPhase.ts` phase implementation. The agent wraps the slash command and parses JSON output. The phase orchestrates the agent call with recovery support, cost tracking, stage comments, and artifact commits.

### Phase 3: Integration
Wire the alignment phase into the three orchestrators that use scenario phases (`adwSdlc`, `adwPlanBuildReview`, `adwPlanBuildTestReview`), replacing any usage of the old `executePlanValidationPhase`. Export the new phase and agent from the barrel files.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1: Add alignment types to the type system
- In `adws/types/issueTypes.ts`: add `'/align_plan_scenarios'` to the `SlashCommand` union type
- In `adws/types/agentTypes.ts`: add `'alignment-agent'` to the `AgentIdentifier` union type
- In `adws/types/workflowTypes.ts`: add `'plan_aligning'` and `'plan_aligned'` to the `WorkflowStage` union type

### Step 2: Add model and effort routing for the alignment command
- In `adws/core/modelRouting.ts`: add `/align_plan_scenarios` to all four maps:
  - `SLASH_COMMAND_MODEL_MAP`: `opus` (complex reasoning)
  - `SLASH_COMMAND_MODEL_MAP_FAST`: `sonnet` (cost-optimized downgrade)
  - `SLASH_COMMAND_EFFORT_MAP`: `'high'`
  - `SLASH_COMMAND_EFFORT_MAP_FAST`: `'medium'`

### Step 3: Add alignment stages to comment parsing
- In `adws/core/workflowCommentParsing.ts`:
  - Add `'plan_aligning'` to `STAGE_ORDER` array (after `'plan_committing'` or `'plan_validating'`, before `'implementing'`)
  - Add alignment headers to `STAGE_HEADER_MAP`:
    - `':arrows_counterclockwise: Aligning Plan and Scenarios'` → `'plan_aligning'`

### Step 4: Add alignment comment formatters
- In `adws/github/workflowCommentsIssue.ts`:
  - Add `formatPlanAligningComment(ctx)` function
  - Add `formatPlanAlignedComment(ctx)` function
  - Wire both into the `formatWorkflowComment` switch statement for stages `'plan_aligning'` and `'plan_aligned'`

### Step 5: Create the `/align_plan_scenarios` slash command
- Create `.claude/commands/align_plan_scenarios.md` with `target: false` frontmatter
- Command takes 5 positional args: `$1` adwId, `$2` issueNumber, `$3` planFilePath, `$4` scenarioGlob, `$5` issueJson
- Instructions:
  1. Parse issue JSON from `$5` (sole source of truth)
  2. Read plan file at `$3` (skip with aligned=true if missing)
  3. Discover `.feature` files tagged `@adw-$2` recursively from `$4` (skip with aligned=true if none)
  4. Identify conflicts between plan behaviours and scenario coverage
  5. Resolve conflicts using GitHub issue body; for unresolvable, append `<!-- ADW-WARNING: -->` inline comments to the plan
  6. Write all updated files directly to disk
  7. Return raw JSON: `{"aligned": boolean, "warnings": string[], "changes": string[], "summary": string}`

### Step 6: Create the alignment agent
- Create `adws/agents/alignmentAgent.ts`:
  - Define `AlignmentResult` interface: `{ aligned: boolean; warnings: string[]; changes: string[]; summary: string }`
  - Implement `parseAlignmentResult(agentOutput)`: extract JSON, gracefully handle parse failures (return aligned=true with warning)
  - Implement `runAlignmentAgent(adwId, issueNumber, planFilePath, worktreePath, issueJson, logsDir, statePath?, cwd?)`:
    - Call `runClaudeAgentWithCommand` with `/align_plan_scenarios` and formatted args
    - Use `getModelForCommand`/`getEffortForCommand` for model/effort selection
    - Parse output with `parseAlignmentResult`
    - Return `AgentResult & { alignmentResult: AlignmentResult }`
  - Re-export `findScenarioFiles` from `validationAgent.ts` for phase convenience

### Step 7: Create the alignment phase
- Create `adws/phases/alignmentPhase.ts`:
  - Implement `executeAlignmentPhase(config: WorkflowConfig)`:
    1. Recovery guard: `shouldExecuteStage('plan_aligning', recoveryState)` — skip if already completed
    2. Verify plan file exists via `readPlanFile`; skip gracefully if missing (return empty cost records)
    3. Discover scenario files via `findScenarioFiles`; skip gracefully if none found
    4. Post `plan_aligning` stage comment
    5. Initialize alignment agent state via `AgentStateManager`
    6. Call `runAlignmentAgent` (single invocation, no loop)
    7. Accumulate cost and model usage
    8. Update agent state with results
    9. Log changes and warnings
    10. Post `plan_aligned` stage comment
    11. Commit updated artifacts if changes were made (via `runCommitAgent`)
    12. Return `{ costUsd, modelUsage, phaseCostRecords }` using `createPhaseCostRecords`

### Step 8: Export alignment phase and agent from barrel files
- In `adws/agents/index.ts`: add exports for `runAlignmentAgent`, `parseAlignmentResult`, `AlignmentResult`
- In `adws/phases/index.ts`: add export for `executeAlignmentPhase`
- In `adws/workflowPhases.ts`: add re-export for `executeAlignmentPhase`

### Step 9: Integrate alignment phase into orchestrators
- In `adws/adwSdlc.tsx`:
  - Import `executeAlignmentPhase` (replacing `executePlanValidationPhase` if still referenced)
  - After `runPhasesParallel(config, tracker, [executePlanPhase, executeScenarioPhase])`, add `runPhase(config, tracker, executeAlignmentPhase)` before `executeBuildPhase`
- In `adws/adwPlanBuildReview.tsx`: same pattern — alignment after parallel plan+scenario, before build
- In `adws/adwPlanBuildTestReview.tsx`: same pattern

### Step 10: Run validation commands
- Run `bun run lint` to check for code quality issues
- Run `bunx tsc --noEmit` to verify type correctness
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify ADW-specific types
- Run `bun run build` to verify no build errors
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` to verify existing BDD regression scenarios still pass

## Testing Strategy
### Edge Cases
- Plan file does not exist — phase skips gracefully, returns empty cost records
- No scenario files tagged `@adw-{issueNumber}` — phase skips gracefully, returns empty cost records
- Alignment agent returns non-JSON output — `parseAlignmentResult` treats as aligned with a warning logged
- Alignment agent identifies unresolvable conflicts — flagged as inline `<!-- ADW-WARNING: -->` comments in the plan, workflow continues
- Recovery from previous run — `shouldExecuteStage('plan_aligning', recoveryState)` skips if alignment already completed
- All conflicts resolved — `aligned: true`, no warnings, changes logged

## Acceptance Criteria
- [x] New `/align_plan_scenarios` command exists at `.claude/commands/align_plan_scenarios.md`
- [x] New `executeAlignmentPhase` function exists in `adws/phases/alignmentPhase.ts`
- [x] The alignment phase reads both plan and scenario files in a single agent invocation (via `runAlignmentAgent`)
- [x] Conflicts are resolved using the GitHub issue as source of truth (issue JSON passed as `$5` arg)
- [x] Unresolvable conflicts are flagged as `<!-- ADW-WARNING: -->` inline warnings in the plan (not thrown as errors)
- [x] No retry loop — single pass only (no `for` loop, no `MAX_*_ATTEMPTS`)
- [x] The phase produces `PhaseCostRecord` entries consistent with existing cost tracking (via `createPhaseCostRecords`)
- [ ] Existing BDD regression scenarios continue to pass
- [x] `plan_aligning` and `plan_aligned` workflow stages are defined and wired into comment parsing and formatting
- [x] `alignment-agent` is a recognized `AgentIdentifier`
- [x] `/align_plan_scenarios` is in all model/effort routing maps
- [x] All three orchestrators using scenario phases (`adwSdlc`, `adwPlanBuildReview`, `adwPlanBuildTestReview`) use alignment phase after parallel plan+scenario

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Root-level type check
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific type check
- `bun run build` — Build the application to verify no build errors
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run BDD regression scenarios to verify zero regressions

## Notes
- The old `executePlanValidationPhase` and its agents (`validationAgent`, `resolutionAgent`) are retained for backward compatibility but are no longer called by any orchestrator. They can be removed in a future cleanup.
- `findScenarioFiles` is re-exported from `alignmentAgent.ts` so the phase does not need to import from `validationAgent` directly.
- The alignment agent uses `opus` in default mode and `sonnet` in fast mode, with `high`/`medium` effort respectively — consistent with the complexity of conflict resolution.
- The slash command produces raw JSON as its final output (no markdown, no code fences) to enable reliable programmatic parsing.
- Follow `guidelines/coding_guidelines.md`: strict TypeScript, functional style, no decorators, immutability, files under 300 lines.
