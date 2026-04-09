# Dead Schema Cleanup: prepareApp, REVIEW_AGENT_COUNT, Health Check Path

**ADW ID:** 670i6z-test-review-refactor
**Date:** 2026-04-09
**Specification:** specs/issue-422-adw-h0wyf3-test-review-refactor-sdlc_planner-cleanup-dead-schema.md

## Overview

This chore removes three trailing inconsistencies left over from the test/review refactor (#394–#405): the dead `prepareApp` schema field that was orphaned when its slash command was deleted, stale `REVIEW_AGENT_COUNT` documentation for a constant removed with review parallelism, and the missing `## Health Check Path` entry in ADW's own `.adw/commands.md`. The changes also include a cleanup of `AgentStateManager.initializeState` calls in `reviewPhase.ts` and `scenarioFixPhase.ts`, replacing them with direct `path.join` expressions, and pruning `review-patch` and `scenario-fix` from the `AgentIdentifier` union type.

## What Was Built

- Removed `prepareApp` from `CommandsConfig` interface, `HEADING_TO_KEY` map, and `getDefaultCommandsConfig()` in `projectConfig.ts`
- Removed `## Prepare App` heading from ADW's own `.adw/commands.md`
- Added `## Health Check Path: /` to `.adw/commands.md` for schema completeness
- Deleted `REVIEW_AGENT_COUNT` documentation from `README.md` and `.env.sample`
- Replaced `AgentStateManager.initializeState(...)` calls with `path.join('agents', adwId, '<role>')` in `reviewPhase.ts` and `scenarioFixPhase.ts`
- Removed `review-patch` and `scenario-fix` from the `AgentIdentifier` union type in `agentTypes.ts`
- Updated `app_docs/agentic_kpis.md` with the latest KPI snapshot

## Technical Implementation

### Files Modified

- `adws/core/projectConfig.ts`: Removed `prepareApp` from `CommandsConfig` interface (line 29), `HEADING_TO_KEY` map (line 120), and `getDefaultCommandsConfig()` default (line 143)
- `adws/types/agentTypes.ts`: Removed `review-patch` and `scenario-fix` from `AgentIdentifier` union type
- `adws/phases/reviewPhase.ts`: Replaced four `AgentStateManager.initializeState(...)` calls with `path.join('agents', adwId, '<role>')`; added `import * as path from 'path'`
- `adws/phases/scenarioFixPhase.ts`: Replaced two `AgentStateManager.initializeState(...)` calls with `path.join('agents', adwId, 'scenario-fix')`; added `import * as path from 'path'`
- `.adw/commands.md`: Removed `## Prepare App` section; added `## Health Check Path: /`
- `README.md`: Removed `REVIEW_AGENT_COUNT` env var documentation line
- `.env.sample`: Removed `# REVIEW_AGENT_COUNT=3` line and its comment
- `app_docs/agentic_kpis.md`: Updated summary metrics and KPI table with latest run data

### Key Changes

- **Dead schema removal**: `prepareApp` existed in three places in `projectConfig.ts` (interface, heading map, default) with no readers — all three removed cleanly with no test updates needed
- **State path simplification**: `AgentStateManager.initializeState` was an indirection over `path.join('agents', adwId, role)` — the phase files now construct the path directly, removing the dependency on `AgentStateManager` for path construction in these phases
- **Type union pruning**: `review-patch` and `scenario-fix` were internal agent roles never surfaced outside the phases; removing them from `AgentIdentifier` tightens the type and prevents future misuse
- **Schema completeness**: `.adw/commands.md` now includes `## Health Check Path` matching the fixture and making ADW's own config a canonical schema example
- **Doc hygiene**: `REVIEW_AGENT_COUNT` was removed from both `README.md` and `.env.sample` to prevent confusion about a tunable that no longer exists

## How to Use

No user-facing behavior changes. This is a schema and documentation cleanup:

1. When running `/adw_init`, ADW's own `.adw/commands.md` now correctly reflects all current schema fields including `## Health Check Path`
2. Contributors reading `README.md` or `.env.sample` will no longer see `REVIEW_AGENT_COUNT` as a valid configuration option
3. The `CommandsConfig` type in `projectConfig.ts` is now accurate — no phantom `prepareApp` field to confuse schema readers

## Configuration

No new configuration options. The `## Health Check Path` field was already supported by the schema parser; this change ensures ADW's own config lists it with its default value of `/`.

## Testing

- `bunx tsc --noEmit` — confirms no type regressions from interface and union type changes
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific type check
- `bun run lint` — linter passes
- `bun run build` — build passes
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — regression BDD scenarios pass

## Notes

- `test/fixtures/cli-tool/.adw/commands.md` was verified to not contain `## Prepare App` — no fixture changes needed
- `adws/core/__tests__/projectConfig.test.ts` was verified to not reference `prepareApp` — no test changes needed
- Historical references to `prepareApp` in `specs/`, `app_docs/`, `features/`, and `.gitignore` were intentionally left untouched (negative BDD assertions, historical docs, gitignore for deleted command file)
