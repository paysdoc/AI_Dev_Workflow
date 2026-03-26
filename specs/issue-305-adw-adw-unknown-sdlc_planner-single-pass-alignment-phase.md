# Feature: Single-pass alignment command + phase (replaces plan validation loop)

## Metadata
issueNumber: `305`
adwId: `adw-unknown`
issueJson: `{}`

## Feature Description

Replace the multi-round plan validation loop (`validate → resolve → re-validate`, up to `MAX_VALIDATION_RETRY_ATTEMPTS`) with a single-pass alignment step that runs once after the parallel plan + scenario phase completes.

A new `/align_plan_scenarios` command is created for use by a new `executeAlignmentPhase` function in `adws/phases/`. One agent reads both the plan and `.feature` files tagged `@adw-{issueNumber}`, identifies conflicts, and resolves them in a single pass. The GitHub issue is the source of truth. Unresolvable conflicts are flagged as warnings in the plan — not thrown as errors — so the build agent can proceed with clear warnings rather than failing the workflow.

This reduces 2–N agent invocations per run (the old validate + retry loop) down to a single invocation, lowering cost and latency.

## User Story

As an ADW operator
I want the plan-scenario alignment step to run in a single agent pass
So that plan-scenario alignment costs one agent invocation instead of up to N retry rounds

## Problem Statement

The current `executePlanValidationPhase` runs an initial validation agent, then enters a loop (`validate → resolve → re-validate`) that can fire up to `MAX_VALIDATION_RETRY_ATTEMPTS` times. Each loop iteration spawns up to two additional agent invocations (resolve + re-validate), burning tokens and adding latency without providing proportional accuracy gains. If the loop exhausts retries, it throws an error that halts the workflow — an aggressive failure mode for what is fundamentally a soft alignment problem.

## Solution Statement

Create a new `/align_plan_scenarios` command file (`.claude/commands/align_plan_scenarios.md`) that instructs a single agent to: (1) read the plan, (2) read the scenario files, (3) resolve conflicts using the issue as source of truth, (4) flag unresolvable conflicts as `<!-- WARNING: ... -->` annotations in the plan, and (5) never throw. Wire it to a new `executeAlignmentPhase` function in `adws/phases/alignmentPhase.ts` that replaces `executePlanValidationPhase` in the orchestrators that use it. Register the new slash command in `adws/types/issueTypes.ts` and `adws/core/modelRouting.ts`.

## Relevant Files

- `adws/phases/planValidationPhase.ts` — existing phase being replaced; source of patterns (agent state, stage guards, cost records)
- `adws/phases/scenarioPhase.ts` — cost record pattern to follow
- `adws/phases/planPhase.ts` — `PhaseCostRecord` usage pattern
- `adws/phases/index.ts` — add `executeAlignmentPhase` export
- `adws/agents/validationAgent.ts` — `findScenarioFiles` utility (reuse in new agent)
- `adws/agents/resolutionAgent.ts` — existing resolution agent (pattern reference; not reused)
- `adws/agents/index.ts` — export new `runAlignmentAgent`
- `adws/types/issueTypes.ts` — `SlashCommand` union type; add `/align_plan_scenarios`
- `adws/core/modelRouting.ts` — `SLASH_COMMAND_MODEL_MAP` and `SLASH_COMMAND_MODEL_MAP_FAST`; add `/align_plan_scenarios`
- `adws/core/workflowCommentParsing.ts` — `STAGE_ORDER` and `STAGE_HEADER_MAP`; add `plan_aligning` stage
- `adws/adwSdlc.tsx` — replace `executePlanValidationPhase` with `executeAlignmentPhase`
- `adws/adwPlanBuildReview.tsx` — same replacement
- `adws/adwPlanBuildTestReview.tsx` — same replacement
- `.claude/commands/validate_plan_scenarios.md` — reference for command format (do not modify)
- `.claude/commands/resolve_plan_scenarios.md` — reference for command format (do not modify)

### New Files

- `.claude/commands/align_plan_scenarios.md` — new slash command prompt for single-pass alignment
- `adws/agents/alignmentAgent.ts` — new agent that invokes `/align_plan_scenarios`
- `adws/phases/alignmentPhase.ts` — new phase function `executeAlignmentPhase`

## Implementation Plan

### Phase 1: Foundation

Register the new slash command in the type system and model routing maps so TypeScript types remain consistent before any runtime code is written.

### Phase 2: Core Implementation

1. Write the `/align_plan_scenarios` command prompt.
2. Write `alignmentAgent.ts` using the same `runClaudeAgentWithCommand` pattern as `validationAgent.ts` and `resolutionAgent.ts`.
3. Write `alignmentPhase.ts` following the `scenarioPhase.ts` / `planPhase.ts` patterns (stage guard, agent state, `PhaseCostRecord`, non-fatal unresolvable conflicts).

### Phase 3: Integration

1. Export `runAlignmentAgent` from `adws/agents/index.ts`.
2. Export `executeAlignmentPhase` from `adws/phases/index.ts`.
3. Add `plan_aligning` to `STAGE_ORDER` and `STAGE_HEADER_MAP` in `workflowCommentParsing.ts`.
4. Replace `executePlanValidationPhase` with `executeAlignmentPhase` in `adwSdlc.tsx`, `adwPlanBuildReview.tsx`, `adwPlanBuildTestReview.tsx`.

## Step by Step Tasks

### Step 1: Register `/align_plan_scenarios` in the type system

- In `adws/types/issueTypes.ts`, add `'/align_plan_scenarios'` to the `SlashCommand` union type (alongside `/validate_plan_scenarios` and `/resolve_plan_scenarios`).

### Step 2: Add model and effort routing for the new command

- In `adws/core/modelRouting.ts`, add `'/align_plan_scenarios': 'sonnet'` to `SLASH_COMMAND_MODEL_MAP` and `SLASH_COMMAND_MODEL_MAP_FAST` (sonnet is appropriate — this is a single-pass structured edit, not deep reasoning).
- If an effort map entry is needed (check existing effort maps), add a corresponding entry.

### Step 3: Create the `/align_plan_scenarios` command prompt

- Create `.claude/commands/align_plan_scenarios.md` with frontmatter `target: false`.
- Arguments: `$1` adwId, `$2` issueNumber, `$3` planFilePath, `$4` scenarioDir (directory to scan for `.feature` files tagged `@adw-$2`), `$5` issueJson.
- Instructions:
  1. Parse `$5` for issue requirements.
  2. Read the plan at `$3`.
  3. Recursively scan `$4` for `.feature` files tagged `@adw-$2`; read each.
  4. Identify conflicts between plan tasks/acceptance criteria and scenario steps/given-when-then blocks.
  5. Resolve each conflict in a single pass using the issue as source of truth: update the plan and/or scenario files on disk.
  6. For conflicts that cannot be resolved, insert a `<!-- WARNING: [description of conflict] -->` comment into the plan at the relevant section — do NOT throw or output an error.
  7. Output a JSON summary: `{ "resolved": boolean, "warnings": string[], "decisions": [{ "conflict": string, "action": "updated_plan" | "updated_scenarios" | "updated_both" | "flagged_warning", "reasoning": string }] }`.
  8. Output only raw JSON — no markdown fences.

### Step 4: Create `adws/agents/alignmentAgent.ts`

- Follow the shape of `validationAgent.ts` / `resolutionAgent.ts`.
- Define `AlignmentDecision` interface with `conflict`, `action` (`"updated_plan" | "updated_scenarios" | "updated_both" | "flagged_warning"`), and `reasoning`.
- Define `AlignmentResult` interface with `resolved: boolean`, `warnings: string[]`, `decisions: AlignmentDecision[]`.
- Export `parseAlignmentResult(agentOutput: string): AlignmentResult` — uses `extractJson`, falls back to a non-error default (all flagged as warnings) if parsing fails.
- Export `runAlignmentAgent(adwId, issueNumber, planFilePath, worktreePath, issueJson, logsDir, statePath?, cwd?): Promise<AgentResult & { alignmentResult: AlignmentResult }>` — calls `runClaudeAgentWithCommand('/align_plan_scenarios', ...)`.
- Keep file under 150 lines.

### Step 5: Create `adws/phases/alignmentPhase.ts`

- Follow the shape of `scenarioPhase.ts` + `planValidationPhase.ts`.
- Export `executeAlignmentPhase(config: WorkflowConfig): Promise<{ costUsd: number; modelUsage: ModelUsageMap; phaseCostRecords: PhaseCostRecord[] }>`.
- Stage guard: use `shouldExecuteStage('plan_aligning', recoveryState)` — skip and return zeros if already completed.
- If no scenario files found (via reused `findScenarioFiles` from `validationAgent.ts`), skip and return zeros without error.
- Post `plan_aligning` stage comment before running the agent.
- Post `plan_aligned` stage comment after successful agent run.
- Unresolvable conflicts: log warnings and proceed — do NOT throw. Commit updated artifacts if any decisions were made.
- Produce `PhaseCostRecord` entries via `createPhaseCostRecords` with `phase: 'alignment'`.
- Keep file under 200 lines.

### Step 6: Export new agent and phase

- In `adws/agents/index.ts`, add export block for `runAlignmentAgent`, `AlignmentResult`, `AlignmentDecision` from `./alignmentAgent`.
- In `adws/phases/index.ts`, add `export { executeAlignmentPhase } from './alignmentPhase'`.

### Step 7: Add `plan_aligning` workflow stage

- In `adws/core/workflowCommentParsing.ts`:
  - Add `'plan_aligning'` and `'plan_aligned'` to the `WorkflowStage` type (check where it is defined — likely `adws/core/index.ts` or `adws/types/workflowTypes.ts`).
  - Add `'plan_aligning'` to `STAGE_ORDER` array (after `'plan_committing'`, before `'implementing'`).
  - Add entries to `STAGE_HEADER_MAP`: `':mag: Aligning Plan and Scenarios': 'plan_aligning'` and `':white_check_mark: Plan-Scenario Alignment Complete': 'plan_aligned'`.

### Step 8: Replace `executePlanValidationPhase` in orchestrators

- In `adwSdlc.tsx`, `adwPlanBuildReview.tsx`, `adwPlanBuildTestReview.tsx`:
  - Replace import of `executePlanValidationPhase` with `executeAlignmentPhase`.
  - Replace call site accordingly (same signature shape: takes `WorkflowConfig`, returns `{ costUsd, modelUsage, phaseCostRecords }`).
  - Ensure the cost records from the alignment phase are passed through to the cost tracking pipeline (same pattern as other phase cost records in those orchestrators).

### Step 9: Validate

- Run lint, type check, and BDD regression scenarios to confirm zero regressions.

## Testing Strategy

### Edge Cases

- No `.feature` files tagged `@adw-{issueNumber}`: phase exits early without error.
- Alignment agent returns non-JSON output: `parseAlignmentResult` falls back to a safe default (no decisions, all flagged as warnings) and logs a warning — does NOT throw.
- Unresolvable conflicts: written as `<!-- WARNING: ... -->` annotations in the plan; phase does NOT throw.
- Recovery resume: `shouldExecuteStage('plan_aligning', recoveryState)` returns false if the stage was already completed in a prior run; phase returns zeros.
- Orchestrators that do NOT use plan validation (`adwPlanBuild.tsx`, `adwPlanBuildTest.tsx`): unchanged — they never called `executePlanValidationPhase` and do not call `executeAlignmentPhase`.

## Acceptance Criteria

- [ ] `.claude/commands/align_plan_scenarios.md` exists with correct frontmatter and argument definitions.
- [ ] `adws/agents/alignmentAgent.ts` exports `runAlignmentAgent`, `AlignmentResult`, `AlignmentDecision`, `parseAlignmentResult`.
- [ ] `adws/phases/alignmentPhase.ts` exports `executeAlignmentPhase` with `PhaseCostRecord` output.
- [ ] `executeAlignmentPhase` reads both plan and scenario files in a single agent invocation (no retry loop).
- [ ] Conflicts are resolved using the GitHub issue as source of truth (per command prompt instructions).
- [ ] Unresolvable conflicts are flagged as `<!-- WARNING: ... -->` annotations in the plan — not thrown as errors.
- [ ] No retry loop in `alignmentPhase.ts`.
- [ ] `'/align_plan_scenarios'` is registered in `SlashCommand` type and both model routing maps.
- [ ] `'plan_aligning'` stage is in `STAGE_ORDER` and `STAGE_HEADER_MAP`.
- [ ] `adwSdlc.tsx`, `adwPlanBuildReview.tsx`, `adwPlanBuildTestReview.tsx` use `executeAlignmentPhase` instead of `executePlanValidationPhase`.
- [ ] `bun run lint` passes.
- [ ] `bunx tsc --noEmit` passes.
- [ ] `bunx tsc --noEmit -p adws/tsconfig.json` passes.
- [ ] `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` passes.

## Validation Commands

```bash
bun run lint
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

## Notes

- `executePlanValidationPhase` in `planValidationPhase.ts` is NOT deleted by this issue — it is only replaced in the three orchestrators that called it. Removal of the old phase and its agents (`validationAgent.ts`, `resolutionAgent.ts`, `/validate_plan_scenarios`, `/resolve_plan_scenarios`) is out of scope for issue #305 and should be handled in a follow-up cleanup issue.
- `adwPlanBuild.tsx` and `adwPlanBuildTest.tsx` do not use plan validation today; they are out of scope.
- The `findScenarioFiles` function from `adws/agents/validationAgent.ts` should be reused directly (imported) rather than duplicated.
- Model tier for `/align_plan_scenarios` is `sonnet` (normal) — single-pass structured editing does not require `opus`. This is different from the old `/validate_plan_scenarios` and `/resolve_plan_scenarios` which were both `opus`.
- The PRD section "Single-pass alignment (replaces plan validation)" is the authoritative specification for the command behavior.
- Keep all new files under 300 lines per coding guidelines.
