# Patch: Finalize SKILL.md Section 4 unit test integration and add test framework awareness

## Metadata
adwId: `6w7p98-unit-test-support-in`
reviewChangeRequest: `Issue #1: SKILL.md Section 4 was not enhanced — the primary deliverable of issue #308 is completely missing. git diff origin/dev shows zero changes to .claude/skills/implement-tdd/SKILL.md. The spec explicitly states this is a 'prompt-only change (modifying SKILL.md markdown)' and all acceptance criteria depend on SKILL.md modifications. Resolution: Enhance SKILL.md Section 4 ('Unit Tests - Conditional') to integrate unit tests into the red-green-refactor loop when enabled: expand RED phase to write unit test alongside step definition, expand GREEN phase to verify both pass, add references to tests.md and mocking.md, add test framework awareness via .adw/commands.md, and remind that BDD scenarios are the independent proof layer.`

## Issue Summary
**Original Spec:** specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md
**Issue:** The review found zero committed changes to SKILL.md Section 4 against origin/dev. The working tree already contains a comprehensive Section 4 rewrite (28 lines added: RED/GREEN/REFACTOR tables, tests.md/mocking.md references, vertical slicing, independent proof layer reminder), but it is missing one spec requirement: test framework awareness via `.adw/commands.md ## Run Tests`. Additionally, the step definitions file `features/step_definitions/implementTddUnitTestSteps.ts` is untracked and must be committed for @adw-308 scenarios to pass.
**Solution:** Add a single instruction line to Section 4 referencing `.adw/commands.md ## Run Tests` for the unit test runner command. Verify all existing Section 4 content satisfies spec acceptance criteria. Ensure step definitions and feature file are committed so @adw-308 scenarios pass.

## Files to Modify
Use these files to implement the patch:

- `.claude/skills/implement-tdd/SKILL.md` — Add `.adw/commands.md ## Run Tests` reference to Section 4 for test framework awareness.
- `features/step_definitions/implementTddUnitTestSteps.ts` — Already written; must be committed (untracked). Verify all step definitions match the feature file steps.
- `features/implement_tdd_unit_test_support.feature` — Already written; must be committed (untracked). Contains 13 @adw-308 scenarios.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add `.adw/commands.md ## Run Tests` reference to SKILL.md Section 4
- In Section 4, after the line `- If unit tests are **enabled**: integrate unit tests as a first-class part of the red-green-refactor loop for each scenario.`, add:
  ```

  When unit tests are enabled, read `.adw/commands.md` `## Run Tests` for the project's unit test runner command. Use this command to run unit tests during the GREEN phase verification.
  ```
- This addresses the spec requirement (Solution Statement item 3): "Test framework awareness: The skill reads `.adw/commands.md` `## Run Tests` command for the project's unit test runner."

### Step 2: Verify existing Section 4 content satisfies all acceptance criteria
- Read the full Section 4 and confirm it includes:
  - [x] Check `.adw/project.md` for `## Unit Tests` setting
  - [x] Disabled/absent path: skip unit tests entirely, only BDD scenarios drive loop
  - [x] Enabled path: RED writes step definition + unit test (test-first)
  - [x] Enabled path: GREEN verifies both BDD scenario and unit test pass
  - [x] Enabled path: REFACTOR keeps both green
  - [x] References `[tests.md](tests.md)` for unit test quality
  - [x] References `[mocking.md](mocking.md)` for mocking guidance
  - [x] BDD scenarios as independent proof layer
  - [x] Unit tests supplement, not replace BDD scenarios
  - [x] Vertical slicing: unit tests written per scenario, not batched
  - [ ] `.adw/commands.md ## Run Tests` reference (added in Step 1)
- If any item is missing, add it. Based on the current diff, only the `.adw/commands.md` reference is missing.

### Step 3: Verify step definitions match all feature file steps
- Read `features/implement_tdd_unit_test_support.feature` and `features/step_definitions/implementTddUnitTestSteps.ts`
- Confirm every `When` and `Then` step in the feature file has a corresponding step definition
- The step definitions file already exists with all 13 scenarios' steps defined. Run a dry-run to confirm:
  ```
  NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308" --dry-run
  ```
- If any steps are undefined, add them to `implementTddUnitTestSteps.ts`

### Step 4: Run @adw-308 scenarios to verify all pass
- Execute: `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"`
- All 13 scenarios must pass (0 failures, 0 undefined)
- If any fail, fix the step definition assertions or SKILL.md content as needed

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — All 13 @adw-308 scenarios pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` — Existing implement_tdd scenarios still pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — All regression scenarios pass (zero regressions)
- `bun run lint` — No lint errors
- `bun run build` — Build succeeds

## Patch Scope
**Lines of code to change:** ~3 lines (1-2 lines added to SKILL.md Section 4 for `.adw/commands.md` reference)
**Risk level:** low
**Testing required:** BDD scenario validation via @adw-308, @adw-304-implement-tdd, and @regression tags. This is a prompt-only change (SKILL.md markdown) with existing step definitions — no TypeScript runtime code changes.
