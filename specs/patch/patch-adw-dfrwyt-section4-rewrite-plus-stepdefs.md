# Patch: Rewrite SKILL.md Section 4 + Section 3 unit test integration and implement all @adw-308 step definitions

## Metadata
adwId: `dfrwyt-unit-test-support-in`
reviewChangeRequest: `specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md`

## Issue Summary
**Original Spec:** specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md
**Issue:** SKILL.md (`.claude/skills/implement-tdd/SKILL.md`) has zero diff against origin/dev. Section 4 ("Unit Tests - Conditional") is still a minimal 3-line block that says "write Vitest/Jest unit tests for any non-trivial logic" without integrating unit tests into the RED-GREEN-REFACTOR loop. Additionally, all 12 `@adw-308` BDD scenarios fail because ~24 step definitions are undefined.
**Solution:** Two coordinated changes: (1) Enhance SKILL.md Section 3 with conditional unit test mentions in RED/GREEN/REFACTOR phases and vertical slicing, and rewrite Section 4 with comprehensive unit test workflow instructions. (2) Create a new step definitions file with all 24 missing step definitions whose assertions match the enhanced SKILL.md wording exactly.

## Files to Modify
Use these files to implement the patch:

- `.claude/skills/implement-tdd/SKILL.md` — Enhance Section 3 (add conditional unit test notes to RED/GREEN/REFACTOR and vertical slicing) and rewrite Section 4 (full unit test workflow integration)
- `features/step_definitions/implementTddUnitTestSupportSteps.ts` — **NEW FILE.** All ~24 missing step definitions for the 12 `@adw-308` scenarios.

Reference files (read-only):
- `features/implement_tdd_unit_test_support.feature` — The 12 scenarios and their steps
- `features/step_definitions/implementTddSkillSteps.ts` — Pattern reference for assertion style
- `features/step_definitions/commonSteps.ts` — Provides `sharedCtx` with `fileContent` and `filePath`
- `features/step_definitions/copyTargetSkillsAdwInitSteps.ts` — Provides existing `When('the content is inspected')` step (line 110)
- `.claude/skills/implement-tdd/tests.md` — Referenced by SKILL.md for unit test quality
- `.claude/skills/implement-tdd/mocking.md` — Referenced by SKILL.md for mocking guidance

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Read current state and understand assertion targets
- Read `.claude/skills/implement-tdd/SKILL.md` to understand the current Section 3 and Section 4 content
- Read `features/implement_tdd_unit_test_support.feature` to identify all step phrases that need implementations
- Read `features/step_definitions/implementTddSkillSteps.ts` and `features/step_definitions/commonSteps.ts` to understand existing patterns
- Read `features/step_definitions/copyTargetSkillsAdwInitSteps.ts` to understand the existing `When('the content is inspected')` step

### Step 2: Enhance SKILL.md Section 3 with conditional unit test mentions

In Section 3 ("Red-Green-Refactor Loop"), make these targeted additions:

**Vertical slicing block** — After the existing WRONG/RIGHT example, add a note that when unit tests are enabled (see Section 4), unit tests are included in the vertical slice:
```
When unit tests are enabled (see Section 4), include unit tests in each vertical slice:
  RED → GREEN: step1+ut1 → impl1
  RED → GREEN: step2+ut2 → impl2
Do NOT write all unit tests first then all implementation.
```

**RED phase** — After "Write the step definitions needed for this scenario (or verify they already exist)", add:
```
- When unit tests are enabled (see Section 4), also write a unit test targeting the function/module being introduced. Write the unit test before implementation (test-first), alongside the step definition.
```

**GREEN phase** — After "Write the minimal code needed to make this scenario pass", add:
```
- When unit tests are enabled, verify both the BDD scenario and the unit test pass. Implementation is considered GREEN only when both pass.
```

**REFACTOR phase** — After "Run the scenario after each refactor step to stay GREEN", add:
```
- When unit tests are enabled, keep both the scenario and unit test green after each refactor step
```

### Step 3: Rewrite SKILL.md Section 4 ("Unit Tests - Conditional")

Replace lines 63-67 (the current minimal Section 4) with this comprehensive block:

```markdown
### 4. Unit Tests (Conditional)

Check `.adw/project.md` for the `## Unit Tests` setting. Read `.adw/commands.md` `## Run Tests` for the project's unit test runner command.

**When unit tests are enabled:**

Unit tests are integrated into the red-green-refactor loop alongside step definitions. They provide finer-grained coverage targeting specific functions and modules.

- **RED phase**: Write a unit test alongside the step definition, before implementation (test-first). The unit test targets the specific function/module being introduced. Follow [tests.md](tests.md) for good vs bad test patterns. Follow [mocking.md](mocking.md) for mocking guidance — mock at system boundaries only.
- **GREEN phase**: Implementation must pass both the BDD scenario AND the unit test. Implementation is considered GREEN only when both pass.
- **REFACTOR phase**: Refactoring keeps both the scenario and unit test green.

Loop structure when unit tests are enabled:
- RED: Write step definition + unit test
- GREEN: Implement code to pass both scenario and unit test
- REFACTOR: Clean up while keeping both green

**When unit tests are disabled or absent:**

Skip unit tests entirely. Only BDD scenarios drive the TDD loop.

- If `## Unit Tests` is `disabled`: skip unit tests entirely.
- If the `## Unit Tests` section is absent from `.adw/project.md`: treat as disabled — skip unit tests entirely. The behavior is identical to when unit tests are disabled.

Loop structure when unit tests are disabled:
- RED: Write step definition
- GREEN: Implement code to pass scenario
- REFACTOR: Clean up while keeping scenario green

**Independence and hierarchy:**

BDD scenarios are the independent proof layer — they were written by a separate agent and verify behavior independently. Unit tests provide finer-grained coverage written by the same agent as the implementation. Do not elevate unit test status above BDD scenarios.
```

### Step 4: Create `features/step_definitions/implementTddUnitTestSupportSteps.ts`

Create a new step definitions file with all missing steps. Import `{ When, Then }` from `@cucumber/cucumber`, `assert` from `assert`, and `{ sharedCtx }` from `./commonSteps.ts`.

**3 When steps** (context-setting, no assertions — content already loaded by Background):
1. `When('the content is inspected for the red-green-refactor loop instructions', ...)` — no-op
2. `When('the content is inspected for the GREEN phase instructions', ...)` — no-op
3. `When('the content is inspected for unit test instructions', ...)` — no-op

**21 Then steps** (all assert on `sharedCtx.fileContent`):

Each assertion MUST match exact wording present in the enhanced SKILL.md. Critical alignment:

| Step phrase | Asserts SKILL.md contains |
|---|---|
| `it contains instructions to check {string} for the {string} setting` | Both the file path (`.adw/project.md`) and the setting heading (`## Unit Tests`) |
| `the check happens before or during the TDD loop, not after` | Section 4 heading index < Section 5 heading index (unit test check is part of the loop) |
| `the RED phase includes writing unit tests alongside step definitions when unit tests are enabled` | "unit test" + "step definition" + "RED" co-occurrence |
| `unit tests are written before implementation code (test-first)` | "before implementation" or "test-first" |
| `unit tests are written as part of the vertical slice for each scenario` | "vertical" + "unit test" co-occurrence |
| `there is no separate post-loop section for writing all unit tests at once` | Negative: no "after the loop write all unit tests" pattern |
| `the GREEN phase verifies that both the BDD scenario and unit tests pass` | "both" + "pass" near GREEN context |
| `implementation is considered GREEN only when both pass` | "only when both pass" verbatim |
| `it describes skipping unit tests when the {string} setting is {string}` | "skip" + setting value (disabled) |
| `only BDD scenarios drive the TDD loop in this case` | "Only BDD scenarios drive the TDD loop" |
| `it describes skipping unit tests when the {string} section is absent from {string}` | "absent" + "skip" |
| `the behavior is identical to when unit tests are disabled` | "identical" or "treat as disabled" |
| `it references {string} for guidance on writing good unit tests` | referenced filename (tests.md) in unit test context |
| `it references {string} for guidance on mocking in unit tests` | referenced filename (mocking.md) in unit test context |
| `it describes BDD scenarios as the independent proof layer` | "independent proof layer" verbatim |
| `it distinguishes unit tests as finer-grained coverage written by the same agent` | "finer-grained" AND "same agent" |
| `it does not elevate unit test status above BDD scenarios` | Negative: no "primary" or "main" proof language for unit tests |
| `the enabled-unit-test loop follows this structure:` (DataTable) | Each row's phase+activity present in content |
| `the disabled-unit-test loop follows this structure:` (DataTable) | Each row's phase+activity present in content |
| `the vertical slicing instruction covers both step definitions and unit tests` | "vertical" section mentions "unit test" |
| `it warns against writing all unit tests first then all implementation` | "all unit tests first" or WRONG example includes unit tests |

### Step 5: Verify wording alignment

Before running tests, manually verify that every assertion string in step definitions matches exact wording present in the enhanced SKILL.md. Key alignment points:
- "independent proof layer" must appear verbatim in SKILL.md
- "finer-grained coverage" and "same agent" must appear verbatim
- "only when both pass" must appear verbatim
- "before implementation" and "test-first" must appear
- "Only BDD scenarios drive the TDD loop" must appear verbatim
- "treat as disabled" must appear for absent = disabled equivalence
- DataTable activity strings ("Write step definition + unit test", "Implement code to pass both scenario and unit test", etc.) must appear verbatim in the loop structure summaries
- "Do NOT write all unit tests first" or equivalent must appear

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — All 12 @adw-308 scenarios pass (0 failures, 0 undefined)
2. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` — Existing implement_tdd scenarios still pass
3. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — All regression scenarios pass (includes @adw-308 @regression tagged scenarios)
4. `bun run lint` — No lint errors
5. `bunx tsc --noEmit` — No type errors
6. `bunx tsc --noEmit -p adws/tsconfig.json` — ADW type check passes

## Patch Scope
**Lines of code to change:** ~230 (SKILL.md ~80 lines rewrite/addition, step defs ~150 lines new file)
**Risk level:** low
**Testing required:** BDD scenario runs for @adw-308, @adw-304-implement-tdd, and @regression tags; lint and type checks
