# Patch: Enhance SKILL.md Section 4 and implement all @adw-308 step definitions

## Metadata
adwId: `dfrwyt-unit-test-support-in`
reviewChangeRequest: `specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md`

## Issue Summary
**Original Spec:** specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md
**Issue:** SKILL.md Section 4 ('Unit Tests - Conditional') was NOT enhanced. The git diff shows zero changes to `.claude/skills/implement-tdd/SKILL.md`. Additionally, the @adw-308 BDD scenarios all fail because their step definitions are undefined.
**Solution:** (1) Rewrite SKILL.md Section 4 with comprehensive unit test workflow instructions integrated into the red-green-refactor loop. (2) Implement all undefined step definitions for the @adw-308 scenarios.

## Files to Modify

- `.claude/skills/implement-tdd/SKILL.md` — Rewrite Section 4 and add unit test mentions to Section 3's RED/GREEN/REFACTOR phases
- `features/step_definitions/implementTddSkillSteps.ts` — Add all undefined step definitions for the @adw-308 scenarios

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Rewrite SKILL.md Section 4 ("Unit Tests - Conditional")

Replace the current minimal Section 4 (lines 63-67) with a comprehensive unit test workflow. The new Section 4 must include:

1. **Test framework awareness**: Instruct the agent to read `.adw/commands.md` `## Run Tests` for the project's unit test runner command
2. **When enabled — full workflow description**:
   - In the **RED phase**: Write a unit test alongside the step definition, before implementation (test-first). The unit test targets the specific function/module being introduced. Follow [tests.md](tests.md) for good vs bad test patterns. Follow [mocking.md](mocking.md) for mocking guidance (mock at system boundaries only).
   - In the **GREEN phase**: Implementation must pass both the BDD scenario AND the unit test. The scenario is not GREEN until both pass.
   - In the **REFACTOR phase**: Ensure both the BDD scenario and unit tests still pass after refactoring.
   - Unit tests are written as part of each vertical slice (per scenario), NOT as a separate batch after the loop.
3. **When disabled or absent**: Skip unit tests entirely. Only BDD scenarios drive the TDD loop. This is the default.
4. **Independence reminder**: BDD scenarios are the independent proof layer — they were written by a separate agent and verify behavior independently. Unit tests provide finer-grained coverage but are written by the same agent as the implementation, so they carry accommodation risk.

Also update Section 3's red-green-refactor loop to mention that when unit tests are enabled, the RED phase includes writing a unit test alongside the step definition, the GREEN phase requires both to pass, and the REFACTOR phase verifies both remain green. Keep existing content for the disabled path unchanged.

### Step 2: Implement all undefined @adw-308 step definitions

Add the following step definitions to `features/step_definitions/implementTddSkillSteps.ts`. Each step inspects `sharedCtx.fileContent` (the SKILL.md content loaded by the Background steps) for the expected content:

**When steps:**
- `When('the content is inspected for the red-green-refactor loop instructions', ...)` — no-op, content already loaded
- `When('the content is inspected for the GREEN phase instructions', ...)` — no-op, content already loaded
- `When('the content is inspected for unit test instructions', ...)` — no-op, content already loaded

**Then steps (checking .adw/project.md setting):**
- `Then('it contains instructions to check {string} for the {string} setting', ...)` — assert content includes both the file path and the setting heading
- `Then('the check happens before or during the TDD loop, not after', ...)` — assert Section 4 appears before or references integration with the TDD loop (check that "Unit Tests" section appears before or within the loop, not as a post-loop appendix)

**Then steps (RED phase / test-first):**
- `Then('the RED phase includes writing unit tests alongside step definitions when unit tests are enabled', ...)` — assert content mentions writing unit tests in the RED phase alongside step definitions
- `Then('unit tests are written before implementation code (test-first)', ...)` — assert content mentions writing unit tests before implementation
- `Then('unit tests are written as part of the vertical slice for each scenario', ...)` — assert content describes unit tests as part of each vertical slice
- `Then('there is no separate post-loop section for writing all unit tests at once', ...)` — assert no section that batches all unit tests after the loop

**Then steps (GREEN phase):**
- `Then('the GREEN phase verifies that both the BDD scenario and unit tests pass', ...)` — assert content describes GREEN phase requiring both to pass
- `Then('implementation is considered GREEN only when both pass', ...)` — assert content links GREEN status to both passing

**Then steps (disabled/absent):**
- `Then('it describes skipping unit tests when the {string} setting is {string}', ...)` — assert content describes skipping when setting matches value
- `Then('only BDD scenarios drive the TDD loop in this case', ...)` — assert content says only BDD scenarios drive the loop when disabled
- `Then('it describes skipping unit tests when the {string} section is absent from {string}', ...)` — assert content covers the absent case
- `Then('the behavior is identical to when unit tests are disabled', ...)` — assert content treats absent the same as disabled

**Then steps (references):**
- `Then('it references {string} for guidance on writing good unit tests', ...)` — assert content includes reference to tests.md in unit test context
- `Then('it references {string} for guidance on mocking in unit tests', ...)` — assert content includes reference to mocking.md in unit test context

**Then steps (independence):**
- `Then('it describes BDD scenarios as the independent proof layer', ...)` — assert content includes "independent proof layer" or equivalent
- `Then('it distinguishes unit tests as finer-grained coverage written by the same agent', ...)` — assert content mentions unit tests as supplementary/finer-grained coverage
- `Then('it does not elevate unit test status above BDD scenarios', ...)` — assert content positions BDD as primary, unit tests as supplementary

**Then steps (loop structure with DataTable):**
- `Then('the enabled-unit-test loop follows this structure:', ...)` — validate the RED/GREEN/REFACTOR phases include unit test activities as described in the DataTable
- `Then('the disabled-unit-test loop follows this structure:', ...)` — validate the RED/GREEN/REFACTOR phases exclude unit test activities as described in the DataTable

**Then steps (vertical slicing):**
- `Then('the vertical slicing instruction covers both step definitions and unit tests', ...)` — assert vertical slicing mentions both
- `Then('it warns against writing all unit tests first then all implementation', ...)` — assert content warns against batching unit tests (similar to existing horizontal slicing warning)

### Step 3: Run tests and verify

Run all @adw-308 scenarios to verify the step definitions work against the enhanced SKILL.md content. Then run @regression scenarios to verify zero regressions.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — All @adw-308 scenarios pass (currently all fail)
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` — Existing implement_tdd scenarios still pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — All regression scenarios pass
- `bun run lint` — No linting errors
- `bunx tsc --noEmit` — Type check passes
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW type check passes
- `bun run build` — Build succeeds

## Patch Scope
**Lines of code to change:** ~150 (SKILL.md ~60 lines rewritten/added, step definitions ~90 lines added)
**Risk level:** low
**Testing required:** BDD scenario validation — all @adw-308 scenarios must pass, all @regression scenarios must continue to pass
