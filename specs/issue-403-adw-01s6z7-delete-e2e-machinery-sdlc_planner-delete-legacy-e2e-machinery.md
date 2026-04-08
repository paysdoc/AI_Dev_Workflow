# Feature: Delete Legacy E2E Machinery

## Metadata
issueNumber: `403`
adwId: `01s6z7-delete-e2e-machinery`
issueJson: `{"number":403,"title":"delete E2E machinery","body":"## Parent PRD\n\n`specs/prd/test-review-refactor.md`\n\n## What to build\n\nNow that all orchestrators have been migrated to scenarioTestPhase (#400), delete the legacy E2E machinery.\n\n**Delete from `agents/`:**\n- `runE2ETestsWithRetry` (in `agents/testRetry.ts`)\n- `runPlaywrightE2ETests` (in `agents/testDiscovery.ts`)\n- `discoverE2ETestFiles` (in `agents/testDiscovery.ts`)\n- `runBddScenariosWithRetry` (in `agents/testRetry.ts`) — verify dead first\n- The entire `agents/regressionScenarioProof.ts` file (logic moved to `phases/scenarioTestPhase.ts` in #399)\n- The `agents/testDiscovery.ts` file may be deletable entirely if nothing else lives in it\n\n**Delete from `core/projectConfig.ts`:**\n- `runE2ETests` field from `CommandsConfig` interface\n- The corresponding heading entry in `HEADING_TO_KEY`\n- The default value\n- Update tests that reference the old field\n\n**Delete the `e2e-tests/` convention:**\n- Remove any documentation or code that references `e2e-tests/*.spec.ts`\n- The directory itself is per-target-repo, so this is just removing the concept from ADW's vocabulary\n\n**Update re-exports:**\n- `agents/index.ts` removes deleted exports\n- `agents/testAgent.ts` removes its E2E-related re-export block\n\n**Verify no callers remain:**\n- `grep -r runE2ETestsWithRetry adws/` should return nothing\n- Same for `runPlaywrightE2ETests`, `discoverE2ETestFiles`, `runBddScenariosWithRetry`\n\n## Acceptance criteria\n\n- [ ] All listed functions and files deleted\n- [ ] `## Run E2E Tests` heading removed from `projectConfig.ts` schema\n- [ ] No remaining references to deleted symbols anywhere in `adws/` or `.claude/commands/`\n- [ ] Type check (`bunx tsc --noEmit`) passes\n- [ ] Existing tests still pass\n- [ ] Lint passes (`bun run lint`)\n\n## Blocked by\n\n- Blocked by #400\n\n## User stories addressed\n\n- User story 31","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-08T12:05:52Z","comments":[],"actionableComment":null}`

## Feature Description
Delete all legacy E2E test machinery from ADW now that every orchestrator has been migrated to the `scenarioTestPhase` / `scenarioFixPhase` pattern (#400). This includes Playwright-based test discovery and execution, the E2E retry loop, the now-dead `runBddScenariosWithRetry` function, and the `regressionScenarioProof.ts` agent file (whose logic needs to be relocated to phases since it's still used by `scenarioTestPhase.ts`, `scenarioFixPhase.ts`, and `reviewRetry.ts`). Also removes the `runE2ETests` field from `CommandsConfig` and purges all references to the `e2e-tests/` directory convention from ADW's vocabulary.

## User Story
As an ADW maintainer
I want to remove the legacy E2E test machinery that has been replaced by the scenario test/fix phases
So that the codebase has a single, clear testing path and no dead code confusing future contributors

## Problem Statement
After #400 wired all orchestrators to use `scenarioTestPhase` and `scenarioFixPhase`, the legacy E2E machinery (`runE2ETestsWithRetry`, `runPlaywrightE2ETests`, `discoverE2ETestFiles`, `testDiscovery.ts`, `runBddScenariosWithRetry`) is dead code. The `executePRReviewTestPhase` function in `prReviewCompletion.ts` still calls `runE2ETestsWithRetry` but `adwPrReview.tsx` no longer invokes it — it uses `executeScenarioTestPhase` and `executeUnitTestPhase` directly. The `regressionScenarioProof.ts` file is listed for deletion but its functions are still actively imported by 6+ files, requiring relocation rather than simple deletion.

## Solution Statement
1. Delete `agents/testDiscovery.ts` entirely (all contents are E2E-specific).
2. Delete `runE2ETestsWithRetry` and `runBddScenariosWithRetry` from `agents/testRetry.ts`, keeping `runUnitTestsWithRetry`.
3. Relocate `regressionScenarioProof.ts` contents into a new file `phases/scenarioProof.ts` and update all imports (7 files).
4. Remove the dead `executePRReviewTestPhase` function from `prReviewCompletion.ts` and its re-exports.
5. Remove `runE2ETests` from `CommandsConfig`, `HEADING_TO_KEY`, and defaults in `projectConfig.ts`.
6. Remove E2E-related re-exports from `agents/index.ts`, `agents/testAgent.ts`, `workflowPhases.ts`, `phases/index.ts`, and `adws/index.ts`.
7. Clean up E2E-related references in `.claude/commands/`, `.adw/commands.md`, `test/fixtures/`, `adws/README.md`, and BDD feature files/step definitions.

## Relevant Files
Use these files to implement the feature:

- `adws/agents/testDiscovery.ts` — Delete entirely: contains `discoverE2ETestFiles`, `runPlaywrightE2ETests`, `isValidE2ETestResult`, `E2ETestResult`, `PlaywrightE2EResult` types
- `adws/agents/testRetry.ts` — Remove `runE2ETestsWithRetry` (lines 99-226) and `runBddScenariosWithRetry` (lines 228-324); keep `runUnitTestsWithRetry` and its types
- `adws/agents/regressionScenarioProof.ts` — Relocate contents to `phases/scenarioProof.ts`, then delete
- `adws/agents/testAgent.ts` — Remove E2E-related re-export block (lines 12-19) and the `E2ETestResult` re-import (line 22)
- `adws/agents/index.ts` — Remove exports for `testDiscovery` (lines 40-47), `runE2ETestsWithRetry`/`runBddScenariosWithRetry` (lines 78-86), and `regressionScenarioProof` (lines 70-76)
- `adws/agents/reviewRetry.ts` — Update import of `shouldRunScenarioProof`, `runScenarioProof`, `ScenarioProofResult` from new location (`../phases/scenarioProof`)
- `adws/phases/scenarioTestPhase.ts` — Update import of `runScenarioProof`, `ScenarioProofResult` from new location (`./scenarioProof`)
- `adws/phases/scenarioFixPhase.ts` — Update import of `ScenarioProofResult` from new location (`./scenarioProof`)
- `adws/phases/prReviewCompletion.ts` — Remove `executePRReviewTestPhase` function and `runE2ETestsWithRetry` import
- `adws/phases/index.ts` — Remove `executePRReviewTestPhase` re-export
- `adws/phases/prReviewPhase.ts` — Remove backward-compatible re-export of `executePRReviewTestPhase`
- `adws/workflowPhases.ts` — Remove `executePRReviewTestPhase` re-export
- `adws/adwSdlc.tsx` — Update import of `ScenarioProofResult` from new location
- `adws/github/proofCommentFormatter.ts` — Update import of `ScenarioProofResult`, `TagProofResult` from new location
- `adws/github/workflowCommentsIssue.ts` — Update import of `ScenarioProofResult` from new location
- `adws/core/projectConfig.ts` — Remove `runE2ETests` field from `CommandsConfig`, `HEADING_TO_KEY`, and defaults
- `adws/core/__tests__/projectConfig.test.ts` — Update if any tests reference `runE2ETests`
- `.adw/commands.md` — Remove `## Run E2E Tests` section
- `test/fixtures/cli-tool/.adw/commands.md` — Remove `## Run E2E Tests` section
- `adws/README.md` — Remove references to `## Run E2E Tests` heading and `e2e-tests/` directory
- `.claude/commands/feature.md` — Remove E2E test file creation instructions referencing `e2e-tests/`
- `.claude/commands/bug.md` — Remove E2E test file creation instructions referencing `e2e-tests/`
- `.claude/commands/adw_init.md` — Remove/update `## Run E2E Tests` references
- `.claude/commands/resolve_failed_scenario.md` — Update language from "E2E test" to "scenario"
- `README.md` — Update project structure listing (remove `testDiscovery.ts`, `regressionScenarioProof.ts`)
- `features/fix_bdd_scenarios_failure.feature` — Remove scenarios that test `runBddScenariosWithRetry` internals
- `features/step_definitions/fixBddScenariosFailureSteps.ts` — Remove step defs for deleted scenarios
- `features/step_definitions/compactionRecoveryTestReviewSteps.ts` — Remove `runBddScenariosWithRetry` reference
- `features/step_definitions/stepDefGenReviewGatingSteps.ts` — Update/remove step defs checking `runBddScenariosWithRetry`
- `features/step_def_generation_review_gating.feature` — Update scenario that checks `runBddScenariosWithRetry`
- `guidelines/coding_guidelines.md` — Read and follow during implementation

### New Files
- `adws/phases/scenarioProof.ts` — Relocated contents of `agents/regressionScenarioProof.ts` (types + functions: `shouldRunScenarioProof`, `runScenarioProof`, `TagProofResult`, `ScenarioProofResult`)

## Implementation Plan
### Phase 1: Foundation — Relocate scenario proof, remove config field
Before deleting anything, relocate `regressionScenarioProof.ts` to `phases/scenarioProof.ts` so all existing consumers can be updated to the new import path. Then remove the `runE2ETests` field from the `CommandsConfig` interface and all related mapping/defaults.

### Phase 2: Core Implementation — Delete dead code
Delete the E2E-specific files and functions:
- Delete `agents/testDiscovery.ts` entirely
- Remove `runE2ETestsWithRetry` and `runBddScenariosWithRetry` from `agents/testRetry.ts`
- Remove the dead `executePRReviewTestPhase` from `prReviewCompletion.ts`
- Clean up all re-exports in barrel files (`agents/index.ts`, `agents/testAgent.ts`, `phases/index.ts`, `phases/prReviewPhase.ts`, `workflowPhases.ts`, `adws/index.ts`)
- Delete the original `agents/regressionScenarioProof.ts`

### Phase 3: Integration — Clean up references
Update all documentation, slash commands, test fixtures, and BDD scenarios to remove references to the deleted symbols and the `e2e-tests/` directory convention.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1: Create `phases/scenarioProof.ts` by relocating `agents/regressionScenarioProof.ts`
- Copy the full contents of `adws/agents/regressionScenarioProof.ts` to `adws/phases/scenarioProof.ts`
- Keep all types (`TagProofResult`, `ScenarioProofResult`) and functions (`shouldRunScenarioProof`, `runScenarioProof`) intact
- The import of `runScenariosByTag` from `../agents/bddScenarioRunner` stays the same (path is still valid from `phases/`)
- The import of `ReviewProofConfig` from `../core/projectConfig` stays the same

### Step 2: Update all imports from `regressionScenarioProof` to `scenarioProof`
- `adws/phases/scenarioTestPhase.ts` — change `'../agents/regressionScenarioProof'` to `'./scenarioProof'`
- `adws/phases/scenarioFixPhase.ts` — change `'../agents/regressionScenarioProof'` to `'./scenarioProof'`
- `adws/agents/reviewRetry.ts` — change `'./regressionScenarioProof'` to `'../phases/scenarioProof'`
- `adws/github/proofCommentFormatter.ts` — change `'../agents/regressionScenarioProof'` to `'../phases/scenarioProof'`
- `adws/github/workflowCommentsIssue.ts` — change `'../agents/regressionScenarioProof'` to `'../phases/scenarioProof'`
- `adws/adwSdlc.tsx` — change `'./agents/regressionScenarioProof'` to `'./phases/scenarioProof'`
- `adws/phases/__tests__/scenarioTestPhase.test.ts` — update mock path and imports

### Step 3: Delete `agents/regressionScenarioProof.ts`
- Delete the file `adws/agents/regressionScenarioProof.ts`
- Remove the `regressionScenarioProof` export block from `adws/agents/index.ts` (lines 70-76)

### Step 4: Delete `agents/testDiscovery.ts`
- Delete the file `adws/agents/testDiscovery.ts`
- Remove the `testDiscovery` export block from `adws/agents/index.ts` (lines 40-47)
- Remove the E2E re-export block from `adws/agents/testAgent.ts` (lines 12-19) and the `E2ETestResult` re-import (line 22)

### Step 5: Remove `runE2ETestsWithRetry` and `runBddScenariosWithRetry` from `testRetry.ts`
- Delete the `runE2ETestsWithRetry` function (lines 99-226)
- Delete the `BddScenarioRetryOptions` interface and `runBddScenariosWithRetry` function (lines 228-324)
- Remove now-unused imports at the top of the file: `discoverE2ETestFiles`, `runPlaywrightE2ETests`, `isValidE2ETestResult`, `E2ETestResult`, `runResolveScenarioAgent`, `runScenariosByTag`
- Keep `runUnitTestsWithRetry`, `TestRetryResult`, and `TestRetryOptions`
- Update the `agents/index.ts` exports: remove `runE2ETestsWithRetry`, `runBddScenariosWithRetry`, `BddScenarioRetryOptions`; keep `runUnitTestsWithRetry`, `TestRetryResult`, `TestRetryOptions`

### Step 6: Remove `executePRReviewTestPhase` and its re-exports
- In `adws/phases/prReviewCompletion.ts`: delete the entire `executePRReviewTestPhase` function and remove the `runE2ETestsWithRetry` import from `'../agents'`
- In `adws/phases/index.ts`: remove `executePRReviewTestPhase` from the re-export
- In `adws/phases/prReviewPhase.ts`: remove `executePRReviewTestPhase` from the backward-compatible re-export block
- In `adws/workflowPhases.ts`: remove `executePRReviewTestPhase` from re-exports
- In `adws/index.ts`: remove `executePRReviewTestPhase` if present

### Step 7: Remove `runE2ETests` from `projectConfig.ts`
- Remove the `runE2ETests: string;` field from the `CommandsConfig` interface
- Remove `'run e2e tests': 'runE2ETests'` from `HEADING_TO_KEY`
- Remove `runE2ETests: 'bunx playwright test'` from `getDefaultCommandsConfig()`
- Check `adws/core/__tests__/projectConfig.test.ts` for any references to `runE2ETests` and remove/update them

### Step 8: Remove `## Run E2E Tests` from `.adw/commands.md` and test fixtures
- Remove the `## Run E2E Tests` section (heading + value) from `.adw/commands.md`
- Remove the `## Run E2E Tests` section from `test/fixtures/cli-tool/.adw/commands.md`

### Step 9: Update `.claude/commands/` to remove E2E test references
- `.claude/commands/feature.md`: Remove the `e2e-tests/` and E2E test file creation paragraphs (lines 27-31 and lines 96, 116)
- `.claude/commands/bug.md`: Remove the `e2e-tests/` and E2E test file creation paragraphs (lines 27-31 and lines 85, 93)
- `.claude/commands/adw_init.md`: Remove/update the `## Run E2E Tests` reference (line 42) and the E2E tool detection logic (line 93+)
- `.claude/commands/resolve_failed_scenario.md`: Update "E2E test" language to "scenario" throughout

### Step 10: Update `adws/README.md` and `README.md`
- `adws/README.md`: Remove references to `## Run E2E Tests` heading and `e2e-tests/` directory convention
- `README.md`: Remove `testDiscovery.ts` and `regressionScenarioProof.ts` from the project structure listing; add `scenarioProof.ts` under `phases/`

### Step 11: Update BDD feature files and step definitions
- `features/fix_bdd_scenarios_failure.feature`: Remove the two scenarios that specifically test `runBddScenariosWithRetry` internals (the stderr scenario at line 67 and the attempt count scenario at line 74). Keep the `unitTestPhase.ts does not import BDD runner` scenario.
- `features/step_definitions/fixBddScenariosFailureSteps.ts`: Remove step definitions for the deleted scenarios
- `features/step_definitions/compactionRecoveryTestReviewSteps.ts`: Remove or update the `runBddScenariosWithRetry` reference (line 656) — this assertion checked that `testRetry.ts` contained the function; update to verify the new testing path
- `features/step_def_generation_review_gating.feature`: Update the scenario at line 67-71 that checks `unitTestPhase.ts` does not call `runBddScenariosWithRetry` — this scenario is still valid since `unitTestPhase.ts` should not call it, but the step definition may need updating
- `features/step_definitions/stepDefGenReviewGatingSteps.ts`: Review the `runBddScenariosWithRetry` step def (line 165) — keep it if the .feature scenario still uses it

### Step 12: Update `adws/phases/index.ts` re-exports for `scenarioProof`
- Add re-exports for the new `scenarioProof.ts` module if needed by external consumers (at minimum `ScenarioProofResult` type and `shouldRunScenarioProof`, `runScenarioProof` functions)

### Step 13: Validation
- Run all validation commands listed below
- Verify no remaining references to deleted symbols: `grep -r "runE2ETestsWithRetry\|runPlaywrightE2ETests\|discoverE2ETestFiles\|testDiscovery\|regressionScenarioProof" adws/`
- Verify no remaining references in commands: `grep -r "runE2ETestsWithRetry\|runPlaywrightE2ETests\|discoverE2ETestFiles" .claude/commands/`

## Testing Strategy
### Unit Tests
No new unit tests are needed — this is a deletion task. Existing `projectConfig.test.ts` tests should still pass after removing the `runE2ETests` field (the tests don't reference it). The relocated `scenarioProof.ts` module preserves all existing behavior.

### Edge Cases
- `regressionScenarioProof.ts` is NOT dead code — it is actively imported by 7 files. Must be relocated, not simply deleted, to avoid breaking `scenarioTestPhase`, `scenarioFixPhase`, `reviewRetry`, `proofCommentFormatter`, `workflowCommentsIssue`, and `adwSdlc`.
- `runBddScenariosWithRetry` is confirmed dead in production orchestrator/phase code but is referenced in BDD feature files and step definitions that test its existence. These test assertions need updating.
- `executePRReviewTestPhase` is dead code — it's defined and re-exported but never called by any orchestrator. Safe to delete.
- `E2ETestResult` type is still used by `testAgent.ts::runResolveScenarioAgent` for its parameter type. After deleting `testDiscovery.ts`, this type must remain available — it should be inlined or kept in `testAgent.ts` since `runResolveScenarioAgent` still needs it.
- BDD step definitions that assert "file contains X" will fail if the source function is deleted — update the assertions.

## Acceptance Criteria
- All listed functions and files deleted: `testDiscovery.ts`, `regressionScenarioProof.ts` (relocated to `phases/scenarioProof.ts`)
- `runE2ETestsWithRetry`, `runBddScenariosWithRetry`, `runPlaywrightE2ETests`, `discoverE2ETestFiles` no longer exist
- `executePRReviewTestPhase` removed from all files
- `## Run E2E Tests` heading removed from `projectConfig.ts` schema and `.adw/commands.md`
- No remaining references to deleted symbols anywhere in `adws/` or `.claude/commands/`
- `E2ETestResult` type preserved in `testAgent.ts` for `runResolveScenarioAgent` parameter
- Type check (`bunx tsc --noEmit`) passes
- Additional type check (`bunx tsc --noEmit -p adws/tsconfig.json`) passes
- Existing tests still pass (`bun run test`)
- Lint passes (`bun run lint`)
- BDD regression scenarios pass (`NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"`)

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type check the project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Additional type check for adws
- `bun run test` — Run unit tests to validate zero regressions
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run BDD regression scenarios
- `grep -r "runE2ETestsWithRetry\|runPlaywrightE2ETests\|discoverE2ETestFiles\|runBddScenariosWithRetry" adws/` — Verify no remaining references in source code (should return nothing)
- `grep -r "testDiscovery\|regressionScenarioProof" adws/ --include="*.ts" --include="*.tsx"` — Verify no remaining import references (should return nothing)
- `grep -r "executePRReviewTestPhase" adws/` — Verify dead function removed (should return nothing)

## Notes
- **Critical finding:** `regressionScenarioProof.ts` is NOT dead code. It is actively imported by `scenarioTestPhase.ts`, `scenarioFixPhase.ts`, `reviewRetry.ts`, `proofCommentFormatter.ts`, `workflowCommentsIssue.ts`, `adwSdlc.tsx`, and `scenarioTestPhase.test.ts`. The issue describes it as "logic moved to scenarioTestPhase" but in reality `scenarioTestPhase` delegates to it. The solution is to relocate it from `agents/` to `phases/` (where it logically belongs as phase-level infrastructure) rather than inlining it.
- **`E2ETestResult` type survival:** The `E2ETestResult` interface is used by `runResolveScenarioAgent` in `testAgent.ts` (for scenario fix payloads). After deleting `testDiscovery.ts`, this type should be defined directly in `testAgent.ts` or in a shared types file. The simplest approach is to inline it in `testAgent.ts` where it is already re-exported.
- **Documentation cleanup is extensive:** Multiple `.claude/commands/` files, `adws/README.md`, and the root `README.md` reference E2E concepts. These need consistent updates but are low-risk changes.
- Follow `guidelines/coding_guidelines.md` throughout — especially: remove unused imports/exports, keep files under 300 lines, and maintain type safety.
