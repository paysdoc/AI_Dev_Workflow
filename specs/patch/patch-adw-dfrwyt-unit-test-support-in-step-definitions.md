# Patch: Write step definitions for @adw-308 BDD scenarios

## Metadata
adwId: `dfrwyt-unit-test-support-in`
reviewChangeRequest: `Issue #2: All 13 @adw-308 scenarios fail with undefined step definitions. 26 steps are undefined across all scenarios. No step definition file was created for the new feature.`

## Issue Summary
**Original Spec:** `specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md`
**Issue:** All 13 `@adw-308` BDD scenarios in `features/implement_tdd_unit_test_support.feature` fail because 24 unique step definitions are missing — 3 `When` context steps and 21 `Then` assertion steps. The feature file was created (Task 3) but the corresponding step definitions (Task 4) were never written. Steps inspect SKILL.md content for unit test integration into the TDD loop (RED phase, GREEN phase, vertical slicing, quality references, independence reminder, disabled/absent handling).
**Solution:** Create `features/step_definitions/implementTddUnitTestSupportSteps.ts` with all 24 step definitions. Each step asserts against `sharedCtx.fileContent` (SKILL.md content loaded by Background steps) using `includes()` or regex checks, following existing patterns in `implementTddSkillSteps.ts`. **Dependency:** Steps will only pass assertions after the SKILL.md Section 4 enhancement from the companion patch `patch-adw-dfrwyt-rewrite-skill-section4.md` is applied.

## Files to Modify

- `features/step_definitions/implementTddUnitTestSupportSteps.ts` — **NEW FILE.** All 24 step definitions for `@adw-308` scenarios. Separate file mirrors the feature file naming convention (`implement_tdd_unit_test_support.feature` -> `implementTddUnitTestSupportSteps.ts`).

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Create step definitions file with all 24 undefined steps

Create `features/step_definitions/implementTddUnitTestSupportSteps.ts`. Follow the patterns in `implementTddSkillSteps.ts`:
- Import `When`, `Then` from `@cucumber/cucumber`
- Import `assert` from `assert`
- Import `sharedCtx` from `./commonSteps.ts`
- All assertions use `sharedCtx.fileContent` (populated by Background's `Given the file ".claude/skills/implement-tdd/SKILL.md" is read`)

#### No-op context steps (3 steps)
Content is already loaded in `sharedCtx.fileContent` by the Background `Given` step. These are context-only steps identical to `When('the content is inspected', ...)` in `copyTargetSkillsAdwInitSteps.ts:110`.

1. `When('the content is inspected for the red-green-refactor loop instructions', function () { /* no-op */ })`
2. `When('the content is inspected for the GREEN phase instructions', function () { /* no-op */ })`
3. `When('the content is inspected for unit test instructions', function () { /* no-op */ })`

#### Setting check steps (2 steps — Scenario 1)

4. `Then('it contains instructions to check {string} for the {string} setting', (file: string, setting: string) => ...)`
   - Assert `sharedCtx.fileContent.includes(file)` — SKILL.md must reference the file path (`.adw/project.md`)
   - Assert `sharedCtx.fileContent.includes(setting)` — SKILL.md must reference the setting heading (`## Unit Tests`)

5. `Then('the check happens before or during the TDD loop, not after', () => ...)`
   - Find index of `## Unit Tests` (or `Unit Tests`) in content
   - Find index of `### 5.` (the section after the TDD loop) in content
   - Assert the Unit Tests index < the Section 5 index, confirming the check is at or before the TDD loop

#### RED phase steps (4 steps — Scenarios 2, 3)

6. `Then('the RED phase includes writing unit tests alongside step definitions when unit tests are enabled', () => ...)`
   - Assert content includes `RED` AND includes both `unit test` (case-insensitive) and `step definition` in proximity
   - Use: `content.includes('RED')` and `content.toLowerCase().includes('unit test')` and `content.includes('step definition')`

7. `Then('unit tests are written before implementation code \\(test-first)', () => ...)`
   - Assert content includes test-first language: `content.toLowerCase().includes('before implementation')` or `content.toLowerCase().includes('test-first')`

8. `Then('unit tests are written as part of the vertical slice for each scenario', () => ...)`
   - Assert content ties unit tests to vertical slicing: `content.toLowerCase().includes('vertical')` and `content.toLowerCase().includes('unit test')`

9. `Then('there is no separate post-loop section for writing all unit tests at once', () => ...)`
   - Assert content does NOT have a heading for writing all unit tests after the loop
   - Check that no section heading (lines starting with `###`) contains both "unit test" and "after" or "batch"
   - Simplest: assert `!content.toLowerCase().includes('write all unit tests')` or similar batch language

#### GREEN phase steps (2 steps — Scenario 4)

10. `Then('the GREEN phase verifies that both the BDD scenario and unit tests pass', () => ...)`
    - Assert content includes `GREEN` AND mentions both BDD/scenario and unit test passing together
    - Use: `content.includes('GREEN')` and `content.toLowerCase().includes('both')`

11. `Then('implementation is considered GREEN only when both pass', () => ...)`
    - Assert content includes "both" passing language in GREEN context
    - Use: `content.toLowerCase().includes('both')` and (`content.toLowerCase().includes('pass')` or `content.toLowerCase().includes('green')`)

#### Disabled/absent steps (4 steps — Scenarios 5, 6)

12. `Then('it describes skipping unit tests when the {string} setting is {string}', (setting: string, value: string) => ...)`
    - Assert content includes `disabled` and includes skip language (`skip` or `skip unit tests entirely`)
    - Use: `content.toLowerCase().includes(value.toLowerCase())` and `content.toLowerCase().includes('skip')`

13. `Then('only BDD scenarios drive the TDD loop in this case', () => ...)`
    - Assert content mentions BDD-only when disabled: `content.includes('BDD')` or `content.toLowerCase().includes('only')` in the disabled context

14. `Then('it describes skipping unit tests when the {string} section is absent from {string}', (section: string, file: string) => ...)`
    - Assert content mentions absent leading to skip: `content.toLowerCase().includes('absent')` and `content.toLowerCase().includes('skip')`

15. `Then('the behavior is identical to when unit tests are disabled', () => ...)`
    - Assert content treats absent same as disabled: `content.toLowerCase().includes('absent')` and (`content.toLowerCase().includes('disabled')` or `content.toLowerCase().includes('identical')` or `content.toLowerCase().includes('same')`)

#### Quality reference steps (2 steps — Scenarios 7, 8)

16. `Then('it references {string} for guidance on writing good unit tests', (file: string) => ...)`
    - Assert `sharedCtx.fileContent.includes(file)` — SKILL.md must reference the file (e.g., `tests.md`)
    - Additionally assert unit test context: `content.toLowerCase().includes('unit test')`

17. `Then('it references {string} for guidance on mocking in unit tests', (file: string) => ...)`
    - Assert `sharedCtx.fileContent.includes(file)` — SKILL.md must reference the file (e.g., `mocking.md`)
    - Additionally assert mocking context: `content.toLowerCase().includes('mock')`

#### Independence steps (3 steps — Scenario 9)

18. `Then('it describes BDD scenarios as the independent proof layer', () => ...)`
    - Assert `content.includes('independent proof layer')` or `content.toLowerCase().includes('independent')` and `content.toLowerCase().includes('proof')`

19. `Then('it distinguishes unit tests as finer-grained coverage written by the same agent', () => ...)`
    - Assert content mentions finer-grained or supplementary coverage: `content.toLowerCase().includes('finer-grained')` or `content.toLowerCase().includes('supplementary')` or `content.toLowerCase().includes('same agent')`

20. `Then('it does not elevate unit test status above BDD scenarios', () => ...)`
    - Assert content does NOT position unit tests as primary over BDD
    - Assert `!content.toLowerCase().includes('unit tests replace')` and `!content.toLowerCase().includes('unit tests are the primary')`
    - Also positively assert BDD independence: `content.toLowerCase().includes('independent')` or `content.includes('BDD')`

#### TDD loop structure steps (2 steps — Scenarios 10, 11, data table)

21. `Then('the enabled-unit-test loop follows this structure:', (dataTable: { rows: () => string[][] }) => ...)`
    - Iterate `dataTable.rows()`, which returns `[phase, activity]` pairs:
      - `['RED', 'Write step definition + unit test']`
      - `['GREEN', 'Implement code to pass both scenario and unit test']`
      - `['REFACTOR', 'Clean up while keeping both green']`
    - For each row, assert content includes the phase AND the content describes the corresponding activity with unit test integration
    - Use flexible matching: assert `content.includes(phase)` and that content describes the general activity (e.g., for RED: `content.toLowerCase().includes('unit test')` and `content.toLowerCase().includes('step definition')`)

22. `Then('the disabled-unit-test loop follows this structure:', (dataTable: { rows: () => string[][] }) => ...)`
    - Iterate rows:
      - `['RED', 'Write step definition']`
      - `['GREEN', 'Implement code to pass scenario']`
      - `['REFACTOR', 'Clean up while keeping scenario green']`
    - For each phase, assert content includes the phase and describes the standard (non-unit-test) activity
    - These phases already exist in Section 3 — assert `content.includes('RED')` and `content.includes('step definition')`, etc.

#### Vertical slicing steps (2 steps — Scenario 12)

23. `Then('the vertical slicing instruction covers both step definitions and unit tests', () => ...)`
    - Assert vertical slicing section mentions both: `content.toLowerCase().includes('vertical')` and `content.toLowerCase().includes('step definition')` and `content.toLowerCase().includes('unit test')`

24. `Then('it warns against writing all unit tests first then all implementation', () => ...)`
    - Assert content warns against batching unit tests: look for `WRONG` or `all unit tests first` or `horizontal` combined with `unit test`
    - Distinct from existing step `it warns against writing all tests first then all implementation` in `implementTddSkillSteps.ts:127` which uses "tests" not "unit tests"

### Step 2: Verify zero undefined steps with dry-run

Run:
```bash
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308" --dry-run
```

All 13 scenarios should show as `skipped` (not `undefined`). If any steps remain undefined, fix the Cucumber expression to match the feature file wording **exactly** — expressions are case-sensitive and whitespace-sensitive.

### Step 3: Run full @adw-308 scenario suite

Run:
```bash
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"
```

If the SKILL.md companion patch has been applied, all 13 scenarios should pass. If not yet applied, scenarios will fail on content assertions (not on undefined steps) — this is expected and the companion patch resolves it.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308" --dry-run` — Zero undefined steps (all 13 scenarios skipped, not undefined)
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — All 13 new scenarios pass (requires SKILL.md companion patch)
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` — Existing implement_tdd scenarios still pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — All regression scenarios pass
- `bun run lint` — No lint errors
- `bunx tsc --noEmit` — Type check passes
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check adws project passes
- `bun run build` — Build succeeds

## Patch Scope
**Lines of code to change:** ~120-150 (new file with 24 step definitions)
**Risk level:** low
**Testing required:** BDD scenarios tagged `@adw-308`, `@adw-304-implement-tdd`, and `@regression` must all pass. This is test infrastructure only — no runtime TypeScript code changes, no SKILL.md changes (those are in the companion patch `patch-adw-dfrwyt-rewrite-skill-section4.md`).
