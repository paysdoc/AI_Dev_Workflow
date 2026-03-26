# Patch: Implement all undefined @adw-308 step definitions and enhance SKILL.md

## Metadata
adwId: `dfrwyt-unit-test-support-in`
reviewChangeRequest: `specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md`

## Issue Summary
**Original Spec:** specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md
**Issue:** All 12 @adw-308 scenarios fail with "Undefined" — no step definitions were implemented for `features/implement_tdd_unit_test_support.feature`. 24 unique step patterns have no matching step definition function. Additionally, SKILL.md Section 3 and 4 lack the detailed unit test integration content these steps assert against.
**Solution:** (1) Enhance SKILL.md Section 3 with conditional unit test mentions in RED/GREEN/REFACTOR phases and vertical slicing. (2) Rewrite SKILL.md Section 4 with comprehensive unit test workflow instructions. (3) Create `features/step_definitions/implementTddUnitTestSteps.ts` with all 24 unique step definitions.

## Files to Modify
Use these files to implement the patch:

- `.claude/skills/implement-tdd/SKILL.md` — Enhance Section 3 (add conditional unit test notes to RED/GREEN/REFACTOR phases + vertical slicing example) and rewrite Section 4 (comprehensive unit test workflow)
- `features/step_definitions/implementTddUnitTestSteps.ts` — **New file.** 24 step definitions for the 12 @adw-308 scenarios

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Enhance SKILL.md Section 3 — Add conditional unit test mentions

In Section 3 "Red-Green-Refactor Loop":

- **Vertical slicing block** (the `WRONG/RIGHT` code block): Add a unit-test-enabled variant after the existing `RIGHT (vertical)` example:
  ```
  RIGHT (vertical, unit tests enabled):
    RED → GREEN: step1 + unit-test1 → impl1
    RED → GREEN: step2 + unit-test2 → impl2
    ...
  ```
  Add a warning line: "Do NOT write all unit tests first then all implementation — this is horizontal slicing."

- **RED phase**: After "Write the step definitions needed for this scenario", add: "When unit tests are enabled (see Section 4), also write a unit test for the function/module being introduced — test-first, before implementation code. The unit test is part of the vertical slice for this scenario."

- **GREEN phase**: After "Write the minimal code needed to make this scenario pass", add: "When unit tests are enabled, implementation must also pass the unit test. The scenario is only GREEN when both the BDD scenario and the unit test pass."

- **REFACTOR phase**: After "Run the scenario after each refactor step to stay GREEN", add: "When unit tests are enabled, also run unit tests after refactoring to keep both green."

### Step 2: Rewrite SKILL.md Section 4 — Comprehensive unit test workflow

Replace the current Section 4 content with comprehensive instructions that include:

1. Check `.adw/project.md` for the `## Unit Tests` section (must appear before/during the TDD loop context, not after)
2. Read `.adw/commands.md` `## Run Tests` for the project's unit test runner command
3. **When enabled** block:
   - RED phase: write unit test alongside step definition, before implementation code (test-first), per-scenario (not batched)
   - Reference [tests.md](tests.md) for good vs bad test patterns (test behavior through public interfaces)
   - Reference [mocking.md](mocking.md) for mocking guidance (mock only at system boundaries)
   - GREEN phase: both BDD scenario AND unit test must pass; only GREEN when both pass
   - REFACTOR phase: both must remain green after refactoring
   - BDD scenarios are the **independent proof layer** (written by separate agent, verify behavior independently)
   - Unit tests provide **finer-grained coverage** but are written by the **same agent** as implementation
   - Do not elevate unit test status above BDD scenarios
4. **When disabled or absent** block:
   - Skip unit tests entirely; only BDD scenarios drive the TDD loop
   - Behavior is identical whether disabled or absent

### Step 3: Create step definitions file `features/step_definitions/implementTddUnitTestSteps.ts`

Create with all 24 unique step definitions. All steps inspect `sharedCtx.fileContent` (SKILL.md loaded by Background). Follow `implementTddSkillSteps.ts` assertion style.

**When steps (3, no-op — content already loaded):**
1. `When('the content is inspected for the red-green-refactor loop instructions', ...)` — no-op
2. `When('the content is inspected for the GREEN phase instructions', ...)` — no-op
3. `When('the content is inspected for unit test instructions', ...)` — no-op

**Then steps (21, assert against `sharedCtx.fileContent`):**
4. `it contains instructions to check {string} for the {string} setting` — assert content includes both the file path and setting heading
5. `the check happens before or during the TDD loop, not after` — assert `.adw/project.md` or `## Unit Tests` appears at or before the TDD loop section (index check)
6. `the RED phase includes writing unit tests alongside step definitions when unit tests are enabled` — assert RED section mentions both unit test and step definition
7. `unit tests are written before implementation code (test-first)` — assert "before" + "implementation" or "test-first" language
8. `unit tests are written as part of the vertical slice for each scenario` — assert "vertical" and "unit test" co-occur
9. `there is no separate post-loop section for writing all unit tests at once` — negative assert: no batch unit test section after the loop
10. `the GREEN phase verifies that both the BDD scenario and unit tests pass` — assert GREEN + both + pass
11. `implementation is considered GREEN only when both pass` — assert "only" + "both" + "pass" / "GREEN"
12. `it describes skipping unit tests when the {string} setting is {string}` — assert skip/disabled language
13. `only BDD scenarios drive the TDD loop in this case` — assert "only BDD scenarios" or equivalent
14. `it describes skipping unit tests when the {string} section is absent from {string}` — assert absent case
15. `the behavior is identical to when unit tests are disabled` — assert absent = disabled same treatment
16. `it references {string} for guidance on writing good unit tests` — assert file referenced in unit test context
17. `it references {string} for guidance on mocking in unit tests` — assert file referenced in mocking context
18. `it describes BDD scenarios as the independent proof layer` — assert "independent proof layer"
19. `it distinguishes unit tests as finer-grained coverage written by the same agent` — assert "finer-grained" or "same agent"
20. `it does not elevate unit test status above BDD scenarios` — assert "Do not elevate" or equivalent
21. `the enabled-unit-test loop follows this structure:` (DataTable) — validate RED has "unit test", GREEN has "both", REFACTOR has "both green"
22. `the disabled-unit-test loop follows this structure:` (DataTable) — validate standard loop without unit test requirement
23. `the vertical slicing instruction covers both step definitions and unit tests` — assert vertical slicing mentions unit tests
24. `it warns against writing all unit tests first then all implementation` — assert WRONG example or explicit warning about batching unit tests

### Step 4: Run validation

Run all validation commands to confirm the patch resolves the issue with zero regressions.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — All 12 @adw-308 scenarios must pass (previously all Undefined)
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` — Existing implement_tdd scenarios still pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — All regression scenarios pass (includes 8 new @adw-308 @regression scenarios)
- `bun run lint` — Linter passes
- `bunx tsc --noEmit` — Type check passes
- `bunx tsc --noEmit -p adws/tsconfig.json` — adws type check passes

## Patch Scope
**Lines of code to change:** ~40 lines added to SKILL.md (Section 3 + Section 4 rewrite), ~200 lines in new step definitions file
**Risk level:** low
**Testing required:** BDD scenarios tagged @adw-308 verify SKILL.md content through step definitions; @regression and @adw-304-implement-tdd ensure no regressions
