# Feature: Scenario Writer Should Use Opus Model

## Metadata
issueNumber: `231`
adwId: `tepq39-scenario-writer-shou`
issueJson: `{"number":231,"title":"Scenario writer should be opus","body":"The scenario writer should make use of the following models:\n - SLASH_COMMAND_MODEL_MAP: opus\n - SLASH_COMMAND_MODEL_MAP_FAST: sonnet","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-18T10:57:29Z","comments":[{"author":"paysdoc","createdAt":"2026-03-18T11:10:44Z","body":"## Take action"}],"actionableComment":null}`

## Feature Description
The scenario writer slash command (`/scenario_writer`) currently uses `sonnet` in the standard model map and `haiku` in the fast/cheap model map. Since scenario writing involves complex reasoning about BDD scenarios, test coverage, and regression tag maintenance, it should use a more capable model. This feature upgrades the scenario writer to use `opus` in the standard model map and `sonnet` in the fast/cheap model map.

## User Story
As an ADW operator
I want the scenario writer agent to use the Opus model for standard runs and Sonnet for fast/cheap runs
So that BDD scenario generation benefits from more capable reasoning, producing higher-quality scenarios

## Problem Statement
The scenario writer (`/scenario_writer`) is currently mapped to `sonnet` in `SLASH_COMMAND_MODEL_MAP` and `haiku` in `SLASH_COMMAND_MODEL_MAP_FAST`. Scenario writing requires complex reasoning about feature behavior, BDD scenario structure, and regression tag maintenance — tasks better suited to a more capable model tier.

## Solution Statement
Update the two model routing maps in `adws/core/config.ts`:
1. Change `/scenario_writer` in `SLASH_COMMAND_MODEL_MAP` from `'sonnet'` to `'opus'`
2. Change `/scenario_writer` in `SLASH_COMMAND_MODEL_MAP_FAST` from `'haiku'` to `'sonnet'`

No other files need to change. The `getModelForCommand()` function already reads from these maps dynamically, so all downstream consumers (the scenario agent, scenario phase) will automatically pick up the new model tiers.

## Relevant Files
Use these files to implement the feature:

- `adws/core/config.ts` — Contains `SLASH_COMMAND_MODEL_MAP` and `SLASH_COMMAND_MODEL_MAP_FAST` where the `/scenario_writer` model tier is defined. This is the only file that needs modification.
- `adws/agents/scenarioAgent.ts` — Scenario agent that consumes the model map via `getModelForCommand()`. Read to confirm no hardcoded model overrides exist.
- `adws/phases/scenarioPhase.ts` — Scenario phase that invokes the scenario agent. Read to confirm it delegates model selection to the agent/config layer.
- `guidelines/coding_guidelines.md` — Coding guidelines that must be followed.

## Implementation Plan
### Phase 1: Foundation
No foundational work needed — the model routing infrastructure already exists in `adws/core/config.ts` via `SLASH_COMMAND_MODEL_MAP`, `SLASH_COMMAND_MODEL_MAP_FAST`, and `getModelForCommand()`.

### Phase 2: Core Implementation
Update two entries in `adws/core/config.ts`:
1. In `SLASH_COMMAND_MODEL_MAP`: change `'/scenario_writer': 'sonnet'` to `'/scenario_writer': 'opus'`
2. In `SLASH_COMMAND_MODEL_MAP_FAST`: change `'/scenario_writer': 'haiku'` to `'/scenario_writer': 'sonnet'`

### Phase 3: Integration
No integration work needed — `getModelForCommand()` already dynamically reads from these maps, so the scenario agent and scenario phase will automatically use the updated model tiers without any code changes.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Read and verify current configuration
- Read `adws/core/config.ts` and confirm the current `/scenario_writer` entries:
  - `SLASH_COMMAND_MODEL_MAP`: currently `'sonnet'`
  - `SLASH_COMMAND_MODEL_MAP_FAST`: currently `'haiku'`
- Read `adws/agents/scenarioAgent.ts` to confirm it uses `getModelForCommand()` and has no hardcoded model overrides
- Read `adws/phases/scenarioPhase.ts` to confirm it delegates model selection properly

### Step 2: Update model maps
- In `adws/core/config.ts`, change the `'/scenario_writer'` entry in `SLASH_COMMAND_MODEL_MAP` from `'sonnet'` to `'opus'`
- In `adws/core/config.ts`, change the `'/scenario_writer'` entry in `SLASH_COMMAND_MODEL_MAP_FAST` from `'haiku'` to `'sonnet'`

### Step 3: Run validation commands
- Run all validation commands listed below to confirm zero regressions

## Testing Strategy
### Edge Cases
- Verify that the fast/cheap mode (`/fast` or `/cheap` in issue body) correctly routes to `sonnet` instead of `haiku`
- Verify that standard mode correctly routes to `opus` instead of `sonnet`
- Confirm no other slash commands are affected by the change

## Acceptance Criteria
- `SLASH_COMMAND_MODEL_MAP['/scenario_writer']` equals `'opus'`
- `SLASH_COMMAND_MODEL_MAP_FAST['/scenario_writer']` equals `'sonnet'`
- `getModelForCommand('/scenario_writer')` returns `'opus'` when no fast/cheap mode is active
- `getModelForCommand('/scenario_writer', '/fast')` returns `'sonnet'` when fast/cheap mode is active
- All existing BDD scenarios pass without regression
- Linter and type checks pass cleanly

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors
- `bunx tsc --noEmit` — Run TypeScript type checking
- `bunx tsc --noEmit -p adws/tsconfig.json` — Run additional type checks for adws
- `bunx cucumber-js` — Run all BDD scenarios to validate zero regressions

## Notes
- No new libraries are needed
- The effort map (`SLASH_COMMAND_EFFORT_MAP`) for `/scenario_writer` remains at `'high'`, which is appropriate for an opus-tier task
- This change aligns the scenario writer with the same model tier as `/validate_plan_scenarios` and `/resolve_plan_scenarios`, which also use opus for complex reasoning about BDD scenarios
