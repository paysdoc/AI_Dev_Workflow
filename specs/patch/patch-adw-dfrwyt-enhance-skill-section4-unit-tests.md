# Patch: Enhance SKILL.md Section 4 with unit test TDD integration

## Metadata
adwId: `dfrwyt-unit-test-support-in`
reviewChangeRequest: `specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md`

## Issue Summary
**Original Spec:** `specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md`
**Issue:** SKILL.md Section 4 ("Unit Tests - Conditional") is minimal — it checks `.adw/project.md` but doesn't integrate unit tests into the red-green-refactor loop. Missing: RED phase expansion, GREEN phase expansion, test framework awareness via `.adw/commands.md`, references to `tests.md` and `mocking.md`, vertical slicing for unit tests, and BDD independence reminder.
**Solution:** Rewrite SKILL.md Section 4 with prescriptive unit test workflow instructions integrated into the TDD loop, and write the missing step definitions for the 13 `@adw-308` BDD scenarios.

## Files to Modify

- `.claude/skills/implement-tdd/SKILL.md` — Rewrite Section 4 to integrate unit tests as first-class TDD loop participants
- `features/step_definitions/implementTddSkillSteps.ts` — Add missing step definitions for the `@adw-308` scenarios

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Enhance SKILL.md Section 4 — Unit Tests (Conditional)

Replace the current minimal Section 4 (lines 63-67) with expanded content that covers:

**Current content (to replace):**
```md
### 4. Unit Tests (Conditional)

Check `.adw/project.md` for the `## Unit Tests` section:
- If unit tests are **enabled**: write Vitest/Jest unit tests for any non-trivial logic introduced, following the guidelines in [tests.md](tests.md) and [mocking.md](mocking.md). The BDD scenario remains the independent proof layer.
- If unit tests are **disabled** or the section is absent: skip unit tests entirely.
```

**New content must include all of the following:**

1. **Setting check instruction**: Instruct agent to check `.adw/project.md` for `## Unit Tests` setting before or during the TDD loop
2. **When disabled/absent**: Skip unit tests entirely — only BDD scenarios drive the TDD loop (keep this path unchanged)
3. **When enabled — RED phase expansion**: Write a unit test alongside the step definition for each scenario (test-first, before implementation). Unit tests target the specific function/module being introduced. Written as part of each vertical slice, NOT batched.
4. **When enabled — GREEN phase expansion**: Implementation must pass BOTH the BDD scenario AND the unit test. Only considered GREEN when both pass.
5. **When enabled — REFACTOR**: Both must remain green after refactoring.
6. **Test framework awareness**: Read `.adw/commands.md` `## Run Tests` for the project's unit test runner command
7. **Quality references**: Reference [tests.md](tests.md) for good vs bad test patterns and [mocking.md](mocking.md) for mocking at system boundaries
8. **Independence reminder**: BDD scenarios are the independent proof layer (written by a separate agent). Unit tests are supplementary finer-grained coverage written by the same build agent — they do NOT replace BDD scenarios.
9. **Vertical slicing**: Unit tests are written per-scenario as part of the vertical slice, not as a separate batch after the loop. Warn against writing all unit tests first then all implementation (same as the existing WRONG/RIGHT pattern in Section 3).

### Step 2: Add conditional unit test references to Section 3 loop description

In the Section 3 RED/GREEN/REFACTOR descriptions, add brief conditional notes indicating that when unit tests are enabled (per Section 4), unit tests are also written in RED and verified in GREEN. Keep the changes minimal — Section 4 has the full details.

Specifically:
- **RED phase**: After "Write the step definitions needed for this scenario", add a note: when unit tests are enabled (Section 4), also write a unit test for the logic being introduced
- **GREEN phase**: After "Write the minimal code needed to make this scenario pass", add a note: when unit tests are enabled, verify the unit test also passes
- **REFACTOR phase**: After "Run the scenario after each refactor step to stay GREEN", add a note: when unit tests are enabled, run unit tests too

### Step 3: Write missing step definitions for @adw-308 scenarios

Add the following step definitions to `features/step_definitions/implementTddSkillSteps.ts`:

1. `Then('it contains instructions to check {string} for the {string} setting', ...)` — Assert SKILL.md contains references to both the file path and the setting heading
2. `Then('the check happens before or during the TDD loop, not after', ...)` — Assert the Unit Tests section appears before or within the loop section (i.e., section number <= loop section number)
3. `When('the content is inspected for the red-green-refactor loop instructions', ...)` — No-op context step (content already loaded)
4. `Then('the RED phase includes writing unit tests alongside step definitions when unit tests are enabled', ...)` — Assert content mentions unit test in RED phase when enabled
5. `Then('unit tests are written before implementation code \\(test-first)', ...)` — Assert content indicates test-first / before implementation
6. `Then('unit tests are written as part of the vertical slice for each scenario', ...)` — Assert content ties unit tests to vertical slicing
7. `Then('there is no separate post-loop section for writing all unit tests at once', ...)` — Assert no batch section exists
8. `When('the content is inspected for the GREEN phase instructions', ...)` — No-op context step
9. `Then('the GREEN phase verifies that both the BDD scenario and unit tests pass', ...)` — Assert GREEN phase mentions both passing
10. `Then('implementation is considered GREEN only when both pass', ...)` — Assert both-must-pass language
11. `Then('it describes skipping unit tests when the {string} setting is {string}', ...)` — Assert skip/disabled language
12. `Then('only BDD scenarios drive the TDD loop in this case', ...)` — Assert BDD-only language when disabled
13. `Then('it describes skipping unit tests when the {string} section is absent from {string}', ...)` — Assert absent = skip
14. `Then('the behavior is identical to when unit tests are disabled', ...)` — Assert absent treated same as disabled
15. `When('the content is inspected for unit test instructions', ...)` — No-op context step
16. `Then('it references {string} for guidance on writing good unit tests', ...)` — Assert tests.md reference
17. `Then('it references {string} for guidance on mocking in unit tests', ...)` — Assert mocking.md reference
18. `Then('it describes BDD scenarios as the independent proof layer', ...)` — Assert independence language
19. `Then('it distinguishes unit tests as finer-grained coverage written by the same agent', ...)` — Assert supplementary coverage language
20. `Then('it does not elevate unit test status above BDD scenarios', ...)` — Assert unit tests don't replace BDD
21. `Then('the enabled-unit-test loop follows this structure:', ...)` — Assert RED/GREEN/REFACTOR with unit test activities from data table
22. `Then('the disabled-unit-test loop follows this structure:', ...)` — Assert RED/GREEN/REFACTOR without unit tests from data table
23. `Then('the vertical slicing instruction covers both step definitions and unit tests', ...)` — Assert vertical slicing mentions both
24. `Then('it warns against writing all unit tests first then all implementation', ...)` — Assert anti-batch warning

All assertions use `sharedCtx.fileContent` and pattern-match against SKILL.md content. Follow existing patterns in the file (simple `includes()` or regex checks).

### Step 4: Validate all scenarios pass

Run the validation commands to ensure zero regressions.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — All 13 new scenarios must pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` — Existing implement_tdd scenarios still pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — All regression scenarios pass
- `bun run lint` — No lint errors
- `bunx tsc --noEmit` — Type check passes
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check adws project passes
- `bun run build` — Build succeeds

## Patch Scope
**Lines of code to change:** ~150-200 (SKILL.md ~80 lines rewritten/added, step definitions ~100-120 lines added)
**Risk level:** low
**Testing required:** BDD scenarios tagged `@adw-308`, `@adw-304-implement-tdd`, and `@regression` must all pass. This is a prompt-only change (SKILL.md markdown) plus test infrastructure (step definitions). No runtime TypeScript code changes.
