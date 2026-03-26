# Patch: Enhance SKILL.md Section 4 unit test TDD integration and add step definitions

## Metadata
adwId: `dfrwyt-unit-test-support-in`
reviewChangeRequest: `specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md`

## Issue Summary
**Original Spec:** specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md
**Issue:** SKILL.md Section 4 ("Unit Tests - Conditional") was NOT modified. It still contains only the minimal "check .adw/project.md, write tests if enabled, skip if disabled" text. The spec requires expanding this into a comprehensive workflow that integrates unit tests into the RED-GREEN-REFACTOR loop. Additionally, all @adw-308 scenario step definitions are undefined.
**Solution:** (1) Rewrite Section 4 to integrate unit tests as a first-class part of the TDD loop — RED phase writes unit test + step def, GREEN phase verifies both pass, references tests.md and mocking.md, references .adw/commands.md `## Run Tests`, adds BDD-as-independent-proof-layer reminder. (2) Add conditional unit test mentions into Section 3's RED/GREEN/REFACTOR phases. (3) Create step definitions for all @adw-308 scenarios.

## Files to Modify

- `.claude/skills/implement-tdd/SKILL.md` — Enhance Section 4 and add unit test conditional mentions to Section 3
- `features/step_definitions/implementTddUnitTestSteps.ts` — **New file.** Step definitions for the 12 scenarios in `features/implement_tdd_unit_test_support.feature`

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Enhance SKILL.md Section 3 — Add conditional unit test mentions to RED/GREEN/REFACTOR

In the Section 3 "Red-Green-Refactor Loop", add conditional unit test notes to each phase:

- **RED phase** (line 44-47): After "Write the step definitions needed for this scenario", add a conditional note: when unit tests are enabled (see Section 4), also write a unit test targeting the function/module being introduced in this scenario — test-first, before implementation. The unit test is part of the vertical slice.
- **GREEN phase** (line 49-52): After "Write the minimal code needed to make this scenario pass", add: when unit tests are enabled, implementation must also pass the unit test. The scenario is GREEN only when both the BDD scenario AND the unit test pass.
- **REFACTOR phase** (line 54-57): After "Run the scenario after each refactor step to stay GREEN", add: when unit tests are enabled, also run unit tests after refactoring to ensure both remain green.

Also update the vertical slicing example block (lines 31-39) to show the unit-test-enabled variant:

```
RIGHT (vertical, unit tests enabled):
  RED → GREEN: step1 + unit-test1 → impl1
  RED → GREEN: step2 + unit-test2 → impl2
  ...
```

### Step 2: Rewrite SKILL.md Section 4 — Comprehensive unit test workflow

Replace the current Section 4 content (lines 63-67) with an expanded section:

```markdown
### 4. Unit Tests (Conditional)

Check `.adw/project.md` for the `## Unit Tests` section. Also read `.adw/commands.md` `## Run Tests` to learn the project's unit test runner command.

**When unit tests are enabled:**

Unit tests are a first-class part of the red-green-refactor loop, integrated per-scenario (not batched after all scenarios):

- **RED phase**: For each scenario, write a unit test alongside the step definition — before writing implementation code (test-first). The unit test targets the specific function or module being introduced in this scenario. Follow [tests.md](tests.md) for good vs bad test patterns: test behavior through public interfaces, not implementation details. Follow [mocking.md](mocking.md) for mocking guidance: mock only at system boundaries (external APIs, databases), never mock your own classes or internal collaborators.
- **GREEN phase**: Implementation must pass both the BDD scenario AND the unit test. A scenario is only GREEN when both pass.
- **REFACTOR phase**: After refactoring, verify both the BDD scenario and unit tests still pass.

BDD scenarios are the **independent proof layer** — they were written by a separate agent and verify behavior independently. Unit tests provide finer-grained coverage but are written by the same agent as the implementation, so they carry accommodation risk. Do not elevate unit test status above BDD scenarios.

**When unit tests are disabled or the section is absent:** skip unit tests entirely. Only BDD scenarios drive the TDD loop.
```

### Step 3: Create step definitions for @adw-308 scenarios

Create `features/step_definitions/implementTddUnitTestSteps.ts` with step definitions for all undefined steps in the @adw-308 feature file. The steps inspect `sharedCtx.fileContent` (already loaded via the Background's Given steps) for expected content in SKILL.md.

The following step definitions are needed (all use `sharedCtx.fileContent` from `commonSteps.ts`):

1. `Then('it contains instructions to check {string} for the {string} setting', ...)` — asserts content includes both the file path and the setting heading
2. `Then('the check happens before or during the TDD loop, not after', ...)` — asserts the `## Unit Tests` / `.adw/project.md` reference appears before Section 5
3. `When('the content is inspected for the red-green-refactor loop instructions', ...)` — no-op, content already loaded
4. `Then('the RED phase includes writing unit tests alongside step definitions when unit tests are enabled', ...)` — asserts RED phase mentions unit test + step definition together when enabled
5. `Then('unit tests are written before implementation code \\(test-first)', ...)` — asserts content includes test-first/before implementation language
6. `Then('unit tests are written as part of the vertical slice for each scenario', ...)` — asserts vertical slice covers unit tests (mentions per-scenario or vertical)
7. `Then('there is no separate post-loop section for writing all unit tests at once', ...)` — asserts no "after all scenarios" or batch unit test section exists
8. `When('the content is inspected for the GREEN phase instructions', ...)` — no-op, content already loaded
9. `Then('the GREEN phase verifies that both the BDD scenario and unit tests pass', ...)` — asserts GREEN mentions both scenario and unit test passing
10. `Then('implementation is considered GREEN only when both pass', ...)` — asserts "only GREEN when both pass" or equivalent
11. `Then('it describes skipping unit tests when the {string} setting is {string}', ...)` — asserts content describes skipping when disabled
12. `Then('only BDD scenarios drive the TDD loop in this case', ...)` — asserts "only BDD scenarios drive" language
13. `Then('it describes skipping unit tests when the {string} section is absent from {string}', ...)` — asserts absent case is described
14. `Then('the behavior is identical to when unit tests are disabled', ...)` — asserts absent and disabled are treated the same
15. `When('the content is inspected for unit test instructions', ...)` — no-op, content already loaded
16. `Then('it references {string} for guidance on writing good unit tests', ...)` — asserts content references the file for unit test guidance
17. `Then('it references {string} for guidance on mocking in unit tests', ...)` — asserts content references the file for mocking guidance
18. `Then('it describes BDD scenarios as the independent proof layer', ...)` — asserts "independent proof layer" present
19. `Then('it distinguishes unit tests as finer-grained coverage written by the same agent', ...)` — asserts "finer-grained" or "same agent" language
20. `Then('it does not elevate unit test status above BDD scenarios', ...)` — asserts "independent proof layer" exists for BDD (BDD elevated over unit tests)
21. `Then('the enabled-unit-test loop follows this structure:', ...)` — checks DataTable: RED has unit test, GREEN has both, REFACTOR keeps both green
22. `Then('the disabled-unit-test loop follows this structure:', ...)` — checks DataTable: standard RED/GREEN/REFACTOR without unit tests
23. `Then('the vertical slicing instruction covers both step definitions and unit tests', ...)` — asserts vertical slicing mentions unit tests
24. `Then('it warns against writing all unit tests first then all implementation', ...)` — asserts WRONG example or explicit warning

### Step 4: Run validation

Run all validation commands to confirm zero regressions.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — All 12 @adw-308 scenarios must pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` — Existing implement_tdd scenarios still pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — All regression scenarios pass
- `bun run lint` — Linter passes
- `bun run build` — Build passes
- `bunx tsc --noEmit` — Type check passes
- `bunx tsc --noEmit -p adws/tsconfig.json` — adws type check passes

## Patch Scope
**Lines of code to change:** ~100 lines in SKILL.md, ~200 lines in new step definitions file
**Risk level:** low
**Testing required:** BDD scenarios tagged @adw-308 verify SKILL.md content; @regression and @adw-304-implement-tdd ensure no regressions
