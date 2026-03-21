# Feature: Skip scenario writer on Take action resume past plan validation

## Metadata
issueNumber: `254`
adwId: `1vil1v-skip-scenario-writer`
issueJson: `{"number":254,"title":"Skip scenario writer on Take action resume past plan validation","body":"## Problem\n\nWhen a user posts a `## Take action` comment to resume a workflow that has already progressed past the planning phase, the scenario writer reruns unnecessarily. This wastes tokens and time since the scenario writer already ran (or attempted to run) during the original parallel plan+scenario execution.\n\nAdditionally, the `plan_validating` stage — already posted to GitHub comments and defined in `WorkflowStage` — is not tracked in `STAGE_ORDER` or `STAGE_HEADER_MAP`, making it invisible to the recovery system.\n\n## Solution\n\n### 1. Register `plan_validating` in the recovery system\n\n**File:** `adws/core/workflowCommentParsing.ts`\n\n- Add `'plan_validating'` to `STAGE_ORDER` between `'plan_committing'` and `'implementing'`\n- Add `':mag: Validating Plan-Scenario Alignment': 'plan_validating'` to `STAGE_HEADER_MAP`\n\n### 2. Add recovery guard to scenario phase\n\n**File:** `adws/phases/scenarioPhase.ts`\n\n- Destructure `recoveryState` from `config`\n- Add `shouldExecuteStage('plan_validating', recoveryState)` guard at the top\n- If recovery is past that stage, log a skip message and return zero-cost result\n\n### 3. Add recovery guard to plan validation phase\n\n**File:** `adws/phases/planValidationPhase.ts`\n\n- Add `shouldExecuteStage('plan_validating', recoveryState)` guard at the top\n- Same early-return pattern as the scenario phase\n\n## Design decisions\n\n- **Single stage**: Only `plan_validating` is added to `STAGE_ORDER` — the intermediate validation sub-stages (`plan_resolving`, `plan_resolved`, `plan_validation_failed`) remain untracked as they are loop-internal or error terminals\n- **Defensive skip threshold**: The cutoff is `plan_validating`, not `plan_created`. If it's unclear whether the scenario writer completed before the resume, it reruns. Once `plan_validating` is reached, the `Promise.all` has definitively resolved\n- **Phase-internal guards**: Skip logic lives inside the phase functions, not the orchestrators. All three orchestrators (`adwSdlc.tsx`, `adwPlanBuildTestReview.tsx`, `adwPlanBuildReview.tsx`) get the behavior for free\n- **Failed scenario writer stays skipped**: If the scenario writer failed on the first run and the workflow is resumed past `plan_validating`, it is not retried. Plan validation will gracefully skip if no scenario files exist\n- **No orchestrator changes**: The `Promise.all` still fires both calls on resume; they return immediately with zero-cost results\n\n## Files to modify\n\n- `adws/core/workflowCommentParsing.ts`\n- `adws/phases/scenarioPhase.ts`\n- `adws/phases/planValidationPhase.ts`","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-21T20:11:02Z","comments":[],"actionableComment":null}`

## Feature Description
When a workflow is resumed via a `## Take action` comment after having already progressed past the planning phase, both the scenario writer and plan validation phases rerun unnecessarily. The `plan_validating` stage — already posted to GitHub comments and defined in the `WorkflowStage` type — is not tracked in `STAGE_ORDER` or `STAGE_HEADER_MAP`, making it invisible to the recovery system. This feature registers `plan_validating` in the recovery system and adds recovery guards to both the scenario phase and plan validation phase, so they skip cleanly on resume.

## User Story
As a workflow operator
I want the scenario writer and plan validation phases to be skipped when resuming a workflow that has already completed those stages
So that I save tokens, time, and avoid redundant work on `## Take action` resume

## Problem Statement
The recovery system cannot detect `plan_validating` as a completed stage because it is absent from `STAGE_ORDER` and `STAGE_HEADER_MAP`. When a user resumes a workflow past the planning phase, the `Promise.all` in orchestrators still fires `executeScenarioPhase` and `executePlanValidationPhase`, which execute fully instead of returning early with zero-cost results.

## Solution Statement
1. Register `plan_validating` in `STAGE_ORDER` (between `plan_committing` and `implementing`) and `STAGE_HEADER_MAP` so the recovery system can detect it as a completed stage.
2. Add `shouldExecuteStage('plan_validating', recoveryState)` guards at the top of both `executeScenarioPhase` and `executePlanValidationPhase`. When recovery is past that stage, log a skip message and return a zero-cost result immediately.
3. All orchestrators that use `Promise.all([executePlanPhase, executeScenarioPhase])` get the skip behavior for free — no orchestrator changes needed.

## Relevant Files
Use these files to implement the feature:

- `adws/core/workflowCommentParsing.ts` — Contains `STAGE_ORDER` and `STAGE_HEADER_MAP`. Must add `plan_validating` to both so the recovery system recognizes it.
- `adws/phases/scenarioPhase.ts` — The scenario phase entry point. Must add a `shouldExecuteStage` guard to skip when recovery is past `plan_validating`.
- `adws/phases/planValidationPhase.ts` — The plan validation phase entry point. Must add the same `shouldExecuteStage` guard to skip when recovery is past `plan_validating`.
- `adws/core/orchestratorLib.ts` — Contains the `shouldExecuteStage` function used by the guard pattern. Reference only.
- `adws/types/workflowTypes.ts` — Contains the `WorkflowStage` type union (already includes `plan_validating`). Reference only.
- `adws/phases/planPhase.ts` — Example of the `shouldExecuteStage` guard pattern in an existing phase. Reference only.
- `guidelines/coding_guidelines.md` — Coding guidelines that must be followed.

## Implementation Plan
### Phase 1: Foundation
Register `plan_validating` in the recovery system by adding it to `STAGE_ORDER` and `STAGE_HEADER_MAP` in `adws/core/workflowCommentParsing.ts`. This is the prerequisite for the phase guards to work correctly — without this, `shouldExecuteStage('plan_validating', recoveryState)` would never detect the stage as completed.

### Phase 2: Core Implementation
Add `shouldExecuteStage('plan_validating', recoveryState)` recovery guards at the top of both `executeScenarioPhase` (in `scenarioPhase.ts`) and `executePlanValidationPhase` (in `planValidationPhase.ts`). When recovery is past that stage, each function logs a skip message and returns a zero-cost result with empty `phaseCostRecords` (for scenario) or empty `modelUsage` (for plan validation).

### Phase 3: Integration
No orchestrator changes are needed. The `Promise.all` calls in `adwSdlc.tsx`, `adwPlanBuildTestReview.tsx`, and `adwPlanBuildReview.tsx` continue to fire both `executePlanPhase` and `executeScenarioPhase` in parallel. On resume past `plan_validating`, both phases return immediately with zero-cost results.

## Step by Step Tasks

### Step 1: Register `plan_validating` in `STAGE_ORDER`
- Open `adws/core/workflowCommentParsing.ts`
- In the `STAGE_ORDER` array, add `'plan_validating'` between `'plan_committing'` and `'implementing'`
- This makes the recovery system aware that `plan_validating` is a trackable stage with a defined position in the stage progression

### Step 2: Register `plan_validating` in `STAGE_HEADER_MAP`
- In the same file (`adws/core/workflowCommentParsing.ts`), add an entry to `STAGE_HEADER_MAP`:
  - Key: `':mag: Validating Plan-Scenario Alignment'`
  - Value: `'plan_validating'`
- This maps the comment header posted by `postIssueStageComment(repoContext, issueNumber, 'plan_validating', ctx)` in `planValidationPhase.ts` back to the `plan_validating` stage during recovery detection

### Step 3: Add recovery guard to `executeScenarioPhase`
- Open `adws/phases/scenarioPhase.ts`
- Import `shouldExecuteStage` from `'../core'`
- Destructure `recoveryState` from `config` (alongside existing destructured properties)
- At the top of the function (before the `phaseStartTime` assignment), add:
  ```typescript
  if (!shouldExecuteStage('plan_validating', recoveryState)) {
    log('Skipping scenario phase (already completed in previous run)', 'info');
    return { costUsd: 0, modelUsage: emptyModelUsageMap(), phaseCostRecords: [] };
  }
  ```
- The guard uses `plan_validating` (not a scenario-specific stage) because the scenario phase runs in `Promise.all` with the plan phase, and `plan_validating` is the first stage posted after both have resolved

### Step 4: Add recovery guard to `executePlanValidationPhase`
- Open `adws/phases/planValidationPhase.ts`
- Import `shouldExecuteStage` from `'../core'`
- Destructure `recoveryState` from `config` (alongside existing destructured properties)
- At the top of the function (before the `log('Phase: Plan Validation', 'info')` call), add:
  ```typescript
  if (!shouldExecuteStage('plan_validating', recoveryState)) {
    log('Skipping plan validation phase (already completed in previous run)', 'info');
    return { costUsd: 0, modelUsage: emptyModelUsageMap() };
  }
  ```
- Note: return shape matches the existing function signature `Promise<{ costUsd: number; modelUsage: ModelUsageMap }>` (no `phaseCostRecords`)

### Step 5: Run validation commands
- Run linter, type checks, and build to verify zero regressions

## Testing Strategy

### Edge Cases
- **Fresh run (no recovery)**: `shouldExecuteStage` returns `true` when `recoveryState.canResume` is `false` — both phases execute normally
- **Resume before `plan_validating`**: If last completed stage is `plan_created` or `plan_committing`, `shouldExecuteStage('plan_validating', ...)` returns `true` — both phases still execute (scenario writer reruns to be safe)
- **Resume at or past `plan_validating`**: If last completed stage is `plan_validating` or later (e.g., `implementing`), `shouldExecuteStage` returns `false` — both phases skip and return zero-cost results
- **Failed scenario writer on first run**: If the scenario writer failed but the workflow reached `plan_validating` (because plan validation ran and found no scenario files), the scenario writer is not retried on resume. Plan validation also skips, which is correct since it would just skip again with no scenario files
- **`plan_validating` comment parsing**: The `STAGE_HEADER_MAP` entry must match the exact header text posted by `postIssueStageComment`. The header `:mag: Validating Plan-Scenario Alignment` is the one used in the phase comment helpers for the `plan_validating` stage

## Acceptance Criteria
- `plan_validating` appears in `STAGE_ORDER` between `plan_committing` and `implementing`
- `STAGE_HEADER_MAP` maps `:mag: Validating Plan-Scenario Alignment` to `plan_validating`
- `executeScenarioPhase` returns early with zero-cost result when recovery is past `plan_validating`
- `executePlanValidationPhase` returns early with zero-cost result when recovery is past `plan_validating`
- No orchestrator files are modified
- `bun run lint`, `bun run build`, and type checks pass with zero errors

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` - Run linter to check for code quality issues
- `bun run build` - Build the application to verify no build errors
- `bunx tsc --noEmit` - Run TypeScript type checking
- `bunx tsc --noEmit -p adws/tsconfig.json` - Run ADW-specific TypeScript type checking

## Notes
- The `plan_validating` stage is already defined in the `WorkflowStage` type union in `adws/types/workflowTypes.ts` — no type changes needed.
- The exact header text for the `STAGE_HEADER_MAP` entry must match what `postIssueStageComment` posts. Verify the header text used for `plan_validating` in `adws/phases/phaseCommentHelpers.ts` to ensure alignment.
- Strictly follow the coding guidelines in `guidelines/coding_guidelines.md`: pure functions, immutability, meaningful names, TypeScript strict mode.
