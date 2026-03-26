# Patch: Rewrite SKILL.md Section 4 with unit test TDD integration and implement step definitions

## Metadata
adwId: `dfrwyt-unit-test-support-in`
reviewChangeRequest: `specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md`

## Issue Summary
**Original Spec:** specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md
**Issue:** SKILL.md Section 4 ("Unit Tests - Conditional") is unchanged from the base branch — `git diff origin/dev -- .claude/skills/implement-tdd/SKILL.md` returns 0 lines. The current Section 4 is a minimal 4-line placeholder that checks `.adw/project.md` but does not integrate unit tests into the red-green-refactor loop. Additionally, all 13 @adw-308 BDD scenarios fail because their 24 step definitions are undefined.
**Solution:** (1) Rewrite SKILL.md Section 4 to describe the full unit test workflow integrated into the TDD loop. (2) Add conditional unit test references in Section 3's RED/GREEN/REFACTOR phases. (3) Implement all undefined step definitions for @adw-308 scenarios.

## Files to Modify
Use these files to implement the patch:

- `.claude/skills/implement-tdd/SKILL.md` — Rewrite Section 4 and add conditional unit test notes in Section 3
- `features/step_definitions/implementTddUnitTestSteps.ts` — **New file.** Step definitions for all 24 undefined @adw-308 scenario steps

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Read current state and reference files
- Read `.claude/skills/implement-tdd/SKILL.md` — understand current Section 3 (lines 27-61) and Section 4 (lines 63-67) structure
- Read `.claude/skills/implement-tdd/tests.md` and `mocking.md` — understand the quality guidance being referenced
- Read `.adw/commands.md` — understand the `## Run Tests` command format
- Read `features/implement_tdd_unit_test_support.feature` — understand all 13 scenarios and 24 step phrases
- Read `features/step_definitions/implementTddSkillSteps.ts` — understand existing step definition patterns and `sharedCtx` usage
- Read `features/step_definitions/commonSteps.ts` — understand `sharedCtx.fileContent` setup

### Step 2: Rewrite SKILL.md Section 4 ("Unit Tests - Conditional")
Replace the current minimal Section 4 (lines 63-67) with a comprehensive section. The new Section 4 must contain **all** of the following elements (each maps to one or more BDD scenarios):

**Test framework awareness:**
- Instruct the agent to check `.adw/project.md` for the `## Unit Tests` section
- Instruct the agent to read `.adw/commands.md` `## Run Tests` for the project's unit test runner command

**When disabled or absent (handle first — short path):**
- If unit tests are **disabled** or the `## Unit Tests` section is absent from `.adw/project.md`: skip unit tests entirely
- Only BDD scenarios drive the TDD loop — behavior unchanged from default

**When enabled — full integrated workflow:**

- **RED phase**: Write a unit test alongside the step definition for each scenario (vertical slice). The unit test targets the specific function/module being introduced. Unit tests are written BEFORE implementation code (test-first). Unit tests are written as part of the vertical slice for each scenario — NOT batched in a separate post-loop section.
- **GREEN phase**: Implementation must pass BOTH the BDD scenario AND the unit test. Only consider GREEN when both pass.
- **REFACTOR phase**: Ensure both BDD scenario and unit test still pass after refactoring.

**Quality references:**
- Reference [tests.md](tests.md) for good vs bad test patterns when writing unit tests
- Reference [mocking.md](mocking.md) for mocking guidance — mock only at system boundaries

**Independence reminder:**
- BDD scenarios are the independent proof layer (written by a separate agent)
- Unit tests are supplementary finer-grained coverage written by the same agent as implementation
- Do NOT elevate unit test status above BDD scenarios

### Step 3: Update Section 3 RED/GREEN/REFACTOR with conditional unit test notes
Add conditional unit test mentions into the Section 3 red-green-refactor loop phases. These should be brief notes that reference Section 4:

- **RED phase** (after the step definition bullet): Add `- If unit tests are enabled (see Section 4), also write a unit test for the function/module being introduced`
- **GREEN phase** (after the scenario pass bullet): Add `- If unit tests are enabled, also run the unit test — both must pass`
- **REFACTOR phase** (after the scenario re-run bullet): Add `- If unit tests are enabled, ensure the unit test also stays green`

Also update the vertical slicing WRONG/RIGHT example to include unit tests:
```
RIGHT (vertical):
  RED → GREEN: step1 + unit test1 → impl1
  RED → GREEN: step2 + unit test2 → impl2
```

### Step 4: Create step definitions file for @adw-308 scenarios
Create `features/step_definitions/implementTddUnitTestSteps.ts` with:

**Imports:** `When`, `Then` from `@cucumber/cucumber`; `sharedCtx` from `./commonSteps.ts`; `assert` from `assert`.

**3 context-only When steps** (no-ops — content already loaded by Background):
- `When('the content is inspected for the red-green-refactor loop instructions', ...)`
- `When('the content is inspected for the GREEN phase instructions', ...)`
- `When('the content is inspected for unit test instructions', ...)`

**Parameterized Then steps:**
1. `it contains instructions to check {string} for the {string} setting` — Assert `fileContent` contains both the file path and the setting heading
2. `it describes skipping unit tests when the {string} setting is {string}` — Assert content mentions skipping when the setting matches the given value
3. `it describes skipping unit tests when the {string} section is absent from {string}` — Assert content describes absent-section behavior (look for "absent" or "missing" or "not present")
4. `it references {string} for guidance on writing good unit tests` — Assert content contains the file reference in a unit-test context
5. `it references {string} for guidance on mocking in unit tests` — Assert content contains the file reference in a mocking context

**Non-parameterized Then steps (RED/GREEN/REFACTOR assertions):**
6. `the check happens before or during the TDD loop, not after` — Assert Section 4 position: indexOf("Unit Tests (Conditional)") < indexOf("## Report") or indexOf("## Plan")
7. `the RED phase includes writing unit tests alongside step definitions when unit tests are enabled` — Assert content contains "unit test" in proximity to "RED" and "step definition"
8. `unit tests are written before implementation code (test-first)` — Assert content contains "before implementation" or "test-first"
9. `unit tests are written as part of the vertical slice for each scenario` — Assert content mentions unit tests in context of "vertical" or "each scenario"
10. `there is no separate post-loop section for writing all unit tests at once` — Assert content does NOT have a separate section instructing batch unit test writing after the loop
11. `the GREEN phase verifies that both the BDD scenario and unit tests pass` — Assert content mentions both scenario and unit test passing in GREEN context
12. `implementation is considered GREEN only when both pass` — Assert content contains "both pass" or "both must pass" or equivalent
13. `only BDD scenarios drive the TDD loop in this case` — Assert content mentions only BDD/scenarios driving the loop when disabled
14. `the behavior is identical to when unit tests are disabled` — Assert absent-section behavior matches disabled behavior (both skip unit tests)

**Independence / proof layer Then steps:**
15. `it describes BDD scenarios as the independent proof layer` — Assert content contains "independent proof layer" in BDD context
16. `it distinguishes unit tests as finer-grained coverage written by the same agent` — Assert content mentions "finer-grained" or "supplementary" and "same agent"
17. `it does not elevate unit test status above BDD scenarios` — Assert content positions BDD as primary (no "unit tests are more important" language)

**DataTable Then steps (TDD loop structure):**
18. `the enabled-unit-test loop follows this structure:` — Assert content contains RED with "unit test", GREEN with "both" scenario and unit test, REFACTOR with "both"
19. `the disabled-unit-test loop follows this structure:` — Assert content contains the standard loop without unit test mentions (already present in current Section 3)

**Vertical slicing Then steps:**
20. `the vertical slicing instruction covers both step definitions and unit tests` — Assert vertical slicing text mentions unit tests alongside step definitions
21. `it warns against writing all unit tests first then all implementation` — Assert content warns against batch/horizontal unit test writing (look for "WRONG" or "all unit tests first")

### Step 5: Run validation
Execute every command to verify correctness:

1. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — All 13 @adw-308 scenarios must pass
2. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` — Existing #304 scenarios still pass
3. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Zero regressions
4. `bun run lint` — No lint errors
5. `bunx tsc --noEmit` — Type check passes

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — All 13 @adw-308 scenarios pass (0 failures, 0 undefined)
2. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` — Existing implement_tdd scenarios pass
3. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — All regression scenarios pass
4. `bun run lint` — No lint errors introduced
5. `bunx tsc --noEmit` — Type check clean

## Patch Scope
**Lines of code to change:** ~120 (SKILL.md: ~60 lines rewritten, step definitions: ~60 lines new)
**Risk level:** low
**Testing required:** BDD scenarios tagged @adw-308 and @regression validate correctness. This is a prompt-only change (SKILL.md markdown) plus step definition file — no runtime TypeScript code is modified.
