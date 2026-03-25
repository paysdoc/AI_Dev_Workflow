# Feature: Build agent routing + orchestrator pipeline restructure

## Metadata
issueNumber: `306`
adwId: `0s1m68-build-agent-routing`
issueJson: `{"number":306,"title":"Build agent routing + orchestrator pipeline restructure","body":"## Parent PRD\n\n`specs/prd/tdd-bdd-integration.md`\n\n## What to build\n\nWire the new `/implement_tdd` skill and alignment phase into the ADW pipeline end-to-end.\n\n**Build agent routing** (`buildAgent.ts`):\n- Detect whether `.feature` files tagged `@adw-{issueNumber}` exist in the worktree\n- When scenarios exist, use `/implement_tdd` instead of `/implement`\n- When no scenarios exist, fall back to `/implement` (unchanged behavior)\n- Pass scenario file paths as additional context to the build agent\n\n**Build phase** (`buildPhase.ts`):\n- Pass scenario context to the build agent when using `/implement_tdd`\n\n**Orchestrator pipeline changes** (`adwSdlc.tsx`, `adwPlanBuildReview.tsx`, `adwPlanBuildTestReview.tsx`):\n- Remove `executeStepDefPhase` calls\n- Replace `executePlanValidationPhase` with `executeAlignmentPhase` (single-pass)\n- New pipeline: `install → [plan ‖ scenarios] → alignment → build (TDD) → test → review → document`\n- `adwPlanBuild.tsx` and `adwPlanBuildTest.tsx` don't use scenarios and remain unchanged\n\nSee PRD sections: \"Build agent routing\" and \"Orchestrator pipeline changes\" for full details.\n\n## Acceptance criteria\n\n- [ ] `buildAgent.ts` scans for `@adw-{issueNumber}` tagged `.feature` files and selects `/implement_tdd` when found\n- [ ] `buildAgent.ts` falls back to `/implement` when no scenarios exist\n- [ ] `buildPhase.ts` passes scenario file paths to the build agent when using TDD mode\n- [ ] `adwSdlc.tsx` uses new pipeline: `install → [plan ‖ scenarios] → alignment → build → test → review → document`\n- [ ] `adwPlanBuildReview.tsx` uses new pipeline with alignment instead of plan validation, no step def phase\n- [ ] `adwPlanBuildTestReview.tsx` uses new pipeline with alignment instead of plan validation, no step def phase\n- [ ] `adwPlanBuild.tsx` and `adwPlanBuildTest.tsx` continue working unchanged\n- [ ] `executeStepDefPhase` is no longer called in any orchestrator\n- [ ] `executePlanValidationPhase` is no longer called in any orchestrator\n- [ ] Parallel plan + scenario execution is preserved\n- [ ] Full SDLC pipeline runs successfully end-to-end with scenarios present\n- [ ] Full SDLC pipeline runs successfully end-to-end without scenarios (fallback path)","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-25T13:49:18Z","comments":[{"author":"paysdoc","createdAt":"2026-03-25T20:52:33Z","body":"## Take action"}],"actionableComment":null}`

## Feature Description
Wire the `/implement_tdd` skill and single-pass alignment phase into the ADW pipeline end-to-end. The build agent must detect whether BDD scenarios tagged `@adw-{issueNumber}` exist in the worktree and route to `/implement_tdd` (TDD red-green-refactor mode) or fall back to `/implement` (unchanged). The three scenario-aware orchestrators (`adwSdlc`, `adwPlanBuildReview`, `adwPlanBuildTestReview`) must drop the now-redundant `executeStepDefPhase` since step definitions are generated inline by the TDD build agent. The simpler orchestrators (`adwPlanBuild`, `adwPlanBuildTest`) remain unchanged.

## User Story
As an ADW pipeline operator
I want the build agent to automatically use TDD mode when BDD scenarios are present
So that step definitions are generated alongside implementation code in a red-green-refactor loop, eliminating the separate step-def generation phase and producing higher-quality, behavior-verified implementations.

## Problem Statement
The current pipeline runs a separate `executeStepDefPhase` after build to generate step definitions, which is disconnected from the implementation cycle. The `/implement_tdd` skill exists but is not yet wired into the automated pipeline. When scenarios exist, the build agent should use them as RED tests during implementation rather than generating step definitions as a post-hoc phase.

## Solution Statement
1. Add `/implement_tdd` to the `SlashCommand` type and model/effort routing maps.
2. Modify `buildAgent.ts` to accept a `scenarioPaths` parameter; when populated, route to `/implement_tdd` instead of `/implement` and include scenario file paths in the agent context.
3. Modify `buildPhase.ts` to discover scenarios via `findScenarioFiles()` and pass them to the build agent.
4. Remove `executeStepDefPhase` calls from the three scenario-aware orchestrators.
5. Verify `adwPlanBuild.tsx` and `adwPlanBuildTest.tsx` remain unchanged.

## Relevant Files
Use these files to implement the feature:

- `adws/types/issueTypes.ts` — Add `/implement_tdd` to the `SlashCommand` union type
- `adws/core/modelRouting.ts` — Add `/implement_tdd` entries to all four routing maps (`SLASH_COMMAND_MODEL_MAP`, `SLASH_COMMAND_MODEL_MAP_FAST`, `SLASH_COMMAND_EFFORT_MAP`, `SLASH_COMMAND_EFFORT_MAP_FAST`)
- `adws/agents/buildAgent.ts` — Add scenario-aware routing: accept optional `scenarioPaths`, select `/implement_tdd` vs `/implement`, include scenario context in args
- `adws/agents/index.ts` — Export new function/type from buildAgent if needed
- `adws/phases/buildPhase.ts` — Call `findScenarioFiles()` to discover scenarios, pass them to the build agent
- `adws/adwSdlc.tsx` — Remove `executeStepDefPhase` call, remove unused import
- `adws/adwPlanBuildReview.tsx` — Remove `executeStepDefPhase` call, remove unused import
- `adws/adwPlanBuildTestReview.tsx` — Remove `executeStepDefPhase` call, remove unused import
- `adws/adwPlanBuild.tsx` — Verify unchanged (no scenarios, no step def phase)
- `adws/adwPlanBuildTest.tsx` — Verify unchanged (no scenarios, no step def phase)
- `adws/agents/validationAgent.ts` — Contains `findScenarioFiles()` (already exported, reuse as-is)
- `guidelines/coding_guidelines.md` — Coding guidelines to follow
- `app_docs/feature-aym0n5-create-implement-tdd.md` — Reference for `/implement_tdd` skill design
- `app_docs/feature-irs6vj-single-pass-alignment-phase.md` — Reference for alignment phase design

### New Files
No new files are required. All changes modify existing files.

## Implementation Plan
### Phase 1: Foundation — Type system and routing
Register `/implement_tdd` as a recognized slash command in the type system and configure its model/effort routing. This is prerequisite for any agent to invoke the command.

### Phase 2: Core Implementation — Build agent routing
Modify `buildAgent.ts` to accept optional scenario file paths and route to `/implement_tdd` when scenarios exist. The scenario paths are included in the agent's prompt context so the TDD skill knows which `.feature` files to drive. Modify `buildPhase.ts` to discover scenarios and pass them through.

### Phase 3: Integration — Orchestrator pipeline cleanup
Remove `executeStepDefPhase` from the three scenario-aware orchestrators. Step definitions are now generated inline by the `/implement_tdd` skill during the build phase. Verify the two simpler orchestrators remain unchanged.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1: Add `/implement_tdd` to SlashCommand type
- In `adws/types/issueTypes.ts`, add `| '/implement_tdd'` to the `SlashCommand` union type, placed after the existing `'/implement'` entry.

### Step 2: Add `/implement_tdd` to model and effort routing maps
- In `adws/core/modelRouting.ts`, add `/implement_tdd` entries to all four maps:
  - `SLASH_COMMAND_MODEL_MAP`: `'/implement_tdd': 'sonnet'` (same as `/implement` — plan execution tier)
  - `SLASH_COMMAND_MODEL_MAP_FAST`: `'/implement_tdd': 'sonnet'`
  - `SLASH_COMMAND_EFFORT_MAP`: `'/implement_tdd': 'high'` (same as `/implement`)
  - `SLASH_COMMAND_EFFORT_MAP_FAST`: `'/implement_tdd': 'high'`

### Step 3: Add TDD-aware routing to build agent
- In `adws/agents/buildAgent.ts`:
  - Add a new `CommandAgentConfig` for TDD mode: `buildAgentTddConfig` using command `'/implement_tdd'` (same agent name and output file pattern as the existing config, but with the TDD command)
  - Modify `runBuildAgent` to accept an optional `scenarioPaths?: string[]` parameter
  - When `scenarioPaths` is provided and non-empty:
    - Use `buildAgentTddConfig` instead of `buildAgentConfig`
    - Append a `## BDD Scenario Files` section to the args listing the scenario file paths, so the TDD skill has context on which feature files to use
  - When `scenarioPaths` is absent or empty: fall back to existing `/implement` behavior (unchanged)
  - Log which mode was selected (TDD vs standard)

### Step 4: Update build phase to discover scenarios and pass to build agent
- In `adws/phases/buildPhase.ts`:
  - Import `findScenarioFiles` from `'../agents'`
  - Before calling `runBuildAgent`, call `findScenarioFiles(issueNumber, worktreePath)` to discover scenario files tagged `@adw-{issueNumber}`
  - Pass the discovered scenario paths to `runBuildAgent` via the new `scenarioPaths` parameter
  - Log the discovery result (number of scenarios found, and whether TDD mode is active)

### Step 5: Remove `executeStepDefPhase` from `adwSdlc.tsx`
- Remove the `executeStepDefPhase` import from the imports block
- Remove the `await runPhase(config, tracker, executeStepDefPhase);` call (currently between test and review phases)
- Update the file header comment to reflect the new pipeline order (remove step 6 "Step Def Gen Phase")

### Step 6: Remove `executeStepDefPhase` from `adwPlanBuildReview.tsx`
- Remove the `executeStepDefPhase` import from the imports block
- Remove the `await runPhase(config, tracker, executeStepDefPhase);` call
- Update the file header comment to reflect the new pipeline order

### Step 7: Remove `executeStepDefPhase` from `adwPlanBuildTestReview.tsx`
- Remove the `executeStepDefPhase` import from the imports block
- Remove the `await runPhase(config, tracker, executeStepDefPhase);` call
- Update the file header comment to reflect the new pipeline order

### Step 8: Verify `adwPlanBuild.tsx` and `adwPlanBuildTest.tsx` are unchanged
- Read both files and confirm they do not import or call `executeStepDefPhase`, `executeScenarioPhase`, `executeAlignmentPhase`, or `executePlanValidationPhase`
- These orchestrators use the simple pipeline: `install → plan → build → test → PR` and must remain unchanged

### Step 9: Run validation commands
- Run all validation commands listed below to ensure zero regressions

## Testing Strategy
### Edge Cases
- No `.feature` files exist in the worktree: build agent falls back to `/implement` (unchanged behavior)
- `.feature` files exist but none are tagged `@adw-{issueNumber}`: build agent falls back to `/implement`
- Multiple `.feature` files tagged `@adw-{issueNumber}`: all paths are passed to the TDD build agent
- Build agent token limit recovery with TDD mode: continuation prompt should preserve TDD context
- `adwPlanBuild.tsx` / `adwPlanBuildTest.tsx` must not be affected by any change

## Acceptance Criteria
- `/implement_tdd` is a valid `SlashCommand` with model and effort routing entries
- `buildAgent.ts` routes to `/implement_tdd` when `scenarioPaths` is non-empty, `/implement` otherwise
- `buildPhase.ts` calls `findScenarioFiles()` and passes results to the build agent
- `executeStepDefPhase` is not called in `adwSdlc.tsx`, `adwPlanBuildReview.tsx`, or `adwPlanBuildTestReview.tsx`
- `executePlanValidationPhase` is not called in any orchestrator (already the case — verify)
- `adwPlanBuild.tsx` and `adwPlanBuildTest.tsx` remain unchanged
- Parallel `[plan ‖ scenarios]` execution is preserved in scenario-aware orchestrators
- `bun run lint` passes with no errors
- `bun run build` passes with no errors
- `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` pass with no errors

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors
- `bunx tsc --noEmit` — Type-check root project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check adws sub-project

## Notes
- The `executePlanValidationPhase` is already not called in any orchestrator (replaced by `executeAlignmentPhase` in issue #305). This plan only needs to verify that state, not change it.
- The `executeStepDefPhase` and `executePlanValidationPhase` modules are NOT deleted — they remain available for potential future use or other orchestrators. Only the calls from the three scenario-aware orchestrators are removed.
- The `/implement_tdd` skill is a Claude Code skill (`.claude/skills/implement-tdd/SKILL.md`) invoked the same way as commands — via `runClaudeAgentWithCommand`. The `command` string `'/implement_tdd'` is resolved by Claude Code to the skill.
- `findScenarioFiles` is already exported from `adws/agents/validationAgent.ts` and re-exported from `adws/agents/index.ts`. No new discovery logic is needed.
- Follow `guidelines/coding_guidelines.md` strictly — immutability, type safety, no magic strings, keep files under 300 lines.
