# Patch: Implement all undefined step definitions for @adw-308 scenarios

## Metadata
adwId: `dfrwyt-unit-test-support-in`
reviewChangeRequest: `Issue #2: No step definitions were implemented. All 14 @adw-308 scenarios fail with 'Undefined' steps. The scenario proof shows exit code 1 with every custom step marked with '?' (undefined). No changes were made to features/step_definitions/.`

## Issue Summary
**Original Spec:** `specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md`
**Issue:** All 14 `@adw-308` scenarios in `features/implement_tdd_unit_test_support.feature` fail with "Undefined" steps because no step definitions were created for the new scenario steps. The Background steps (`Given the ADW codebase...`, `And the file ... is read`) and `When the content is inspected` work (from existing step def files), but all scenario-specific `When` and `Then` steps are undefined.
**Solution:** Create a new step definitions file `features/step_definitions/implementTddUnitTestSteps.ts` containing all 23 undefined steps. Each step asserts against `sharedCtx.fileContent` (SKILL.md content loaded by the Background). Follow existing patterns from `implementTddSkillSteps.ts`.

## Files to Modify
Use these files to implement the patch:

- `features/step_definitions/implementTddUnitTestSteps.ts` — **New file**: step definitions for all `@adw-308` unit test support scenarios
- `.claude/skills/implement-tdd/SKILL.md` — Enhance Section 4 and update Section 3 to integrate unit tests into the red-green-refactor loop (required so step assertions pass)

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Enhance SKILL.md Section 3 — Add conditional unit test mentions to red-green-refactor loop
- In the RED phase block, add a conditional note: when unit tests are enabled (see Section 4), also write a unit test targeting the function/module being introduced alongside the step definition
- In the GREEN phase block, add: when unit tests are enabled, verify both the BDD scenario AND the unit test pass
- In the REFACTOR phase block, add: when unit tests are enabled, ensure both scenario and unit test remain green after refactoring
- Update the WRONG/RIGHT vertical slicing example to show unit tests as part of the vertical slice when enabled:
  ```
  WRONG (horizontal):
    RED:   step1 + unit-test1, step2 + unit-test2, step3, step4
    GREEN: impl1, impl2, impl3, impl4

  RIGHT (vertical):
    RED → GREEN: step1 (+ unit-test1 if enabled) → impl1
    RED → GREEN: step2 (+ unit-test2 if enabled) → impl2
    ...
  ```

### Step 2: Rewrite SKILL.md Section 4 — Full unit test workflow integrated into the TDD loop
Replace the current minimal Section 4 with a comprehensive section:

1. **Check the setting**: Read `.adw/project.md` for the `## Unit Tests` section. If **disabled** or absent, skip unit tests entirely — only BDD scenarios drive the TDD loop.
2. **Test framework**: When enabled, read `.adw/commands.md` `## Run Tests` for the project's unit test runner command.
3. **RED phase integration**: Write a unit test BEFORE implementation (test-first) alongside the step definition. The unit test targets the specific function/module being introduced. Follow [tests.md](tests.md) for good vs bad test patterns.
4. **GREEN phase integration**: Implementation must pass both the BDD scenario AND the unit test. Both must be GREEN before moving on.
5. **Mocking guidance**: Follow [mocking.md](mocking.md) — mock at system boundaries only.
6. **Independence reminder**: BDD scenarios are the independent proof layer — written by a separate agent. Unit tests provide finer-grained coverage but are written by the same agent as the implementation, so they carry accommodation risk.
7. **Vertical slice**: Unit tests are written as part of the vertical slice for each scenario, not batched separately.

### Step 3: Create step definitions file `features/step_definitions/implementTddUnitTestSteps.ts`
Create a new file with all 23 undefined step definitions. Import `When`, `Then` from `@cucumber/cucumber`, `assert` from `assert`, and `sharedCtx` from `./commonSteps.ts`. Each step reads `sharedCtx.fileContent`.

**When steps (no-op context — content already loaded):**
1. `When('the content is inspected for the red-green-refactor loop instructions', ...)` — no-op
2. `When('the content is inspected for the GREEN phase instructions', ...)` — no-op
3. `When('the content is inspected for unit test instructions', ...)` — no-op

**Then steps — Setting check (Scenario 1):**
4. `Then('it contains instructions to check {string} for the {string} setting', ...)` — assert content includes both the file path string and the setting heading string
5. `Then('the check happens before or during the TDD loop, not after', ...)` — assert the `## Unit Tests` / `.adw/project.md` reference appears before or within the loop section (indexOf of unit test reference < indexOf of "## Report" or end of loop)

**Then steps — RED phase (Scenarios 2, 3):**
6. `Then('the RED phase includes writing unit tests alongside step definitions when unit tests are enabled', ...)` — assert RED phase text mentions writing unit test(s) alongside step definition(s) when enabled
7. `Then('unit tests are written before implementation code \\(test-first)', ...)` — assert content contains "before implementation" or "test-first" in unit test context
8. `Then('unit tests are written as part of the vertical slice for each scenario', ...)` — assert vertical slicing text mentions unit tests
9. `Then('there is no separate post-loop section for writing all unit tests at once', ...)` — assert Section 4 does NOT contain a separate batch/post-loop instruction for writing all unit tests after the loop

**Then steps — GREEN phase (Scenario 4):**
10. `Then('the GREEN phase verifies that both the BDD scenario and unit tests pass', ...)` — assert GREEN text mentions both BDD/scenario AND unit test passing
11. `Then('implementation is considered GREEN only when both pass', ...)` — assert "both" + "pass" or "both" + "GREEN" language

**Then steps — Skip when disabled/absent (Scenarios 5, 6):**
12. `Then('it describes skipping unit tests when the {string} setting is {string}', ...)` — assert content mentions the setting value and skip/skip-entirely language
13. `Then('only BDD scenarios drive the TDD loop in this case', ...)` — assert "only BDD scenarios" or "BDD scenarios drive" language
14. `Then('it describes skipping unit tests when the {string} section is absent from {string}', ...)` — assert "absent" + skip language
15. `Then('the behavior is identical to when unit tests are disabled', ...)` — assert both disabled and absent result in same skip behavior (both mentioned in same condition)

**Then steps — References (Scenarios 7, 8):**
16. `Then('it references {string} for guidance on writing good unit tests', ...)` — assert content contains the referenced file (e.g., "tests.md")
17. `Then('it references {string} for guidance on mocking in unit tests', ...)` — assert content contains the referenced file (e.g., "mocking.md")

**Then steps — Independence (Scenario 9):**
18. `Then('it describes BDD scenarios as the independent proof layer', ...)` — assert "independent proof layer" text
19. `Then('it distinguishes unit tests as finer-grained coverage written by the same agent', ...)` — assert "finer-grained" or "same agent" text
20. `Then('it does not elevate unit test status above BDD scenarios', ...)` — assert unit tests described as supplementary/accommodation risk, not primary

**Then steps — Loop structure (Scenarios 10, 11):**
21. `Then('the enabled-unit-test loop follows this structure:', ...)` — DataTable step: for each row, assert the phase name and activity description are reflected in SKILL.md content
22. `Then('the disabled-unit-test loop follows this structure:', ...)` — DataTable step: for each row, assert the phase name and activity description are reflected in SKILL.md content (without unit test mentions)

**Then steps — Vertical slicing (Scenario 12):**
23. `Then('the vertical slicing instruction covers both step definitions and unit tests', ...)` — assert vertical slicing text mentions both step definitions and unit tests

Note: `Then('it warns against writing all unit tests first then all implementation', ...)` already exists in `implementTddSkillSteps.ts` (line 127) — do NOT duplicate.

### Step 4: Run validation
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308" --dry-run` to confirm 0 undefined steps
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — all 14 scenarios should pass
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` — existing scenarios still pass
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — zero regressions

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — Run all new unit test support scenarios (14 scenarios, 0 undefined, 0 failing)
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` — Verify existing implement_tdd scenarios still pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run all regression scenarios to verify zero regressions
- `bun run lint` — Check code quality
- `bunx tsc --noEmit` — Type check main project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check adws project

## Patch Scope
**Lines of code to change:** ~100 lines in SKILL.md (enhance Sections 3-4), ~180 lines in new step definitions file
**Risk level:** low
**Testing required:** All `@adw-308` scenarios pass, all `@regression` scenarios pass, lint and type check clean
