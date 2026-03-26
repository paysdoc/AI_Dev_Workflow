# Patch: Implement all undefined @adw-308 step definitions and enhance SKILL.md Section 4

## Metadata
adwId: `dfrwyt-unit-test-support-in`
reviewChangeRequest: `Issue #1: All 12 @adw-308 BDD scenarios FAILED — every scenario has undefined step definitions. None of the Then/When steps unique to issue #308 were implemented.`

## Issue Summary
**Original Spec:** `specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md`
**Issue:** All 12 `@adw-308` BDD scenarios fail because 20+ step definitions referenced in `features/implement_tdd_unit_test_support.feature` are undefined. The current SKILL.md Section 4 is also still in its minimal form — it was never enhanced with the detailed unit test TDD workflow instructions that the scenarios verify.
**Solution:** Two-part fix: (1) Enhance SKILL.md Section 3 and rewrite Section 4 to integrate unit tests into the red-green-refactor loop, and (2) implement all missing step definitions in `features/step_definitions/implementTddSkillSteps.ts` that verify the enhanced SKILL.md content. Both parts are required — step definitions alone will fail if SKILL.md lacks the content they assert against.

## Files to Modify

- `.claude/skills/implement-tdd/SKILL.md` — Enhance Section 3 with conditional unit test mentions in RED/GREEN/REFACTOR phases; rewrite Section 4 ("Unit Tests - Conditional") with comprehensive unit test workflow instructions.
- `features/step_definitions/implementTddSkillSteps.ts` — Add all 20+ undefined step definitions for `@adw-308` scenarios. This file already contains the `@adw-304` step definitions and is the correct location for `@adw-308` steps (same skill being verified).

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Enhance SKILL.md Section 3 with conditional unit test mentions
Add conditional unit test participation to each phase of the red-green-refactor loop in Section 3:

- **RED phase** — After the existing step definition instructions, add a conditional note: when unit tests are enabled (see Section 4), also write a unit test targeting the function/module being introduced — before implementation (test-first). Write the unit test as part of this vertical slice, not as a separate batch.
- **GREEN phase** — Add: when unit tests are enabled, implementation is considered GREEN only when both the BDD scenario and the unit test pass.
- **REFACTOR phase** — Add: when unit tests are enabled, keep both the scenario and unit test green.

Also update the vertical slicing instruction/`WRONG` example to cover both step definitions AND unit tests.

### Step 2: Rewrite SKILL.md Section 4 — Unit Tests (Conditional)
Replace the current minimal Section 4 with comprehensive instructions. The rewritten section must contain:

1. **Check `.adw/project.md` for `## Unit Tests` setting** — kept from existing, but explicitly positioned as something checked before/during the TDD loop
2. **When enabled — full workflow**:
   - Read `.adw/commands.md` `## Run Tests` for the unit test runner command
   - Unit tests are written during the RED phase alongside step definitions, before implementation (test-first)
   - Unit tests are written per scenario as part of each vertical slice — NOT as a separate batch
   - Reference [tests.md](tests.md) for guidance on writing good unit tests
   - Reference [mocking.md](mocking.md) for guidance on mocking in unit tests (mock at system boundaries only)
   - Both the BDD scenario AND unit tests must pass during GREEN — implementation is GREEN only when both pass
   - BDD scenarios remain the independent proof layer; unit tests are finer-grained coverage written by the same agent
   - Do not elevate unit test status above BDD scenarios
3. **When disabled or absent**: Skip unit tests entirely — only BDD scenarios drive the TDD loop. The behavior when absent is identical to disabled.

**Key phrases that MUST appear** (step definitions assert these):
- `.adw/project.md` and `## Unit Tests`
- `RED` with unit test + step definition co-occurrence
- `before implementation` or `test-first`
- `GREEN` with both scenario and unit test passing
- `both` + `pass` (in GREEN context)
- `disabled` and `skip unit tests entirely`
- `absent` with skip/disabled equivalence
- `tests.md` (in unit test writing context)
- `mocking.md` (in unit test mocking context)
- `independent proof layer`
- `finer-grained` (describing unit tests relative to BDD)
- `same agent` (distinguishing who writes unit tests)
- `vertical` in unit test context
- `step definition` + `unit test` together in RED phase

### Step 3: Implement all undefined step definitions in implementTddSkillSteps.ts
Add all undefined steps to the existing `features/step_definitions/implementTddSkillSteps.ts` file. Follow the established patterns: import `sharedCtx` from `./commonSteps.ts`, use `assert.ok()` with descriptive messages, check `sharedCtx.fileContent`.

**When steps (3 — context-only no-ops, content already in sharedCtx from Background):**
1. `When('the content is inspected for the red-green-refactor loop instructions', ...)` — no-op
2. `When('the content is inspected for the GREEN phase instructions', ...)` — no-op
3. `When('the content is inspected for unit test instructions', ...)` — no-op

**Then steps (21 — string assertions on sharedCtx.fileContent):**

*Cluster 1 — Reading the setting:*
4. `Then('it contains instructions to check {string} for the {string} setting', (file, setting) => ...)` — assert content includes both `file` and `setting`
5. `Then('the check happens before or during the TDD loop, not after', ...)` — assert `.adw/project.md` or `## Unit Tests` appears before the `## Report` section (by indexOf comparison)

*Cluster 2 — RED phase integration:*
6. `Then('the RED phase includes writing unit tests alongside step definitions when unit tests are enabled', ...)` — assert content includes RED + unit test + step definition
7. `Then('unit tests are written before implementation code \\(test-first)', ...)` — assert "before implementation" or "test-first"
8. `Then('unit tests are written as part of the vertical slice for each scenario', ...)` — assert "vertical" and "unit test" appear together
9. `Then('there is no separate post-loop section for writing all unit tests at once', ...)` — assert content does NOT contain a dedicated post-loop "write all unit tests" batch section

*Cluster 3 — GREEN phase integration:*
10. `Then('the GREEN phase verifies that both the BDD scenario and unit tests pass', ...)` — assert GREEN + both + pass concepts
11. `Then('implementation is considered GREEN only when both pass', ...)` — assert "both pass" or "both" near "GREEN"

*Cluster 4 — Disabled/absent:*
12. `Then('it describes skipping unit tests when the {string} setting is {string}', (setting, value) => ...)` — assert content mentions the value and skipping
13. `Then('only BDD scenarios drive the TDD loop in this case', ...)` — assert BDD/scenario-only language when disabled
14. `Then('it describes skipping unit tests when the {string} section is absent from {string}', (section, file) => ...)` — assert "absent" with skip behavior
15. `Then('the behavior is identical to when unit tests are disabled', ...)` — assert absent treated as equivalent to disabled (e.g., same "skip" instruction covers both)

*Cluster 5 — Quality references:*
16. `Then('it references {string} for guidance on writing good unit tests', (ref) => ...)` — assert ref (e.g., "tests.md") appears in content
17. `Then('it references {string} for guidance on mocking in unit tests', (ref) => ...)` — assert ref (e.g., "mocking.md") appears in content

*Cluster 6 — Independence:*
18. `Then('it describes BDD scenarios as the independent proof layer', ...)` — assert "independent proof layer"
19. `Then('it distinguishes unit tests as finer-grained coverage written by the same agent', ...)` — assert "finer-grained" or "same agent"
20. `Then('it does not elevate unit test status above BDD scenarios', ...)` — assert content does NOT say unit tests "replace", are "primary", or are "more important" than BDD scenarios

*Cluster 7 — Loop structure (DataTable):*
21. `Then('the enabled-unit-test loop follows this structure:', (dataTable) => ...)` — for each row in table, assert the phase (RED/GREEN/REFACTOR) and its activity description are represented in content
22. `Then('the disabled-unit-test loop follows this structure:', (dataTable) => ...)` — verify standard loop activities are present (step definitions only, no unit test mentions required)

*Cluster 8 — Vertical slicing with unit tests:*
23. `Then('the vertical slicing instruction covers both step definitions and unit tests', ...)` — assert vertical slicing section mentions both "step definition" and "unit test"
24. `Then('it warns against writing all unit tests first then all implementation', ...)` — assert warning about horizontal unit test batching (check for "WRONG" or "all unit tests first")

### Step 4: Verify no step definition conflicts
Ensure no duplicate step patterns between the new steps and existing steps. Key check: the existing `Then('it describes writing unit tests when unit tests are enabled', ...)` (line 164) and `Then('it describes skipping unit tests when unit tests are disabled', ...)` (line 173) have different Cucumber expression text from the new steps — they coexist safely.

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — All 12 @adw-308 scenarios must pass
2. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` — Existing implement_tdd scenarios still pass
3. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Zero regression failures
4. `bun run lint` — No linting errors
5. `bunx tsc --noEmit` — No type errors
6. `bun run build` — Build succeeds

## Patch Scope
**Lines of code to change:** ~80 lines in SKILL.md (Section 3 additions + Section 4 rewrite), ~180 lines in implementTddSkillSteps.ts (24 new step definitions)
**Risk level:** low — SKILL.md is prompt-only markdown; step definitions use established assertion patterns from existing steps
**Testing required:** BDD scenarios tagged `@adw-308`, `@adw-304-implement-tdd`, and `@regression`
