# Patch: Implement all undefined @adw-308 step definitions

## Metadata
adwId: `dfrwyt-unit-test-support-in`
reviewChangeRequest: `Issue #2: All 12 @adw-308 BDD scenarios fail because no step definitions exist for the new steps. Resolution: Implement all undefined step definitions.`

## Issue Summary
**Original Spec:** specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md
**Issue:** All 12 @adw-308 BDD scenarios fail with 26 undefined steps. The feature file `features/implement_tdd_unit_test_support.feature` was created but no corresponding step definitions were implemented. Steps like `it contains instructions to check {string} for the {string} setting`, `the content is inspected for the red-green-refactor loop instructions`, and 18+ more are all undefined.
**Solution:** Implement all 26 undefined step definitions in `features/step_definitions/implementTddSkillSteps.ts`, following the established pattern of asserting against `sharedCtx.fileContent` (the SKILL.md content loaded by the Background). Also ensure SKILL.md Section 4 and Section 3 contain the content these steps assert against (prerequisite from Issue #1 patches).

## Files to Modify

- `features/step_definitions/implementTddSkillSteps.ts` — Add all 26 undefined step definitions (3 When no-ops + 23 Then assertions)
- `.claude/skills/implement-tdd/SKILL.md` — Enhance Section 4 and add conditional unit test mentions to Section 3 (prerequisite — the step definitions assert against content that must exist in SKILL.md)

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Enhance SKILL.md Section 3 with conditional unit test mentions

Update the Section 3 red-green-refactor loop to conditionally reference unit tests:

- **Vertical slicing block** (lines 29-39): Add text noting that vertical slicing applies to unit tests as well — do NOT write all unit tests first then implement. Add an example that includes unit tests in the WRONG/RIGHT diagram.
- **RED phase** (lines 44-47): Add a conditional note: "When unit tests are enabled (see Section 4), also write a unit test for the function/module being introduced, alongside the step definition. The unit test must be written before implementation (test-first)."
- **GREEN phase** (lines 49-52): Add: "When unit tests are enabled, both the BDD scenario AND the unit test must pass. Implementation is only GREEN when both pass."
- **REFACTOR phase** (lines 54-57): Add: "When unit tests are enabled, verify both the BDD scenario and unit tests still pass after refactoring."

Keep existing content for the disabled path unchanged — only add conditional notes.

### Step 2: Rewrite SKILL.md Section 4 ("Unit Tests - Conditional")

Replace lines 63-67 (the current minimal Section 4) with comprehensive unit test workflow instructions:

1. **Test framework awareness**: "Read `.adw/commands.md` `## Run Tests` for the project's unit test runner command."
2. **When enabled**:
   - RED phase: Write a unit test alongside the step definition, before implementation (test-first). The unit test targets the specific function/module being introduced. Follow [tests.md](tests.md) for good vs bad test patterns. Follow [mocking.md](mocking.md) for mocking guidance (mock at system boundaries only). Unit tests are written as part of each vertical slice (per scenario), NOT as a separate batch.
   - GREEN phase: Implementation must pass both the BDD scenario AND the unit test.
   - REFACTOR phase: Ensure both still pass after refactoring.
3. **When disabled or absent**: Skip unit tests entirely. Only BDD scenarios drive the TDD loop. This is the default behavior. The behavior for absent is identical to disabled.
4. **Independence reminder**: BDD scenarios are the independent proof layer — written by a separate agent, verify behavior independently. Unit tests provide finer-grained coverage but are written by the same agent as the implementation.

### Step 3: Implement all 26 undefined step definitions

Add to `features/step_definitions/implementTddSkillSteps.ts`, using the existing `sharedCtx` import and pattern:

**When steps (3 no-ops — content already loaded by Background):**
- `When('the content is inspected for the red-green-refactor loop instructions', function () {})` — no-op
- `When('the content is inspected for the GREEN phase instructions', function () {})` — no-op
- `When('the content is inspected for unit test instructions', function () {})` — no-op

**Then steps — .adw/project.md setting (2 steps):**
- `Then('it contains instructions to check {string} for the {string} setting', function (filePath, setting) { ... })` — assert `sharedCtx.fileContent` includes both `filePath` and `setting`
- `Then('the check happens before or during the TDD loop, not after', function () { ... })` — assert `## Unit Tests` or Section 4 content appears before or references integration with the loop (e.g., Section 4 number <= Section 3, or unit test instructions reference the RED/GREEN phases)

**Then steps — RED phase / test-first (4 steps):**
- `Then('the RED phase includes writing unit tests alongside step definitions when unit tests are enabled', function () { ... })` — assert content mentions writing unit tests in the RED phase alongside step definitions (e.g., content includes "RED" AND "unit test" in proximity, or "step definition" AND "unit test" in the same loop context)
- `Then('unit tests are written before implementation code \\(test-first)', function () { ... })` — assert content mentions test-first / before implementation for unit tests
- `Then('unit tests are written as part of the vertical slice for each scenario', function () { ... })` — assert content describes unit tests within each vertical slice
- `Then('there is no separate post-loop section for writing all unit tests at once', function () { ... })` — assert no section heading or instruction that batches all unit tests after the loop completes

**Then steps — GREEN phase (2 steps):**
- `Then('the GREEN phase verifies that both the BDD scenario and unit tests pass', function () { ... })` — assert content describes GREEN phase requiring both BDD and unit test to pass
- `Then('implementation is considered GREEN only when both pass', function () { ... })` — assert content links GREEN status to both passing

**Then steps — disabled/absent (4 steps):**
- `Then('it describes skipping unit tests when the {string} setting is {string}', function (setting, value) { ... })` — assert content describes skipping when the setting matches value (e.g., "disabled")
- `Then('only BDD scenarios drive the TDD loop in this case', function () { ... })` — assert content says only BDD scenarios drive the loop when disabled
- `Then('it describes skipping unit tests when the {string} section is absent from {string}', function (section, file) { ... })` — assert content covers the absent case
- `Then('the behavior is identical to when unit tests are disabled', function () { ... })` — assert absent is treated the same as disabled (e.g., "absent" and "disabled" appear in the same sentence/paragraph, or both map to "skip")

**Then steps — references (2 steps):**
- `Then('it references {string} for guidance on writing good unit tests', function (file) { ... })` — assert content includes the file reference (e.g., `tests.md`) in the context of unit test guidance
- `Then('it references {string} for guidance on mocking in unit tests', function (file) { ... })` — assert content includes the file reference (e.g., `mocking.md`) in the context of unit test mocking

**Then steps — independence (3 steps):**
- `Then('it describes BDD scenarios as the independent proof layer', function () { ... })` — assert content includes "independent proof layer" or equivalent phrasing
- `Then('it distinguishes unit tests as finer-grained coverage written by the same agent', function () { ... })` — assert content mentions unit tests as finer-grained/supplementary coverage
- `Then('it does not elevate unit test status above BDD scenarios', function () { ... })` — assert BDD is positioned as primary (e.g., "independent proof layer" is applied to BDD, not unit tests)

**Then steps — loop structure with DataTable (2 steps):**
- `Then('the enabled-unit-test loop follows this structure:', function (dataTable) { ... })` — for each row in the DataTable (phase, activity), assert the SKILL.md content describes that phase including that activity when unit tests are enabled
- `Then('the disabled-unit-test loop follows this structure:', function (dataTable) { ... })` — for each row, assert the SKILL.md content describes that phase with only BDD-related activity (no unit test mention required for disabled path)

**Then steps — vertical slicing (2 steps):**
- `Then('the vertical slicing instruction covers both step definitions and unit tests', function () { ... })` — assert vertical slicing content mentions both step definitions and unit tests
- `Then('it warns against writing all unit tests first then all implementation', function () { ... })` — NOTE: this step already exists at line 127-133 of implementTddSkillSteps.ts. Verify it matches the feature file text. If the existing step matches, no change needed. If the Cucumber expression differs (e.g., escaped parentheses), add a new step with the exact matching expression.

### Step 4: Run @adw-308 scenarios and fix failures iteratively

Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"`. If any scenario fails:
- If the failure is an assertion error (content not found), adjust the SKILL.md content to include the expected text
- If the failure is a step definition error, fix the step definition
- Re-run until all 12 scenarios pass

### Step 5: Verify zero regressions

Run regression and existing implement_tdd scenarios to ensure no breakage.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — All 12 @adw-308 scenarios pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` — Existing implement_tdd scenarios still pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — All regression scenarios pass
- `bun run lint` — No linting errors
- `bunx tsc --noEmit` — Type check passes
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW type check passes
- `bun run build` — Build succeeds

## Patch Scope
**Lines of code to change:** ~200 (SKILL.md ~70 lines rewritten/added, step definitions ~130 lines added)
**Risk level:** low
**Testing required:** BDD scenario validation — all 12 @adw-308 scenarios must pass, all @regression scenarios must continue to pass. This is a prompt-only change (SKILL.md markdown) plus test infrastructure (step definitions) — no runtime TypeScript code changes.
