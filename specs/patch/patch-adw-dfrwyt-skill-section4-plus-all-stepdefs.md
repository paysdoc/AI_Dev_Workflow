# Patch: Enhance SKILL.md Section 4 and implement all @adw-308 step definitions

## Metadata
adwId: `dfrwyt-unit-test-support-in`
reviewChangeRequest: `specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md`

## Issue Summary
**Original Spec:** specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md
**Issue:** SKILL.md (`.claude/skills/implement-tdd/SKILL.md`) was NOT modified. `git diff origin/dev` shows zero changes to any file under `.claude/skills/implement-tdd/`. Section 4 ("Unit Tests - Conditional") remains a minimal 3-line block that doesn't integrate unit tests into the red-green-refactor loop. Additionally, all 12 `@adw-308` scenarios fail with undefined step definitions (~24 missing steps).
**Solution:** Two-part coordinated fix: (1) Rewrite SKILL.md Section 4 to fully integrate unit tests into the TDD loop with RED/GREEN/REFACTOR phase expansions, references to `tests.md` and `mocking.md`, `.adw/commands.md` test runner awareness, and BDD independence reminder. (2) Add conditional unit test mentions to Section 3. (3) Create all missing step definitions in `features/step_definitions/implementTddSkillSteps.ts` whose assertions match the enhanced SKILL.md wording.

## Files to Modify

- `.claude/skills/implement-tdd/SKILL.md` -- Rewrite Section 4 ("Unit Tests - Conditional") and add conditional unit test mentions to Section 3's RED/GREEN/REFACTOR phases.
- `features/step_definitions/implementTddSkillSteps.ts` -- Add ~24 new step definitions for all undefined steps in the `@adw-308` feature file.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Enhance SKILL.md Section 3 with conditional unit test mentions

In Section 3 ("Red-Green-Refactor Loop"), add conditional unit test instructions within each phase sub-section:

- **RED phase** (after the existing "Write the step definitions needed for this scenario" bullet): Add a conditional note: when unit tests are enabled (see Section 4), also write a unit test targeting the function/module being introduced alongside the step definition.
- **GREEN phase** (after the existing "Write the minimal code needed to make this scenario pass" bullet): Add a conditional note: when unit tests are enabled, verify both the BDD scenario and the unit test pass before moving on.
- **REFACTOR phase** (after the existing refactoring bullets): Add a conditional note: when unit tests are enabled, keep both the scenario and unit test green after each refactor step.

Ensure the "Vertical slicing only" instruction explicitly mentions that unit tests (when enabled) are also written per-scenario, not batched. Add a WRONG/RIGHT example that includes unit tests:

```
WRONG (horizontal):
  RED:   step1+ut1, step2+ut2, step3+ut3
  GREEN: impl1, impl2, impl3

RIGHT (vertical):
  RED -> GREEN: step1+ut1 -> impl1
  RED -> GREEN: step2+ut2 -> impl2
```

### Step 2: Rewrite SKILL.md Section 4 ("Unit Tests - Conditional")

Replace the current minimal Section 4 with a comprehensive block containing ALL of these elements:

**Setting check:**
- Instruct reading `.adw/project.md` for the `## Unit Tests` setting
- Instruct reading `.adw/commands.md` `## Run Tests` for the project's unit test runner command

**When enabled:**
1. RED phase: Write a unit test alongside the step definition, before implementation (test-first). The unit test targets the specific function/module being introduced. Follow [tests.md](tests.md) for good vs bad test patterns. Follow [mocking.md](mocking.md) for mocking guidance (mock at system boundaries only).
2. GREEN phase: Implementation must pass both the BDD scenario AND the unit test. Implementation is GREEN only when both pass.
3. REFACTOR phase: Refactoring keeps both scenario and unit test green.
4. Loop structure summary:
   - RED: Write step definition + unit test
   - GREEN: Implement code to pass both scenario and unit test
   - REFACTOR: Clean up while keeping both green

**When disabled or absent:**
1. Skip unit tests entirely when `## Unit Tests` is `disabled`
2. Skip unit tests when the `## Unit Tests` section is absent from `.adw/project.md` -- absent means disabled
3. Only BDD scenarios drive the TDD loop
4. Loop structure summary:
   - RED: Write step definition
   - GREEN: Implement code to pass scenario
   - REFACTOR: Clean up while keeping scenario green

**Independence and hierarchy:**
- BDD scenarios are the independent proof layer
- Unit tests provide finer-grained coverage written by the same agent as the implementation
- Do NOT elevate unit test status above BDD scenarios

### Step 3: Create all missing step definitions

Add the following step definitions to `features/step_definitions/implementTddSkillSteps.ts`, all inspecting `sharedCtx.fileContent`:

**When steps (3 new -- context-setting, no assertions):**
- `When('the content is inspected for the red-green-refactor loop instructions', ...)`
- `When('the content is inspected for the GREEN phase instructions', ...)`
- `When('the content is inspected for unit test instructions', ...)`

**Then steps (~21 new -- each asserts on `sharedCtx.fileContent`):**

1. `it contains instructions to check {string} for the {string} setting` -- assert content includes the file path AND the setting name
2. `the check happens before or during the TDD loop, not after` -- assert Section 4's heading index is less than end of document, or Section 3 references unit tests conditionally
3. `the RED phase includes writing unit tests alongside step definitions when unit tests are enabled` -- assert RED + unit test + step definition co-occurrence
4. `unit tests are written before implementation code (test-first)` -- assert "before implementation" or "test-first" language
5. `unit tests are written as part of the vertical slice for each scenario` -- assert "vertical" + "unit test" co-occurrence
6. `there is no separate post-loop section for writing all unit tests at once` -- negative assert: no "after the loop" or "batch all unit tests" language
7. `the GREEN phase verifies that both the BDD scenario and unit tests pass` -- assert GREEN + both + pass
8. `implementation is considered GREEN only when both pass` -- assert "only when both" or equivalent
9. `it describes skipping unit tests when the {string} setting is {string}` -- assert skip + setting value
10. `only BDD scenarios drive the TDD loop in this case` -- assert "only BDD scenarios" or equivalent
11. `it describes skipping unit tests when the {string} section is absent from {string}` -- assert absent + skip
12. `the behavior is identical to when unit tests are disabled` -- assert absent = disabled equivalence
13. `it references {string} for guidance on writing good unit tests` -- assert referenced file near unit test instructions
14. `it references {string} for guidance on mocking in unit tests` -- assert referenced file near unit test instructions
15. `it describes BDD scenarios as the independent proof layer` -- assert "independent proof layer"
16. `it distinguishes unit tests as finer-grained coverage written by the same agent` -- assert "finer-grained" or "same agent"
17. `it does not elevate unit test status above BDD scenarios` -- negative assert: no "primary" or "main" proof language for unit tests
18. `the enabled-unit-test loop follows this structure:` (DataTable) -- check each phase/activity pair is described
19. `the disabled-unit-test loop follows this structure:` (DataTable) -- check disabled loop matches BDD-only approach
20. `the vertical slicing instruction covers both step definitions and unit tests` -- assert vertical slicing mentions unit tests
21. `it warns against writing all unit tests first then all implementation` -- assert anti-pattern warning includes unit tests

### Step 4: Coordinate wording between SKILL.md and step definition assertions

Before running tests, manually verify that:
- Every string literal in step definition assertions matches wording present in the enhanced SKILL.md
- The DataTable scenarios (enabled/disabled loop structures) have matching text in Section 4's summary
- No assertion checks for exact phrases not present in SKILL.md

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` -- All 12 @adw-308 scenarios must pass (0 failures, 0 undefined)
2. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` -- Existing implement_tdd scenarios still pass
3. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` -- All regression scenarios pass
4. `bun run lint` -- No lint errors
5. `bunx tsc --noEmit` -- No type errors

## Patch Scope
**Lines of code to change:** ~200 (SKILL.md ~80 lines rewrite/addition, step defs ~120 lines new)
**Risk level:** low
**Testing required:** BDD scenario runs for @adw-308, @adw-304-implement-tdd, and @regression tags
