# Patch: Implement missing step definitions for remove_unit_tests.feature

## Metadata
adwId: `u8okxe-bug-issues-should-us`
reviewChangeRequest: `specs/issue-211-adw-u8okxe-bug-issues-should-us-sdlc_planner-bug-sdlc-chore-classifier.md`

## Issue Summary
**Original Spec:** specs/issue-211-adw-u8okxe-bug-issues-should-us-sdlc_planner-bug-sdlc-chore-classifier.md
**Issue:** The @regression suite fails (exit code 1) because 5 scenarios in `features/remove_unit_tests.feature` have undefined step definitions. These are pre-existing failures from issue 202 (remove unit tests chore) whose step definitions were never implemented — not regressions caused by the current issue 211 changes. The undefined steps include: `the repository is at the current working directory`, `no *.test.ts files exist anywhere in the repository`, `the {string} directory does not exist`, file/dependency existence checks, and package.json content assertions.
**Solution:** Create `features/step_definitions/removeUnitTestsSteps.ts` implementing all missing step definitions for the 5 @regression-tagged scenarios. Given/When steps are context-only (the removal already happened in issue 202), and Then steps assert current filesystem/file contents to verify the post-removal state holds.

## Files to Modify
Use these files to implement the patch:

- `features/step_definitions/removeUnitTestsSteps.ts` — **NEW FILE** — Contains all missing step definitions for the 5 @regression scenarios in `remove_unit_tests.feature`.

Reference files (read-only, for pattern/convention guidance):
- `features/step_definitions/commonSteps.ts` — Provides shared Given/When/Then steps. Note existing step `Given('the ADW codebase is checked out', ...)`.
- `features/step_definitions/removeUnnecessaryExportsSteps.ts` — Contains reusable steps `When('{string} and {string} are run', ...)` and `Then('both type-check commands exit with code {int}', ...)` already consumed by Scenario 5.
- `features/remove_unit_tests.feature` — The feature file with the 5 failing @regression scenarios.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Create `features/step_definitions/removeUnitTestsSteps.ts`
- Import `{ Given, When, Then }` from `@cucumber/cucumber`, `{ existsSync, readFileSync, readdirSync, statSync }` from `fs`, `{ join }` from `path`, and `assert` from `assert`
- Use `const ROOT = process.cwd();` consistent with other step definition files
- Add a recursive `findFiles(dir, pattern)` helper (excluding `node_modules`) to scan for matching filenames
- Implement the following 17 step definitions:

**Background step (shared by all 5 scenarios):**
1. `Given('the repository is at the current working directory', ...)` — Assert `existsSync(join(ROOT, 'adws'))` and `existsSync(join(ROOT, 'package.json'))`.

**Scenario 1 — All *.test.ts files are deleted:**
2. `Given('the repository contains unit test files under {string}, {string}, and {string}', ...)` — Context-only no-op.
3. `When('all unit test files are deleted as part of issue {int}', ...)` — Context-only no-op.
4. `Then('no {string} files exist anywhere in the repository', ...)` — Use `findFiles` with a regex derived from the glob pattern; assert zero matches.
5. `Then('the {string} directory does not exist', ...)` — Assert `!existsSync(join(ROOT, dirPath))`.

**Scenario 2 — vitest.config.ts is removed:**
6. `Given('{string} exists at the project root', ...)` — Context-only no-op.
7. `When('the Vitest configuration file is deleted', ...)` — Context-only no-op.
8. `Then('{string} does not exist in the repository', ...)` — Assert `!existsSync(join(ROOT, fileName))`.

**Scenario 3 — vitest dependency is removed from package.json:**
9. `Given('{string} lists {string} under devDependencies', ...)` — Context-only no-op.
10. `When('the vitest package and related test dependencies are removed from {string}', ...)` — Context-only no-op.
11. `Then('{string} does not contain {string} as a dependency', ...)` — Parse `package.json`, assert dep not in `dependencies` or `devDependencies`.
12. `Then('{string} does not reference {string}', ...)` — Read file as text, assert content does not include term.

**Scenario 4 — test scripts are removed from package.json:**
13. `Given('{string} contains a {string} script and a {string} script', ...)` — Context-only no-op.
14. `When('the test scripts are removed from {string}', ...)` — Context-only no-op.
15. `Then('{string} does not contain a {string} script entry', ...)` — Parse `package.json`, assert script name not in `scripts`.

**Scenario 5 — TypeScript compilation succeeds (partial — When/Then for tsc already defined in removeUnnecessaryExportsSteps.ts):**
16. `Given('all unit test files and {string} have been removed', ...)` — Context-only no-op.
17. `Then('no {string} or missing-type errors are reported for removed test files', ...)` — Read `this.__result1` and `this.__result2`, combine stdout+stderr, assert no `Cannot find module` and no error-type string present.

### Step 2: Verify step definitions resolve the 5 failing scenarios
- Run `bunx cucumber-js --tags "@adw-m8wft2-chore-remove-all-uni and @regression"` to confirm all 5 @regression scenarios in `remove_unit_tests.feature` pass
- If any step still shows as undefined, compare step text in the feature file with the step definition pattern — Cucumber is strict about whitespace and punctuation

### Step 3: Run full regression suite
- Run `bunx cucumber-js --tags "@regression"` to confirm the full regression suite passes with zero failures

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `bunx cucumber-js --tags "@adw-m8wft2-chore-remove-all-uni and @regression"` — Confirm all 5 previously-failing @regression scenarios now pass
- `bunx cucumber-js --tags "@regression"` — Confirm full regression suite passes
- `bunx tsc --noEmit --project adws/tsconfig.json` — Type-check the ADW TypeScript project
- `bunx tsc --noEmit` — Type-check the root TypeScript project
- `bun run lint` — Run linter to check for code quality issues

## Patch Scope
**Lines of code to change:** ~165 (new file with 17 step definitions — context-only no-ops plus simple filesystem/file-content assertions)
**Risk level:** low
**Testing required:** Run @regression-tagged Cucumber scenarios for `remove_unit_tests.feature` to confirm all 5 pass; run full @regression suite to confirm zero regressions; run tsc and lint validation
