# Patch: Rewrite SKILL.md Section 3+4 for unit test TDD integration + implement all @adw-308 step definitions

## Metadata
adwId: `dfrwyt-unit-test-support-in`
reviewChangeRequest: `Issue #2: SKILL.md (.claude/skills/implement-tdd/SKILL.md) has zero changes against origin/dev. The spec requires enhancing Section 4 ('Unit Tests - Conditional') to integrate unit tests as a first-class part of the TDD loop — describing RED phase expansion (write step def + unit test), GREEN phase expansion (both must pass), test framework awareness (.adw/commands.md), references to tests.md and mocking.md, and the independence reminder. None of this was done. Resolution: Rewrite SKILL.md Section 4 per the spec's Implementation Plan Phase 2: expand RED/GREEN/REFACTOR phases for unit test support, add .adw/commands.md test runner awareness, reference tests.md and mocking.md, and add the BDD independence reminder. Also integrate unit test conditional mentions into Section 3's red-green-refactor loop.`

## Issue Summary
**Original Spec:** `specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md`
**Issue:** SKILL.md has zero changes against origin/dev. Section 4 ("Unit Tests - Conditional") is a minimal 3-line block that doesn't integrate unit tests into the TDD loop. Section 3's red-green-refactor loop has no conditional unit test mentions. All 13 @adw-308 BDD scenarios fail because 24 step definitions are undefined.
**Solution:** (1) Rewrite SKILL.md Section 4 with comprehensive unit test workflow: RED/GREEN/REFACTOR expansion, `.adw/commands.md` test runner awareness, tests.md/mocking.md references, BDD independence reminder. (2) Integrate conditional unit test mentions into Section 3's RED/GREEN/REFACTOR phases and vertical slicing. (3) Implement all undefined @adw-308 step definitions.

## Files to Modify

- `.claude/skills/implement-tdd/SKILL.md` — Rewrite Section 4, add conditional unit test mentions to Section 3 (RED/GREEN/REFACTOR phases and vertical slicing example)
- `features/step_definitions/implementTddUnitTestSteps.ts` — **New file.** All 24 step definitions for `features/implement_tdd_unit_test_support.feature`

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Update SKILL.md Section 3 — Add conditional unit test mentions to the red-green-refactor loop

In Section 3 ("Red-Green-Refactor Loop"), make these targeted additions:

**1a. Vertical slicing example** — Update the WRONG/RIGHT ASCII diagram to include unit tests:
```
WRONG (horizontal):
  RED:   step1+test1, step2+test2, step3+test3
  GREEN: impl1, impl2, impl3

RIGHT (vertical):
  RED -> GREEN: step1+test1 -> impl1
  RED -> GREEN: step2+test2 -> impl2
  ...
```
Add a note: "When unit tests are enabled (see Section 4), write the unit test as part of the vertical slice — never write all unit tests first then all implementation."

**1b. RED phase** — After "Write the step definitions needed for this scenario (or verify they already exist)", add:
"If unit tests are enabled (see Section 4), also write a unit test for the function/module being introduced. Write it before implementation (test-first)."

**1c. GREEN phase** — After "Write the minimal code needed to make this scenario pass", add:
"If unit tests are enabled, also run the unit test (see `.adw/commands.md` `## Run Tests`). Implementation is GREEN only when both the BDD scenario and the unit test pass."

**1d. REFACTOR phase** — After "Run the scenario after each refactor step to stay GREEN", add:
"If unit tests are enabled, ensure both the scenario and unit tests remain GREEN after refactoring."

### Step 2: Rewrite SKILL.md Section 4 — Comprehensive unit test workflow

Replace the current Section 4 (lines 63-67 of SKILL.md) with:

```markdown
### 4. Unit Tests (Conditional)

Check `.adw/project.md` for the `## Unit Tests` setting before entering the TDD loop:

**When `## Unit Tests: enabled`:**

Unit tests are a first-class part of the red-green-refactor loop, written alongside step definitions during the RED phase for each scenario — not as a separate batch after the loop.

1. **Read the test runner**: Read `.adw/commands.md` `## Run Tests` for the project's unit test command.
2. **RED — Write unit test alongside step definition**: For each scenario, write a unit test targeting the specific function/module being introduced. Follow [tests.md](tests.md) for good vs. bad test patterns (test behavior through public interfaces, not implementation details). Follow [mocking.md](mocking.md) for mocking guidance (mock at system boundaries only). The unit test must be written **before** implementation code (test-first).
3. **GREEN — Dual verification**: Implementation is GREEN only when **both** the BDD scenario AND the unit test pass. Run the scenario with the tag command and the unit test with the `## Run Tests` command.
4. **REFACTOR**: Ensure both the scenario and unit tests remain GREEN after refactoring.

**Independence reminder**: BDD scenarios are the independent proof layer — they were written by a separate agent and verify behavior independently. Unit tests provide finer-grained coverage but are written by the same agent as the implementation.

**When `## Unit Tests: disabled` or the `## Unit Tests` section is absent from `.adw/project.md`:**

Skip unit tests entirely. Only BDD scenarios drive the TDD loop. The behavior is identical whether the setting is explicitly disabled or absent.
```

### Step 3: Create step definitions for all @adw-308 scenarios

Create `features/step_definitions/implementTddUnitTestSteps.ts` with all 24 undefined step definitions. Import `When`, `Then` from `@cucumber/cucumber`, `assert` from `assert`, and `sharedCtx` from `./commonSteps.ts`.

All steps inspect `sharedCtx.fileContent` (loaded by the Background's `the file ".claude/skills/implement-tdd/SKILL.md" is read`).

**Context steps (no-op, content already loaded):**
- `When('the content is inspected for the red-green-refactor loop instructions', ...)`
- `When('the content is inspected for the GREEN phase instructions', ...)`
- `When('the content is inspected for unit test instructions', ...)`

**Assertion steps — Section 4 reads the setting:**
1. `Then('it contains instructions to check {string} for the {string} setting', ...)` — Assert content includes both the config file path and the setting heading
2. `Then('the check happens before or during the TDD loop, not after', ...)` — Assert `.adw/project.md` reference appears in Section 4 (which is positioned before/alongside Section 3's loop)

**Assertion steps — RED phase integration:**
3. `Then('the RED phase includes writing unit tests alongside step definitions when unit tests are enabled', ...)` — Assert content has RED section mentioning unit test alongside step definition
4. `Then('unit tests are written before implementation code \\(test-first)', ...)` — Assert content mentions "before implementation" or "test-first"
5. `Then('unit tests are written as part of the vertical slice for each scenario', ...)` — Assert vertical slicing includes unit tests
6. `Then('there is no separate post-loop section for writing all unit tests at once', ...)` — Assert no "write all unit tests" batch section after the loop

**Assertion steps — GREEN phase dual verification:**
7. `Then('the GREEN phase verifies that both the BDD scenario and unit tests pass', ...)` — Assert GREEN mentions both BDD and unit tests passing
8. `Then('implementation is considered GREEN only when both pass', ...)` — Assert "both" or "only when both" in GREEN context

**Assertion steps — disabled/absent skip:**
9. `Then('it describes skipping unit tests when the {string} setting is {string}', ...)` — Assert content describes skipping for the given value
10. `Then('only BDD scenarios drive the TDD loop in this case', ...)` — Assert "Only BDD scenarios" or "only scenarios drive"
11. `Then('it describes skipping unit tests when the {string} section is absent from {string}', ...)` — Assert absent handling described
12. `Then('the behavior is identical to when unit tests are disabled', ...)` — Assert identical/same treatment for absent vs disabled

**Assertion steps — quality references:**
13. `Then('it references {string} for guidance on writing good unit tests', ...)` — Assert content references the given file (e.g., tests.md) in unit test context
14. `Then('it references {string} for guidance on mocking in unit tests', ...)` — Assert content references the given file (e.g., mocking.md) in unit test context

**Assertion steps — BDD independence:**
15. `Then('it describes BDD scenarios as the independent proof layer', ...)` — Assert "independent proof layer"
16. `Then('it distinguishes unit tests as finer-grained coverage written by the same agent', ...)` — Assert "finer-grained" or "same agent"
17. `Then('it does not elevate unit test status above BDD scenarios', ...)` — Assert unit tests described as supplementary (independence reminder positions BDD above)

**Assertion steps — loop structure (DataTable):**
18. `Then('the enabled-unit-test loop follows this structure:', ...)` — Verify each row's phase/activity against content (RED has unit test, GREEN has both, REFACTOR has both)
19. `Then('the disabled-unit-test loop follows this structure:', ...)` — Verify each row matches standard loop without unit tests

**Assertion steps — vertical slicing:**
20. `Then('the vertical slicing instruction covers both step definitions and unit tests', ...)` — Assert vertical slicing mentions both
21. `Then('it warns against writing all unit tests first then all implementation', ...)` — Assert WRONG example or warning includes unit tests

### Step 4: Run validation

Execute all validation commands to verify zero regressions.

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — All 13 @adw-308 scenarios must pass (0 undefined, 0 failures)
2. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` — Existing implement_tdd scenarios still pass
3. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — All regression scenarios pass
4. `bun run lint` — No lint errors
5. `bun run build` — Build succeeds
6. `bunx tsc --noEmit` — Type check passes

## Patch Scope
**Lines of code to change:** ~80 lines in SKILL.md (Section 3 additions + Section 4 rewrite), ~200 lines in new step definitions file
**Risk level:** low — prompt-only change to SKILL.md plus new step definitions that only assert against SKILL.md content
**Testing required:** BDD scenario validation via cucumber-js for @adw-308, @adw-304-implement-tdd, and @regression tags
