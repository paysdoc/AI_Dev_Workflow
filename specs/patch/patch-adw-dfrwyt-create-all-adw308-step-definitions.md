# Patch: Create all step definitions for @adw-308 scenarios

## Metadata
adwId: `dfrwyt-unit-test-support-in`
reviewChangeRequest: `specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md`

## Issue Summary
**Original Spec:** `specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md`
**Issue:** All 12 `@adw-308` scenarios in `features/implement_tdd_unit_test_support.feature` fail with "Undefined" steps. `git diff origin/dev --name-only -- features/step_definitions/` returns empty — no step definitions were created. The Background steps work (from existing files), but all 21 scenario-specific When/Then steps are undefined.
**Solution:** Create `features/step_definitions/implementTddUnitTestSteps.ts` with all 21 undefined step definitions, and enhance SKILL.md Sections 3-4 so the content assertions pass. Each step asserts against `sharedCtx.fileContent` (SKILL.md content loaded by the Background). Follow patterns from `implementTddSkillSteps.ts`.

## Files to Modify
Use these files to implement the patch:

- `.claude/skills/implement-tdd/SKILL.md` — Enhance Section 3 (add conditional unit test mentions to RED/GREEN/REFACTOR phases and vertical slicing example) and rewrite Section 4 (full unit test workflow when enabled)
- `features/step_definitions/implementTddUnitTestSteps.ts` — **New file**: all 21 step definitions for the `@adw-308` scenarios

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Enhance SKILL.md Section 3 — Add conditional unit test mentions to red-green-refactor loop
- In the **RED** phase block (after "Write the step definitions needed for this scenario"), add a conditional note: "When unit tests are enabled (see Section 4), also write a unit test targeting the function/module being introduced — test-first, before implementation."
- In the **GREEN** phase block (after "Run the scenario to verify it passes"), add: "When unit tests are enabled, verify both the BDD scenario AND the unit test pass. Implementation is considered GREEN only when both pass."
- In the **REFACTOR** phase block, add: "When unit tests are enabled, ensure both scenario and unit test remain green after refactoring."
- Update the WRONG/RIGHT vertical slicing example to include unit tests when enabled:
  ```
  WRONG (horizontal):
    RED:   step1 + unit-test1, step2 + unit-test2, step3, step4
    GREEN: impl1, impl2, impl3, impl4

  RIGHT (vertical):
    RED → GREEN: step1 (+ unit-test1 if enabled) → impl1
    RED → GREEN: step2 (+ unit-test2 if enabled) → impl2
    ...
  ```
- Ensure the vertical slicing instruction explicitly covers both step definitions and unit tests, and warns against writing all unit tests first then all implementation.

### Step 2: Rewrite SKILL.md Section 4 — Comprehensive unit test workflow
Replace the current minimal Section 4 with:

1. **Check the setting first**: "Check `.adw/project.md` for the `## Unit Tests` section." This must appear before the loop instructions (before `## Report`) so it satisfies the "before or during the TDD loop, not after" assertion.
2. **When enabled**:
   - Read `.adw/commands.md` `## Run Tests` for the project's unit test runner command
   - RED phase: write a unit test BEFORE implementation (test-first) alongside the step definition. Reference [tests.md](tests.md) for good vs bad test patterns.
   - GREEN phase: implementation must pass both the BDD scenario AND the unit test. Both must be GREEN.
   - Mocking: follow [mocking.md](mocking.md) — mock at system boundaries only.
   - Unit tests are written as part of the vertical slice for each scenario, not batched separately.
3. **When disabled or absent**: skip unit tests entirely — only BDD scenarios drive the TDD loop.
4. **Independence reminder**: BDD scenarios are the independent proof layer — written by a separate agent. Unit tests provide finer-grained coverage but are written by the same agent as the implementation, so they carry accommodation risk. Unit tests are supplementary; they do not replace or elevate above BDD scenarios.

### Step 3: Create `features/step_definitions/implementTddUnitTestSteps.ts`
Create a new file importing `When`, `Then` from `@cucumber/cucumber`, `assert` from `assert`, and `sharedCtx` from `./commonSteps.ts`. All steps read `sharedCtx.fileContent`.

**3 When steps (no-op context setters — content already loaded by Background):**
1. `When('the content is inspected for the red-green-refactor loop instructions', ...)` — no-op
2. `When('the content is inspected for the GREEN phase instructions', ...)` — no-op
3. `When('the content is inspected for unit test instructions', ...)` — no-op

**18 Then steps:**

Setting check (Scenario 1):
4. `Then('it contains instructions to check {string} for the {string} setting', (file, setting) => ...)` — assert content includes both the file path and the setting heading
5. `Then('the check happens before or during the TDD loop, not after', ...)` — assert the Unit Tests / `.adw/project.md` reference indexOf < indexOf of `## Report`

RED phase (Scenarios 2, 3):
6. `Then('the RED phase includes writing unit tests alongside step definitions when unit tests are enabled', ...)` — assert RED section mentions unit test + step definition when enabled
7. `Then('unit tests are written before implementation code \\(test-first)', ...)` — assert "before implementation" or "test-first" in unit test context
8. `Then('unit tests are written as part of the vertical slice for each scenario', ...)` — assert vertical slicing text mentions unit tests
9. `Then('there is no separate post-loop section for writing all unit tests at once', ...)` — assert no batch/post-loop instruction for writing all unit tests after the loop

GREEN phase (Scenario 4):
10. `Then('the GREEN phase verifies that both the BDD scenario and unit tests pass', ...)` — assert GREEN text mentions both BDD/scenario AND unit test
11. `Then('implementation is considered GREEN only when both pass', ...)` — assert "both" + "pass" or "both" + "GREEN"

Skip when disabled/absent (Scenarios 5, 6):
12. `Then('it describes skipping unit tests when the {string} setting is {string}', (setting, value) => ...)` — assert content includes the setting, the value, and skip language
13. `Then('only BDD scenarios drive the TDD loop in this case', ...)` — assert "only BDD scenarios" or "BDD scenarios drive"
14. `Then('it describes skipping unit tests when the {string} section is absent from {string}', (section, file) => ...)` — assert "absent" + skip language
15. `Then('the behavior is identical to when unit tests are disabled', ...)` — assert both disabled and absent lead to same skip (both mentioned in same condition)

References (Scenarios 7, 8):
16. `Then('it references {string} for guidance on writing good unit tests', (ref) => ...)` — assert content contains the referenced file string
17. `Then('it references {string} for guidance on mocking in unit tests', (ref) => ...)` — assert content contains the referenced file string

Independence (Scenario 9):
18. `Then('it describes BDD scenarios as the independent proof layer', ...)` — assert "independent proof layer"
19. `Then('it distinguishes unit tests as finer-grained coverage written by the same agent', ...)` — assert "finer-grained" or "same agent"
20. `Then('it does not elevate unit test status above BDD scenarios', ...)` — assert unit tests described as supplementary, not primary

Loop structure with DataTable (Scenarios 10, 11):
21. `Then('the enabled-unit-test loop follows this structure:', (dataTable) => ...)` — for each row (phase, activity), assert both the phase name and key activity terms present in content
22. `Then('the disabled-unit-test loop follows this structure:', (dataTable) => ...)` — same pattern for disabled loop

Vertical slicing (Scenario 12):
23. `Then('the vertical slicing instruction covers both step definitions and unit tests', ...)` — assert vertical slicing text mentions both
24. `Then('it warns against writing all unit tests first then all implementation', ...)` — assert WRONG example or "all unit tests first" language. Note: distinct from existing step `'it warns against writing all tests first then all implementation'` in `implementTddSkillSteps.ts:127`.

**Total: 3 When + 21 Then = 24 step definitions** (corrected — 21 unique Then steps, not 18).

### Step 4: Run validation and fix assertion failures
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308" --dry-run` to confirm 0 undefined steps
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — all 12 scenarios should pass
- Iterate: fix SKILL.md content or step assertion logic until all pass
- Run regression and type checks

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — All 12 unit test support scenarios pass (0 undefined, 0 failing)
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` — Existing implement_tdd scenarios still pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — All regression scenarios pass
- `bun run lint` — Code quality check
- `bunx tsc --noEmit` — Type check main project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check adws project

## Patch Scope
**Lines of code to change:** ~80 lines in SKILL.md (enhance Sections 3-4), ~200 lines in new step definitions file
**Risk level:** low
**Testing required:** All 12 `@adw-308` scenarios pass, all `@regression` scenarios pass, lint and type checks clean
