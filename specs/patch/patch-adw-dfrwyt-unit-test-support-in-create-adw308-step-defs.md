# Patch: Create step definitions for all 12 @adw-308 scenarios

## Metadata
adwId: `dfrwyt-unit-test-support-in`
reviewChangeRequest: `Issue #2: All 12 new @adw-308 scenarios fail with 'Undefined' step definitions. The feature file features/implement_tdd_unit_test_support.feature was created with well-structured scenarios, but no corresponding step definitions were implemented. Resolution: Implement Task 4 from the spec — create step definitions for all new scenario steps in features/step_definitions/.`

## Issue Summary
**Original Spec:** `specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md`
**Issue:** 24 step definitions (3 `When` + 21 `Then`) are missing for the 12 `@adw-308` BDD scenarios in `features/implement_tdd_unit_test_support.feature`. The feature file was created (Task 3) but the corresponding step definitions (Task 4) were never implemented, causing all scenarios to report `Undefined` steps.
**Solution:** Create `features/step_definitions/implementTddUnitTestSupportSteps.ts` with all 24 step definitions. Each step asserts against `sharedCtx.fileContent` (SKILL.md content loaded by the Background step) using `includes()` checks, following existing patterns in `implementTddSkillSteps.ts`. **Dependency:** Step assertions will only pass after the companion SKILL.md enhancement patch (`patch-adw-dfrwyt-unit-test-support-in-enhance-section4-tdd-loop.md`) is applied.

## Files to Modify
- `features/step_definitions/implementTddUnitTestSupportSteps.ts` — **NEW FILE.** 24 step definitions for all `@adw-308` scenarios. Naming mirrors the feature file convention (`implement_tdd_unit_test_support.feature` -> `implementTddUnitTestSupportSteps.ts`).

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Create the step definitions file

Create `features/step_definitions/implementTddUnitTestSupportSteps.ts` with all 24 step definitions.

**Imports:**
```typescript
import { When, Then } from '@cucumber/cucumber';
import assert from 'assert';
import { sharedCtx } from './commonSteps.ts';
```

**No-op context steps (3 When steps):**
Content is already loaded in `sharedCtx.fileContent` by the Background `Given the file ".claude/skills/implement-tdd/SKILL.md" is read` step. These are context-only steps identical to `When('the content is inspected', ...)` in `copyTargetSkillsAdwInitSteps.ts:110`.

1. `When('the content is inspected for the red-green-refactor loop instructions', function () { /* no-op */ })`
2. `When('the content is inspected for the GREEN phase instructions', function () { /* no-op */ })`
3. `When('the content is inspected for unit test instructions', function () { /* no-op */ })`

**Setting check steps (2 Then steps — Scenario 1, line 19):**

4. `Then('it contains instructions to check {string} for the {string} setting', function (file: string, setting: string) { ... })`
   - Assert `sharedCtx.fileContent.includes(file)` — must reference `.adw/project.md`
   - Assert `sharedCtx.fileContent.includes(setting)` — must reference `## Unit Tests`

5. `Then('the check happens before or during the TDD loop, not after', function () { ... })`
   - Find index of `Unit Tests` in content
   - Find index of `### 5.` (the section after the TDD loop) in content
   - Assert Unit Tests index < Section 5 index

**RED phase steps (4 Then steps — Scenarios 2-3, lines 29-38):**

6. `Then('the RED phase includes writing unit tests alongside step definitions when unit tests are enabled', function () { ... })`
   - Assert content includes `RED` AND `unit test` (case-insensitive) AND `step definition`

7. `Then('unit tests are written before implementation code \\(test-first)', function () { ... })`
   - Assert `content.toLowerCase()` includes `before implementation` or `test-first`

8. `Then('unit tests are written as part of the vertical slice for each scenario', function () { ... })`
   - Assert `content.toLowerCase()` includes `vertical` AND `unit test`

9. `Then('there is no separate post-loop section for writing all unit tests at once', function () { ... })`
   - Assert content does NOT have a section heading containing both "unit test" and "batch"/"post-loop"
   - Use negative assertion: `!content.includes('### ') || ...` combined with checking no batch language in section headings

**GREEN phase steps (2 Then steps — Scenario 4, line 45):**

10. `Then('the GREEN phase verifies that both the BDD scenario and unit tests pass', function () { ... })`
    - Assert content includes `GREEN` AND `both` (case-insensitive)

11. `Then('implementation is considered GREEN only when both pass', function () { ... })`
    - Assert content includes `both` AND (`pass` or `green`) (case-insensitive)

**Disabled/absent steps (4 Then steps — Scenarios 5-6, lines 55-64):**

12. `Then('it describes skipping unit tests when the {string} setting is {string}', function (setting: string, value: string) { ... })`
    - Assert `content.toLowerCase()` includes `value.toLowerCase()` AND `skip`

13. `Then('only BDD scenarios drive the TDD loop in this case', function () { ... })`
    - Assert content includes `BDD` or `only BDD scenarios` in the disabled context

14. `Then('it describes skipping unit tests when the {string} section is absent from {string}', function (section: string, file: string) { ... })`
    - Assert `content.toLowerCase()` includes `absent` AND `skip`

15. `Then('the behavior is identical to when unit tests are disabled', function () { ... })`
    - Assert `content.toLowerCase()` includes `absent` AND (`disabled` or `identical` or `same`)

**Quality reference steps (2 Then steps — Scenarios 7-8, lines 72-78):**

16. `Then('it references {string} for guidance on writing good unit tests', function (file: string) { ... })`
    - Assert `sharedCtx.fileContent.includes(file)` — SKILL.md must reference the file (e.g., `tests.md`)
    - Assert content includes `unit test` (case-insensitive) — in unit test context

17. `Then('it references {string} for guidance on mocking in unit tests', function (file: string) { ... })`
    - Assert `sharedCtx.fileContent.includes(file)` — must reference `mocking.md`
    - Assert content includes `mock` (case-insensitive) — in mocking context

**Independence steps (3 Then steps — Scenario 9, line 85):**

18. `Then('it describes BDD scenarios as the independent proof layer', function () { ... })`
    - Assert `content.includes('independent proof layer')` or `content.toLowerCase()` includes `independent` AND `proof`

19. `Then('it distinguishes unit tests as finer-grained coverage written by the same agent', function () { ... })`
    - Assert content includes `finer-grained` or `supplementary` or `same agent` (case-insensitive)

20. `Then('it does not elevate unit test status above BDD scenarios', function () { ... })`
    - Assert content does NOT include `unit tests replace` or `unit tests are the primary`
    - Positively assert `content.includes('independent')` or `content.includes('BDD')`

**TDD loop structure steps (2 Then steps — Scenarios 10-11, lines 96-111, DataTable):**

21. `Then('the enabled-unit-test loop follows this structure:', function (dataTable: { rows: () => string[][] }) { ... })`
    - Iterate `dataTable.rows()` for `[phase, activity]` pairs:
      - `['RED', 'Write step definition + unit test']`
      - `['GREEN', 'Implement code to pass both scenario and unit test']`
      - `['REFACTOR', 'Clean up while keeping both green']`
    - For each row, assert content includes the phase. Use flexible matching for activities:
      - RED: assert `unit test` AND `step definition` present (case-insensitive)
      - GREEN: assert `both` present (case-insensitive)
      - REFACTOR: assert `both` present (case-insensitive)

22. `Then('the disabled-unit-test loop follows this structure:', function (dataTable: { rows: () => string[][] }) { ... })`
    - Iterate rows:
      - `['RED', 'Write step definition']`
      - `['GREEN', 'Implement code to pass scenario']`
      - `['REFACTOR', 'Clean up while keeping scenario green']`
    - These phases already exist in Section 3 — assert `content.includes('RED')` AND `content.includes('step definition')`, etc.

**Vertical slicing steps (2 Then steps — Scenario 12, line 118):**

23. `Then('the vertical slicing instruction covers both step definitions and unit tests', function () { ... })`
    - Assert `content.toLowerCase()` includes `vertical` AND `step definition` AND `unit test`

24. `Then('it warns against writing all unit tests first then all implementation', function () { ... })`
    - Assert content warns against batching: `WRONG` or `all unit tests first` or `horizontal` combined with `unit test`
    - NOTE: Distinct from the existing step `it warns against writing all tests first then all implementation` in `implementTddSkillSteps.ts:127` which uses "tests" (generic), not "unit tests" (specific)

### Step 2: Verify zero undefined steps

Run dry-run to confirm all step expressions match:
```bash
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308" --dry-run
```

All 12 scenarios should show as `skipped` (not `undefined`). If any steps remain `undefined`, fix the Cucumber expression to match the feature file wording **exactly** — expressions are case-sensitive and whitespace-sensitive. Pay special attention to:
- Escaped parentheses in step 7: `\\(test-first)`
- DataTable steps 21-22: use `function` syntax (not arrow functions) for `this` binding if needed

### Step 3: Run full @adw-308 suite

```bash
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"
```

All 12 scenarios should pass if the companion SKILL.md patch has been applied. If SKILL.md is still in its original state, scenarios will fail on assertion checks (not on undefined steps) — this is expected.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308" --dry-run` — Zero undefined steps (all 12 scenarios skipped, not undefined)
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — All 12 new scenarios pass (requires companion SKILL.md patch)
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` — Existing implement_tdd scenarios still pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — All regression scenarios pass
- `bun run lint` — No lint errors
- `bunx tsc --noEmit` — Type check passes
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check adws project passes
- `bun run build` — Build succeeds

## Patch Scope
**Lines of code to change:** ~130-150 (1 new file with 24 step definitions)
**Risk level:** low
**Testing required:** BDD scenarios tagged `@adw-308`, `@adw-304-implement-tdd`, and `@regression` must all pass. This is test infrastructure only — no runtime TypeScript code changes. Depends on companion SKILL.md patch for assertion checks to pass.
