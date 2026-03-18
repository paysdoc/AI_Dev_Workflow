# Scenario Writer Opus Model Upgrade

**ADW ID:** tepq39
**Date:** 2026-03-18
**Specification:** specs/issue-231-adw-tepq39-scenario-writer-shou-sdlc_planner-scenario-writer-opus-model.md

## Overview

The `/scenario_writer` slash command has been upgraded from `sonnet` to `opus` in the standard model map and from `haiku` to `sonnet` in the fast/cheap model map. This change ensures that BDD scenario generation benefits from more capable reasoning, producing higher-quality scenarios with better coverage and regression tag maintenance.

## What Was Built

- Updated `SLASH_COMMAND_MODEL_MAP` to route `/scenario_writer` to `opus` (previously `sonnet`)
- Updated `SLASH_COMMAND_MODEL_MAP_FAST` to route `/scenario_writer` to `sonnet` (previously `haiku`)
- Added BDD feature file and step definitions to validate model routing for the scenario writer command

## Technical Implementation

### Files Modified

- `adws/core/config.ts`: Changed `/scenario_writer` from `'sonnet'` to `'opus'` in `SLASH_COMMAND_MODEL_MAP`, and from `'haiku'` to `'sonnet'` in `SLASH_COMMAND_MODEL_MAP_FAST`
- `features/scenario_writer_model_config.feature`: New BDD feature file with scenarios validating the model configuration for standard and fast modes
- `features/step_definitions/scenarioWriterModelConfigSteps.ts`: New step definitions implementing the BDD validation steps
- `README.md`: Minor documentation update

### Key Changes

- `/scenario_writer` in `SLASH_COMMAND_MODEL_MAP`: `'sonnet'` → `'opus'`
- `/scenario_writer` in `SLASH_COMMAND_MODEL_MAP_FAST`: `'haiku'` → `'sonnet'`
- No changes to `getModelForCommand()` — it already reads from these maps dynamically, so all downstream consumers (scenario agent, scenario phase) automatically pick up the new tiers
- The effort level (`SLASH_COMMAND_EFFORT_MAP`) remains `'high'`, appropriate for opus-tier reasoning

## How to Use

The change is transparent to users. When the scenario writer runs:

1. **Standard mode**: `getModelForCommand('/scenario_writer')` now returns `'opus'`
2. **Fast/cheap mode** (e.g., `/fast` or `/cheap` in issue body): `getModelForCommand('/scenario_writer', '/fast')` now returns `'sonnet'`

No configuration changes are needed — the routing is automatic via the existing `getModelForCommand()` function.

## Configuration

No additional configuration required. The model tier is determined by `SLASH_COMMAND_MODEL_MAP` and `SLASH_COMMAND_MODEL_MAP_FAST` in `adws/core/config.ts`.

## Testing

Run the BDD scenarios to validate the configuration:

```sh
bunx cucumber-js --tags @scenario-writer-model
```

Or run all scenarios:

```sh
bunx cucumber-js
```

## Notes

- This aligns `/scenario_writer` with `/validate_plan_scenarios` and `/resolve_plan_scenarios`, which also use `opus` for complex BDD reasoning tasks
- The `SLASH_COMMAND_EFFORT_MAP` entry for `/scenario_writer` remains `'high'`, which is appropriate for opus-tier work
- No changes to agent or phase code were needed — the routing infrastructure already existed
