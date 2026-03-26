# Patch: Implement all 26 undefined @adw-308 step definitions and enhance SKILL.md Section 4

## Metadata
adwId: `dfrwyt-unit-test-support-in`
reviewChangeRequest: `specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md`

## Issue Summary
**Original Spec:** specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md
**Issue:** All 12 @adw-308 scenarios FAIL with 26 undefined steps. SKILL.md Section 4 was never enhanced — it still contains the original 3-line minimal content (lines 63-67). The feature file exists at `features/implement_tdd_unit_test_support.feature` but no corresponding step definitions were implemented.
**Solution:** (1) Rewrite SKILL.md Section 4 with comprehensive unit test workflow instructions so assertions have content to match. (2) Add conditional unit test mentions to Section 3. (3) Implement all 26 undefined step definitions in `features/step_definitions/implementTddUnitTestSteps.ts` (new file — keeps the #308-specific steps separate from the existing #304 step definitions).

## Files to Modify
Use these files to implement the patch:

- `.claude/skills/implement-tdd/SKILL.md` — Rewrite Section 4 ("Unit Tests - Conditional") and add conditional unit test mentions to Section 3's RED/GREEN/REFACTOR phases
- `features/step_definitions/implementTddUnitTestSteps.ts` — **New file.** All 26 undefined step definitions for @adw-308 scenarios. Separate file avoids bloating the existing `implementTddSkillSteps.ts` which serves #304 scenarios.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Rewrite SKILL.md Section 4 ("Unit Tests - Conditional")

Replace lines 63-67 of `.claude/skills/implement-tdd/SKILL.md` (the current minimal Section 4) with a comprehensive unit test workflow. The new Section 4 must include all of the following (each maps to one or more BDD scenario assertions):

1. **Test framework awareness**: "Read `.adw/commands.md` `## Run Tests` for the project's unit test runner command."
2. **When `## Unit Tests: enabled`** — integrate unit tests into the red-green-refactor loop:
   - **RED phase**: Write a unit test alongside the step definition, before implementation (test-first). The unit test targets the specific function/module being introduced. Follow [tests.md](tests.md) for good vs bad test patterns. Follow [mocking.md](mocking.md) for mocking guidance (mock at system boundaries only). Unit tests are written as part of each vertical slice (per scenario), NOT as a separate batch after the loop.
   - **GREEN phase**: Implementation must pass both the BDD scenario AND the unit test. The scenario is not considered GREEN until both pass.
   - **REFACTOR phase**: Ensure both the BDD scenario and unit tests still pass after refactoring.
3. **When `## Unit Tests: disabled` or absent**: Skip unit tests entirely. Only BDD scenarios drive the TDD loop. This is the default behavior. The behavior when the `## Unit Tests` section is absent from `.adw/project.md` is identical to when it is set to disabled.
4. **Independence reminder**: BDD scenarios are the independent proof layer — they were written by a separate agent and verify behavior independently. Unit tests provide finer-grained coverage but are written by the same agent as the implementation, so they carry accommodation risk. Unit tests do not elevate above BDD scenarios in status.

### Step 2: Add conditional unit test mentions to Section 3

Update the Section 3 Red-Green-Refactor loop in SKILL.md to conditionally mention unit tests:

- **Vertical slicing block** (around lines 29-39): Add text noting that vertical slicing applies to unit tests as well when enabled — do NOT write all unit tests first then implement. The WRONG/RIGHT example should note that unit tests are included in the vertical slice alongside step definitions.
- **RED phase** (around lines 44-47): Add conditional note: "When unit tests are enabled (see Section 4), also write a unit test for the function/module being introduced, alongside the step definition. The unit test must be written before implementation (test-first)."
- **GREEN phase** (around lines 49-52): Add: "When unit tests are enabled, both the BDD scenario AND the unit test must pass. Implementation is only GREEN when both pass."
- **REFACTOR phase** (around lines 54-57): Add: "When unit tests are enabled, verify both the BDD scenario and unit tests still pass after refactoring."

Keep existing content for the disabled path unchanged — only add conditional notes.

### Step 3: Create `features/step_definitions/implementTddUnitTestSteps.ts` with all 26 undefined step definitions

Create a new step definitions file. Import `{ When, Then }` from `@cucumber/cucumber`, `assert` from `assert`, and `{ sharedCtx }` from `./commonSteps.ts`. Each step inspects `sharedCtx.fileContent` (the SKILL.md content loaded by the Background).

**When steps (3 no-ops — content already loaded by Background):**
- `When('the content is inspected for the red-green-refactor loop instructions', function () {})` — no-op
- `When('the content is inspected for the GREEN phase instructions', function () {})` — no-op
- `When('the content is inspected for unit test instructions', function () {})` — no-op

**Then steps — .adw/project.md setting (2 steps):**
- `Then('it contains instructions to check {string} for the {string} setting', function (filePath: string, setting: string) { ... })` — assert `sharedCtx.fileContent` includes both `filePath` and `setting`
- `Then('the check happens before or during the TDD loop, not after', function () { ... })` — assert the Unit Tests section is referenced within or before the loop (e.g., content includes "Section 4" or "Unit Tests" referenced from within the loop phases)

**Then steps — RED phase / test-first (4 steps):**
- `Then('the RED phase includes writing unit tests alongside step definitions when unit tests are enabled', function () { ... })` — assert content includes "RED" and "unit test" in the context of writing alongside step definitions
- `Then('unit tests are written before implementation code \\(test-first)', function () { ... })` — assert content mentions test-first or before implementation for unit tests
- `Then('unit tests are written as part of the vertical slice for each scenario', function () { ... })` — assert content describes unit tests within each vertical slice
- `Then('there is no separate post-loop section for writing all unit tests at once', function () { ... })` — assert no section heading or instruction that batches all unit tests after the loop (negative assertion: content should NOT contain phrasing like "after all scenarios, write unit tests")

**Then steps — GREEN phase (2 steps):**
- `Then('the GREEN phase verifies that both the BDD scenario and unit tests pass', function () { ... })` — assert GREEN phase requires both BDD scenario and unit test to pass
- `Then('implementation is considered GREEN only when both pass', function () { ... })` — assert content links GREEN status to both passing

**Then steps — disabled/absent (4 steps):**
- `Then('it describes skipping unit tests when the {string} setting is {string}', function (setting: string, value: string) { ... })` — assert content describes skipping when the setting has this value
- `Then('only BDD scenarios drive the TDD loop in this case', function () { ... })` — assert content says only BDD scenarios drive the loop when disabled
- `Then('it describes skipping unit tests when the {string} section is absent from {string}', function (section: string, file: string) { ... })` — assert content covers the absent case
- `Then('the behavior is identical to when unit tests are disabled', function () { ... })` — assert absent is treated the same as disabled

**Then steps — references (2 steps):**
- `Then('it references {string} for guidance on writing good unit tests', function (file: string) { ... })` — assert content includes the file reference (e.g., `tests.md`) in the unit test context
- `Then('it references {string} for guidance on mocking in unit tests', function (file: string) { ... })` — assert content includes the file reference (e.g., `mocking.md`) in the unit test context

**Then steps — independence (3 steps):**
- `Then('it describes BDD scenarios as the independent proof layer', function () { ... })` — assert content includes "independent proof layer"
- `Then('it distinguishes unit tests as finer-grained coverage written by the same agent', function () { ... })` — assert content mentions finer-grained coverage or supplementary
- `Then('it does not elevate unit test status above BDD scenarios', function () { ... })` — assert BDD is positioned as primary (independent proof layer applies to BDD, not to unit tests)

**Then steps — loop structure with DataTable (2 steps):**
- `Then('the enabled-unit-test loop follows this structure:', function (dataTable) { ... })` — for each row (phase, activity), assert SKILL.md describes that phase including that activity when enabled. Specifically: RED → "step definition" + "unit test", GREEN → "both" or "scenario and unit test", REFACTOR → "both" or "keeping both green"
- `Then('the disabled-unit-test loop follows this structure:', function (dataTable) { ... })` — for each row, assert the content describes the default loop (no unit test requirements). This validates the existing Section 3 content for the non-unit-test path.

**Then steps — vertical slicing (2 steps):**
- `Then('the vertical slicing instruction covers both step definitions and unit tests', function () { ... })` — assert vertical slicing content mentions both step definitions and unit tests
- NOTE: `Then('it warns against writing all unit tests first then all implementation', ...)` already exists at `implementTddSkillSteps.ts:127-133`. It checks for "WRONG" or "all tests first" in content. Verify this matches the feature file step text exactly. If it matches, no duplicate needed. If Cucumber reports it as undefined, the text differs and a new step definition must be added with the exact matching expression.

### Step 4: Run @adw-308 scenarios and fix iteratively

Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"`. If any scenario fails:
- If the failure is an assertion error (content not found in SKILL.md), adjust the SKILL.md content to include the expected text
- If the failure is a step definition error, fix the step definition
- Re-run until all 12 scenarios pass

### Step 5: Verify zero regressions

Run @adw-304-implement-tdd and @regression scenarios to ensure the SKILL.md changes and new step definitions don't break anything.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — All 12 @adw-308 scenarios pass (0 failures, 0 undefined)
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` — Existing implement_tdd scenarios still pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — All regression scenarios pass
- `bun run lint` — No linting errors
- `bunx tsc --noEmit` — Type check passes
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW type check passes
- `bun run build` — Build succeeds

## Patch Scope
**Lines of code to change:** ~200 (SKILL.md ~70 lines rewritten/added, new step definitions file ~130 lines)
**Risk level:** low
**Testing required:** BDD scenario validation — all 12 @adw-308 scenarios must pass, all @regression scenarios must continue to pass. This is a prompt-only change (SKILL.md markdown) plus test infrastructure (step definitions) — no runtime TypeScript code changes.
