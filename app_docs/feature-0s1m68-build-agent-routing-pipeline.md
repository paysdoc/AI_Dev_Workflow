# Build Agent Routing and Orchestrator Pipeline Restructure

**ADW ID:** 0s1m68-build-agent-routing
**Date:** 2026-03-25
**Specification:** specs/issue-306-adw-0s1m68-build-agent-routing-sdlc_planner-tdd-routing-pipeline.md

## Overview

Wires the `/implement_tdd` skill into the ADW pipeline end-to-end by adding scenario-aware routing to the build agent. When `.feature` files tagged `@adw-{issueNumber}` are present in the worktree, the build agent automatically selects `/implement_tdd` (TDD red-green-refactor mode) instead of `/implement`, passing scenario file paths as context. The three scenario-aware orchestrators (`adwSdlc`, `adwPlanBuildReview`, `adwPlanBuildTestReview`) drop the now-redundant `executeStepDefPhase` since step definitions are generated inline by the TDD build agent.

## What Was Built

- **Build agent TDD routing** — `buildAgent.ts` calls `findScenarioFiles()` internally and selects `/implement_tdd` vs `/implement` based on whether tagged scenarios exist
- **Scenario file context injection** — When TDD mode is selected, scenario file paths are appended to the agent args under a `## BDD Scenario Files` section
- **`/implement_tdd` type registration** — Added to `SlashCommand` union type in `issueTypes.ts`
- **`/implement_tdd` model/effort routing** — Registered in all four routing maps (`SLASH_COMMAND_MODEL_MAP`, `SLASH_COMMAND_MODEL_MAP_FAST`, `SLASH_COMMAND_EFFORT_MAP`, `SLASH_COMMAND_EFFORT_MAP_FAST`) with `sonnet` model and `high` effort
- **`/align_plan_scenarios` routing** — Also registered in all four maps (opus/high for standard, sonnet/medium for fast)
- **Orchestrator pipeline cleanup** — `executeStepDefPhase` removed from `adwSdlc.tsx`, `adwPlanBuildReview.tsx`, and `adwPlanBuildTestReview.tsx`; `executePlanValidationPhase` replaced by `executeAlignmentPhase` in all three
- **Build phase compaction recovery** — `buildPhase.ts` now handles `compactionDetected` in addition to token limit continuations, using typed continuation reasons (`'token_limit'` vs `'compaction'`)

## Technical Implementation

### Files Modified

- `adws/agents/buildAgent.ts`: Added `buildAgentTddConfig`, imports `findScenarioFiles`, detects scenarios and routes command, appends scenario paths to args
- `adws/core/modelRouting.ts`: Added `/implement_tdd` and `/align_plan_scenarios` entries to all four routing maps
- `adws/types/issueTypes.ts`: Added `/implement_tdd` and `/align_plan_scenarios` to `SlashCommand` union type
- `adws/phases/buildPhase.ts`: Added `compactionDetected` continuation branch; now passes typed reason to `buildContinuationPrompt`
- `adws/adwSdlc.tsx`: Replaced `executePlanValidationPhase` with `executeAlignmentPhase`; removed `executeStepDefPhase` call and import
- `adws/adwPlanBuildReview.tsx`: Same pipeline restructure — alignment replaces plan validation, step def phase removed
- `adws/adwPlanBuildTestReview.tsx`: Same pipeline restructure — alignment replaces plan validation, step def phase removed
- `features/build_agent_routing_pipeline.feature`: New BDD feature file with `@adw-306` scenarios covering all routing and orchestrator scenarios

### Key Changes

- **TDD detection is internal to the build agent** — `buildPhase.ts` does not call `findScenarioFiles`; the build agent handles discovery using the `cwd` parameter passed from the phase
- **Fallback preserved** — When no `@adw-{issueNumber}` tagged `.feature` files exist, behavior is identical to pre-change (uses `/implement`)
- **Step definition generation eliminated as a separate phase** — The `/implement_tdd` skill generates step definitions inline during the red-green-refactor loop, making `executeStepDefPhase` redundant in scenario-aware orchestrators
- **Pipeline step count reduced** — All three scenario-aware orchestrators now have 9 phases instead of 10 (step def phase removed)
- **Compaction recovery extended to build phase** — `buildPhase.ts` now handles both `tokenLimitReached` and `compactionDetected` with typed continuation reasons

## How to Use

The routing is fully automatic — no configuration required.

1. **With BDD scenarios** — Ensure `.feature` files tagged `@adw-{issueNumber}` exist in the worktree before the build phase runs (created by the scenario phase). The build agent will automatically select `/implement_tdd` and receive scenario context.

2. **Without BDD scenarios** — The build agent falls back to `/implement` with identical behavior to before this change. Orchestrators that don't use scenarios (`adwPlanBuild`, `adwPlanBuildTest`) are unaffected.

3. **Log output** — The build agent logs the selected mode:
   ```
   Build Agent mode: TDD (/implement_tdd)
     Scenario files found: features/my_feature.feature
   ```
   or:
   ```
   Build Agent mode: standard (/implement)
   ```

## Configuration

No new configuration required. The feature uses existing infrastructure:
- `findScenarioFiles(issueNumber, worktreePath)` from `adws/agents/validationAgent.ts`
- Model/effort routing via the four maps in `adws/core/modelRouting.ts`
- `/implement_tdd` skill at `.claude/skills/implement-tdd/SKILL.md`

## Testing

BDD scenarios covering this feature are in `features/build_agent_routing_pipeline.feature` tagged `@adw-306`. Key regression scenarios (`@regression` tag) cover:

- Scenario file detection using `findScenarioFiles`
- TDD command selection when scenarios exist
- Standard `/implement` fallback when no scenarios exist
- Scenario file paths passed in TDD mode args
- `buildPhase.ts` passing worktree path and issue number
- `SlashCommand` type and routing map registrations
- All three orchestrators: no `executeStepDefPhase`, no `executePlanValidationPhase`
- Non-scenario orchestrators (`adwPlanBuild`, `adwPlanBuildTest`) unchanged

Run: `bunx cucumber-js --tags @adw-306`

## Notes

- `executeStepDefPhase` and `executePlanValidationPhase` modules are **not deleted** — they remain available for future use. Only the calls were removed from the three scenario-aware orchestrators.
- `adwPlanBuild.tsx` and `adwPlanBuildTest.tsx` are intentionally unchanged — they use the simple `install → plan → build → test → PR` pipeline without scenarios.
- The `/implement_tdd` command string is resolved by Claude Code to `.claude/skills/implement-tdd/SKILL.md` via the standard skill resolution mechanism.
