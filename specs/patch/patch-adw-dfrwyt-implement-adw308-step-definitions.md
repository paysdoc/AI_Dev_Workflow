# Patch: Implement all undefined @adw-308 BDD step definitions

## Metadata
adwId: `dfrwyt-unit-test-support-in`
reviewChangeRequest: `Issue #2: All 13 @adw-308 BDD scenarios fail because step definitions are undefined`

## Issue Summary
**Original Spec:** specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md
**Issue:** All 13 @adw-308 BDD scenarios fail with "Undefined" steps. The feature file `features/implement_tdd_unit_test_support.feature` uses 24 step phrases that have no implementations in the step_definitions directory. Existing steps in `implementTddSkillSteps.ts` cover issue #304 steps but none of the #308-specific steps.
**Solution:** Create a new step definitions file `features/step_definitions/implementTddUnitTestSteps.ts` implementing all 24 undefined steps. Each step inspects `sharedCtx.fileContent` (the SKILL.md content) for expected instructional text. Context-only `When` steps are no-ops; `Then` steps assert the presence of expected strings/patterns in the content. This patch depends on the SKILL.md Section 4 enhancement (from the main spec) — step definitions will only pass once Section 4 contains the full unit test integration instructions.

## Files to Modify
Use these files to implement the patch:

- `features/step_definitions/implementTddUnitTestSteps.ts` — **New file.** All 24 undefined step definitions for @adw-308 scenarios.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Create the step definitions file with imports and context-only When steps
Create `features/step_definitions/implementTddUnitTestSteps.ts`. Import `When`, `Then` from `@cucumber/cucumber` and `sharedCtx` from `./commonSteps.ts`. Import `assert` from `assert`.

Implement these 3 context-only `When` steps as no-ops (content already loaded by Background Given step):
- `When('the content is inspected for the red-green-refactor loop instructions', ...)` — no-op
- `When('the content is inspected for the GREEN phase instructions', ...)` — no-op
- `When('the content is inspected for unit test instructions', ...)` — no-op

### Step 2: Implement the parameterized Then steps
These steps use `{string}` parameters to match different values across scenarios:

1. `Then('it contains instructions to check {string} for the {string} setting', (file, setting) => ...)` — Assert `sharedCtx.fileContent` contains both `file` (e.g. `.adw/project.md`) and `setting` (e.g. `## Unit Tests`)
2. `Then('it describes skipping unit tests when the {string} setting is {string}', (setting, value) => ...)` — Assert content mentions skipping unit tests when the setting is the given value (e.g. "disabled")
3. `Then('it describes skipping unit tests when the {string} section is absent from {string}', (section, file) => ...)` — Assert content describes absent section behavior (check for "absent" or "missing" or "not present" language)
4. `Then('it references {string} for guidance on writing good unit tests', (file) => ...)` — Assert content contains the referenced file (e.g. `tests.md`) in a unit test context
5. `Then('it references {string} for guidance on mocking in unit tests', (file) => ...)` — Assert content contains the referenced file (e.g. `mocking.md`) in a mocking/unit test context

### Step 3: Implement the non-parameterized Then steps for RED/GREEN/REFACTOR phases
These assert specific instructional content about the TDD loop:

6. `Then('the check happens before or during the TDD loop, not after', ...)` — Assert the `## Unit Tests` check (Section 4) appears before the Report section. Use positional check: indexOf of "Unit Tests" < indexOf of "Report"
7. `Then('the RED phase includes writing unit tests alongside step definitions when unit tests are enabled', ...)` — Assert content mentions unit test(s) in connection with RED phase and step definition(s)
8. `Then('unit tests are written before implementation code (test-first)', ...)` — Assert content mentions writing unit tests before implementation (check for "before implementation" or "test-first")
9. `Then('unit tests are written as part of the vertical slice for each scenario', ...)` — Assert content mentions unit tests within vertical slice or per-scenario context
10. `Then('there is no separate post-loop section for writing all unit tests at once', ...)` — Assert content does NOT have a separate section titled something like "Write all unit tests" after the loop. Verify no post-loop batch instruction exists
11. `Then('the GREEN phase verifies that both the BDD scenario and unit tests pass', ...)` — Assert GREEN phase mentions both BDD/scenario and unit test(s) passing
12. `Then('implementation is considered GREEN only when both pass', ...)` — Assert content indicates both must pass for GREEN status
13. `Then('only BDD scenarios drive the TDD loop in this case', ...)` — Assert content mentions only BDD scenarios driving the loop when disabled
14. `Then('the behavior is identical to when unit tests are disabled', ...)` — Assert content treats absent and disabled the same way (e.g. both say "skip unit tests entirely")

### Step 4: Implement the BDD independence and vertical slicing steps

15. `Then('it describes BDD scenarios as the independent proof layer', ...)` — Assert content contains "independent proof layer" or similar phrasing about BDD
16. `Then('it distinguishes unit tests as finer-grained coverage written by the same agent', ...)` — Assert content mentions unit tests as supplementary/finer-grained and written by the same agent
17. `Then('it does not elevate unit test status above BDD scenarios', ...)` — Assert BDD is positioned as primary (e.g. "independent proof layer" appears) and unit tests are not described as the primary validation mechanism
18. `Then('the vertical slicing instruction covers both step definitions and unit tests', ...)` — Assert the vertical slicing section mentions both step definitions and unit tests
19. `Then('it warns against writing all unit tests first then all implementation', ...)` — Assert content warns against horizontal slicing of unit tests (check for "WRONG" pattern or "all unit tests first")

### Step 5: Implement the DataTable steps for TDD loop structure

20. `Then('the enabled-unit-test loop follows this structure:', (dataTable) => ...)` — Parse the DataTable rows. For each row (phase, activity), assert the SKILL.md content describes that phase with that activity when unit tests are enabled. Check: RED mentions "step definition" + "unit test", GREEN mentions "both" passing, REFACTOR mentions keeping "both" green
21. `Then('the disabled-unit-test loop follows this structure:', (dataTable) => ...)` — Parse the DataTable rows. For each row (phase, activity), assert the SKILL.md content describes that phase with that activity when unit tests are disabled. Check: RED mentions "step definition" only, GREEN mentions scenario passing, REFACTOR mentions scenario green

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308" --dry-run` — Verify all step definitions are recognized (no undefined steps)
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — Run all @adw-308 scenarios (requires SKILL.md Section 4 enhancement to pass)
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` — Verify existing implement_tdd scenarios still pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run all regression scenarios to verify zero regressions
- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type check main project

## Patch Scope
**Lines of code to change:** ~150 (new step definitions file)
**Risk level:** low
**Testing required:** All @adw-308 steps resolve in dry-run, all @adw-308 scenarios pass (after SKILL.md enhancement), all @regression scenarios pass, lint + typecheck clean
