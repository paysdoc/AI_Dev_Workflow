# Patch: Create all @adw-308 step definitions and enhance SKILL.md Section 4

## Metadata
adwId: `dfrwyt-unit-test-support-in`
reviewChangeRequest: `specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md`

## Issue Summary
**Original Spec:** specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md
**Issue:** All 12 @adw-308 scenarios fail with undefined step definitions. No step definition file was created for the new scenarios in `features/implement_tdd_unit_test_support.feature`. Additionally, SKILL.md Section 4 is still minimal and lacks the detailed unit test workflow content that the step definitions assert against.
**Solution:** Two-part fix: (1) Enhance SKILL.md Section 4 with comprehensive unit test TDD integration content so assertions have matching content, and (2) Create a new step definitions file with all 23 undefined steps following the existing pattern in `implementTddSkillSteps.ts`.

## Files to Modify

- `.claude/skills/implement-tdd/SKILL.md` — Enhance Section 4 ("Unit Tests - Conditional") with detailed TDD loop integration, and add conditional unit test notes to Section 3
- `features/step_definitions/implementTddUnitTestSteps.ts` — **New file.** Step definitions for all 12 @adw-308 scenarios (23 step definitions total)

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Read current state
- Read `.claude/skills/implement-tdd/SKILL.md` to confirm current Section 4 content
- Read `features/implement_tdd_unit_test_support.feature` to confirm all 12 scenarios and their steps
- Read `features/step_definitions/implementTddSkillSteps.ts` to understand the existing pattern (uses `sharedCtx.fileContent` from `commonSteps.ts`, asserts with `assert.ok` on string includes)
- Read `features/step_definitions/commonSteps.ts` to understand `sharedCtx` structure

### Step 2: Enhance SKILL.md Section 4 and add unit test notes to Section 3
Rewrite Section 4 ("Unit Tests - Conditional") to be a comprehensive subsection. The key content that must be present (to satisfy BDD assertions):

**Move the unit test check to happen BEFORE the loop** — Add a substep to Section 2 or early in Section 3 (before the loop begins): "Check `.adw/project.md` for the `## Unit Tests` setting. This determines whether unit tests are part of the TDD loop."

**Expand Section 3** to conditionally include unit tests in the loop phases:
- **RED phase (when unit tests enabled):** Write step definition **+ unit test** for the scenario. Unit tests are written before implementation (test-first), as part of the vertical slice for each scenario — not batched separately.
- **GREEN phase (when unit tests enabled):** Implementation must pass **both** the BDD scenario **and** the unit test. Implementation is considered GREEN only when both pass.
- **REFACTOR phase (when unit tests enabled):** Keep both green during cleanup.

**Expand Section 4** with:
- When enabled: Read `.adw/commands.md` `## Run Tests` for the unit test runner command. Write unit tests following [tests.md](tests.md) for good vs bad test patterns and [mocking.md](mocking.md) for mocking at system boundaries only.
- When `disabled` or section absent: skip unit tests entirely — only BDD scenarios drive the TDD loop. Behavior is identical whether disabled or absent.
- BDD scenarios are the **independent proof layer** — they were written by a separate agent. Unit tests provide **finer-grained coverage** but are written by the same agent as the implementation (not elevated above BDD scenarios).
- Vertical slicing applies to unit tests: write step definition + unit test + implementation per scenario. Do NOT write all unit tests first then all implementation (WRONG pattern).

**Summary of content keywords the BDD assertions check for:**
- `.adw/project.md` and `## Unit Tests` (setting check)
- `test-first` or `before implementation` (test-first order)
- `vertical slice` + `unit test` (per-scenario, not batch)
- `both` + `pass` in GREEN context (dual verification)
- `disabled` + `skip` (skip when disabled)
- `absent` (skip when absent)
- `tests.md` reference in unit test context
- `mocking.md` reference in unit test context
- `independent proof layer` (BDD independence)
- `finer-grained` or `same agent` (unit test distinction)
- Vertical slicing covers unit tests (already covers step defs from Section 3)

### Step 3: Create step definitions file `features/step_definitions/implementTddUnitTestSteps.ts`

Create a new file following the pattern of `implementTddSkillSteps.ts`. Import from `@cucumber/cucumber`, `assert`, and `sharedCtx` from `./commonSteps.ts`.

All steps read `sharedCtx.fileContent` (already set by the Background's `Given/And` steps) and assert on string content.

**3 When steps (no-ops — content already loaded by Background):**
1. `When('the content is inspected for the red-green-refactor loop instructions', ...)` — no-op
2. `When('the content is inspected for the GREEN phase instructions', ...)` — no-op
3. `When('the content is inspected for unit test instructions', ...)` — no-op

**20 Then steps:**
1. `Then('it contains instructions to check {string} for the {string} setting', (file, setting) => ...)` — assert content includes both `file` and `setting`
2. `Then('the check happens before or during the TDD loop, not after', ...)` — assert `## Unit Tests` or `.adw/project.md` appears before the main loop code in content (e.g., check that the setting reference appears in or before Section 3/4, not after Section 5)
3. `Then('the RED phase includes writing unit tests alongside step definitions when unit tests are enabled', ...)` — assert content includes RED + unit test + step definition concepts together
4. `Then('unit tests are written before implementation code \\(test-first)', ...)` — assert content includes `test-first` or `before implementation`
5. `Then('unit tests are written as part of the vertical slice for each scenario', ...)` — assert content mentions vertical slice in unit test context
6. `Then('there is no separate post-loop section for writing all unit tests at once', ...)` — assert content does NOT have a standalone "write all unit tests" section after the loop
7. `Then('the GREEN phase verifies that both the BDD scenario and unit tests pass', ...)` — assert GREEN + both + pass
8. `Then('implementation is considered GREEN only when both pass', ...)` — assert both pass concept
9. `Then('it describes skipping unit tests when the {string} setting is {string}', (setting, value) => ...)` — assert content mentions skipping/skip when the value (disabled)
10. `Then('only BDD scenarios drive the TDD loop in this case', ...)` — assert BDD-only when disabled
11. `Then('it describes skipping unit tests when the {string} section is absent from {string}', (section, file) => ...)` — assert absent handling
12. `Then('the behavior is identical to when unit tests are disabled', ...)` — assert absent = disabled equivalence
13. `Then('it references {string} for guidance on writing good unit tests', (ref) => ...)` — assert content includes the reference file in unit test context
14. `Then('it references {string} for guidance on mocking in unit tests', (ref) => ...)` — assert content includes the reference file in mocking context
15. `Then('it describes BDD scenarios as the independent proof layer', ...)` — assert `independent proof layer`
16. `Then('it distinguishes unit tests as finer-grained coverage written by the same agent', ...)` — assert `finer-grained` or `same agent`
17. `Then('it does not elevate unit test status above BDD scenarios', ...)` — assert `independent proof layer` present (BDD is primary)
18. `Then('the enabled-unit-test loop follows this structure:', (dataTable) => ...)` — assert each row's activity concept is present in content (RED+unit test, GREEN+both, REFACTOR+both green)
19. `Then('the disabled-unit-test loop follows this structure:', (dataTable) => ...)` — assert each row's activity concept is present (RED+step def only, GREEN+scenario, REFACTOR+scenario green)
20. `Then('the vertical slicing instruction covers both step definitions and unit tests', ...)` — assert vertical slicing mentions both step definitions and unit tests

**Note:** `Then('it warns against writing all unit tests first then all implementation', ...)` already exists in `implementTddSkillSteps.ts` (line 127) — do NOT duplicate it.

### Step 4: Run validation
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — all 12 scenarios must pass
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — zero regressions
- Run `bun run lint` — no lint errors
- Run `bunx tsc --noEmit` — no type errors

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — All 12 @adw-308 scenarios pass (0 undefined, 0 failing)
2. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` — Existing implement_tdd scenarios still pass
3. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — All regression scenarios pass
4. `bun run lint` — No lint errors in new or modified files
5. `bunx tsc --noEmit` — No TypeScript errors

## Patch Scope
**Lines of code to change:** ~180 (60 lines SKILL.md enhancement + 120 lines new step definitions file)
**Risk level:** low
**Testing required:** BDD scenario execution — all 12 @adw-308 scenarios must go from undefined to passing; existing @regression scenarios must remain green
