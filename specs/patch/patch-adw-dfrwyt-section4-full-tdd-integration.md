# Patch: Rewrite SKILL.md Section 4 with full TDD loop integration and implement step definitions

## Metadata
adwId: `dfrwyt-unit-test-support-in`
reviewChangeRequest: `specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md`

## Issue Summary
**Original Spec:** specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md
**Issue:** SKILL.md Section 4 ("Unit Tests - Conditional") contains only 4 lines of minimal text from issue #304. It checks `.adw/project.md` but does not integrate unit tests into the red-green-refactor loop. Additionally, all @adw-308 BDD step definitions are undefined, causing every scenario to fail.
**Solution:** (1) Rewrite SKILL.md Section 4 to describe the full unit test workflow integrated into the TDD loop — RED phase writes step definition + unit test, GREEN phase verifies both pass, references `.adw/commands.md` test runner, `tests.md`, `mocking.md`, and includes a BDD independence reminder. (2) Update Section 3 to conditionally reference unit tests in the RED/GREEN/REFACTOR phases. (3) Implement all undefined step definitions for @adw-308 scenarios.

## Files to Modify

- `.claude/skills/implement-tdd/SKILL.md` — Rewrite Section 4 and add conditional unit test references in Section 3
- `features/step_definitions/implementTddUnitTestSteps.ts` — New file: step definitions for all undefined @adw-308 scenario steps

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Rewrite SKILL.md Section 4 ("Unit Tests - Conditional")
Replace the current minimal 4-line Section 4 (lines 63-68) with a comprehensive section that:

- **Test framework awareness**: Instruct the agent to read `.adw/commands.md` `## Run Tests` for the project's unit test runner command
- **When enabled** — describe the full integrated workflow:
  - RED phase: write a unit test alongside the step definition, targeting the specific function/module being introduced. The unit test must be written BEFORE implementation (test-first)
  - GREEN phase: implementation must pass BOTH the BDD scenario AND the unit test. Only consider GREEN when both pass
  - REFACTOR phase: ensure both still pass after refactoring
  - Unit tests are written per scenario as part of the vertical slice — NOT batched in a separate post-loop section
  - Reference [tests.md](tests.md) for good vs bad test patterns when writing unit tests
  - Reference [mocking.md](mocking.md) for mocking guidance — mock only at system boundaries
  - Independence reminder: BDD scenarios are the independent proof layer (written by a separate agent). Unit tests are supplementary finer-grained coverage written by the same agent as implementation
- **When disabled or absent** — skip unit tests entirely. Only BDD scenarios drive the TDD loop (unchanged from current behavior)

### Step 2: Update Section 3 to reference conditional unit test steps
Add conditional unit test mentions into the Section 3 red-green-refactor loop phases:

- **RED phase**: Add note that when unit tests are enabled (per Section 4), also write a unit test alongside the step definition
- **GREEN phase**: Add note that when unit tests are enabled, both the BDD scenario AND unit test must pass
- **REFACTOR phase**: Add note that when unit tests are enabled, both must remain green after refactoring

Keep these as brief conditional notes (e.g., "If unit tests are enabled (see Section 4), also write/verify the unit test") to avoid bloating Section 3.

### Step 3: Implement all undefined @adw-308 step definitions
Create `features/step_definitions/implementTddUnitTestSteps.ts` with step definitions for all undefined steps from the scenario proof. Import `sharedCtx` from `commonSteps.ts` and follow the existing pattern. The undefined steps are:

1. `Then it contains instructions to check {string} for the {string} setting` — assert `sharedCtx.fileContent` contains both the file path and the setting heading
2. `Then the check happens before or during the TDD loop, not after` — assert the unit test check (Section 4) appears before or references integration with the loop (Section 3)
3. `When the content is inspected for the red-green-refactor loop instructions` — context-only step (no-op, like "When the content is inspected")
4. `Then the RED phase includes writing unit tests alongside step definitions when unit tests are enabled` — assert content mentions unit tests in RED phase context
5. `Then unit tests are written before implementation code (test-first)` — assert content mentions writing unit tests before implementation
6. `Then unit tests are written as part of the vertical slice for each scenario` — assert content mentions unit tests within vertical slice / per-scenario context
7. `Then there is no separate post-loop section for writing all unit tests at once` — assert no separate batch section for unit tests
8. `When the content is inspected for the GREEN phase instructions` — context-only step
9. `Then the GREEN phase verifies that both the BDD scenario and unit tests pass` — assert GREEN phase mentions both passing
10. `Then implementation is considered GREEN only when both pass` — assert content mentions both must pass for GREEN
11. `Then it describes skipping unit tests when the {string} setting is {string}` — assert content describes skipping when disabled
12. `Then only BDD scenarios drive the TDD loop in this case` — assert content mentions only BDD scenarios when disabled
13. `Then it describes skipping unit tests when the {string} section is absent from {string}` — assert content describes absent = skip
14. `Then the behavior is identical to when unit tests are disabled` — assert absent and disabled produce same behavior
15. `When the content is inspected for unit test instructions` — context-only step
16. `Then it references {string} for guidance on writing good unit tests` — assert content references the file in unit test context
17. `Then it references {string} for guidance on mocking in unit tests` — assert content references the file in mocking context
18. `Then it describes BDD scenarios as the independent proof layer` — assert content mentions "independent proof layer" for BDD
19. `Then it distinguishes unit tests as finer-grained coverage written by the same agent` — assert content mentions unit tests as supplementary / same agent
20. `Then it does not elevate unit test status above BDD scenarios` — assert BDD is positioned as primary, unit tests as supplementary
21. `Then the enabled-unit-test loop follows this structure:` (DataTable) — assert RED/GREEN/REFACTOR phases match the expected activities with unit tests
22. `Then the disabled-unit-test loop follows this structure:` (DataTable) — assert RED/GREEN/REFACTOR phases match the expected activities without unit tests
23. `Then the vertical slicing instruction covers both step definitions and unit tests` — assert vertical slicing mentions both
24. `Then it warns against writing all unit tests first then all implementation` — assert content warns against horizontal slicing of unit tests

### Step 4: Verify all @adw-308 scenarios pass
Run the @adw-308 scenarios and fix any failures.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — Run new scenarios for this issue
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` — Verify existing implement_tdd scenarios still pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run all regression scenarios to verify zero regressions
- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type check main project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check adws project
- `bun run build` — Build the application to verify no build errors

## Patch Scope
**Lines of code to change:** ~200 (SKILL.md ~50 lines rewritten/added, step definitions ~150 lines new)
**Risk level:** low
**Testing required:** All @adw-308 scenarios pass, all @regression scenarios pass, lint + typecheck clean
