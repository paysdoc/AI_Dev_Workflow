# Feature: Implement all undefined cucumber step definitions

## Metadata
issueNumber: `215`
adwId: `fla3u2-1773754088098`
issueJson: `{"number":215,"title":"Implement all undefined cucumber step definitions","body":"## User Story\n\nAs a developer running the BDD regression suite, I want all cucumber scenarios to have fully implemented step definitions so that every scenario executes and validates the codebase instead of being silently skipped as undefined.\n\n## Context\n\nA dry-run of `bunx cucumber-js --dry-run` reveals **6 scenarios with 17 undefined steps** across two feature files. The remaining 167 scenarios are fully wired. This issue completes the last mile.\n\n## Undefined Steps\n\n### `features/remove_run_bdd_scenarios_command.feature` — 4 scenarios, 10 undefined steps\n\n**Scenario: runBddScenarios is removed from HEADING_TO_KEY map** (line 31)\n- `When searching for the {string} map`\n- `Then the map does not contain an entry mapping to {string}`\n- `Then the map still contains an entry mapping to {string}`\n\n**Scenario: runBddScenarios is removed from getDefaultCommandsConfig** (line 38)\n- `When searching for the {string} function body`\n- `Then the returned object does not contain a {string} property`\n- `Then the returned object still contains a {string} property`\n\n**Scenario: adwTest.tsx uses runScenariosByTag with adw-issueNumber tag** (line 71)\n- `Then the BDD scenario execution uses the {string} command from project config`\n- `Then the tag argument is derived from the issue number`\n\n**Scenario: .adw/conditional_docs.md does not reference Run BDD Scenarios** (line 108)\n- `Then no reference to {string} is found in {string}`\n- `Then {string} is referenced in its place where applicable`\n\n### `features/remove_unit_tests.feature` — 2 scenarios, 7 undefined steps\n\n**Scenario: No vitest imports remain in any source file after removal** (line 50)\n- `Given all unit test files have been deleted`\n- `Then no file contains an import from {string}`\n- `Then no file references vitest globals such as {string}, {string}, {string}, or {string} in a test context`\n\n**Scenario: bun install completes without errors after vitest removal** (line 57)\n- `Given {string} has been removed from {string} devDependencies`\n- `When {string} is run`\n- `Then bun install exits with code {int}`\n- `Then no missing dependency errors are reported`\n\n## Implementation Notes\n\n- Steps for `remove_run_bdd_scenarios_command.feature` go in `features/step_definitions/removeRunBddScenariosSteps.ts`\n- Steps for `remove_unit_tests.feature` go in `features/step_definitions/removeUnitTestsSteps.ts`\n- Reuse existing patterns: `sharedCtx.fileContent` for file content assertions, `spawnSync` for command execution, `findFiles()` helper for recursive scanning\n- All steps follow the established conventions in `commonSteps.ts` (file reading, string matching, regex-based symbol checking)\n\n## Acceptance Criteria\n\n- [ ] All 17 undefined steps have implementations in the appropriate step definition files\n- [ ] `bunx cucumber-js --dry-run` reports 0 undefined scenarios and 0 undefined steps\n- [ ] `bunx cucumber-js` passes all 173 scenarios (previously defined scenarios remain green)\n- [ ] All `@regression`-tagged scenarios pass during review\n\n## Review\n\nThis is a **feature** — all regression scenarios must be run during the review phase.","state":"OPEN","author":"paysdoc","labels":["enhancement"],"createdAt":"2026-03-17T13:27:50Z","comments":[],"actionableComment":null}`

## Feature Description
Implement the 17 undefined cucumber step definitions across two feature files (`remove_run_bdd_scenarios_command.feature` and `remove_unit_tests.feature`) so that the BDD regression suite has zero undefined steps. Currently, a dry-run of `bunx cucumber-js --dry-run` reveals 6 scenarios with 17 undefined steps, while the remaining 167 scenarios are fully wired. This completes the last mile of BDD coverage.

## User Story
As a developer running the BDD regression suite
I want all cucumber scenarios to have fully implemented step definitions
So that every scenario executes and validates the codebase instead of being silently skipped as undefined

## Problem Statement
6 cucumber scenarios across two feature files have 17 undefined steps. These scenarios are silently skipped during regression runs, meaning the assertions they describe are never actually validated. This undermines confidence in the BDD safety net.

## Solution Statement
Add the 17 missing step definitions to the two existing step definition files (`removeRunBddScenariosSteps.ts` and `removeUnitTestsSteps.ts`), following established patterns from `commonSteps.ts` and other step definition files. The steps use `sharedCtx.fileContent` for file content assertions, `spawnSync` for command execution, and `findFiles()` for recursive source scanning.

## Relevant Files
Use these files to implement the feature:

- `features/remove_run_bdd_scenarios_command.feature` — Feature file containing 4 scenarios with 10 undefined steps that need wiring
- `features/remove_unit_tests.feature` — Feature file containing 2 scenarios with 7 undefined steps that need wiring
- `features/step_definitions/removeRunBddScenariosSteps.ts` — Target file for the 10 new step definitions for the remove-run-bdd-scenarios feature
- `features/step_definitions/removeUnitTestsSteps.ts` — Target file for the 7 new step definitions for the remove-unit-tests feature
- `features/step_definitions/commonSteps.ts` — Shared step definitions and `sharedCtx` export; pattern reference for all step definitions
- `features/step_definitions/removeUnnecessaryExportsSteps.ts` — Reference for `spawnSync`-based command execution pattern (`When '{string}' is executed`) and exit code assertion pattern (`Then 'both type-check commands exit with code {int}'`)
- `features/step_definitions/replaceCrucialWithRegressionSteps.ts` — Reference for `Given 'all TypeScript source files under {string} are scanned'` context-only pattern
- `guidelines/coding_guidelines.md` — Coding guidelines that must be followed

### New Files
No new files are needed. All step definitions go into existing files.

## Implementation Plan
### Phase 1: Add missing steps to removeRunBddScenariosSteps.ts
Add 10 new step definitions for the 4 undefined scenarios in `remove_run_bdd_scenarios_command.feature`:
1. `When searching for the {string} map` — context-only step
2. `Then the map does not contain an entry mapping to {string}` — assert `sharedCtx.fileContent` does not contain the string
3. `Then the map still contains an entry mapping to {string}` — assert `sharedCtx.fileContent` contains the string
4. `When searching for the {string} function body` — context-only step
5. `Then the returned object does not contain a {string} property` — assert `sharedCtx.fileContent` does not contain the string
6. `Then the returned object still contains a {string} property` — assert `sharedCtx.fileContent` contains the string
7. `Then the BDD scenario execution uses the {string} command from project config` — assert `sharedCtx.fileContent` contains the command string
8. `Then the tag argument is derived from the issue number` — assert `sharedCtx.fileContent` contains `adw-` tag construction
9. `Then no reference to {string} is found in {string}` — assert `sharedCtx.fileContent` does not contain the reference
10. `Then {string} is referenced in its place where applicable` — assert `sharedCtx.fileContent` contains the replacement reference

### Phase 2: Add missing steps to removeUnitTestsSteps.ts
Add 7 new step definitions for the 2 undefined scenarios in `remove_unit_tests.feature`:
1. `Given all unit test files have been deleted` — context-only step (deletion already happened)
2. `Then no file contains an import from {string}` — scan all `.ts` files under `adws/` and assert none import the given module
3. `Then no file references vitest globals such as {string}, {string}, {string}, or {string} in a test context` — scan all `.ts` files under `adws/` and assert none reference vitest globals
4. `Given {string} has been removed from {string} devDependencies` — context-only step (removal already happened)
5. `When {string} is run` — execute the command via `spawnSync` and store result in world context
6. `Then bun install exits with code {int}` — assert the stored command result has the expected exit code
7. `Then no missing dependency errors are reported` — assert the stored command result stderr does not contain dependency errors

### Phase 3: Validation
Run `bunx cucumber-js --dry-run` to confirm 0 undefined steps, then run full `bunx cucumber-js` to confirm all 173 scenarios pass.

## Step by Step Tasks

### Step 1: Read existing step definitions and feature files
- Read `features/step_definitions/removeRunBddScenariosSteps.ts` to understand existing steps and identify where to add new ones
- Read `features/step_definitions/removeUnitTestsSteps.ts` to understand existing steps and identify where to add new ones
- Read `features/remove_run_bdd_scenarios_command.feature` lines 31–112 for the exact step text
- Read `features/remove_unit_tests.feature` lines 50–61 for the exact step text
- Read `features/step_definitions/commonSteps.ts` for `sharedCtx` pattern
- Read `features/step_definitions/removeUnnecessaryExportsSteps.ts` for `spawnSync` and exit code patterns

### Step 2: Add 10 missing steps to removeRunBddScenariosSteps.ts
Add the following step definitions to `features/step_definitions/removeRunBddScenariosSteps.ts`:

- **`When('searching for the {string} map', ...)`** — context-only step (assertions in Then steps)
- **`Then('the map does not contain an entry mapping to {string}', ...)`** — assert `!sharedCtx.fileContent.includes(mapping)`, checking the key does not appear in the HEADING_TO_KEY map
- **`Then('the map still contains an entry mapping to {string}', ...)`** — assert `sharedCtx.fileContent.includes(mapping)`, confirming the key is still present
- **`When('searching for the {string} function body', ...)`** — context-only step
- **`Then('the returned object does not contain a {string} property', ...)`** — assert `!sharedCtx.fileContent.includes(prop)` within the function body context
- **`Then('the returned object still contains a {string} property', ...)`** — assert `sharedCtx.fileContent.includes(prop)`
- **`Then('the BDD scenario execution uses the {string} command from project config', ...)`** — assert `sharedCtx.fileContent.includes(cmd)`
- **`Then('the tag argument is derived from the issue number', ...)`** — assert `sharedCtx.fileContent` contains `adw-` tag construction pattern (e.g., `adw-${` or `adw-` combined with issue number variable)
- **`Then('no reference to {string} is found in {string}', ...)`** — assert `!sharedCtx.fileContent.includes(ref)`
- **`Then('{string} is referenced in its place where applicable', ...)`** — assert `sharedCtx.fileContent.includes(replacement)`

Follow existing conventions:
- Use `function()` syntax (not arrow functions) for access to `this`
- Use `sharedCtx` from `commonSteps.ts` for file content assertions
- Use `assert` from Node.js built-in `assert` module

### Step 3: Add 7 missing steps to removeUnitTestsSteps.ts
Add the following step definitions to `features/step_definitions/removeUnitTestsSteps.ts`:

- **`Given('all unit test files have been deleted', ...)`** — context-only step (deletion already happened)
- **`Then('no file contains an import from {string}', ...)`** — use `findFiles()` to find all `.ts` files under `adws/`, read each, assert none contain `import.*{module}` pattern
- **`Then('no file references vitest globals such as {string}, {string}, {string}, or {string} in a test context', ...)`** — use `findFiles()` to find all `.ts` files under `adws/`, read each, assert none contain the given global identifiers in import or call contexts
- **`Given('{string} has been removed from {string} devDependencies', ...)`** — context-only step (removal already happened)
- **`When('{string} is run', ...)`** — split command string, run via `spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf-8', timeout: 120000 })`, store result as `this.__commandResult`
- **`Then('bun install exits with code {int}', ...)`** — read `this.__commandResult`, assert `result.status === expectedCode`
- **`Then('no missing dependency errors are reported', ...)`** — read `this.__commandResult`, assert stderr does not contain `error:` or `missing dependency` patterns

Import `spawnSync` from `child_process` at the top of the file. The `findFiles()` helper already exists in this file.

### Step 4: Verify dry-run reports 0 undefined steps
- Run `bunx cucumber-js --dry-run`
- Confirm output shows `173 scenarios (173 skipped)` and `920 steps (920 skipped)` with 0 undefined
- If any undefined steps remain, fix them before proceeding

### Step 5: Run full cucumber suite and validate all 173 scenarios pass
- Run `bunx cucumber-js`
- Confirm all 173 scenarios pass
- If any scenarios fail, investigate and fix the step implementation
- Run `bunx cucumber-js --tags "@regression"` to confirm all regression-tagged scenarios pass

### Step 6: Run validation commands
- Run `bun run lint` to check for code quality issues
- Run `bunx tsc --noEmit` to verify TypeScript compilation
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify adws-specific TypeScript compilation
- Run `bunx cucumber-js --dry-run` to confirm 0 undefined steps
- Run `bunx cucumber-js` to confirm all 173 scenarios pass

## Testing Strategy

### Edge Cases
- Ensure the new `When('{string} is run', ...)` step in removeUnitTestsSteps.ts does not conflict with the existing `When('{string} is executed', ...)` step in removeUnnecessaryExportsSteps.ts — they use different Cucumber expressions so there is no conflict
- Ensure the new `Then('no file contains an import from {string}', ...)` step in removeUnitTestsSteps.ts does not conflict with the existing `Then('no file contains a call to {string}', ...)` in removeRunBddScenariosSteps.ts — different expression text, no conflict
- The `When('{string} is run', ...)` step must handle multi-word commands like `bun install` by splitting on whitespace
- The vitest globals scanning step receives 4 string parameters — ensure the cucumber expression handles all 4 correctly
- The `findFiles()` helper must exclude `node_modules/` and `.git/` to avoid false positives

## Acceptance Criteria
- All 17 undefined steps have implementations in the appropriate step definition files
- `bunx cucumber-js --dry-run` reports 0 undefined scenarios and 0 undefined steps (173 scenarios, 920 steps all skipped)
- `bunx cucumber-js` passes all 173 scenarios (previously defined scenarios remain green)
- All `@regression`-tagged scenarios pass
- `bun run lint` passes with no errors
- `bunx tsc --noEmit` passes with no errors
- `bunx tsc --noEmit -p adws/tsconfig.json` passes with no errors

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Verify TypeScript compilation succeeds
- `bunx tsc --noEmit -p adws/tsconfig.json` — Verify adws-specific TypeScript compilation succeeds
- `bunx cucumber-js --dry-run` — Confirm 0 undefined scenarios and 0 undefined steps
- `bunx cucumber-js` — Run all 173 scenarios and confirm they all pass

## Notes
- Follow the coding guidelines in `guidelines/coding_guidelines.md` — use `function()` syntax for step definitions (not arrow functions), meaningful assertion messages, and clear variable names
- No new libraries required — all needed imports (`@cucumber/cucumber`, `assert`, `fs`, `child_process`) are already available
- No unit tests per `.adw/project.md` (`## Unit Tests: disabled`)
- The existing `When('{string} and {string} are run', ...)` pattern in `removeUnnecessaryExportsSteps.ts` is a good reference for the `spawnSync` approach, but the new `When('{string} is run', ...)` step is simpler since it runs a single command
- All 10 steps added to `removeRunBddScenariosSteps.ts` follow the same `sharedCtx.fileContent` assertion pattern already used extensively in that file
