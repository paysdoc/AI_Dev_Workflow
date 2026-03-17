# Patch: Implement missing step definitions for remove_run_bdd_scenarios_command.feature

## Metadata
adwId: `u8okxe-bug-issues-should-us`
reviewChangeRequest: `specs/issue-211-adw-u8okxe-bug-issues-should-us-sdlc_planner-bug-sdlc-chore-classifier.md`

## Issue Summary
**Original Spec:** specs/issue-211-adw-u8okxe-bug-issues-should-us-sdlc_planner-bug-sdlc-chore-classifier.md
**Issue:** The @regression suite fails (exit code 1) because 7 scenarios in `features/remove_run_bdd_scenarios_command.feature` have undefined step definitions. These are pre-existing failures from PR #205 — not caused by this branch's changes. The missing steps include patterns like `searching for the {string} heading`, `searching for the {string} interface definition`, `{string} is not defined in {string}`, `{string} is not called in {string}`, `{string} is not imported in {string}`, and several others.
**Solution:** Create a new step definitions file `features/step_definitions/removeRunBddScenariosSteps.ts` implementing all missing step definitions for the 7 @regression-tagged scenarios. Each step follows the established pattern: `When` steps are context-only pass-throughs, `Then` steps use `sharedCtx` from `commonSteps.ts` to assert content presence/absence via string includes or regex checks.

## Files to Modify
Use these files to implement the patch:

- `features/step_definitions/removeRunBddScenariosSteps.ts` — **NEW FILE** — Contains all missing step definitions for `remove_run_bdd_scenarios_command.feature` @regression scenarios.

Reference files (read-only, for pattern/convention guidance):
- `features/step_definitions/commonSteps.ts` — Provides `sharedCtx` export and shared Given/When/Then steps.
- `features/step_definitions/replaceCrucialWithRegressionSteps.ts` — Exemplifies the code-inspection step pattern (context-only When, assertion-based Then using `sharedCtx`).
- `features/step_definitions/removeUnnecessaryExportsSteps.ts` — Exemplifies export-checking patterns with regex.
- `features/remove_run_bdd_scenarios_command.feature` — The feature file with the 7 failing @regression scenarios.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Create the step definitions file
- Create `features/step_definitions/removeRunBddScenariosSteps.ts`
- Import `{ When, Then }` from `@cucumber/cucumber`, `assert` from `assert`, and `{ sharedCtx }` from `./commonSteps.ts`
- Implement the following step definitions (all operate on `sharedCtx.fileContent` and `sharedCtx.filePath` which are populated by the existing `Given('{string} is read', ...)` step in `commonSteps.ts`):

**Context-only When steps (no-op, assertions happen in Then):**
1. `When('searching for the {string} heading', ...)` — context-only
2. `When('searching for the {string} interface definition', ...)` — context-only
3. `When('searching for the {string} function definition', ...)` — context-only
4. `When('searching for {string} in export statements', ...)` — context-only
5. `When('searching for BDD scenario execution calls', ...)` — context-only
6. `When('searching for BDD scenario execution calls in the retry path', ...)` — context-only
7. `When('searching for the {string} interface or type definition', ...)` — context-only

**Assertion Then steps:**
8. `Then('no {string} heading exists in {string}', (heading, filePath) => ...)` — assert `sharedCtx.fileContent` does NOT include the heading string
9. `Then('the {string} section is still present in {string}', (section, filePath) => ...)` — assert `sharedCtx.fileContent` DOES include the section string
10. `Then('the interface does not contain a {string} field', (field) => ...)` — assert `sharedCtx.fileContent` does NOT include the field name
11. `Then('the interface still contains a {string} field', (field) => ...)` — assert `sharedCtx.fileContent` DOES include the field name
12. `Then('{string} is not defined in {string}', (symbol, filePath) => ...)` — assert `sharedCtx.fileContent` does NOT match a function/const/class definition of the symbol (use regex: `export\s+(?:async\s+)?(?:function|const)\s+{symbol}\b` or simple `.includes()`)
13. `Then('{string} is still defined and exported from {string}', (symbol, filePath) => ...)` — assert `sharedCtx.fileContent` DOES match an exported definition of the symbol
14. `Then('{string} does not appear in any export statement in {string}', (symbol, filePath) => ...)` — assert `sharedCtx.fileContent` does NOT contain the symbol in export statements (check `export` lines for the symbol)
15. `Then('{string} is not called in {string}', (fn, filePath) => ...)` — assert `sharedCtx.fileContent` does NOT contain `{fn}(`
16. `Then('the BDD scenario execution uses {string} as the command', (cmd) => ...)` — assert `sharedCtx.fileContent` DOES include the command string
17. `Then('the tag passed to the scenario runner is constructed from the issue number \\(e.g. {string}\\)', (tag) => ...)` — assert `sharedCtx.fileContent` includes `adw-` tag pattern (use regex or string check for `adw-` or the literal tag pattern)
18. `Then('{string} is not imported in {string}', (symbol, filePath) => ...)` — assert `sharedCtx.fileContent` does NOT contain `import.*{symbol}` pattern
19. `Then('the BDD scenario retry function calls {string} internally', (fn) => ...)` — assert `sharedCtx.fileContent` DOES include the function name
20. `Then('the tag passed is {string} constructed from the issueNumber option', (tag) => ...)` — assert `sharedCtx.fileContent` includes `adw-` tag construction pattern
21. `Then('the options type does not contain a {string} field sourced from {string} config', (field, source) => ...)` — assert `sharedCtx.fileContent` does NOT include the field name in the options type context
22. `Then('the options type contains a field for the {string} command', (cmd) => ...)` — assert `sharedCtx.fileContent` DOES include a reference to the command
23. `Then('the options type still contains an {string} field', (field) => ...)` — assert `sharedCtx.fileContent` DOES include the field name

### Step 2: Verify step definitions resolve the failures
- Run `npx cucumber-js --tags @regression features/remove_run_bdd_scenarios_command.feature` to confirm all 7 @regression scenarios pass with the new step definitions
- If any step still shows as undefined, compare the step text in the feature file with the step definition pattern — Cucumber is strict about whitespace and punctuation

### Step 3: Run full regression suite
- Run the full `@regression` tag suite to confirm no regressions: `npx cucumber-js --tags @regression`

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `npx cucumber-js --tags @regression features/remove_run_bdd_scenarios_command.feature` — Confirm the 7 previously-failing @regression scenarios now pass
- `npx cucumber-js --tags @regression` — Confirm full regression suite passes
- `bunx tsc --noEmit --project adws/tsconfig.json` — Type-check the ADW TypeScript project
- `bunx tsc --noEmit` — Type-check the root TypeScript project
- `bun run lint` — Run linter to check for code quality issues

## Patch Scope
**Lines of code to change:** ~100 (new file with ~23 step definitions)
**Risk level:** low
**Testing required:** Run @regression-tagged Cucumber scenarios to confirm all pass; run full validation suite (tsc, lint) to confirm no regressions
