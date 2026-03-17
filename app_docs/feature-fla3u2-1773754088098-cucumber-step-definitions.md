# Cucumber Step Definitions: Complete BDD Coverage

**ADW ID:** fla3u2-1773754088098
**Date:** 2026-03-17
**Specification:** specs/issue-215-adw-fla3u2-1773754088098-sdlc_planner-implement-cucumber-step-definitions.md

## Overview

Implements 17 previously undefined Cucumber step definitions across two step definition files, completing BDD regression coverage for the `remove_run_bdd_scenarios_command.feature` and `remove_unit_tests.feature` feature files. Prior to this change, 6 scenarios with 17 steps were silently skipped during regression runs. All 173 scenarios in the suite now execute and validate the codebase.

## What Was Built

- 10 new step definitions in `removeRunBddScenariosSteps.ts` covering HEADING_TO_KEY map assertions, function body assertions, adwTest.tsx command assertions, and conditional_docs.md reference assertions
- 7 new step definitions in `removeUnitTestsSteps.ts` covering vitest import scanning, vitest global scanning, `bun install` execution and exit code assertion
- ADW tag `@adw-fla3u2-1773754088098` added to the 6 previously-undefined scenarios in both feature files

## Technical Implementation

### Files Modified

- `features/step_definitions/removeRunBddScenariosSteps.ts`: Added 10 step definitions using `sharedCtx.fileContent` assertions for map/function body/command/reference checks
- `features/step_definitions/removeUnitTestsSteps.ts`: Added 7 step definitions including `spawnSync`-based command execution and recursive file scanning via `findFiles()`
- `features/remove_run_bdd_scenarios_command.feature`: Added `@adw-fla3u2-1773754088098` tag to 4 scenarios
- `features/remove_unit_tests.feature`: Added `@adw-fla3u2-1773754088098` tag to 2 scenarios; fixed scenario title to reflect `test:watch` only removal
- `package.json`: Minor update (restore test script)

### Key Changes

- `When('searching for the {string} map', ...)` and `When('searching for the {string} function body', ...)` are context-only no-op steps; assertions are deferred to `Then` steps that read `sharedCtx.fileContent`
- `Then('no file contains an import from {string}', ...)` and the vitest globals step use `findFiles(join(ROOT, 'adws'), /\.ts$/)` to recursively scan all TypeScript source files
- `When('{string} is run', ...)` splits the command string on whitespace and executes via `spawnSync` with a 120-second timeout, storing the result for subsequent `Then` assertions
- `Then('bun install exits with code {int}', ...)` asserts `result.status === expectedCode`; `Then('no missing dependency errors are reported', ...)` asserts stderr is free of `error:` patterns
- `spawnSync` imported from `child_process` added to `removeUnitTestsSteps.ts`

## How to Use

1. Run `bunx cucumber-js --dry-run` — should report `173 scenarios (173 skipped)` with 0 undefined steps
2. Run `bunx cucumber-js` — all 173 scenarios should pass
3. Run `bunx cucumber-js --tags "@regression"` — all regression-tagged scenarios should pass
4. Run `bunx cucumber-js --tags "@adw-fla3u2-1773754088098"` to execute only the 6 scenarios added in this feature

## Configuration

No new configuration required. The steps use the existing `ROOT` constant and `sharedCtx` shared context from `commonSteps.ts`.

## Testing

```bash
bunx cucumber-js --dry-run   # Verify 0 undefined steps
bunx cucumber-js             # Verify all 173 scenarios pass
bunx cucumber-js --tags "@adw-fla3u2-1773754088098"  # Verify only the 6 new scenarios
```

## Notes

- The `When('{string} is run', ...)` step is distinct from the existing `When('{string} is executed', ...)` in `removeUnnecessaryExportsSteps.ts` — no conflict
- The vitest globals step accepts 4 string parameters matching the Cucumber expression `{string}, {string}, {string}, or {string}`
- `findFiles()` already excludes `node_modules/` and `.git/` directories
