# Patch: Create all @adw-308 step definitions + enhance SKILL.md for assertions to pass

## Metadata
adwId: `dfrwyt-unit-test-support-in`
reviewChangeRequest: `Issue #2: All @adw-308 step definitions are missing. 12 of 13 scenarios fail as 'Undefined' — 28 undefined steps total. No step definition file was created for the new feature scenarios.`

## Issue Summary
**Original Spec:** `specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md`
**Issue:** 12 of 13 `@adw-308` scenarios fail as Undefined — 28 step instances (24 unique step definitions) are missing. No step definition file was created for `features/implement_tdd_unit_test_support.feature`. The 13th scenario (from `implement_tdd_skill.feature:88`) already has step definitions and passes. Additionally, SKILL.md Section 4 has not been enhanced, so even if step definitions were created, content assertions would fail against the current minimal Section 4.
**Solution:** (1) Enhance SKILL.md Sections 3 and 4 with the content the step definitions will assert against, (2) create `features/step_definitions/implementTddUnitTestSupportSteps.ts` with all 24 step definitions.

## Files to Modify
Use these files to implement the patch:

- `.claude/skills/implement-tdd/SKILL.md` — Enhance Section 3 (add unit test conditional mentions in RED/GREEN/REFACTOR and vertical slicing) and rewrite Section 4 with comprehensive enabled/disabled workflow.
- `features/step_definitions/implementTddUnitTestSupportSteps.ts` — **NEW FILE.** All 24 step definitions (3 When + 21 Then) for the 12 `@adw-308` scenarios in `implement_tdd_unit_test_support.feature`.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Enhance SKILL.md Section 3 — integrate unit test mentions into the TDD loop

Read `.claude/skills/implement-tdd/SKILL.md`. Make these targeted edits to Section 3:

**1a. Modify the vertical slicing instruction** to cover both step definitions and unit tests. Replace:
```
**Vertical slicing only.** Do NOT write all step definitions first and then all implementation. Work one scenario at a time.
```
With:
```
**Vertical slicing only.** Do NOT write all step definitions first and then all implementation. When unit tests are enabled, do NOT write all unit tests first then all implementation either. Work one scenario at a time.
```

**1b. Modify the RED phase heading and add unit test bullet.** Replace:
```
**RED — Write or complete step definitions**
- Write the step definitions needed for this scenario (or verify they already exist)
- Run the scenario to verify it fails: the test must be RED before you implement
- If the scenario already passes, skip to the next one
```
With:
```
**RED — Write or complete step definitions (+ unit test when enabled)**
- Write the step definitions needed for this scenario (or verify they already exist)
- If unit tests are **enabled**: also write a unit test before implementation (test-first) for the logic this scenario introduces. The unit test is written as part of the vertical slice for each scenario. See [tests.md](tests.md) for guidance on writing good unit tests and [mocking.md](mocking.md) for guidance on mocking in unit tests (mock at system boundaries only).
- Run the scenario to verify it fails: the test must be RED before you implement
- If the scenario already passes, skip to the next one
```

**1c. Modify the GREEN phase to verify both.** Replace:
```
**GREEN — Implement to pass**
- Write the minimal code needed to make this scenario pass
- Run the scenario to verify it passes: the test must be GREEN before moving on
- Do not add code beyond what this scenario requires
```
With:
```
**GREEN — Implement to pass**
- Write the minimal code needed to make this scenario pass
- If unit tests are **enabled**: verify both the BDD scenario AND the unit test pass. Implementation is considered GREEN only when both pass.
- Run the scenario to verify it passes: the test must be GREEN before moving on
- Do not add code beyond what this scenario requires
```

**1d. Modify the REFACTOR phase** to mention unit tests. Replace:
```
- Run the scenario after each refactor step to stay GREEN
```
With:
```
- Run the scenario (and unit test if enabled) after each refactor step to stay GREEN
```

### Step 2: Rewrite SKILL.md Section 4 — comprehensive unit test conditional

Replace the entire Section 4 block. Replace:
```
### 4. Unit Tests (Conditional)

Check `.adw/project.md` for the `## Unit Tests` section:
- If unit tests are **enabled**: write Vitest/Jest unit tests for any non-trivial logic introduced, following the guidelines in [tests.md](tests.md) and [mocking.md](mocking.md). The BDD scenario remains the independent proof layer.
- If unit tests are **disabled** or the section is absent: skip unit tests entirely.
```
With:
```
### 4. Unit Tests (Conditional)

Check `.adw/project.md` for the `## Unit Tests` section:

**When enabled:**
- Unit tests are integrated into the red-green-refactor loop as part of each vertical slice — not as a separate batch
- Write unit tests before implementation code (test-first), alongside step definitions in the RED phase
- Read `.adw/commands.md` `## Run Tests` for the project's unit test runner command
- Follow [tests.md](tests.md) for guidance on writing good unit tests (test behavior through public interfaces)
- Follow [mocking.md](mocking.md) for guidance on mocking in unit tests (mock at system boundaries only)
- During the GREEN phase, both the BDD scenario AND unit tests must pass — implementation is considered GREEN only when both pass
- BDD scenarios are the independent proof layer, written by a separate agent. Unit tests are finer-grained coverage written by the same agent as the implementation — do not elevate unit test status above BDD scenarios

**When disabled or absent:**
- Skip unit tests entirely — only BDD scenarios drive the TDD loop
- The behavior when the `## Unit Tests` section is absent from `.adw/project.md` is identical to when unit tests are disabled
```

### Step 3: Create step definitions file for all @adw-308 scenarios

Create `features/step_definitions/implementTddUnitTestSupportSteps.ts` with all 24 step definitions. Follow patterns from `implementTddSkillSteps.ts`:
- Import `When`, `Then` from `@cucumber/cucumber`
- Import `assert` from `assert`
- Import `sharedCtx` from `./commonSteps.ts`
- All assertions use `sharedCtx.fileContent` (populated by the Background step `Given the file ".claude/skills/implement-tdd/SKILL.md" is read`)

The 24 step definitions are organized by scenario group:

#### When steps (3 no-op context steps — content already loaded by Background)

1. `When('the content is inspected for the red-green-refactor loop instructions', function () { /* no-op */ })`
2. `When('the content is inspected for the GREEN phase instructions', function () { /* no-op */ })`
3. `When('the content is inspected for unit test instructions', function () { /* no-op */ })`

#### Setting check steps (Scenario 1: lines 19-22)

4. `Then('it contains instructions to check {string} for the {string} setting', (file, setting) => ...)`
   - Assert `sharedCtx.fileContent.includes(file)` AND `sharedCtx.fileContent.includes(setting)`

5. `Then('the check happens before or during the TDD loop, not after', () => ...)`
   - Find index of `## Unit Tests` and `## Report` in content
   - Assert Unit Tests index < Report index (ensuring the check is before the report/end)

#### RED phase steps (Scenarios 2-3: lines 29-38)

6. `Then('the RED phase includes writing unit tests alongside step definitions when unit tests are enabled', () => ...)`
   - Assert content includes `RED` AND `unit test` AND (`step definition` or `step definitions`) AND `enabled`

7. `Then('unit tests are written before implementation code \\(test-first)', () => ...)`
   - Assert content includes `before implementation` OR `test-first`

8. `Then('unit tests are written as part of the vertical slice for each scenario', () => ...)`
   - Assert content includes `vertical slice` AND `unit test`

9. `Then('there is no separate post-loop section for writing all unit tests at once', () => ...)`
   - Split content by lines, check no heading line (starting with `#`) contains batch language like "write all unit tests"

#### GREEN phase steps (Scenario 4: lines 45-48)

10. `Then('the GREEN phase verifies that both the BDD scenario and unit tests pass', () => ...)`
    - Assert content includes `GREEN` AND `BDD scenario` AND `unit test` AND `pass`

11. `Then('implementation is considered GREEN only when both pass', () => ...)`
    - Assert content includes `GREEN only when both pass`

#### Disabled/absent steps (Scenarios 5-6: lines 55-64)

12. `Then('it describes skipping unit tests when the {string} setting is {string}', (setting, value) => ...)`
    - Assert content.toLowerCase() includes `skip unit tests` AND value.toLowerCase()

13. `Then('only BDD scenarios drive the TDD loop in this case', () => ...)`
    - Assert content includes `only BDD scenarios drive the TDD loop`

14. `Then('it describes skipping unit tests when the {string} section is absent from {string}', (section, file) => ...)`
    - Assert content includes `absent` AND file

15. `Then('the behavior is identical to when unit tests are disabled', () => ...)`
    - Assert content includes `identical` AND `disabled`

#### Quality reference steps (Scenarios 7-8: lines 71-79)

16. `Then('it references {string} for guidance on writing good unit tests', (file) => ...)`
    - Assert content includes the file string AND `unit test`

17. `Then('it references {string} for guidance on mocking in unit tests', (file) => ...)`
    - Assert content includes the file string AND `mocking` (case-insensitive)

#### Independence steps (Scenario 9: lines 85-89)

18. `Then('it describes BDD scenarios as the independent proof layer', () => ...)`
    - Assert content includes `independent proof layer`

19. `Then('it distinguishes unit tests as finer-grained coverage written by the same agent', () => ...)`
    - Assert content includes `finer-grained` AND `same agent`

20. `Then('it does not elevate unit test status above BDD scenarios', () => ...)`
    - Assert content includes `do not elevate` OR `independent proof layer`

#### TDD loop structure steps (Scenarios 10-11: lines 96-111, DataTable)

21. `Then('the enabled-unit-test loop follows this structure:', (dataTable) => ...)`
    - Iterate `dataTable.rows()` for `[phase, activity]` pairs
    - For each row, assert the SKILL.md content mentions the activity's key concepts in the context of the phase:
      - RED row: assert content mentions `unit test` + `step definition` near `RED`
      - GREEN row: assert content mentions both passing near `GREEN`
      - REFACTOR row: assert content mentions keeping both green near `REFACTOR`

22. `Then('the disabled-unit-test loop follows this structure:', (dataTable) => ...)`
    - Iterate rows and assert each phase is present in content
    - Assert the disabled path says only BDD scenarios drive the loop

#### Vertical slicing steps (Scenario 12: lines 118-121)

23. `Then('the vertical slicing instruction covers both step definitions and unit tests', () => ...)`
    - Assert content.toLowerCase() includes `vertical` AND `step definition` AND `unit test`

24. `Then('it warns against writing all unit tests first then all implementation', () => ...)`
    - Assert content.toLowerCase() includes `all unit tests first`

### Step 4: Validate — dry-run then full run

1. Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308" --dry-run` — Confirm zero undefined steps (all 13 scenarios defined)
2. Fix any Cucumber expression mismatches if dry-run reveals undefined steps
3. Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — All 13 scenarios must pass (12 from new file + 1 from implement_tdd_skill.feature)
4. Fix any assertion failures by adjusting step definition assertions or SKILL.md wording until green

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — All 13 @adw-308 scenarios pass (12 new + 1 existing)
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` — Existing implement_tdd scenarios still pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — All regression scenarios pass
- `bun run lint` — No lint errors
- `bunx tsc --noEmit` — Type check passes
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check adws project passes
- `bun run build` — Build succeeds

## Patch Scope
**Lines of code to change:** ~200 (SKILL.md: ~30 lines modified/added, new step definitions file: ~170 lines)
**Risk level:** low
**Testing required:** BDD scenarios tagged `@adw-308`, `@adw-304-implement-tdd`, and `@regression` must all pass. Changes are prompt content (SKILL.md) and test infrastructure (step definitions) — no runtime TypeScript code changes.
