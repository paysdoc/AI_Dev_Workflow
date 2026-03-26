# Patch: Rewrite SKILL.md Section 4 with unit test TDD loop integration

## Metadata
adwId: `dfrwyt-unit-test-support-in`
reviewChangeRequest: `Issue #1: SKILL.md was not modified. The spec identifies .claude/skills/implement-tdd/SKILL.md as 'The main file to modify' (Task 2). Zero changes were made, meaning the core feature — integrating unit tests into the TDD loop — was never implemented.`

## Issue Summary
**Original Spec:** `specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md`
**Issue:** SKILL.md Section 4 ("Unit Tests - Conditional") remains minimal (5 lines). It checks `.adw/project.md` but doesn't integrate unit tests into the red-green-refactor loop. Missing: RED phase expansion, GREEN phase expansion, test framework awareness, `tests.md`/`mocking.md` references in unit test context, vertical slicing for unit tests, and BDD independence reminder. Additionally, Section 3 has no conditional references to unit tests. All 13 `@adw-308` BDD scenarios fail with undefined step definitions.
**Solution:** (1) Rewrite SKILL.md Section 4 with prescriptive unit test workflow. (2) Add conditional unit test notes to Section 3's RED/GREEN/REFACTOR phases. (3) Write all 24 missing step definitions in a new file. This is a prompt-only change (SKILL.md markdown) plus test infrastructure — no runtime TypeScript code changes.

## Files to Modify

- `.claude/skills/implement-tdd/SKILL.md` — Rewrite Section 4 (lines 63-67) and add conditional notes to Section 3 RED/GREEN/REFACTOR phases
- `features/step_definitions/implementTddUnitTestSupportSteps.ts` — **NEW FILE.** 24 step definitions for `@adw-308` scenarios (mirrors feature file naming convention)

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Rewrite SKILL.md Section 4 — Unit Tests (Conditional)

Replace the current Section 4 content (lines 63-67):
```md
### 4. Unit Tests (Conditional)

Check `.adw/project.md` for the `## Unit Tests` section:
- If unit tests are **enabled**: write Vitest/Jest unit tests for any non-trivial logic introduced, following the guidelines in [tests.md](tests.md) and [mocking.md](mocking.md). The BDD scenario remains the independent proof layer.
- If unit tests are **disabled** or the section is absent: skip unit tests entirely.
```

With expanded content that includes ALL of the following (every item is required for BDD scenarios to pass):

1. **Setting check**: Instruct agent to check `.adw/project.md` for the `## Unit Tests` setting before or during the TDD loop
2. **When disabled or absent**: Skip unit tests entirely — only BDD scenarios drive the TDD loop. Absent is identical to disabled.
3. **When enabled — RED phase**: Write a unit test alongside the step definition for each scenario. Unit tests are test-first (written before implementation code). Written per-scenario as part of the vertical slice, NOT as a separate batch after the loop.
4. **When enabled — GREEN phase**: Implementation must pass BOTH the BDD scenario AND the unit test. Only considered GREEN when both pass.
5. **When enabled — REFACTOR**: Both must remain green after refactoring.
6. **Test framework awareness**: Read `.adw/commands.md` `## Run Tests` for the project's unit test runner command
7. **Quality references**: Reference [tests.md](tests.md) for good vs bad test patterns when writing unit tests. Reference [mocking.md](mocking.md) for mocking at system boundaries only.
8. **Independence reminder**: BDD scenarios are the independent proof layer (written by a separate agent). Unit tests provide finer-grained coverage but are written by the same build agent. Unit tests do NOT replace or elevate above BDD scenarios.
9. **Vertical slicing**: Unit tests follow the same vertical slicing principle — write per-scenario, not batched. Warn against writing all unit tests first then all implementation.

### Step 2: Add conditional unit test notes to Section 3

In Section 3's RED/GREEN/REFACTOR sub-sections, add brief conditional notes:

- **RED phase** (after "Write the step definitions needed for this scenario"): Add note that when unit tests are enabled (Section 4), also write a unit test for the logic being introduced
- **GREEN phase** (after "Write the minimal code needed to make this scenario pass"): Add note that when unit tests are enabled, verify the unit test also passes
- **REFACTOR phase** (after "Run the scenario after each refactor step to stay GREEN"): Add note that when unit tests are enabled, run unit tests too to keep both green

Keep these additions minimal — Section 4 has the full details.

### Step 3: Create step definitions file for @adw-308 scenarios

Create `features/step_definitions/implementTddUnitTestSupportSteps.ts` with all 24 step definitions.

**Imports:** `When`, `Then` from `@cucumber/cucumber`, `assert` from `assert`, `sharedCtx` from `./commonSteps.ts`.

**No-op context steps** (3 steps — content already in `sharedCtx.fileContent` from Background):
- `When('the content is inspected for the red-green-refactor loop instructions', ...)`
- `When('the content is inspected for the GREEN phase instructions', ...)`
- `When('the content is inspected for unit test instructions', ...)`

**Setting check steps** (2 steps — Scenario 1):
- `Then('it contains instructions to check {string} for the {string} setting', ...)` — assert content includes both the file path and the setting heading
- `Then('the check happens before or during the TDD loop, not after', ...)` — assert Unit Tests section appears before or within the loop section (section number check)

**RED phase steps** (4 steps — Scenarios 2, 3):
- `Then('the RED phase includes writing unit tests alongside step definitions when unit tests are enabled', ...)` — assert RED references unit tests + step definitions when enabled
- `Then('unit tests are written before implementation code \\(test-first)', ...)` — assert test-first / before implementation language
- `Then('unit tests are written as part of the vertical slice for each scenario', ...)` — assert per-scenario vertical slicing for unit tests
- `Then('there is no separate post-loop section for writing all unit tests at once', ...)` — assert NO batch/post-loop section for unit tests

**GREEN phase steps** (2 steps — Scenario 4):
- `Then('the GREEN phase verifies that both the BDD scenario and unit tests pass', ...)` — assert GREEN mentions both passing
- `Then('implementation is considered GREEN only when both pass', ...)` — assert "both" must pass language

**Disabled/absent steps** (4 steps — Scenarios 5, 6):
- `Then('it describes skipping unit tests when the {string} setting is {string}', ...)` — assert skip when disabled
- `Then('only BDD scenarios drive the TDD loop in this case', ...)` — assert BDD-only when disabled
- `Then('it describes skipping unit tests when the {string} section is absent from {string}', ...)` — assert absent = skip
- `Then('the behavior is identical to when unit tests are disabled', ...)` — assert absent treated same as disabled

**Quality reference steps** (2 steps — Scenarios 7, 8):
- `Then('it references {string} for guidance on writing good unit tests', ...)` — assert tests.md reference in unit test context
- `Then('it references {string} for guidance on mocking in unit tests', ...)` — assert mocking.md reference in unit test context

**Independence steps** (3 steps — Scenario 9):
- `Then('it describes BDD scenarios as the independent proof layer', ...)` — assert "independent proof layer"
- `Then('it distinguishes unit tests as finer-grained coverage written by the same agent', ...)` — assert supplementary/finer-grained language
- `Then('it does not elevate unit test status above BDD scenarios', ...)` — assert unit tests don't replace BDD

**TDD loop structure steps** (2 steps — Scenarios 10, 11, data table assertions):
- `Then('the enabled-unit-test loop follows this structure:', ...)` — iterate data table, assert each phase/activity pair described when enabled
- `Then('the disabled-unit-test loop follows this structure:', ...)` — iterate data table, assert each phase/activity pair described when disabled

**Vertical slicing steps** (2 steps — Scenario 12):
- `Then('the vertical slicing instruction covers both step definitions and unit tests', ...)` — assert vertical slicing mentions both
- `Then('it warns against writing all unit tests first then all implementation', ...)` — assert anti-batch warning for unit tests

All assertions use `sharedCtx.fileContent` with `includes()` or regex checks. Follow existing patterns in `implementTddSkillSteps.ts`.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308" --dry-run` — Zero undefined steps (all 13 scenarios show as skipped, not undefined)
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — All 13 new scenarios pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` — Existing implement_tdd scenarios still pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — All regression scenarios pass
- `bun run lint` — No lint errors
- `bunx tsc --noEmit` — Type check passes
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check adws project passes
- `bun run build` — Build succeeds

## Patch Scope
**Lines of code to change:** ~200-250 (SKILL.md ~80 lines rewritten/added in Section 4, ~15 lines added to Section 3; step definitions file ~120-150 lines)
**Risk level:** low
**Testing required:** BDD scenarios tagged `@adw-308`, `@adw-304-implement-tdd`, and `@regression` must all pass. This is a prompt-only change (SKILL.md markdown) plus test infrastructure (step definitions). No runtime TypeScript code changes.
