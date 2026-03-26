# Patch: Fix @regression suite — implement @adw-308 step definitions and enhance SKILL.md Section 4

## Metadata
adwId: `dfrwyt-unit-test-support-in`
reviewChangeRequest: `Issue #3: @regression suite broken: 12 failures and 8 undefined steps (556 scenarios total: 12 failed, 8 undefined, 536 passed). The failures are all from @adw-308 scenarios that were tagged @regression but have no step definitions, polluting the regression suite. Resolution: Implement the missing step definitions to fix both @adw-308 and @regression suites simultaneously.`

## Issue Summary
**Original Spec:** `specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md`
**Issue:** 12 @adw-308 scenarios tagged @regression have undefined step definitions, causing 12 failures and 8 undefined steps in the regression suite (556 total: 12 failed, 8 undefined, 536 passed). The SKILL.md Section 4 is also still minimal, so content-based assertions in these scenarios would fail even with step definitions.
**Solution:** Two-part fix: (1) Enhance SKILL.md Section 4 to integrate unit tests into the red-green-refactor loop with proper references to tests.md, mocking.md, and independence reminders; (2) Implement all missing step definitions in a new file `features/step_definitions/implementTddUnitTestSteps.ts`.

## Files to Modify

- `.claude/skills/implement-tdd/SKILL.md` — Enhance Section 4 ("Unit Tests - Conditional") to integrate unit tests as a first-class part of the TDD loop
- `features/step_definitions/implementTddUnitTestSteps.ts` — **New file.** All missing step definitions for the 12 @adw-308 scenarios

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Enhance SKILL.md Section 4 ("Unit Tests - Conditional")

Replace the current minimal Section 4 with a comprehensive unit test integration that satisfies all 12 @adw-308 scenario assertions. The enhanced Section 4 must contain:

1. **Project config check** — Instructions to check `.adw/project.md` for the `## Unit Tests` setting. This check must appear BEFORE or DURING the TDD loop (it's already in Section 4 which is before Section 5, so position is correct).

2. **When enabled — RED phase expansion** — When unit tests are enabled, the RED phase writes both a step definition AND a unit test before implementation (test-first). Unit tests are written as part of the vertical slice for each scenario, NOT as a separate batch. Reference [tests.md](tests.md) for good vs bad unit test patterns.

3. **When enabled — GREEN phase expansion** — Both the BDD scenario AND unit tests must pass. Implementation is considered GREEN only when both pass. Read `.adw/commands.md` `## Run Tests` for the project's unit test runner command.

4. **When enabled — REFACTOR** — Keep both BDD scenario and unit test green during refactoring. Reference [mocking.md](mocking.md) for mocking guidance (mock at system boundaries only).

5. **When disabled or absent — skip entirely** — Only BDD scenarios drive the TDD loop (unchanged from current behavior).

6. **Independence reminder** — BDD scenarios are the independent proof layer (written by a separate agent). Unit tests are finer-grained coverage written by the same agent as implementation. Do not elevate unit test status above BDD scenarios.

7. **Vertical slicing with unit tests** — The vertical slicing instruction must cover both step definitions AND unit tests. Warn against writing all unit tests first then all implementation.

8. **Loop structure summary** — Include a clear summary showing:
   - Enabled: RED (step definition + unit test) → GREEN (pass both scenario and unit test) → REFACTOR (keep both green)
   - Disabled: RED (step definition) → GREEN (pass scenario) → REFACTOR (keep scenario green)

Key content strings that step definitions will assert on (ensure these exact phrases appear in Section 4):
- `.adw/project.md` and `## Unit Tests` (for the config check)
- `RED` phase with `unit test` and `step definition` together
- `before implementation` or `test-first` (for test ordering)
- `vertical slice` (for per-scenario unit tests)
- `GREEN` with both `scenario` and `unit test` passing
- `disabled` and `absent` for skip conditions
- `BDD scenarios` as `independent proof layer`
- `finer-grained coverage` for unit test characterization
- `tests.md` and `mocking.md` references
- `.adw/commands.md` and `## Run Tests` for test runner

### Step 2: Create step definitions file for @adw-308 scenarios

Create `features/step_definitions/implementTddUnitTestSteps.ts` with all missing step definitions. Each step definition reads from `sharedCtx.fileContent` (the SKILL.md content loaded by the Background Given step) and asserts specific content exists.

The missing steps to implement (grouped by type):

**When steps:**
- `When('the content is inspected for the red-green-refactor loop instructions', ...)` — no-op, content already in sharedCtx
- `When('the content is inspected for the GREEN phase instructions', ...)` — no-op, content already in sharedCtx
- `When('the content is inspected for unit test instructions', ...)` — no-op, content already in sharedCtx

**Then steps (config check):**
- `Then('it contains instructions to check {string} for the {string} setting', ...)` — assert content includes both strings
- `Then('the check happens before or during the TDD loop, not after', ...)` — assert `## Unit Tests` section appears before the RED/GREEN loop or within Section 4

**Then steps (RED phase / test-first):**
- `Then('the RED phase includes writing unit tests alongside step definitions when unit tests are enabled', ...)` — assert RED phase mentions both unit test and step definition
- `Then('unit tests are written before implementation code \\(test-first)', ...)` — assert content mentions test-first or before implementation
- `Then('unit tests are written as part of the vertical slice for each scenario', ...)` — assert vertical slice + unit test
- `Then('there is no separate post-loop section for writing all unit tests at once', ...)` — assert no separate batch section

**Then steps (GREEN phase):**
- `Then('the GREEN phase verifies that both the BDD scenario and unit tests pass', ...)` — assert GREEN mentions both passing
- `Then('implementation is considered GREEN only when both pass', ...)` — assert both must pass for GREEN

**Then steps (disabled/absent):**
- `Then('it describes skipping unit tests when the {string} setting is {string}', ...)` — assert content mentions skipping when disabled
- `Then('only BDD scenarios drive the TDD loop in this case', ...)` — assert BDD-only when disabled
- `Then('it describes skipping unit tests when the {string} section is absent from {string}', ...)` — assert absent handling
- `Then('the behavior is identical to when unit tests are disabled', ...)` — assert absent=disabled

**Then steps (references):**
- `Then('it references {string} for guidance on writing good unit tests', ...)` — assert tests.md reference
- `Then('it references {string} for guidance on mocking in unit tests', ...)` — assert mocking.md reference

**Then steps (independence):**
- `Then('it describes BDD scenarios as the independent proof layer', ...)` — assert independent proof layer text
- `Then('it distinguishes unit tests as finer-grained coverage written by the same agent', ...)` — assert finer-grained + same agent
- `Then('it does not elevate unit test status above BDD scenarios', ...)` — assert proof layer is BDD, not unit tests

**Then steps (loop structure — DataTable):**
- `Then('the enabled-unit-test loop follows this structure:', ...)` — parse DataTable, assert RED has step def + unit test, GREEN has both pass, REFACTOR has both green
- `Then('the disabled-unit-test loop follows this structure:', ...)` — parse DataTable, assert RED has step def only, GREEN has scenario only

**Then steps (vertical slicing):**
- `Then('the vertical slicing instruction covers both step definitions and unit tests', ...)` — assert vertical slicing mentions unit tests
- `Then('it warns against writing all unit tests first then all implementation', ...)` — assert warning text

Follow the existing pattern from `implementTddSkillSteps.ts`: import from `@cucumber/cucumber`, use `sharedCtx.fileContent`, use `assert.ok()` with descriptive messages. Import `sharedCtx` from `./commonSteps.ts`.

### Step 3: Verify both @adw-308 and @regression pass

Run the @adw-308 scenarios to verify all 12 pass, then run @regression to verify zero regressions.

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — All 12 @adw-308 scenarios must pass (0 failures, 0 undefined)
2. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — All regression scenarios pass (536+ passed, 0 failed, 0 undefined)
3. `bun run lint` — No linting errors
4. `bunx tsc --noEmit` — No type errors
5. `bun run build` — Build succeeds

## Patch Scope
**Lines of code to change:** ~120 (SKILL.md Section 4: ~60 lines enhanced; new step defs file: ~60 lines)
**Risk level:** low
**Testing required:** @adw-308 scenarios (12 scenarios, all must pass) + @regression suite (536+ scenarios, all must pass)
