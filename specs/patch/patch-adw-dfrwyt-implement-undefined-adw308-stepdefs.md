# Patch: Implement all undefined @adw-308 step definitions

## Metadata
adwId: `dfrwyt-unit-test-support-in`
reviewChangeRequest: `specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md`

## Issue Summary
**Original Spec:** specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md
**Issue:** All 12 @adw-308 scenarios FAILED because every new step definition is 'Undefined'. The feature file `features/implement_tdd_unit_test_support.feature` was created but no step definitions were implemented for its unique steps.
**Solution:** Create `features/step_definitions/implementTddUnitTestSupportSteps.ts` with all missing step definitions. Each step reads `sharedCtx.fileContent` (already loaded by Background steps via `commonSteps.ts`) and asserts that SKILL.md contains the expected unit test instructions. Follow existing patterns from `implementTddSkillSteps.ts`.

## Files to Modify
Use these files to implement the patch:

- `features/step_definitions/implementTddUnitTestSupportSteps.ts` — **NEW FILE.** All missing step definitions for the 12 @adw-308 scenarios.

Reference files (read-only):
- `features/implement_tdd_unit_test_support.feature` — The feature file defining the 12 scenarios and their steps.
- `features/step_definitions/implementTddSkillSteps.ts` — Existing step definitions to follow as a pattern.
- `features/step_definitions/commonSteps.ts` — Provides `sharedCtx` with `fileContent` and `filePath`.
- `features/step_definitions/copyTargetSkillsAdwInitSteps.ts` — Provides existing `When('the content is inspected')` step (line 110).
- `.claude/skills/implement-tdd/SKILL.md` — The file being inspected. Read to understand what content the assertions should match against.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Read SKILL.md to identify assertable content
- Read `.claude/skills/implement-tdd/SKILL.md` to understand what phrases/patterns exist for each assertion.
- Map each undefined step to specific content in SKILL.md that satisfies it.

### Step 2: Create implementTddUnitTestSupportSteps.ts with all missing step definitions
- Create `features/step_definitions/implementTddUnitTestSupportSteps.ts`.
- Import `{ When, Then }` from `@cucumber/cucumber`, `assert` from `assert`, and `{ sharedCtx }` from `./commonSteps.ts`.
- Implement the following step definitions (all inspect `sharedCtx.fileContent`):

**When steps (context-setting, no assertions):**
1. `When('the content is inspected for the red-green-refactor loop instructions')` — no-op, content already loaded.
2. `When('the content is inspected for the GREEN phase instructions')` — no-op, content already loaded.
3. `When('the content is inspected for unit test instructions')` — no-op, content already loaded.

**Then steps (assertions on SKILL.md content):**
4. `Then('it contains instructions to check {string} for the {string} setting')` — Assert `fileContent` includes both the config file path and the setting name.
5. `Then('the check happens before or during the TDD loop, not after')` — Assert the `## Unit Tests` / `.adw/project.md` reference appears in Section 4 (before or alongside the loop, not in a post-loop section).
6. `Then('the RED phase includes writing unit tests alongside step definitions when unit tests are enabled')` — Assert content contains RED + unit test + step definition together, with "enabled" context.
7. `Then('unit tests are written before implementation code \\(test-first)')` — Assert content mentions writing unit tests before implementation or test-first.
8. `Then('unit tests are written as part of the vertical slice for each scenario')` — Assert content ties unit tests to vertical slicing / per-scenario approach.
9. `Then('there is no separate post-loop section for writing all unit tests at once')` — Assert no instruction to batch all unit tests after the loop.
10. `Then('the GREEN phase verifies that both the BDD scenario and unit tests pass')` — Assert GREEN phase mentions both BDD/scenario and unit test passing.
11. `Then('implementation is considered GREEN only when both pass')` — Assert content indicates both must pass for GREEN.
12. `Then('it describes skipping unit tests when the {string} setting is {string}')` — Assert content describes skipping when setting matches the value (disabled).
13. `Then('only BDD scenarios drive the TDD loop in this case')` — Assert content states only BDD scenarios drive the loop when unit tests are off.
14. `Then('it describes skipping unit tests when the {string} section is absent from {string}')` — Assert content describes the absent case leading to skip.
15. `Then('the behavior is identical to when unit tests are disabled')` — Assert content treats absent as equivalent to disabled.
16. `Then('it references {string} for guidance on writing good unit tests')` — Assert content references the given file (tests.md) in unit test context.
17. `Then('it references {string} for guidance on mocking in unit tests')` — Assert content references the given file (mocking.md) in unit test context.
18. `Then('it describes BDD scenarios as the independent proof layer')` — Assert content includes "independent proof layer" or similar.
19. `Then('it distinguishes unit tests as finer-grained coverage written by the same agent')` — Assert content mentions finer-grained or supplementary coverage + same agent.
20. `Then('it does not elevate unit test status above BDD scenarios')` — Assert content positions BDD as primary, not unit tests.
21. `Then('the enabled-unit-test loop follows this structure:')` — With DataTable param. Assert each phase/activity pair is represented in content.
22. `Then('the disabled-unit-test loop follows this structure:')` — With DataTable param. Assert each phase/activity pair is represented in content (standard loop without unit tests).
23. `Then('the vertical slicing instruction covers both step definitions and unit tests')` — Assert vertical slicing instruction mentions both.
24. `Then('it warns against writing all unit tests first then all implementation')` — Assert content warns against batching unit tests (horizontal slicing for unit tests).

### Step 3: Verify SKILL.md Section 4 has sufficient content for assertions to pass
- Read SKILL.md Section 4 carefully. If the current Section 4 content is too minimal for certain assertions to pass (e.g., missing phrases about "independent proof layer", "test-first", "both pass"), the step definitions' searched phrases must match what SKILL.md actually contains.
- If SKILL.md Section 4 lacks content that certain scenarios assert, enhance Section 4 to include the required instructions (this was already planned in the original spec Task 2). Key additions to Section 4:
  - Unit tests written in RED phase alongside step definitions (test-first)
  - Both unit test AND scenario must pass in GREEN phase
  - Reference to `tests.md` and `mocking.md` for unit test quality
  - BDD scenarios as independent proof layer; unit tests as supplementary
  - Disabled/absent → skip entirely, only BDD scenarios drive loop
  - Vertical slicing applies to unit tests too
- Keep changes to SKILL.md minimal — only add what's needed for assertions to pass.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — All 12 @adw-308 scenarios must pass (0 undefined, 0 failures)
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` — Existing implement_tdd scenarios still pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — All regression scenarios pass (zero regressions)
- `bun run lint` — No linting errors
- `bunx tsc --noEmit` — Type check passes

## Patch Scope
**Lines of code to change:** ~150-200 (new step definitions file) + ~30-50 (SKILL.md Section 4 enhancement if needed)
**Risk level:** low
**Testing required:** Run @adw-308 scenarios to confirm all 12 pass, run @regression to confirm no regressions
