# Scenario Planner Agent

**ADW ID:** hpq6cn-implement-scenario-p
**Date:** 2026-03-13
**Specification:** specs/issue-165-adw-hpq6cn-implement-scenario-p-sdlc_planner-scenario-planner-agent.md

## Overview

Introduces a Scenario Planner Agent that automatically generates and maintains BDD scenarios (Gherkin `.feature` files) from GitHub issues. The agent runs in parallel with the Plan Agent during the planning phase, producing executable acceptance criteria before implementation begins. It also performs a `@crucial` tag maintenance sweep on every run to keep critical scenario designations up to date.

## What Was Built

- **`/scenario_writer` slash command** — Prompt template that drives the agent's behavior: reads issue details, detects or bootstraps the E2E tool, writes/modifies/flags Gherkin scenarios, and sweeps `@crucial` tags
- **`adws/agents/scenarioAgent.ts`** — Agent module exporting `formatScenarioArgs()` and `runScenarioAgent()`
- **`adws/phases/scenarioPhase.ts`** — Non-fatal phase function `executeScenarioPhase()` following the KPI phase pattern
- **Parallel execution** — All six orchestrators now run the scenario phase concurrently with the plan phase via `Promise.all`
- **Type system registration** — `/scenario_writer` added to `SlashCommand` union; `scenario-agent` added to `AgentIdentifier` union
- **Config map entries** — `/scenario_writer` registered in all four command model/effort maps

## Technical Implementation

### Files Modified

- `adws/types/issueTypes.ts`: Added `'/scenario_writer'` to the `SlashCommand` union type
- `adws/types/agentTypes.ts`: Added `'scenario-agent'` to the `AgentIdentifier` union type
- `adws/core/config.ts`: Added `/scenario_writer` to `SLASH_COMMAND_MODEL_MAP` (sonnet), `SLASH_COMMAND_MODEL_MAP_FAST` (haiku), `SLASH_COMMAND_EFFORT_MAP` (high), `SLASH_COMMAND_EFFORT_MAP_FAST` (medium)
- `adws/agents/index.ts`: Exported `runScenarioAgent` and `formatScenarioArgs` from the new agent module
- `adws/phases/index.ts`: Exported `executeScenarioPhase` from the new phase module
- `adws/workflowPhases.ts`: Re-exported `executeScenarioPhase` from `./phases`
- `adws/adwSdlc.tsx`: Runs scenario phase in parallel with plan phase
- `adws/adwPlanBuild.tsx`: Runs scenario phase in parallel with plan phase
- `adws/adwPlanBuildTest.tsx`: Runs scenario phase in parallel with plan phase
- `adws/adwPlanBuildReview.tsx`: Runs scenario phase in parallel with plan phase
- `adws/adwPlanBuildDocument.tsx`: Runs scenario phase in parallel with plan phase
- `adws/adwPlanBuildTestReview.tsx`: Runs scenario phase in parallel with plan phase
- `.adw/conditional_docs.md`: Added entry for this documentation file
- `.gitignore`: Updated as needed

### New Files

- `.claude/commands/scenario_writer.md`: Slash command prompt template
- `adws/agents/scenarioAgent.ts`: Agent module (85 lines)
- `adws/phases/scenarioPhase.ts`: Phase module (78 lines)

### Key Changes

- **Parallel planning**: The scenario phase runs via `Promise.all([executePlanPhase(config), executeScenarioPhase(config)])` — both phases read `config` without mutations, making concurrent execution safe
- **Non-fatal design**: `scenarioPhase.ts` wraps all agent calls in a try/catch; errors are logged at `warn` level and return `{ costUsd: 0, modelUsage: emptyModelUsageMap() }` without throwing
- **Agent state tracking**: The scenario agent initializes, writes, and completes `AgentStateManager` state entries (`scenario-agent`) matching the pattern used by other agents
- **Args format**: `formatScenarioArgs` returns `[issueNumber, adwId, issueJson]` — the same three-argument pattern as the plan agent for consistency
- **Cucumber bootstrap**: When `## Run E2E Tests` is absent or `n/a` in `.adw/commands.md`, the agent installs Cucumber, creates config, and updates the commands file

## How to Use

The scenario phase runs automatically as part of any workflow that includes a planning phase. No manual invocation is needed.

1. Start any standard ADW workflow (e.g., `bunx tsx adws/adwSdlc.tsx <issueNumber>`)
2. During the planning phase, the scenario agent runs concurrently with the plan agent
3. The agent reads `.adw/scenarios.md` in the target repo to locate the scenario directory (defaults to `features/`)
4. New/modified Gherkin `.feature` files are written to the target repo's scenario directory
5. Every created, modified, or flagged scenario receives the `@adw-{issueNumber}` tag
6. A `@crucial` maintenance sweep runs automatically at the end of each scenario agent execution
7. The agent output (scenario paths, tags applied, `@crucial` changes) is logged in `<logsDir>/scenario-agent.jsonl`

## Configuration

| Config | Location | Default |
|--------|----------|---------|
| Scenario directory path | `.adw/scenarios.md` in target repo | `features/` |
| E2E tool and run commands | `.adw/commands.md` `## Run E2E Tests` section | Cucumber (bootstrapped if absent) |
| Model (standard) | `SLASH_COMMAND_MODEL_MAP['/scenario_writer']` | `sonnet` |
| Model (fast/cheap) | `SLASH_COMMAND_MODEL_MAP_FAST['/scenario_writer']` | `haiku` |
| Reasoning effort (standard) | `SLASH_COMMAND_EFFORT_MAP['/scenario_writer']` | `high` |
| Reasoning effort (fast/cheap) | `SLASH_COMMAND_EFFORT_MAP_FAST['/scenario_writer']` | `medium` |

## Testing

- TypeScript compilation: `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json`
- Lint: `bun run lint`
- Full test suite: `bun run test`

The scenario phase is non-fatal, so a failing scenario agent will not block workflow validation tests.

## Notes

- **Depends on issue #164**: The `.adw/scenarios.md` configuration file is defined by issue #164 (BDD scenario configuration and tagging conventions). If it does not exist, the agent defaults to `features/` and handles the absence gracefully.
- **`@crucial` tag**: The secondary sweep re-evaluates `@crucial` designations across all existing scenarios using `app_docs/` documentation and the current issue as context. Changes are documented in the agent output.
- **CWD = worktree**: The agent is invoked with `cwd` set to the worktree path so scenario files are written into the target repository, not the ADW repo.
- **No new libraries**: The implementation uses only existing ADW dependencies and internal modules.
