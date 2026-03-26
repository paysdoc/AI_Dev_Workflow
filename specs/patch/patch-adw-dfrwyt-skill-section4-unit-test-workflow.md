# Patch: Enhance SKILL.md Section 4 with prescriptive unit test workflow

## Metadata
adwId: `dfrwyt-unit-test-support-in`
reviewChangeRequest: `Issue #2: SKILL.md Section 4 ('Unit Tests - Conditional') was NOT enhanced — git diff origin/dev shows zero changes to .claude/skills/implement-tdd/SKILL.md. This is the core deliverable of issue #308.`

## Issue Summary
**Original Spec:** `specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md`
**Issue:** SKILL.md Section 4 ("Unit Tests - Conditional") remains a minimal 3-line stub. It tells the agent to check `.adw/project.md` and write unit tests when enabled, but lacks prescriptive workflow integration: when to write them (test-first in RED), how they fit with step definitions (per-scenario vertical slice), what verification looks like (both must pass in GREEN), how to find the test runner (`.adw/commands.md`), and the BDD independence reminder.
**Solution:** Enhance SKILL.md in two places: (1) integrate unit test conditional mentions into Section 3's RED/GREEN/REFACTOR phases and vertical slicing instruction, (2) rewrite Section 4 with comprehensive enabled/disabled workflow detail. Also create the step definitions file needed for `@adw-308` scenario validation.

## Files to Modify
Use these files to implement the patch:

- `.claude/skills/implement-tdd/SKILL.md` — Enhance Section 3 (add unit test conditional mentions in RED/GREEN/REFACTOR and vertical slicing) and rewrite Section 4 with comprehensive enabled/disabled paths.
- `features/step_definitions/implementTddUnitTestSupportSteps.ts` — **NEW FILE.** Step definitions for all `@adw-308` scenarios that assert against the enhanced SKILL.md content.

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

Replace the entire Section 4 content. Replace:
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

### Step 3: Create step definitions file for @adw-308 scenarios

Create `features/step_definitions/implementTddUnitTestSupportSteps.ts` with all step definitions needed by the `@adw-308` scenarios. Follow patterns in `implementTddSkillSteps.ts`:
- Import `When`, `Then` from `@cucumber/cucumber`
- Import `assert` from `assert`
- Import `sharedCtx` from `./commonSteps.ts`
- All assertions use `sharedCtx.fileContent` (populated by Background's `Given the file ".claude/skills/implement-tdd/SKILL.md" is read`)

**When steps (no-op context — content already loaded by Background):**
1. `When('the content is inspected for the red-green-refactor loop instructions', ...)`
2. `When('the content is inspected for the GREEN phase instructions', ...)`
3. `When('the content is inspected for unit test instructions', ...)`

**Then steps — setting check (Scenario 1):**
4. `Then('it contains instructions to check {string} for the {string} setting', ...)` — assert content includes both the file path and the setting
5. `Then('the check happens before or during the TDD loop, not after', ...)` — assert `Unit Tests` appears before `## Report` in content

**Then steps — RED phase (Scenarios 2, 3):**
6. `Then('the RED phase includes writing unit tests alongside step definitions when unit tests are enabled', ...)` — assert content includes `RED` AND `unit test` AND `step definition` AND `enabled`
7. `Then('unit tests are written before implementation code \\(test-first)', ...)` — assert content includes `before implementation` or `test-first`
8. `Then('unit tests are written as part of the vertical slice for each scenario', ...)` — assert content includes `vertical slice` AND `unit test`
9. `Then('there is no separate post-loop section for writing all unit tests at once', ...)` — assert no heading contains batch unit test language

**Then steps — GREEN phase (Scenario 4):**
10. `Then('the GREEN phase verifies that both the BDD scenario and unit tests pass', ...)` — assert content includes `GREEN` AND `BDD scenario` AND `unit test` AND `pass`
11. `Then('implementation is considered GREEN only when both pass', ...)` — assert content includes `GREEN only when both pass`

**Then steps — disabled/absent (Scenarios 5, 6):**
12. `Then('it describes skipping unit tests when the {string} setting is {string}', ...)` — assert content includes the setting, the value, and skip language
13. `Then('only BDD scenarios drive the TDD loop in this case', ...)` — assert content includes `only BDD scenarios drive the TDD loop`
14. `Then('it describes skipping unit tests when the {string} section is absent from {string}', ...)` — assert content includes `absent` and the file path
15. `Then('the behavior is identical to when unit tests are disabled', ...)` — assert content includes `identical` with disabled context

**Then steps — quality references (Scenarios 7, 8):**
16. `Then('it references {string} for guidance on writing good unit tests', ...)` — assert content includes the file and `unit test`
17. `Then('it references {string} for guidance on mocking in unit tests', ...)` — assert content includes the file and `mock`

**Then steps — independence (Scenario 9):**
18. `Then('it describes BDD scenarios as the independent proof layer', ...)` — assert content includes `independent proof layer`
19. `Then('it distinguishes unit tests as finer-grained coverage written by the same agent', ...)` — assert content includes `finer-grained` AND `same agent`
20. `Then('it does not elevate unit test status above BDD scenarios', ...)` — assert content includes `do not elevate` OR `independent proof layer`

**Then steps — TDD loop structure (Scenarios 10, 11):**
21. `Then('the enabled-unit-test loop follows this structure:', ...)` — iterate DataTable rows, assert RED mentions `unit test` + `step definition`, GREEN mentions both pass
22. `Then('the disabled-unit-test loop follows this structure:', ...)` — iterate rows, assert disabled path described

**Then steps — vertical slicing (Scenario 12):**
23. `Then('the vertical slicing instruction covers both step definitions and unit tests', ...)` — assert content includes `vertical` AND `step definition` AND `unit test`
24. `Then('it warns against writing all unit tests first then all implementation', ...)` — assert content includes `all unit tests first`

### Step 4: Validate — dry-run then full run

1. Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308" --dry-run` to confirm zero undefined steps
2. Fix any Cucumber expression mismatches if dry-run reveals undefined steps
3. Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — all 12 scenarios must pass
4. Fix any assertion failures by adjusting step definitions or SKILL.md content until green

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — All 12 @adw-308 scenarios pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` — Existing implement_tdd scenarios still pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — All regression scenarios pass
- `bun run lint` — No lint errors
- `bunx tsc --noEmit` — Type check passes
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check adws project passes
- `bun run build` — Build succeeds

## Patch Scope
**Lines of code to change:** ~180 (SKILL.md: ~30 lines modified/added, new step definitions file: ~150 lines)
**Risk level:** low
**Testing required:** BDD scenarios tagged `@adw-308`, `@adw-304-implement-tdd`, and `@regression` must all pass. Changes are prompt content (SKILL.md) and test infrastructure (step definitions) — no runtime TypeScript code changes.
