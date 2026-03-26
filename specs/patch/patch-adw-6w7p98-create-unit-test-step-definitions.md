# Patch: Create step definitions for @adw-308 unit test support scenarios

## Metadata
adwId: `6w7p98-unit-test-support-in`
reviewChangeRequest: `Issue #1: All 13 @adw-308 scenarios FAILED — every scenario has undefined step definitions`

## Issue Summary
**Original Spec:** specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md
**Issue:** All 13 `@adw-308` scenarios in `features/implement_tdd_unit_test_support.feature` fail with "Undefined" steps. No step definition file was created for the new scenarios. The scenario proof shows approximately 20+ undefined step snippets.
**Solution:** Create a new step definition file `features/step_definitions/implementTddUnitTestSupportSteps.ts` implementing all undefined steps. Steps inspect `sharedCtx.fileContent` (SKILL.md content loaded by Background) for expected content patterns.

## Files to Modify
Use these files to implement the patch:

- `features/step_definitions/implementTddUnitTestSupportSteps.ts` — **NEW FILE.** All undefined step definitions for the 13 `@adw-308` scenarios.
- `.claude/skills/implement-tdd/SKILL.md` — **Read-only reference.** Understand the content the steps will assert against (Section 3 and Section 4 especially).
- `features/implement_tdd_unit_test_support.feature` — **Read-only reference.** The feature file defines all 13 scenarios with the steps to implement.
- `features/step_definitions/implementTddSkillSteps.ts` — **Read-only reference.** Follow existing patterns (assertion style, `sharedCtx` usage).
- `features/step_definitions/commonSteps.ts` — **Read-only reference.** Import `sharedCtx` from here.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Read SKILL.md to identify assertion targets
- Read `.claude/skills/implement-tdd/SKILL.md` to understand what content each step should assert against
- Section 4 contains the unit test conditional instructions — most `Then` steps assert presence of keywords/phrases in this section
- Section 3 contains the red-green-refactor loop — steps about RED/GREEN/REFACTOR phases assert content there
- Note the exact text used in SKILL.md so assertions match (e.g., `.adw/project.md`, `## Unit Tests`, `tests.md`, `mocking.md`, `RED`, `GREEN`, `REFACTOR`, `step definition`, `unit test`, `vertical`, etc.)

### Step 2: Create `features/step_definitions/implementTddUnitTestSupportSteps.ts`
- Import `{ When, Then }` from `@cucumber/cucumber` and `assert` from `assert`
- Import `{ sharedCtx }` from `./commonSteps.ts`
- Follow the same patterns as `implementTddSkillSteps.ts`: steps read `sharedCtx.fileContent` and assert with `assert.ok(content.includes(...), message)`

Implement these undefined steps (grouped by scenario):

**When steps (context-only, content already loaded by Background):**
- `When('the content is inspected for the red-green-refactor loop instructions', ...)` — no-op, content already in `sharedCtx`
- `When('the content is inspected for the GREEN phase instructions', ...)` — no-op
- `When('the content is inspected for unit test instructions', ...)` — no-op

**Scenario 1 — Reading the Unit Tests setting:**
- `Then('it contains instructions to check {string} for the {string} setting', ...)` — assert `sharedCtx.fileContent` includes both the file path and the setting heading
- `Then('the check happens before or during the TDD loop, not after', ...)` — assert the `## Unit Tests` check (Section 4) appears in SKILL.md before or at the same level as the TDD loop, or that Section 4 is positioned before the Report section

**Scenario 2 — RED phase integration:**
- `Then('the RED phase includes writing unit tests alongside step definitions when unit tests are enabled', ...)` — assert content includes RED and unit test references in same context
- `Then('unit tests are written before implementation code \\(test-first)', ...)` — assert content includes test-first / before implementation language

**Scenario 3 — Per-scenario vertical slice:**
- `Then('unit tests are written as part of the vertical slice for each scenario', ...)` — assert content includes vertical slicing that mentions unit tests
- `Then('there is no separate post-loop section for writing all unit tests at once', ...)` — assert content does NOT contain a section for batch unit test writing after the loop

**Scenario 4 — GREEN phase both pass:**
- `Then('the GREEN phase verifies that both the BDD scenario and unit tests pass', ...)` — assert GREEN section mentions both BDD/scenario and unit test passing
- `Then('implementation is considered GREEN only when both pass', ...)` — assert content includes both-must-pass language

**Scenario 5 — Skip when disabled:**
- `Then('it describes skipping unit tests when the {string} setting is {string}', ...)` — assert content includes the setting value (disabled) and skip language
- `Then('only BDD scenarios drive the TDD loop in this case', ...)` — assert content includes BDD-only / skip unit tests language

**Scenario 6 — Skip when absent:**
- `Then('it describes skipping unit tests when the {string} section is absent from {string}', ...)` — assert content includes absent/missing language
- `Then('the behavior is identical to when unit tests are disabled', ...)` — assert content treats absent same as disabled

**Scenario 7 & 8 — References to tests.md and mocking.md:**
- `Then('it references {string} for guidance on writing good unit tests', ...)` — assert content includes the referenced file
- `Then('it references {string} for guidance on mocking in unit tests', ...)` — assert content includes the referenced file

**Scenario 9 — BDD as independent proof layer:**
- `Then('it describes BDD scenarios as the independent proof layer', ...)` — assert content includes "independent proof layer" or equivalent
- `Then('it distinguishes unit tests as finer-grained coverage written by the same agent', ...)` — assert content includes finer-grained / same agent language
- `Then('it does not elevate unit test status above BDD scenarios', ...)` — assert content does NOT position unit tests as primary over BDD

**Scenario 10 & 11 — TDD loop structure (DataTable):**
- `Then('the enabled-unit-test loop follows this structure:', ...)` — accept DataTable, verify each phase/activity keyword appears in content
- `Then('the disabled-unit-test loop follows this structure:', ...)` — accept DataTable, verify each phase/activity keyword appears in content

**Scenario 12 — Vertical slicing with unit tests:**
- `Then('the vertical slicing instruction covers both step definitions and unit tests', ...)` — assert vertical slicing mentions both step definitions and unit tests
- `Then('it warns against writing all unit tests first then all implementation', ...)` — assert content includes warning about writing all unit tests first (note: similar step exists in `implementTddSkillSteps.ts` but with different wording "all tests first" — this new step specifically says "all unit tests first")

### Step 3: Verify assertions match SKILL.md content
- Cross-reference every assertion with SKILL.md Section 3 and Section 4 content
- If any assertion would fail because SKILL.md doesn't contain the expected text, do NOT modify SKILL.md — the spec says SKILL.md was already enhanced in earlier tasks. The step definitions should assert what exists
- If SKILL.md is genuinely missing content that scenarios expect, note it as a separate issue

### Step 4: Run @adw-308 scenarios and fix failures
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` to verify all 13 scenarios pass
- Fix any assertion mismatches by adjusting step definition assertions to match actual SKILL.md content
- Ensure assertions are specific enough to be meaningful but not so brittle they break on minor wording changes

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — All 13 new scenarios pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` — Existing implement_tdd scenarios still pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — All regression scenarios pass (zero regressions)
- `bun run lint` — No linting errors
- `bunx tsc --noEmit` — Type check passes

## Patch Scope
**Lines of code to change:** ~150-200 (one new file)
**Risk level:** low
**Testing required:** Run @adw-308, @adw-304-implement-tdd, and @regression scenario suites
