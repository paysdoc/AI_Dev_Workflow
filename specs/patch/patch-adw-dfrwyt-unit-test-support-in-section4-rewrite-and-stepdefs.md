# Patch: Rewrite SKILL.md Section 4 and implement @adw-308 step definitions

## Metadata
adwId: `dfrwyt-unit-test-support-in`
reviewChangeRequest: `Issue #1: SKILL.md was not modified — git diff origin/dev shows zero changes. Section 4 still contains the original 3-line minimal content. The spec requires enhancing Section 4 with: RED phase expansion (unit test + step def before implementation), GREEN phase expansion (both must pass), test framework awareness via .adw/commands.md, explicit tests.md/mocking.md references, and independence reminder. Resolution: Rewrite SKILL.md Section 4 per the spec's Implementation Plan Phase 2: expand the conditional block to describe the full unit test workflow integrated into the red-green-refactor loop, add test framework awareness, add quality references, and integrate unit test mentions into Section 3.`

## Issue Summary
**Original Spec:** specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md
**Issue:** SKILL.md Section 4 ("Unit Tests - Conditional") was NOT enhanced — it still contains the original 3-line minimal content (lines 63-67). All 13 @adw-308 BDD scenarios fail because their step definitions are undefined (26 undefined steps total).
**Solution:** (1) Rewrite SKILL.md Section 4 with comprehensive unit test workflow instructions integrated into the red-green-refactor loop. (2) Add conditional unit test mentions to Section 3. (3) Implement all undefined step definitions for the @adw-308 scenarios.

## Files to Modify
Use these files to implement the patch:

- `.claude/skills/implement-tdd/SKILL.md` — Rewrite Section 4 and add conditional unit test mentions to Section 3's RED/GREEN/REFACTOR phases
- `features/step_definitions/implementTddSkillSteps.ts` — Add all 26 undefined step definitions for the @adw-308 scenarios

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Rewrite SKILL.md Section 4 ("Unit Tests - Conditional")

Replace lines 63-67 (the current minimal Section 4) with a comprehensive unit test workflow. The new Section 4 must include:

1. **Test framework awareness**: Instruct the agent to read `.adw/commands.md` `## Run Tests` for the project's unit test runner command.
2. **When enabled — full workflow integrated into the loop**:
   - **RED phase**: Write a unit test alongside the step definition, before implementation (test-first). The unit test targets the specific function/module being introduced. Follow [tests.md](tests.md) for good vs bad test patterns. Follow [mocking.md](mocking.md) for mocking guidance (mock at system boundaries only). Unit tests are written as part of each vertical slice (per scenario), NOT as a separate batch.
   - **GREEN phase**: Implementation must pass both the BDD scenario AND the unit test. The scenario is not considered GREEN until both pass.
   - **REFACTOR phase**: Ensure both the BDD scenario and unit tests still pass after refactoring.
3. **When disabled or absent**: Skip unit tests entirely. Only BDD scenarios drive the TDD loop. This is the default behavior.
4. **Independence reminder**: BDD scenarios are the independent proof layer — they were written by a separate agent and verify behavior independently. Unit tests provide finer-grained coverage but are written by the same agent as the implementation.

### Step 2: Add conditional unit test mentions to Section 3

Update the Section 3 Red-Green-Refactor loop to conditionally mention unit tests in each phase:

- **RED phase** (line 44-47): Add a note that when unit tests are enabled (see Section 4), also write a unit test alongside the step definition before implementation.
- **GREEN phase** (line 49-52): Add a note that when unit tests are enabled, both the BDD scenario and the unit test must pass.
- **REFACTOR phase** (line 54-57): Add a note that when unit tests are enabled, ensure both still pass after refactoring.
- **Vertical slicing** (line 29-39): Update the WRONG/RIGHT example or add text noting that vertical slicing applies to unit tests as well — do NOT write all unit tests first then implement.

Keep the existing content for the disabled path unchanged — only add conditional notes.

### Step 3: Implement all undefined @adw-308 step definitions

Add step definitions to `features/step_definitions/implementTddSkillSteps.ts`. Each step inspects `sharedCtx.fileContent` (the SKILL.md content loaded by the Background steps):

**When steps (no-ops — content already loaded):**
- `When('the content is inspected for the red-green-refactor loop instructions', ...)`
- `When('the content is inspected for the GREEN phase instructions', ...)`
- `When('the content is inspected for unit test instructions', ...)`

**Then steps — .adw/project.md setting:**
- `Then('it contains instructions to check {string} for the {string} setting', ...)` — assert content includes both the file path and the setting heading
- `Then('the check happens before or during the TDD loop, not after', ...)` — assert "Unit Tests" section number (4) comes before or equal to the loop section (3), or that it's referenced within the loop

**Then steps — RED phase / test-first:**
- `Then('the RED phase includes writing unit tests alongside step definitions when unit tests are enabled', ...)` — assert content mentions writing unit tests in RED phase alongside step definitions
- `Then('unit tests are written before implementation code \\(test-first)', ...)` — assert content mentions writing unit tests before implementation
- `Then('unit tests are written as part of the vertical slice for each scenario', ...)` — assert content describes unit tests within each vertical slice
- `Then('there is no separate post-loop section for writing all unit tests at once', ...)` — assert no section that batches all unit tests after the loop

**Then steps — GREEN phase:**
- `Then('the GREEN phase verifies that both the BDD scenario and unit tests pass', ...)` — assert GREEN phase requires both to pass
- `Then('implementation is considered GREEN only when both pass', ...)` — assert GREEN status requires both passing

**Then steps — disabled/absent:**
- `Then('it describes skipping unit tests when the {string} setting is {string}', ...)` — assert content describes skipping
- `Then('only BDD scenarios drive the TDD loop in this case', ...)` — assert content says only BDD scenarios drive the loop when disabled
- `Then('it describes skipping unit tests when the {string} section is absent from {string}', ...)` — assert content covers absent case
- `Then('the behavior is identical to when unit tests are disabled', ...)` — assert absent treated same as disabled

**Then steps — references:**
- `Then('it references {string} for guidance on writing good unit tests', ...)` — assert content references tests.md in unit test context
- `Then('it references {string} for guidance on mocking in unit tests', ...)` — assert content references mocking.md in unit test context

**Then steps — independence:**
- `Then('it describes BDD scenarios as the independent proof layer', ...)` — assert "independent proof layer" or equivalent
- `Then('it distinguishes unit tests as finer-grained coverage written by the same agent', ...)` — assert finer-grained/supplementary mention
- `Then('it does not elevate unit test status above BDD scenarios', ...)` — assert BDD is positioned as primary

**Then steps — loop structure with DataTable:**
- `Then('the enabled-unit-test loop follows this structure:', ...)` — validate RED/GREEN/REFACTOR phases include unit test activities per DataTable rows
- `Then('the disabled-unit-test loop follows this structure:', ...)` — validate phases exclude unit test activities per DataTable rows

**Then steps — vertical slicing:**
- `Then('the vertical slicing instruction covers both step definitions and unit tests', ...)` — assert vertical slicing mentions both
- `Then('it warns against writing all unit tests first then all implementation', ...)` — already exists in implementTddSkillSteps.ts (line 127-133), may need updating to also match unit test batching warning

### Step 4: Run tests and fix any failures

Run @adw-308 scenarios. If any fail, fix the SKILL.md content or step definitions until all pass. Then run @regression to verify zero regressions.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — All 13 @adw-308 scenarios pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` — Existing implement_tdd scenarios still pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — All regression scenarios pass
- `bun run lint` — No linting errors
- `bunx tsc --noEmit` — Type check passes
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW type check passes
- `bun run build` — Build succeeds

## Patch Scope
**Lines of code to change:** ~200 (SKILL.md ~70 lines rewritten/added, step definitions ~130 lines added)
**Risk level:** low
**Testing required:** BDD scenario validation — all 13 @adw-308 scenarios must pass, all @regression scenarios must continue to pass. This is a prompt-only change (SKILL.md markdown) plus test infrastructure (step definitions) — no runtime TypeScript code changes.
