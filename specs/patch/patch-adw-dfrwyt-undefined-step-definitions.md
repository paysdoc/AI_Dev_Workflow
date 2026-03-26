# Patch: Create step definitions for all 12 @adw-308 BDD scenarios

## Metadata
adwId: `dfrwyt-unit-test-support-in`
reviewChangeRequest: `specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md`

## Issue Summary
**Original Spec:** specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md
**Issue:** All 12 @adw-308 BDD scenarios FAIL because step definitions are undefined. The feature file `features/implement_tdd_unit_test_support.feature` references 24 steps (When/Then) that have no implementations in any step definition file. Steps include content inspection variants (`inspected for the red-green-refactor loop instructions`, `inspected for the GREEN phase instructions`, `inspected for unit test instructions`) and assertions about SKILL.md content (RED/GREEN/REFACTOR phases, skip-when-disabled, tests.md/mocking.md references, BDD independence, vertical slicing, data table loop structure).
**Solution:** Two-part fix: (1) Enhance SKILL.md Section 4 with comprehensive unit test workflow instructions so assertions have content to match, and (2) create a new step definitions file implementing all 24 undefined steps.

## Files to Modify
Use these files to implement the patch:

- `.claude/skills/implement-tdd/SKILL.md` — Enhance Section 4 ("Unit Tests - Conditional") with prescriptive RED/GREEN/REFACTOR integration, test framework awareness, tests.md/mocking.md references, BDD independence reminder, and vertical slicing note. Add conditional unit test mentions to Section 3 RED/GREEN/REFACTOR sub-sections.
- `features/step_definitions/implementTddUnitTestSteps.ts` — **New file.** All 24 step definitions for the @adw-308 feature scenarios. Follows existing patterns: imports `sharedCtx` from `commonSteps.ts`, uses `assert` for content assertions against `sharedCtx.fileContent`.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Enhance SKILL.md Section 4 — Unit Tests (Conditional)

Replace the current minimal Section 4 (lines 63-67) with a comprehensive section. The enhanced section must contain content that matches what each @adw-308 BDD scenario asserts. Specifically:

**4.1 Configuration check** (scenarios 1, 5, 6):
- Instruct reading `.adw/project.md` for the `## Unit Tests` setting — must appear textually to satisfy `it contains instructions to check ".adw/project.md" for the "## Unit Tests" setting`
- The section placement (Section 4, before Section 5) satisfies `the check happens before or during the TDD loop, not after`
- State: when `disabled` or section absent, skip unit tests entirely — only BDD scenarios drive the TDD loop
- State: absent is treated identically to disabled (default behavior)

**4.2 When enabled — RED phase integration** (scenarios 2, 3):
- Write a unit test alongside the step definition in the RED phase, before implementation (test-first)
- Unit tests are written per scenario as part of the vertical slice, not batched after the loop
- Reference [tests.md](tests.md) for good vs bad test patterns
- Reference [mocking.md](mocking.md) for mocking guidance (mock at system boundaries only)

**4.3 When enabled — GREEN phase integration** (scenario 4):
- Both the BDD scenario AND the unit test must pass for GREEN
- Read `.adw/commands.md` `## Run Tests` for the unit test runner command
- Implementation is considered GREEN only when both pass

**4.4 BDD independence reminder** (scenario 9):
- BDD scenarios are the independent proof layer — written by a separate agent
- Unit tests provide finer-grained coverage but are written by the same agent as implementation
- Do not elevate unit test status above BDD scenarios

**4.5 Vertical slicing** (scenario 12):
- Vertical slicing covers both step definitions and unit tests
- Warn against writing all unit tests first then all implementation

Also add brief conditional notes in Section 3's RED, GREEN, and REFACTOR sub-sections referencing Section 4 when unit tests are enabled. This ensures scenarios 10 and 11 (data table loop structure) can match the expanded loop.

### Step 2: Create step definitions file

Create `features/step_definitions/implementTddUnitTestSteps.ts` with all 24 undefined steps. Group by category:

**Imports and setup:**
```typescript
import { When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';
```

**Context (When) steps — no-ops since content is already loaded:**
1. `When('the content is inspected for the red-green-refactor loop instructions', ...)` — no-op
2. `When('the content is inspected for the GREEN phase instructions', ...)` — no-op
3. `When('the content is inspected for unit test instructions', ...)` — no-op

**Configuration check assertions (Then):**
4. `Then('it contains instructions to check {string} for the {string} setting', ...)` — assert content includes both the file path and the setting heading
5. `Then('the check happens before or during the TDD loop, not after', ...)` — assert Section 4 (`## 4.`) index < Section 5 (`## 5.`) index (or that Section 3 references Section 4)

**RED phase assertions (Then):**
6. `Then('the RED phase includes writing unit tests alongside step definitions when unit tests are enabled', ...)` — assert content mentions unit test + step definition in RED context when enabled
7. `Then('unit tests are written before implementation code \\(test-first)', ...)` — assert content includes "test-first" or "before implementation"
8. `Then('unit tests are written as part of the vertical slice for each scenario', ...)` — assert content connects unit tests with vertical slice
9. `Then('there is no separate post-loop section for writing all unit tests at once', ...)` — assert content does NOT contain a standalone "write all unit tests" section after the loop

**GREEN phase assertions (Then):**
10. `Then('the GREEN phase verifies that both the BDD scenario and unit tests pass', ...)` — assert GREEN phase mentions both BDD scenario and unit test passing
11. `Then('implementation is considered GREEN only when both pass', ...)` — assert content conditions GREEN on both passing

**Skip-when-disabled assertions (Then):**
12. `Then('it describes skipping unit tests when the {string} setting is {string}', ...)` — assert content describes skipping for the given setting value
13. `Then('only BDD scenarios drive the TDD loop in this case', ...)` — assert content states only BDD scenarios drive the loop
14. `Then('it describes skipping unit tests when the {string} section is absent from {string}', ...)` — assert content describes absent = skip
15. `Then('the behavior is identical to when unit tests are disabled', ...)` — assert content treats absent same as disabled

**Quality reference assertions (Then):**
16. `Then('it references {string} for guidance on writing good unit tests', ...)` — assert content references the file in unit test context
17. `Then('it references {string} for guidance on mocking in unit tests', ...)` — assert content references the file in mocking context

**BDD independence assertions (Then):**
18. `Then('it describes BDD scenarios as the independent proof layer', ...)` — assert content includes "independent proof layer" or equivalent
19. `Then('it distinguishes unit tests as finer-grained coverage written by the same agent', ...)` — assert content mentions "finer-grained" or "same agent"
20. `Then('it does not elevate unit test status above BDD scenarios', ...)` — assert content does NOT position unit tests as primary; BDD remains primary

**Data table loop structure assertions (Then):**
21. `Then('the enabled-unit-test loop follows this structure:', ...)` — data table step: for each row (phase, activity), assert SKILL.md mentions the activity for that phase
22. `Then('the disabled-unit-test loop follows this structure:', ...)` — data table step: for each row, assert the standard Section 3 loop matches

**Vertical slicing assertions (Then):**
23. `Then('the vertical slicing instruction covers both step definitions and unit tests', ...)` — assert vertical slicing text mentions both step definitions and unit tests
24. `Then('it warns against writing all unit tests first then all implementation', ...)` — already exists in `implementTddSkillSteps.ts` (line 127-133); DO NOT duplicate — reuse existing step

**Important:** Step 24 (`it warns against writing all tests first then all implementation`) already exists in `implementTddSkillSteps.ts` at line 127. However, the feature file uses the wording `it warns against writing all unit tests first then all implementation` (note: "unit tests" vs "tests"). Check whether Cucumber matches this — if the expression is different, a new step definition is needed. If identical, skip.

### Step 3: Run validation

Execute all validation commands to verify zero regressions.

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — All 12 @adw-308 scenarios must pass
2. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` — Existing implement_tdd scenarios still pass
3. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — All regression scenarios pass
4. `bun run lint` — No lint errors
5. `bunx tsc --noEmit` — Type check passes

## Patch Scope
**Lines of code to change:** ~150 (SKILL.md ~50 lines enhanced, step defs ~100 lines new)
**Risk level:** low
**Testing required:** BDD scenario verification via cucumber-js for @adw-308, @adw-304-implement-tdd, and @regression tags
