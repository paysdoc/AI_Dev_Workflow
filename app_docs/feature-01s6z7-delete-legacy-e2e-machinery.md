# Delete Legacy E2E Machinery

**ADW ID:** 01s6z7-delete-e2e-machinery
**Date:** 2026-04-08
**Specification:** specs/issue-403-adw-01s6z7-delete-e2e-machinery-sdlc_planner-delete-legacy-e2e-machinery.md

## Overview

Removes all legacy Playwright E2E test machinery from ADW now that every orchestrator has been migrated to the `scenarioTestPhase` / `scenarioFixPhase` pattern (#400). The `regressionScenarioProof.ts` agent file — still actively used — was relocated to `phases/scenarioProof.ts` rather than deleted. All dead functions, re-exports, and documentation references to the `e2e-tests/` convention were purged.

## What Was Built

- Deleted `adws/agents/testDiscovery.ts` (Playwright discovery + runner, 199 lines)
- Removed `runE2ETestsWithRetry` and `runBddScenariosWithRetry` from `adws/agents/testRetry.ts`
- Relocated `adws/agents/regressionScenarioProof.ts` → `adws/phases/scenarioProof.ts` and updated all 7 import sites
- Removed dead `executePRReviewTestPhase` function and its re-exports across 5 files
- Removed `runE2ETests` field from `CommandsConfig` interface, `HEADING_TO_KEY`, and defaults in `projectConfig.ts`
- Cleaned up E2E references in `.claude/commands/`, `.adw/commands.md`, `test/fixtures/`, `adws/README.md`, and `README.md`
- Updated BDD feature files and step definitions to remove assertions about deleted symbols

## Technical Implementation

### Files Modified

- `adws/agents/testRetry.ts`: Removed `runE2ETestsWithRetry` (~130 lines) and `runBddScenariosWithRetry` (~97 lines); only `runUnitTestsWithRetry` remains
- `adws/agents/testDiscovery.ts`: Deleted entirely (Playwright discovery + execution + type definitions)
- `adws/agents/testAgent.ts`: Removed E2E re-export block and `runResolveE2ETestAgent` import
- `adws/agents/index.ts`: Removed `testDiscovery`, `regressionScenarioProof`, `runE2ETestsWithRetry`, `runBddScenariosWithRetry` export blocks
- `adws/phases/scenarioProof.ts`: New file — relocated from `agents/regressionScenarioProof.ts`; exports `TagProofResult`, `ScenarioProofResult`, `shouldRunScenarioProof`, `runScenarioProof`
- `adws/phases/prReviewCompletion.ts`: Removed `executePRReviewTestPhase` and its `runE2ETestsWithRetry` import
- `adws/phases/prReviewPhase.ts`: Removed backward-compatible re-export of `executePRReviewTestPhase`
- `adws/phases/index.ts`: Removed `executePRReviewTestPhase` re-export; added `scenarioProof` exports
- `adws/workflowPhases.ts`: Removed `executePRReviewTestPhase` re-export
- `adws/core/projectConfig.ts`: Removed `runE2ETests` from `CommandsConfig`, `HEADING_TO_KEY`, and `getDefaultCommandsConfig()`
- `adws/agents/reviewRetry.ts`: Updated import of `shouldRunScenarioProof` / `runScenarioProof` to `../phases/scenarioProof`
- `adws/phases/scenarioTestPhase.ts`: Updated import to `./scenarioProof`
- `adws/phases/scenarioFixPhase.ts`: Updated import to `./scenarioProof`
- `adws/github/proofCommentFormatter.ts`: Updated import to `../phases/scenarioProof`
- `adws/github/workflowCommentsIssue.ts`: Updated import to `../phases/scenarioProof`
- `adws/adwSdlc.tsx`: Updated import to `./phases/scenarioProof`
- `.adw/commands.md`: Removed `## Run E2E Tests` section
- `test/fixtures/cli-tool/.adw/commands.md`: Removed `## Run E2E Tests` section
- `.claude/commands/feature.md`, `bug.md`, `adw_init.md`: Removed `e2e-tests/` references
- `.claude/commands/resolve_failed_e2e_test.md`: Deleted; replaced by `resolve_failed_scenario.md`
- `features/fix_bdd_scenarios_failure.feature`: Removed scenarios testing `runBddScenariosWithRetry` internals
- `features/step_definitions/fixBddScenariosFailureSteps.ts`: Removed step defs for deleted scenarios
- `features/step_definitions/compactionRecoveryTestReviewSteps.ts`: Updated `runBddScenariosWithRetry` assertion

### Key Changes

- **Relocation, not deletion:** `regressionScenarioProof.ts` was still imported by 7 files (scenarioTestPhase, scenarioFixPhase, reviewRetry, proofCommentFormatter, workflowCommentsIssue, adwSdlc, scenarioTestPhase.test.ts). It was moved to `phases/scenarioProof.ts` where it logically belongs as phase-level infrastructure.
- **`E2ETestResult` type preserved:** The type is still used by `runResolveScenarioAgent` in `testAgent.ts`; it was inlined there after `testDiscovery.ts` was deleted.
- **Single testing path:** ADW now has one test execution path — `scenarioTestPhase` → `scenarioFixPhase` — with no Playwright/E2E fork.
- **`executePRReviewTestPhase` was dead code:** Defined and re-exported in 5 places but never invoked by any orchestrator after the `adwPrReview.tsx` migration in #398.
- **`runE2ETests` config field removed:** `.adw/commands.md` in target repos no longer needs a `## Run E2E Tests` heading; the field is no longer parsed or defaulted.

## How to Use

This is a deletion feature — no new API surface. The relevant update for users:

1. **Target repo `.adw/commands.md`**: Remove any `## Run E2E Tests` section. It is no longer read by ADW.
2. **Scenario proof types**: Import `ScenarioProofResult`, `TagProofResult`, `shouldRunScenarioProof`, `runScenarioProof` from `adws/phases/scenarioProof` (not `adws/agents/regressionScenarioProof`).
3. **No `executePRReviewTestPhase`**: Any code that imported this function should switch to `executeScenarioTestPhase` + `executeScenarioFixPhase` directly.
4. **Resolve failed scenario command**: Use `/resolve_failed_scenario` (replaces the deleted `/resolve_failed_e2e_test`).

## Configuration

- `## Run E2E Tests` is no longer a valid heading in `.adw/commands.md`. ADW will not parse or error on it, but the field has been removed from the `CommandsConfig` interface, so any TypeScript code accessing `config.runE2ETests` will fail to compile.
- Scenario execution is configured via `## Run Scenarios by Tag`, `## Start Dev Server`, and `## Health Check Path` — see `app_docs/feature-1bg58c-scenario-test-fix-phases.md`.

## Testing

```bash
# Type check
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json

# Unit tests
bun run test

# BDD regression
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"

# Verify no lingering references
grep -r "runE2ETestsWithRetry\|runPlaywrightE2ETests\|discoverE2ETestFiles\|runBddScenariosWithRetry" adws/
grep -r "testDiscovery\|regressionScenarioProof" adws/ --include="*.ts" --include="*.tsx"
grep -r "executePRReviewTestPhase" adws/
```

## Notes

- The `features/delete_legacy_e2e_machinery.feature` BDD file documents acceptance scenarios for this cleanup and is the regression guard.
- `adws/phases/unitTestPhase.ts` (renamed from `testPhase.ts`) is unrelated to E2E — it runs Vitest unit tests and remains unchanged in behaviour.
