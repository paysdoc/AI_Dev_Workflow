# Patch: Fix @regression suite failure from undefined @adw-308 step definitions

## Metadata
adwId: `dfrwyt-unit-test-support-in`
reviewChangeRequest: `Issue #3: 8 of the 12 @adw-308 scenarios are also tagged @regression, meaning the regression suite would also fail with undefined steps if run. Resolution: Implementing the step definitions (issue #1) resolves this. Once step defs exist and SKILL.md is enhanced, the @regression-tagged scenarios should pass.`

## Issue Summary
**Original Spec:** `specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md`
**Issue:** All 12 `@adw-308` scenarios have undefined step definitions. 8 of these are also tagged `@regression`, causing the regression suite to fail with undefined steps. The current SKILL.md Section 4 is too minimal for the step definitions to assert meaningful content against.
**Solution:** (1) Enhance SKILL.md Section 4 to integrate unit tests as a first-class part of the TDD loop with test-first workflow, quality references, and independence reminder. (2) Create a new step definitions file implementing all undefined steps for the 12 `@adw-308` scenarios so both `@adw-308` and `@regression` suites pass.

## Files to Modify
Use these files to implement the patch:

- `.claude/skills/implement-tdd/SKILL.md` — Rewrite Section 4 ("Unit Tests - Conditional") to provide prescriptive unit test workflow integrated into the red-green-refactor loop. Also add conditional unit test mentions into Section 3 loop description.
- `features/step_definitions/unitTestSupportSteps.ts` — **New file.** Step definitions for all 12 `@adw-308` scenarios in `features/implement_tdd_unit_test_support.feature`.

Read-only references (do not modify):
- `features/implement_tdd_unit_test_support.feature` — The 12 scenarios defining the expected behavior.
- `features/step_definitions/commonSteps.ts` — `sharedCtx` for accessing loaded file content.
- `features/step_definitions/copyTargetSkillsAdwInitSteps.ts` — Existing `When('the content is inspected')` step.
- `features/step_definitions/implementTddSkillSteps.ts` — Existing steps to avoid duplication.
- `.claude/skills/implement-tdd/tests.md` — Referenced by SKILL.md for quality guidance.
- `.claude/skills/implement-tdd/mocking.md` — Referenced by SKILL.md for mocking guidance.
- `guidelines/coding_guidelines.md` — Follow coding guidelines.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Read current state of SKILL.md and all reference files
- Read `.claude/skills/implement-tdd/SKILL.md` fully
- Read `.claude/skills/implement-tdd/tests.md` and `mocking.md`
- Read `features/implement_tdd_unit_test_support.feature` to understand all 12 scenarios
- Read `features/step_definitions/commonSteps.ts` for `sharedCtx` import pattern
- Read `features/step_definitions/implementTddSkillSteps.ts` for existing steps to avoid duplicating
- Read `features/step_definitions/copyTargetSkillsAdwInitSteps.ts` for the existing `When('the content is inspected')` step
- Read `guidelines/coding_guidelines.md`

### Step 2: Enhance SKILL.md Section 4 and Section 3
Rewrite Section 4 ("Unit Tests - Conditional") to provide comprehensive, prescriptive instructions:

**Section 4 must contain:**
- Instruction to check `.adw/project.md` for the `## Unit Tests` setting (this check happens before/during the TDD loop)
- When **enabled**:
  - Read `.adw/commands.md` `## Run Tests` for the unit test runner command
  - During the RED phase: write a unit test alongside the step definition for each scenario (test-first, before implementation)
  - Unit tests are written per-scenario as part of the vertical slice (NOT batched separately)
  - Reference [tests.md](tests.md) for good vs bad unit test patterns
  - Reference [mocking.md](mocking.md) for mocking guidance (mock at system boundaries only)
  - During the GREEN phase: both the BDD scenario AND the unit test must pass; implementation is GREEN only when both pass
  - During REFACTOR: both must stay green
  - BDD scenarios are the independent proof layer; unit tests are finer-grained coverage written by the same agent as implementation
  - Do not elevate unit test status above BDD scenarios
- When **disabled** or absent: skip unit tests entirely, only BDD scenarios drive the TDD loop

**Section 3 modifications:**
- Add a conditional note in the RED phase mentioning that when unit tests are enabled, a unit test is also written alongside the step definition
- Add a conditional note in the GREEN phase mentioning that when unit tests are enabled, both the scenario and unit test must pass
- The vertical slicing instruction should cover both step definitions and unit tests, warning against writing all unit tests first then all implementation

### Step 3: Create step definitions file
Create `features/step_definitions/unitTestSupportSteps.ts` implementing all undefined steps from the 12 `@adw-308` scenarios.

The undefined steps to implement (all assert against `sharedCtx.fileContent` from the loaded SKILL.md):

**When steps (content inspection variants):**
- `When('the content is inspected for the red-green-refactor loop instructions')` — no-op, content already loaded
- `When('the content is inspected for the GREEN phase instructions')` — no-op, content already loaded
- `When('the content is inspected for unit test instructions')` — no-op, content already loaded

**Then steps (assertions against SKILL.md content):**
1. `Then('it contains instructions to check {string} for the {string} setting')` — assert content includes both strings
2. `Then('the check happens before or during the TDD loop, not after')` — assert `.adw/project.md` / `Unit Tests` appears before or within the TDD loop section, not in a post-loop section
3. `Then('the RED phase includes writing unit tests alongside step definitions when unit tests are enabled')` — assert RED phase mentions unit tests + step definitions together when enabled
4. `Then('unit tests are written before implementation code (test-first)')` — assert test-first / before implementation language
5. `Then('unit tests are written as part of the vertical slice for each scenario')` — assert vertical slice covers unit tests
6. `Then('there is no separate post-loop section for writing all unit tests at once')` — assert no batch/separate unit test section exists after the loop
7. `Then('the GREEN phase verifies that both the BDD scenario and unit tests pass')` — assert GREEN mentions both passing
8. `Then('implementation is considered GREEN only when both pass')` — assert both-must-pass language
9. `Then('it describes skipping unit tests when the {string} setting is {string}')` — assert skip/disabled language
10. `Then('only BDD scenarios drive the TDD loop in this case')` — assert BDD-only when disabled
11. `Then('it describes skipping unit tests when the {string} section is absent from {string}')` — assert absent = skip
12. `Then('the behavior is identical to when unit tests are disabled')` — assert absent treated same as disabled
13. `Then('it references {string} for guidance on writing good unit tests')` — assert tests.md reference
14. `Then('it references {string} for guidance on mocking in unit tests')` — assert mocking.md reference
15. `Then('it describes BDD scenarios as the independent proof layer')` — assert independent proof layer language
16. `Then('it distinguishes unit tests as finer-grained coverage written by the same agent')` — assert finer-grained / same agent language
17. `Then('it does not elevate unit test status above BDD scenarios')` — assert BDD scenarios are primary
18. `Then('the enabled-unit-test loop follows this structure:')` — assert RED/GREEN/REFACTOR phases with unit test activities (data table)
19. `Then('the disabled-unit-test loop follows this structure:')` — assert RED/GREEN/REFACTOR phases without unit tests (data table)
20. `Then('the vertical slicing instruction covers both step definitions and unit tests')` — assert vertical slicing mentions both
21. `Then('it warns against writing all unit tests first then all implementation')` — assert anti-pattern warning

**Patterns to follow:**
- Import `{ When, Then }` from `@cucumber/cucumber` and `assert` from `assert`
- Import `{ sharedCtx }` from `./commonSteps.ts`
- All assertions use `sharedCtx.fileContent` (loaded by the Background step)
- Use `assert.ok(content.includes(...), message)` pattern consistent with existing step defs
- When step functions use `function()` syntax (not arrow), per Cucumber convention

### Step 4: Run validation
Execute the validation commands to verify zero regressions.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — All 12 @adw-308 scenarios must pass (0 failures, 0 undefined)
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — All regression scenarios pass (the 8 @regression-tagged @adw-308 scenarios included)
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` — Existing implement_tdd scenarios still pass
- `bun run lint` — No lint errors
- `bunx tsc --noEmit` — Type check passes
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check adws passes

## Patch Scope
**Lines of code to change:** ~120 (SKILL.md: ~50 lines rewritten/added, unitTestSupportSteps.ts: ~70 lines new)
**Risk level:** low
**Testing required:** BDD scenario suite — all `@adw-308`, `@regression`, and `@adw-304-implement-tdd` tags must pass with zero undefined steps
