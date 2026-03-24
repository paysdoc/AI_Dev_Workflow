# Patch: Update stale @regression scenarios for config-driven architecture

## Metadata
adwId: `9k4ut2-machine-readable-rev`
reviewChangeRequest: `specs/issue-273-adw-s18k21-machine-readable-rev-sdlc_planner-machine-readable-review-proof.md`

## Issue Summary
**Original Spec:** specs/issue-273-adw-s18k21-machine-readable-rev-sdlc_planner-machine-readable-review-proof.md
**Issue:** 3 scenarios in `features/replace_crucial_with_regression.feature` (lines 34, 55, 62) fail because they assert the old hardcoded `@regression` behavior that issue #273 intentionally replaced with config-driven tags. Specifically: (1) asserts `regressionScenarioProof.ts` contains `@regression` string, (2) asserts `ScenarioProofResult` has `regressionPassed` field, (3) asserts `runRegressionScenarioProof` references `regression` tag directly.
**Solution:** Update the 3 failing scenario assertions to reflect the new config-driven architecture — assert `ReviewProofConfig` usage, `tagResults`/`hasBlockerFailures` fields, and config-driven tag iteration instead of hardcoded `@regression` references. No step definition changes needed — existing generic string-includes steps already support the new assertions.

## Files to Modify

- `features/replace_crucial_with_regression.feature` — Update 3 scenarios (lines 34, 55, 62) to assert config-driven behavior instead of hardcoded `@regression`

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Update scenario at line 34 — regressionScenarioProof.ts tag assertion
- **Current** (line 38): `And the string "@regression" is present where the regression tag is referenced`
- **New**: `And the string "ReviewProofConfig" is present where the regression tag is referenced`
- **Why**: `regressionScenarioProof.ts` no longer contains the literal `@regression` string. It imports and uses `ReviewProofConfig` to drive tag execution. The existing step definition at `replaceCrucialWithRegressionSteps.ts:161-168` performs `sharedCtx.fileContent.includes(expected)`, so `"ReviewProofConfig"` matches the import on line 12 of `regressionScenarioProof.ts`.
- Also update the scenario title to: `Scenario: regressionScenarioProof.ts source file does not reference @crucial and uses config-driven tags`

### Step 2: Update scenario at line 55 — ScenarioProofResult interface field assertion
- **Current** (line 58): `Then the interface contains a field named "regressionPassed"`
- **New**: `Then the interface contains a field named "tagResults"`
- **Why**: `ScenarioProofResult` replaced the `regressionPassed` boolean with a generic `tagResults: TagProofResult[]` array. The step definition at `replaceCrucialWithRegressionSteps.ts:71-73` performs `sharedCtx.fileContent.includes(field)`, so `"tagResults"` matches line 41 of `regressionScenarioProof.ts`.
- Also update the scenario title to: `Scenario: ScenarioProofResult interface uses tagResults instead of crucialPassed`
- **Current** (line 59): `And the interface does not contain a field named "crucialPassed"` — keep as-is (still valid)
- Add: `And the interface does not contain a field named "regressionPassed"` — verify old field is gone too

### Step 3: Update scenario at line 62 — function tag reference assertion
- **Current** (line 63): `Given the "runRegressionScenarioProof" function in "adws/agents/regressionScenarioProof.ts" is read`
- **New**: `Given the "runScenarioProof" function in "adws/agents/regressionScenarioProof.ts" is read`
- **Current** (line 65): `Then it passes "regression" (or the resolved tag from runRegressionCommand) as the tag argument`
- **New**: `Then it passes "reviewProofConfig" (or the resolved tag from runRegressionCommand) as the tag argument`
- **Why**: The function was renamed from `runRegressionScenarioProof` to `runScenarioProof` and now iterates `reviewProofConfig.tags` instead of passing a hardcoded `"regression"` tag. The step definition at `replaceCrucialWithRegressionSteps.ts:87-98` just reads the file (doesn't validate function name). The step at lines 111-118 performs `sharedCtx.fileContent.includes(tag)`, so `"reviewProofConfig"` matches multiple occurrences.
- Also update the scenario title to: `Scenario: runScenarioProof function iterates config-driven tags instead of hardcoded regression`
- Keep: `And it does not hard-code the string "crucial" as the tag argument` — still valid

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bunx cucumber-js features/replace_crucial_with_regression.feature --tags "@adw-20eum6-replace-crucial-with and @regression"` — Run only the 3 previously-failing scenarios (they all carry both tags)
- `bunx cucumber-js features/replace_crucial_with_regression.feature` — Run all scenarios in the feature file to confirm no regressions
- `bun run lint` — Verify linting passes
- `bunx tsc --noEmit` — Root-level TypeScript type check
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type check

## Patch Scope
**Lines of code to change:** ~10 lines in 1 file
**Risk level:** low
**Testing required:** Run the 3 updated scenarios plus the full feature file to confirm all pass
