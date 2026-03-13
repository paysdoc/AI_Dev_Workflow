# Plan-Scenario Validation and Resolution

**ADW ID:** sinbtg-implement-plan-scena
**Date:** 2026-03-13
**Specification:** specs/issue-166-adw-1773386483053-jl2amw-sdlc_planner-plan-scenario-validation-resolution.md

## Overview

This feature introduces a Plan-Scenario Validation and Resolution phase that runs between the planning and build phases in ADW workflows. It compares the generated implementation plan against BDD scenarios tagged `@adw-{issueNumber}` to ensure alignment, and when mismatches are detected, invokes a Resolution Agent that uses the GitHub issue as the sole arbiter of truth to reconcile them.

## What Was Built

- **Validation Agent** (`adws/agents/validationAgent.ts`): Reads the plan and tagged BDD scenarios, identifies mismatches (plan-only, scenario-only, or conflicting behaviors), and returns a structured alignment result
- **Resolution Agent** (`adws/agents/resolutionAgent.ts`): Takes mismatches and the GitHub issue as input, updates the plan and/or scenario files on disk to resolve divergence, guided by the issue as sole truth
- **Plan Validation Phase** (`adws/phases/planValidationPhase.ts`): Orchestrates the validation-resolution loop with up to `MAX_VALIDATION_RETRY_ATTEMPTS` iterations before failing the workflow
- **Slash commands**: `/validate_plan_scenarios` and `/resolve_plan_scenarios` added to `.claude/commands/`
- **New workflow stages**: `plan_validating`, `plan_validated`, `plan_resolving`, `plan_resolved`, `plan_validation_failed` added to `WorkflowStage` and wired into `workflowCommentsIssue.ts`
- **Type extensions**: New `AgentIdentifier`, `WorkflowStage`, and `SlashCommand` entries; model/effort map entries in `config.ts`
- **Orchestrator integration**: `executePlanValidationPhase` inserted between plan and build in `adwSdlc.tsx`, `adwPlanBuild.tsx`, `adwPlanBuildDocument.tsx`, `adwPlanBuildReview.tsx`, `adwPlanBuildTest.tsx`, `adwPlanBuildTestReview.tsx`

## Technical Implementation

### Files Modified

- `adws/agents/validationAgent.ts`: New — Validation Agent runner with `findScenarioFiles`, `readScenarioContents`, `buildValidationPrompt`, `parseValidationResult`, `runValidationAgent`
- `adws/agents/resolutionAgent.ts`: New — Resolution Agent runner with `buildResolutionPrompt`, `parseResolutionResult`, `runResolutionAgent`
- `adws/phases/planValidationPhase.ts`: New — Phase implementation with validation-resolution loop, disk writes for updated artifacts, and post-loop commit via `runCommitAgent`
- `adws/agents/index.ts`: Exports for new agent functions and types
- `adws/phases/index.ts`: Export for `executePlanValidationPhase`
- `adws/workflowPhases.ts`: Re-export of phase
- `adws/types/agentTypes.ts`: Added `'validation-agent'` and `'resolution-agent'` to `AgentIdentifier`
- `adws/types/workflowTypes.ts`: Added five new `WorkflowStage` entries
- `adws/types/issueTypes.ts`: Added `/validate_plan_scenarios` and `/resolve_plan_scenarios` to `SlashCommand`
- `adws/core/config.ts`: Added model (`opus`/`sonnet`) and effort (`high`) map entries for both new slash commands
- `adws/github/workflowCommentsIssue.ts`: Added comment formatters for all five new workflow stages
- `adws/adwSdlc.tsx`, `adwPlanBuild.tsx`, `adwPlanBuildDocument.tsx`, `adwPlanBuildReview.tsx`, `adwPlanBuildTest.tsx`, `adwPlanBuildTestReview.tsx`: Integrated `executePlanValidationPhase` between plan and build
- `.claude/commands/validate_plan_scenarios.md`: Slash command prompt for the Validation Agent
- `.claude/commands/resolve_plan_scenarios.md`: Slash command prompt for the Resolution Agent

### Key Changes

- The Validation Agent scans the worktree recursively for `.feature` files containing `@adw-{issueNumber}` and compares them structurally against the spec file, producing typed mismatches (`plan_only`, `scenario_only`, `conflicting`)
- The Resolution Agent receives the GitHub issue body as the sole source of truth and directly writes updated plan/scenario files to disk before returning its JSON decision
- If no scenario files are found, the phase exits silently (no error) — the phase is a no-op when BDD scenarios haven't been generated yet
- The validation loop retries up to `MAX_VALIDATION_RETRY_ATTEMPTS` (from `adws/core`) and throws a fatal error if alignment cannot be achieved, stopping the workflow before build
- Updated artifacts are committed via `runCommitAgent` at the end of the phase if any files were changed

## How to Use

The phase runs automatically as part of any orchestrator that includes both plan and build phases. No manual configuration is needed.

1. Run any ADW workflow that includes planning (e.g., `adwSdlc`, `adwPlanBuild`)
2. After the Plan Agent completes, the phase scans for `.feature` files tagged `@adw-{issueNumber}`
3. If no scenario files exist, the phase skips silently
4. If scenario files exist, the Validation Agent compares them against the spec and reports alignment
5. If aligned, the workflow proceeds to build
6. If mismatched, the Resolution Agent updates plan/scenario files using the GitHub issue as arbiter
7. Validation re-runs; if aligned after resolution, the workflow proceeds
8. If alignment fails after `MAX_VALIDATION_RETRY_ATTEMPTS`, the workflow halts with a fatal error

## Configuration

| Setting | Location | Description |
|---|---|---|
| `MAX_VALIDATION_RETRY_ATTEMPTS` | `adws/core` | Maximum validation-resolution loop iterations before fatal failure |
| Model (standard) | `SLASH_COMMAND_MODEL_MAP` in `config.ts` | `opus` for both validation and resolution |
| Model (fast mode) | `SLASH_COMMAND_MODEL_MAP_FAST` in `config.ts` | `sonnet` for cost optimization |
| Effort | `SLASH_COMMAND_EFFORT_MAP` / `_FAST` | `high` for both (validation accuracy is critical) |

## Testing

- `adws/__tests__/planValidationAgent.test.ts` — unit tests for `formatValidationArgs`, `formatResolutionArgs`, `runPlanValidationAgent`, `runPlanResolutionAgent` with mock of `runClaudeAgentWithCommand`
- `adws/__tests__/planValidationPhase.test.ts` — unit tests for the phase: happy path, resolution path, max attempts, recovery skip, cost accumulation, state and comment posting
- `adws/phases/__tests__/planValidationPhase.test.ts` — additional phase-level tests
- `adws/agents/__tests__/validationAgent.test.ts`, `adws/agents/__tests__/resolutionAgent.test.ts` — agent-level tests

Run with: `bun run test`

## Notes

- This feature depends on issue #164 (BDD scenario tagging conventions) and #165 (Scenario Planner Agent). If no scenario files are present, the phase is a safe no-op.
- The phase is **fatal** (unlike KPI phase): misalignment that cannot be resolved stops the workflow before build to prevent building from inconsistent artifacts.
- Slash command prompt files (`.claude/commands/validate_plan_scenarios.md`, `.claude/commands/resolve_plan_scenarios.md`) define the exact agent behavior and JSON output contracts — modify these to change agent reasoning.
