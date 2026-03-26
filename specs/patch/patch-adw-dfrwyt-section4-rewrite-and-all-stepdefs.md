# Patch: Rewrite SKILL.md Section 4 and implement all @adw-308 step definitions

## Metadata
adwId: `dfrwyt-unit-test-support-in`
reviewChangeRequest: `specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md`

## Issue Summary
**Original Spec:** specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md
**Issue:** SKILL.md Section 4 ("Unit Tests - Conditional") still contains only the original 3-line block from issue #304. It does not integrate unit tests into the red-green-refactor loop, lacks test-first workflow, GREEN phase dual verification, test framework awareness, or references to tests.md/mocking.md in the unit test context. Additionally, all @adw-308 BDD scenario step definitions are undefined.
**Solution:** Two-part fix: (1) Rewrite Section 4 with the full unit test workflow integrated into RED/GREEN/REFACTOR phases, test framework awareness via `.adw/commands.md`, references to tests.md and mocking.md, and the independence reminder. Also add conditional unit test mentions to Section 3. (2) Create step definitions for all 24 undefined steps in the @adw-308 feature file.

## Files to Modify

- `.claude/skills/implement-tdd/SKILL.md` — Rewrite Section 4, add conditional unit test integration to Section 3
- `features/step_definitions/implementTddUnitTestSteps.ts` — **New file.** All step definitions for `features/implement_tdd_unit_test_support.feature`

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Rewrite SKILL.md Section 4 ("Unit Tests - Conditional")

Replace the current Section 4 (lines 63–67) with a comprehensive unit test workflow section. The new Section 4 must include:

**4.1 — Check the setting:**
- Instruct the agent to read `.adw/project.md` for the `## Unit Tests` section
- If **disabled** or **absent**: skip unit tests entirely — only BDD scenarios drive the TDD loop
- If **enabled**: follow the unit test workflow below

**4.2 — Test framework awareness:**
- Read `.adw/commands.md` `## Run Tests` for the project's unit test runner command
- Do not hard-code Vitest or Jest — use whatever `## Run Tests` specifies

**4.3 — Unit test workflow (when enabled), integrated into the RED/GREEN/REFACTOR loop:**

```
RED phase (expanded):
  1. Write step definition for this scenario
  2. Write a unit test targeting the function/module being introduced (test-first)
  3. Run the scenario → must be RED
  4. Run the unit test → must be RED (failing)

GREEN phase (expanded):
  1. Write minimal code to pass both the BDD scenario AND the unit test
  2. Run the scenario → must be GREEN
  3. Run the unit test → must be GREEN
  4. Implementation is only considered GREEN when BOTH pass

REFACTOR phase (expanded):
  1. Clean up while keeping both scenario and unit test GREEN
```

**4.4 — Vertical slicing applies to unit tests too:**
- Unit tests are written as part of the vertical slice for each scenario, not batched separately
- There is no separate post-loop section for writing all unit tests at once
- Warn against writing all unit tests first then all implementation (same anti-pattern as horizontal step definitions)

**4.5 — Quality guidance references:**
- Reference [tests.md](tests.md) for guidance on writing good unit tests (test behavior through public interfaces, not implementation details)
- Reference [mocking.md](mocking.md) for guidance on mocking in unit tests (mock at system boundaries only)

**4.6 — Independence reminder:**
- BDD scenarios are the independent proof layer — they were written by a separate agent and verify behavior independently
- Unit tests provide finer-grained coverage but are written by the same agent as the implementation
- Do not elevate unit test status above BDD scenarios

### Step 2: Add conditional unit test mentions to Section 3

In Section 3's RED/GREEN/REFACTOR phase descriptions, add conditional notes indicating that when unit tests are enabled (per Section 4), the RED phase also includes writing a unit test and the GREEN phase requires both unit test and scenario to pass. Keep these as brief conditional annotations — do not duplicate the full Section 4 content.

### Step 3: Create step definitions for all @adw-308 scenarios

Create `features/step_definitions/implementTddUnitTestSteps.ts` with all undefined steps. Each step inspects `sharedCtx.fileContent` (SKILL.md loaded by the Background). The following steps are needed:

**When steps:**
- `When('the content is inspected for the red-green-refactor loop instructions', ...)` — context-only, no assertion
- `When('the content is inspected for the GREEN phase instructions', ...)` — context-only, no assertion
- `When('the content is inspected for unit test instructions', ...)` — context-only, no assertion

**Then steps — setting check:**
- `Then('it contains instructions to check {string} for the {string} setting', ...)` — assert content includes both the file path and the setting heading
- `Then('the check happens before or during the TDD loop, not after', ...)` — assert the `.adw/project.md` reference appears before or within the TDD loop section (before Section 5)

**Then steps — RED phase:**
- `Then('the RED phase includes writing unit tests alongside step definitions when unit tests are enabled', ...)` — assert content mentions writing unit tests in the RED phase
- `Then('unit tests are written before implementation code (test-first)', ...)` — assert content mentions test-first or writing unit tests before implementation

**Then steps — vertical slicing:**
- `Then('unit tests are written as part of the vertical slice for each scenario', ...)` — assert content mentions unit tests in the context of vertical slicing
- `Then('there is no separate post-loop section for writing all unit tests at once', ...)` — assert content does NOT have a separate section for batch unit test writing after the loop

**Then steps — GREEN phase:**
- `Then('the GREEN phase verifies that both the BDD scenario and unit tests pass', ...)` — assert content mentions both BDD/scenario and unit test passing in GREEN
- `Then('implementation is considered GREEN only when both pass', ...)` — assert content states both must pass

**Then steps — disabled/absent:**
- `Then('it describes skipping unit tests when the {string} setting is {string}', ...)` — assert content mentions skipping when disabled
- `Then('only BDD scenarios drive the TDD loop in this case', ...)` — assert content mentions only BDD scenarios when disabled
- `Then('it describes skipping unit tests when the {string} section is absent from {string}', ...)` — assert content mentions absent/missing section behavior
- `Then('the behavior is identical to when unit tests are disabled', ...)` — assert absent is treated same as disabled

**Then steps — references:**
- `Then('it references {string} for guidance on writing good unit tests', ...)` — assert content includes the file reference (e.g., "tests.md")
- `Then('it references {string} for guidance on mocking in unit tests', ...)` — assert content includes the file reference (e.g., "mocking.md")

**Then steps — independence:**
- `Then('it describes BDD scenarios as the independent proof layer', ...)` — assert content includes "independent proof layer"
- `Then('it distinguishes unit tests as finer-grained coverage written by the same agent', ...)` — assert content mentions finer-grained or supplementary coverage by same agent
- `Then('it does not elevate unit test status above BDD scenarios', ...)` — assert "independent proof layer" refers to BDD, not unit tests

**Then steps — loop structure (data table):**
- `Then('the enabled-unit-test loop follows this structure:', ...)` — verify RED includes "unit test", GREEN includes "both", REFACTOR includes "both"
- `Then('the disabled-unit-test loop follows this structure:', ...)` — verify the standard loop without unit test mentions

**Then steps — vertical slicing with unit tests:**
- `Then('the vertical slicing instruction covers both step definitions and unit tests', ...)` — assert vertical slicing mentions both
- `Then('it warns against writing all unit tests first then all implementation', ...)` — assert anti-pattern warning covers unit tests

### Step 4: Run validation

Execute all validation commands to confirm zero failures.

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — All 13 @adw-308 scenarios must pass
2. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` — Existing implement_tdd scenarios still pass
3. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Zero regressions
4. `bun run lint` — No lint errors
5. `bunx tsc --noEmit` — Type check passes
6. `bunx tsc --noEmit -p adws/tsconfig.json` — adws type check passes

## Patch Scope
**Lines of code to change:** ~200 (SKILL.md: ~80 lines rewritten, step defs: ~120 lines new)
**Risk level:** low
**Testing required:** BDD scenario validation — all @adw-308 scenarios pass, all @regression scenarios pass, lint and type checks clean
