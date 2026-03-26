# Patch: Create step definitions for all @adw-308 undefined steps

## Metadata
adwId: `dfrwyt-unit-test-support-in`
reviewChangeRequest: `Issue #2: All 13 @adw-308 scenarios fail with undefined step definitions`

## Issue Summary
**Original Spec:** `specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md`
**Issue:** All 13 `@adw-308` scenarios fail because no step definition file was created for the new feature scenarios in `features/implement_tdd_unit_test_support.feature`. Cucumber reports ~24 undefined steps.
**Solution:** Create `features/step_definitions/implementTddUnitTestSupportSteps.ts` implementing all undefined steps. Steps inspect SKILL.md content using string/regex assertions consistent with existing step definition patterns in `implementTddSkillSteps.ts` and `commonSteps.ts`.

## Files to Modify
Use these files to implement the patch:

- `features/step_definitions/implementTddUnitTestSupportSteps.ts` — **NEW FILE.** All undefined step definitions for the `@adw-308` scenarios.
- `.claude/skills/implement-tdd/SKILL.md` — **May need enhancement.** If Section 4 lacks content the step assertions require (RED/GREEN phase unit test integration, vertical slicing for unit tests, tests.md/mocking.md references in unit test context), enhance Section 4 so assertions pass.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Read the SKILL.md and feature file to catalogue all undefined steps
- Read `features/implement_tdd_unit_test_support.feature` to identify every step that is undefined
- Read `.claude/skills/implement-tdd/SKILL.md` to understand what content currently exists in Section 4 and the rest of the file
- Read `features/step_definitions/implementTddSkillSteps.ts` and `features/step_definitions/commonSteps.ts` for patterns to follow
- Read `features/step_definitions/copyTargetSkillsAdwInitSteps.ts` for the `When the content is inspected` pattern

### Step 2: Enhance SKILL.md Section 4 if needed
- Check whether the current Section 4 content satisfies the assertions that the step definitions will make. The scenarios expect:
  - Instructions to check `.adw/project.md` for `## Unit Tests` setting (exists)
  - RED phase includes writing unit tests alongside step definitions when enabled (currently missing detailed RED integration)
  - Unit tests written before implementation / test-first (currently missing)
  - GREEN phase verifies both BDD scenario and unit tests pass (currently missing)
  - Vertical slicing covers both step definitions and unit tests (currently missing)
  - References to `tests.md` and `mocking.md` for unit test quality (exists but could be clearer)
  - BDD scenarios as independent proof layer (exists but brief)
  - Skip entirely when disabled or absent (exists)
- If any expected content is missing, enhance Section 4 with the minimum additions needed. Integrate unit test mentions into the Section 3 red-green-refactor loop description where the conditional flow applies.

### Step 3: Create `features/step_definitions/implementTddUnitTestSupportSteps.ts`
- Import `{ When, Then }` from `@cucumber/cucumber`, `assert` from `assert`, and `{ sharedCtx }` from `./commonSteps.ts`
- Use `sharedCtx.fileContent` for all content assertions (set by Background's `Given the file ... is read` step)
- Implement all ~24 undefined steps. The key steps and their assertion patterns:

**Context-only When steps** (no assertions, content already loaded):
- `When('the content is inspected for the red-green-refactor loop instructions', ...)`
- `When('the content is inspected for the GREEN phase instructions', ...)`
- `When('the content is inspected for unit test instructions', ...)`

**Then steps checking for specific content patterns:**
- `Then('it contains instructions to check {string} for the {string} setting', ...)` — assert content includes both the file path and the setting string
- `Then('the check happens before or during the TDD loop, not after', ...)` — assert `## Unit Tests` section index < loop end index or is within Section 4 which precedes Section 5
- `Then('the RED phase includes writing unit tests alongside step definitions when unit tests are enabled', ...)` — assert content mentions RED + unit test + step definition in context of enabled
- `Then('unit tests are written before implementation code \\(test-first)', ...)` — assert content mentions writing unit tests before implementation
- `Then('unit tests are written as part of the vertical slice for each scenario', ...)` — assert vertical slice covers unit tests
- `Then('there is no separate post-loop section for writing all unit tests at once', ...)` — assert no "write all unit tests" batch section exists
- `Then('the GREEN phase verifies that both the BDD scenario and unit tests pass', ...)` — assert GREEN mentions both BDD and unit tests passing
- `Then('implementation is considered GREEN only when both pass', ...)` — assert both must pass for GREEN
- `Then('it describes skipping unit tests when the {string} setting is {string}', ...)` — assert content mentions skip/disabled
- `Then('only BDD scenarios drive the TDD loop in this case', ...)` — assert BDD-only when disabled
- `Then('it describes skipping unit tests when the {string} section is absent from {string}', ...)` — assert absent section handling
- `Then('the behavior is identical to when unit tests are disabled', ...)` — assert absent = disabled
- `Then('it references {string} for guidance on writing good unit tests', ...)` — assert file reference exists in content
- `Then('it references {string} for guidance on mocking in unit tests', ...)` — assert file reference exists in content
- `Then('it describes BDD scenarios as the independent proof layer', ...)` — assert "independent proof layer" or equivalent
- `Then('it distinguishes unit tests as finer-grained coverage written by the same agent', ...)` — assert finer-grained / same agent distinction
- `Then('it does not elevate unit test status above BDD scenarios', ...)` — assert BDD is positioned as primary/independent
- `Then('the enabled-unit-test loop follows this structure:', ...)` — DataTable step: verify RED has unit test + step def, GREEN has both pass, REFACTOR keeps both green
- `Then('the disabled-unit-test loop follows this structure:', ...)` — DataTable step: verify RED has step def only, GREEN has scenario only
- `Then('the vertical slicing instruction covers both step definitions and unit tests', ...)` — assert vertical slicing mentions unit tests
- `Then('it warns against writing all unit tests first then all implementation', ...)` — assert warning about horizontal slicing for unit tests

### Step 4: Run @adw-308 scenarios to verify all steps are defined and passing
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` and fix any assertion failures by either adjusting step definitions or enhancing SKILL.md content
- Iterate until all 13 scenarios pass

### Step 5: Run regression scenarios to verify zero regressions
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` to confirm no existing scenarios broke

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — All 13 @adw-308 scenarios pass (0 undefined, 0 failures)
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` — Existing implement_tdd scenarios still pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — All regression scenarios pass
- `bun run lint` — No linting errors
- `bunx tsc --noEmit` — Main project type check passes
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW project type check passes

## Patch Scope
**Lines of code to change:** ~150-200 (new step definition file) + ~30-50 (SKILL.md Section 4 enhancement if needed)
**Risk level:** low
**Testing required:** All @adw-308 scenarios pass, all @regression scenarios pass, lint and type checks clean
