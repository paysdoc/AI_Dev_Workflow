# Remove Legacy E2E Machinery

**ADW ID:** 4omdx0-delete-e2e-machinery
**Date:** 2026-04-08
**Specification:** specs/issue-403-adw-4omdx0-delete-e2e-machinery-sdlc_planner-remove-legacy-e2e.md

## Overview

This chore removes all Playwright-based E2E test infrastructure from ADW now that every orchestrator has been migrated to use `scenarioTestPhase` (wired in #400). The deleted code — E2E discovery, Playwright runners, and the associated retry wrappers — was superseded by the BDD scenario test/fix phase system. References to the `e2e-tests/` convention were also purged from slash commands and documentation.

## What Was Built

- Deleted `adws/agents/testDiscovery.ts` (E2E file discovery + Playwright runner)
- Deleted `.claude/commands/test_e2e.md` (legacy E2E slash command)
- Deleted `.claude/commands/resolve_failed_e2e_test.md` (superseded by `/resolve_failed_scenario`)
- Removed `runE2ETestsWithRetry` and `runBddScenariosWithRetry` from `testRetry.ts`
- Removed E2E call block from `adwPrReview`'s `prReviewCompletion.ts` phase
- Removed `runE2ETests` config field from `projectConfig.ts` schema and `.adw/commands.md`
- Cleaned E2E references from `feature.md`, `bug.md`, `resolve_failed_scenario.md`, and `review.md` slash commands
- Inlined `E2ETestResult` interface into `testAgent.ts` (still used by `runResolveScenarioAgent`)

## Technical Implementation

### Files Deleted

- `adws/agents/testDiscovery.ts` — contained `discoverE2ETestFiles`, `runPlaywrightE2ETests`, `isValidE2ETestResult`, `E2ETestResult`, `PlaywrightE2EResult`
- `.claude/commands/test_e2e.md` — legacy slash command for running Playwright tests
- `.claude/commands/resolve_failed_e2e_test.md` — legacy slash command, renamed to `resolve_failed_scenario.md`

### Files Modified

- `adws/agents/testRetry.ts`: removed `runE2ETestsWithRetry` (lines 99-226), `runBddScenariosWithRetry`, `BddScenarioRetryOptions`, and all `testDiscovery` imports
- `adws/agents/testAgent.ts`: removed re-exports from `testDiscovery`; inlined `E2ETestResult` interface; fixed JSDoc to reference `/resolve_failed_scenario`
- `adws/agents/index.ts`: removed "Test Discovery" export block; removed `runE2ETestsWithRetry`, `runBddScenariosWithRetry`, `BddScenarioRetryOptions` from "Test Retry" block; added `E2ETestResult` to "Test Agent" exports
- `adws/phases/prReviewCompletion.ts`: removed `runE2ETestsWithRetry` import and call block; simplified cost/model-usage merging to use only `unitTestsResult`
- `adws/core/projectConfig.ts`: removed `runE2ETests` from `CommandsConfig` interface, `HEADING_TO_KEY`, and `getDefaultCommandsConfig()`
- `.adw/commands.md`: removed `## Run E2E Tests` heading and value
- `.claude/commands/feature.md`, `bug.md`: removed E2E test file creation instructions
- `.claude/commands/resolve_failed_scenario.md`: replaced `test_e2e.md` references with BDD scenario guidance
- `.claude/commands/review.md`: removed `e2e-examples/` reference

### Key Changes

- **`E2ETestResult` type preserved**: The interface is kept in `testAgent.ts` (not renamed) because it is the parameter type for `runResolveScenarioAgent`, which is called from `scenarioTestPhase.ts`. Renaming to `ScenarioTestResult` is a separate, optional cleanup.
- **`regressionScenarioProof.ts` NOT deleted**: The issue originally asked for its deletion but it remains actively used by `scenarioTestPhase.ts`, `scenarioFixPhase.ts`, `reviewRetry.ts`, `adwSdlc.tsx`, and others. It is the current BDD proof system, not legacy E2E.
- **`prReviewCompletion.ts` cost simplification**: The E2E call removed from this completion phase means `combinedCostUsd` and `combinedModelUsage` now come directly from `unitTestsResult` without a merge step.
- **`e2e-examples/` directory**: Was a placeholder convention referenced in commands but never actually populated — references safely removed.

## How to Use

No new functionality — this is a cleanup chore. The replacement for all removed E2E capabilities is the BDD scenario test/fix phase system:

1. Use `scenarioTestPhase` / `scenarioFixPhase` (in `adws/phases/`) for scenario-based testing
2. Use `/resolve_failed_scenario` (`.claude/commands/resolve_failed_scenario.md`) to fix failing BDD scenarios
3. Configure `## Run Scenarios by Tag`, `## Start Dev Server`, and `## Health Check Path` in `.adw/commands.md`

## Configuration

- `runE2ETests` key removed from `.adw/commands.md` and `CommandsConfig`. Any existing target repos with a `## Run E2E Tests` heading in their `.adw/commands.md` can safely remove that heading — it will no longer be parsed.

## Testing

- `grep -r "runE2ETestsWithRetry" adws/ .claude/commands/` — must return nothing
- `grep -r "testDiscovery" adws/` — must return nothing
- `grep -r "e2e-tests/" adws/ .claude/commands/` — must return nothing
- `bunx tsc --noEmit` — type check passes
- `bun run test` — existing tests pass

## Notes

- The `E2ETestResult` type name is intentionally left as-is in `testAgent.ts` despite the "E2E" prefix being a misnomer post-cleanup. It is consumed externally and renaming is a separate concern.
- The `e2e-examples/` directory referenced in some commands never existed — it was a placeholder convention that was never populated.
