# Patch: Enhance SKILL.md Section 4 with comprehensive unit test TDD workflow

## Metadata
adwId: `dfrwyt-unit-test-support-in`
reviewChangeRequest: `specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md`

## Issue Summary
**Original Spec:** specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md
**Issue:** SKILL.md Section 4 ("Unit Tests - Conditional") was never enhanced beyond the original 3-line conditional block. The git diff shows zero changes to `.claude/skills/implement-tdd/SKILL.md`. Section 4 currently only says "check `.adw/project.md`... if enabled write tests... if disabled skip" — it lacks the comprehensive unit test workflow instructions required by the spec.
**Solution:** Rewrite SKILL.md Section 4 to integrate unit tests as a first-class part of the red-green-refactor loop when enabled, add test framework awareness, reference `tests.md` and `mocking.md`, and add the BDD independence reminder. Then implement all undefined step definitions for the @adw-308 scenarios.

## Files to Modify

- `.claude/skills/implement-tdd/SKILL.md` — Rewrite Section 4 ("Unit Tests - Conditional") with comprehensive unit test workflow instructions integrated into the TDD loop.
- `features/step_definitions/implementTddUnitTestSteps.ts` — New file. Implement all undefined step definitions for the 13 @adw-308 scenarios in `features/implement_tdd_unit_test_support.feature`.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Rewrite SKILL.md Section 4

Replace the current Section 4 (lines 63-67) with a comprehensive unit test section. The new Section 4 must contain all of the following:

**a) Test framework awareness:**
- Instruct the agent to read `.adw/commands.md` `## Run Tests` for the project's unit test runner command

**b) Conditional check (preserve existing):**
- Check `.adw/project.md` for the `## Unit Tests` section
- If **disabled** or **absent**: skip unit tests entirely — only BDD scenarios drive the TDD loop

**c) When enabled — expanded red-green-refactor integration:**
- **RED phase**: Write a unit test **alongside** the step definition, before implementation (test-first). The unit test targets the specific function/module being introduced for that scenario's slice. Follow [tests.md](tests.md) for good vs bad test patterns (test behavior through public interfaces, not implementation details). Follow [mocking.md](mocking.md) for mocking guidance (mock only at system boundaries).
- **GREEN phase**: Implementation must pass **both** the BDD scenario AND the unit test. The scenario is not GREEN until both pass. Run unit tests using the command from `.adw/commands.md` `## Run Tests`.
- **REFACTOR phase**: After refactoring, verify **both** the BDD scenario and unit test still pass.

**d) Vertical slicing applies to unit tests:**
- Unit tests are written as part of the vertical slice for each scenario — do NOT write all unit tests first then all implementation (same principle as step definitions in Section 3).

**e) Independence reminder:**
- BDD scenarios are the **independent proof layer** — they were written by a separate agent and verify behavior independently.
- Unit tests provide finer-grained coverage but are written by the **same agent** as the implementation, so they carry accommodation risk. They supplement, not replace, BDD scenarios.

**Important:** Keep Section 4 positioned **before** Section 5 (Verification Frequency). The unit test check must happen before or during the TDD loop, not after.

### Step 2: Implement all undefined @adw-308 step definitions

Create `features/step_definitions/implementTddUnitTestSteps.ts` with step definitions for all 13 scenarios. The step definitions inspect `sharedCtx.fileContent` (the SKILL.md content loaded by the Background step) for the required content.

Required step definitions (from the scenario proof's undefined steps):

1. `Then('it contains instructions to check {string} for the {string} setting', ...)` — Assert SKILL.md mentions `.adw/project.md` and `## Unit Tests`
2. `Then('the check happens before or during the TDD loop, not after', ...)` — Assert the Unit Tests section appears before or at the same level as the TDD loop sections (before Section 5/6/7)
3. `When('the content is inspected for the red-green-refactor loop instructions', ...)` — Set context to inspect loop instructions (similar to `When the content is inspected` but scoped)
4. `Then('the RED phase includes writing unit tests alongside step definitions when unit tests are enabled', ...)` — Assert SKILL.md mentions writing unit tests in the RED phase when enabled
5. `Then('unit tests are written before implementation code \\(test-first)', ...)` — Assert test-first language
6. `Then('unit tests are written as part of the vertical slice for each scenario', ...)` — Assert vertical slicing applies to unit tests
7. `Then('there is no separate post-loop section for writing all unit tests at once', ...)` — Assert no batch section for unit tests after the loop
8. `When('the content is inspected for the GREEN phase instructions', ...)` — Context step for GREEN phase inspection
9. `Then('the GREEN phase verifies that both the BDD scenario and unit tests pass', ...)` — Assert both must pass in GREEN
10. `Then('implementation is considered GREEN only when both pass', ...)` — Assert "only when both pass" or equivalent
11. `Then('it describes skipping unit tests when the {string} setting is {string}', ...)` — Assert disabled skip behavior
12. `Then('only BDD scenarios drive the TDD loop in this case', ...)` — Assert BDD-only when disabled
13. `Then('it describes skipping unit tests when the {string} section is absent from {string}', ...)` — Assert absent skip behavior
14. `Then('the behavior is identical to when unit tests are disabled', ...)` — Assert absent = disabled
15. `When('the content is inspected for unit test instructions', ...)` — Context step for unit test reference inspection
16. `Then('it references {string} for guidance on writing good unit tests', ...)` — Assert tests.md reference
17. `Then('it references {string} for guidance on mocking in unit tests', ...)` — Assert mocking.md reference
18. `Then('it describes BDD scenarios as the independent proof layer', ...)` — Assert independence language
19. `Then('it distinguishes unit tests as finer-grained coverage written by the same agent', ...)` — Assert supplementary/accommodation-risk language
20. `Then('it does not elevate unit test status above BDD scenarios', ...)` — Assert unit tests don't supersede BDD
21. `Then('the enabled-unit-test loop follows this structure:', ...)` — DataTable step: verify RED=step def+unit test, GREEN=pass both, REFACTOR=keep both green
22. `Then('the disabled-unit-test loop follows this structure:', ...)` — DataTable step: verify RED=step def only, GREEN=pass scenario, REFACTOR=keep green
23. `Then('the vertical slicing instruction covers both step definitions and unit tests', ...)` — Assert vertical slice mentions unit tests
24. `Then('it warns against writing all unit tests first then all implementation', ...)` — Assert anti-horizontal warning for unit tests

All step definitions should:
- Import `sharedCtx` from `./commonSteps.ts`
- Use `assert` from `'assert'` for assertions
- Search `sharedCtx.fileContent` for required content patterns
- Follow the existing patterns in `implementTddSkillSteps.ts`

### Step 3: Verify no duplicate step definitions

Before finalizing, check that none of the new step definitions conflict with existing ones in `implementTddSkillSteps.ts` or other step definition files. The existing file already has some overlapping patterns (e.g., `it describes skipping unit tests when unit tests are disabled`) — the new steps use different Cucumber expressions so they should not conflict, but verify.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — All 13 @adw-308 scenarios must pass (0 failures, 0 undefined)
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` — Existing implement_tdd scenarios still pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — All regression scenarios pass (zero regressions)
- `bun run lint` — No lint errors
- `bun run build` — Build succeeds
- `bunx tsc --noEmit` — Type check passes
- `bunx tsc --noEmit -p adws/tsconfig.json` — adws type check passes

## Patch Scope
**Lines of code to change:** ~150 (SKILL.md Section 4 rewrite: ~60 lines, step definitions file: ~90 lines)
**Risk level:** low
**Testing required:** BDD scenario validation via @adw-308 and @regression tags. This is a prompt-only change (SKILL.md markdown) plus new step definitions — no runtime TypeScript code changes.
