# Patch: Integrate unit tests into SKILL.md TDD loop and implement all @adw-308 step definitions

## Metadata
adwId: `dfrwyt-unit-test-support-in`
reviewChangeRequest: `specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md`

## Issue Summary
**Original Spec:** specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md
**Issue:** SKILL.md has zero changes. Section 4 ("Unit Tests - Conditional") is still a minimal 3-line block that says "write Vitest/Jest unit tests" but doesn't integrate unit tests into the red-green-refactor loop, doesn't describe test-first workflow, doesn't add GREEN phase verification, and doesn't reference tests.md/mocking.md in the unit test context. All 12 @adw-308 BDD scenarios fail with ~24 undefined step definitions.
**Solution:** (1) Rewrite SKILL.md Section 4 with comprehensive unit test workflow instructions integrated into the TDD loop. (2) Add conditional unit test mentions to Section 3's RED/GREEN/REFACTOR phases and vertical slicing. (3) Implement all missing step definitions in `implementTddSkillSteps.ts` with assertions that match the enhanced SKILL.md wording.

## Files to Modify

- `.claude/skills/implement-tdd/SKILL.md` -- Rewrite Section 4, add conditional unit test mentions to Section 3
- `features/step_definitions/implementTddSkillSteps.ts` -- Add ~24 new step definitions for all undefined @adw-308 steps

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Enhance SKILL.md Section 3 with conditional unit test mentions

In Section 3 ("Red-Green-Refactor Loop"), make these additions:

**Vertical slicing block** -- Update the WRONG/RIGHT example to show unit tests are also per-scenario (when enabled):

```
WRONG (horizontal):
  RED:   step1, step2, step3, step4
  GREEN: impl1, impl2, impl3, impl4

RIGHT (vertical):
  RED -> GREEN: step1 -> impl1
  RED -> GREEN: step2 -> impl2
  ...

When unit tests are enabled (see Section 4), include unit tests in the vertical slice:
  RED -> GREEN: step1+ut1 -> impl1
  RED -> GREEN: step2+ut2 -> impl2
```

**RED phase** -- After "Write the step definitions needed for this scenario", add:
```
- When unit tests are enabled (see Section 4), also write a unit test targeting the function/module being introduced. Write the unit test before implementation (test-first), alongside the step definition.
```

**GREEN phase** -- After "Write the minimal code needed to make this scenario pass", add:
```
- When unit tests are enabled, verify both the BDD scenario and the unit test pass. Implementation is considered GREEN only when both pass.
```

**REFACTOR phase** -- After existing refactoring bullets, add:
```
- When unit tests are enabled, keep both the scenario and unit test green after each refactor step
```

### Step 2: Rewrite SKILL.md Section 4 ("Unit Tests - Conditional")

Replace the current minimal Section 4 (lines 63-67) with a comprehensive block:

```markdown
### 4. Unit Tests (Conditional)

Check `.adw/project.md` for the `## Unit Tests` setting. Read `.adw/commands.md` `## Run Tests` for the project's unit test runner command.

**When unit tests are enabled:**

Unit tests are integrated into the red-green-refactor loop alongside step definitions. They provide finer-grained coverage targeting specific functions and modules.

- **RED phase**: Write a unit test alongside the step definition, before implementation (test-first). The unit test targets the specific function/module being introduced. Follow [tests.md](tests.md) for good vs bad test patterns. Follow [mocking.md](mocking.md) for mocking guidance — mock at system boundaries only.
- **GREEN phase**: Implementation must pass both the BDD scenario AND the unit test. Implementation is considered GREEN only when both pass.
- **REFACTOR phase**: Refactoring keeps both the scenario and unit test green.

Loop structure when unit tests are enabled:
- RED: Write step definition + unit test
- GREEN: Implement code to pass both scenario and unit test
- REFACTOR: Clean up while keeping both green

**When unit tests are disabled or absent:**

Skip unit tests entirely. Only BDD scenarios drive the TDD loop.

- If `## Unit Tests` is `disabled`: skip unit tests entirely.
- If the `## Unit Tests` section is absent from `.adw/project.md`: treat as disabled — skip unit tests entirely. The behavior is identical to when unit tests are disabled.

Loop structure when unit tests are disabled:
- RED: Write step definition
- GREEN: Implement code to pass scenario
- REFACTOR: Clean up while keeping scenario green

**Independence and hierarchy:**

BDD scenarios are the independent proof layer — they were written by a separate agent and verify behavior independently. Unit tests provide finer-grained coverage written by the same agent as the implementation. Do not elevate unit test status above BDD scenarios.
```

### Step 3: Add all missing step definitions to `implementTddSkillSteps.ts`

Append the following step definitions at the end of the file (before the closing). All use `sharedCtx.fileContent` from `commonSteps.ts`.

**3 When steps** (context-setting, no assertions — reuse sharedCtx.fileContent from Background):
- `When('the content is inspected for the red-green-refactor loop instructions', ...)` -- no-op, content already loaded
- `When('the content is inspected for the GREEN phase instructions', ...)` -- no-op
- `When('the content is inspected for unit test instructions', ...)` -- no-op

**~21 Then steps** with assertions on `sharedCtx.fileContent`:

1. `it contains instructions to check {string} for the {string} setting` -- assert content includes both the file path and the setting heading
2. `the check happens before or during the TDD loop, not after` -- assert Section 4 heading appears before or adjacent to Section 3, or Section 3 references unit tests conditionally
3. `the RED phase includes writing unit tests alongside step definitions when unit tests are enabled` -- assert RED + unit test + step definition co-occurrence
4. `unit tests are written before implementation code (test-first)` -- assert "before implementation" or "test-first"
5. `unit tests are written as part of the vertical slice for each scenario` -- assert "vertical" + "unit test" co-occurrence
6. `there is no separate post-loop section for writing all unit tests at once` -- negative assert: no "after the loop write all unit tests" pattern
7. `the GREEN phase verifies that both the BDD scenario and unit tests pass` -- assert GREEN + both + pass
8. `implementation is considered GREEN only when both pass` -- assert "only when both pass"
9. `it describes skipping unit tests when the {string} setting is {string}` -- assert skip + setting value
10. `only BDD scenarios drive the TDD loop in this case` -- assert "only BDD scenarios"
11. `it describes skipping unit tests when the {string} section is absent from {string}` -- assert absent + skip
12. `the behavior is identical to when unit tests are disabled` -- assert "identical" or "treat as disabled"
13. `it references {string} for guidance on writing good unit tests` -- assert referenced filename near unit test context
14. `it references {string} for guidance on mocking in unit tests` -- assert referenced filename near unit test context
15. `it describes BDD scenarios as the independent proof layer` -- assert "independent proof layer"
16. `it distinguishes unit tests as finer-grained coverage written by the same agent` -- assert "finer-grained" or "same agent"
17. `it does not elevate unit test status above BDD scenarios` -- negative assert: unit tests not described as "primary" or "main" proof
18. `the enabled-unit-test loop follows this structure:` (DataTable) -- each row's phase/activity is present in content
19. `the disabled-unit-test loop follows this structure:` (DataTable) -- each row's phase/activity is present in content
20. `the vertical slicing instruction covers both step definitions and unit tests` -- assert vertical slicing mentions unit tests
21. `it warns against writing all unit tests first then all implementation` -- assert WRONG example or anti-pattern warning includes unit tests

### Step 4: Verify wording alignment between SKILL.md and step definitions

Before running tests, manually verify that every assertion string in step definitions matches exact wording present in the enhanced SKILL.md. Critical alignment points:
- "independent proof layer" must appear verbatim in SKILL.md
- "finer-grained coverage" or "same agent" must appear verbatim
- "only when both pass" must appear verbatim
- "before implementation" or "test-first" must appear
- DataTable activity strings must appear in the loop structure summaries
- "treat as disabled" or "identical" must appear for absent = disabled equivalence

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` -- All 12 @adw-308 scenarios pass (0 failures, 0 undefined)
2. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` -- Existing implement_tdd scenarios still pass
3. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` -- All regression scenarios pass (includes @adw-308 @regression tagged scenarios)
4. `bun run lint` -- No lint errors
5. `bunx tsc --noEmit` -- No type errors

## Patch Scope
**Lines of code to change:** ~220 (SKILL.md ~80 lines rewrite/addition, step defs ~140 lines new)
**Risk level:** low
**Testing required:** BDD scenario runs for @adw-308, @adw-304-implement-tdd, and @regression tags
