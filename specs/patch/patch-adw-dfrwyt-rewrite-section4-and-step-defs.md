# Patch: Rewrite SKILL.md Section 4 and implement all @adw-308 step definitions

## Metadata
adwId: `dfrwyt-unit-test-support-in`
reviewChangeRequest: `Issue #3: @adw-308 scenarios all FAILED (exit code 1). The scenario proof shows every scenario has undefined steps marked with 'U'. Zero scenarios pass. This means acceptance criteria '@adw-308 tagged scenarios pass' is not met.`

## Issue Summary
**Original Spec:** `specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md`
**Issue:** All 13 @adw-308 scenarios fail because (a) SKILL.md Section 4 lacks the detailed content the scenarios assert against, and (b) 24 step definitions are undefined.
**Solution:** Rewrite SKILL.md Section 4 with comprehensive unit test integration into the TDD loop, update Section 3 vertical slicing to mention unit tests, and create all missing step definitions in a new file `features/step_definitions/implementTddUnitTestSteps.ts`.

## Files to Modify

- `.claude/skills/implement-tdd/SKILL.md` — Rewrite Section 4 ("Unit Tests - Conditional") with comprehensive TDD loop integration; update Section 3 vertical slicing to mention unit tests.
- `features/step_definitions/implementTddUnitTestSteps.ts` — **New file.** All step definitions for `@adw-308` scenarios.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Rewrite SKILL.md Section 4 ("Unit Tests - Conditional")

Replace the current minimal Section 4 (lines 63-67) with this content:

```markdown
### 4. Unit Tests (Conditional)

Check `.adw/project.md` for the `## Unit Tests` setting before entering the TDD loop.

**When unit tests are enabled:**

Read `.adw/commands.md` `## Run Tests` for the project's unit test runner command.

In the RED phase, write a unit test alongside the step definition for each scenario. Unit tests are written before implementation code (test-first) as part of the vertical slice for each scenario — not as a separate batch. Follow [tests.md](tests.md) for guidance on writing good unit tests (test behavior through public interfaces, not implementation details). Follow [mocking.md](mocking.md) for guidance on mocking in unit tests (mock at system boundaries only).

In the GREEN phase, implementation is considered GREEN only when both the BDD scenario and unit tests pass. Verify that both pass before moving to REFACTOR.

In the REFACTOR phase, ensure both the BDD scenario and unit tests remain green after each refactoring step.

BDD scenarios are the independent proof layer — they were written by a separate agent and verify behavior independently. Unit tests provide finer-grained coverage written by the same agent as the implementation. Do not elevate unit test status above BDD scenarios.

**When unit tests are disabled or the `## Unit Tests` section is absent from `.adw/project.md`:**

Skip unit tests entirely. Only BDD scenarios drive the TDD loop in this case. The behavior when the section is absent is identical to when unit tests are disabled.
```

### Step 2: Update Section 3 vertical slicing to mention unit tests

Replace the existing vertical slicing paragraph in Section 3 (line 29):
```
**Vertical slicing only.** Do NOT write all step definitions first and then all implementation. Work one scenario at a time.
```
With:
```
**Vertical slicing only.** Do NOT write all step definitions first and then all implementation. When unit tests are enabled, do NOT write all unit tests first then all implementation. Work one scenario at a time — step definition, unit test (if enabled), then implementation.
```

### Step 3: Create step definitions file `features/step_definitions/implementTddUnitTestSteps.ts`

Create a new step definitions file with all 24 undefined steps. Each step definition asserts against `sharedCtx.fileContent` (the SKILL.md content loaded by the Background Given step).

Import pattern: `{ When, Then }` from `@cucumber/cucumber`, `assert` from `assert`, `sharedCtx` from `./commonSteps.ts`.

**When steps** (3 no-op context steps — content already in sharedCtx):
- `When('the content is inspected for the red-green-refactor loop instructions', ...)`
- `When('the content is inspected for the GREEN phase instructions', ...)`
- `When('the content is inspected for unit test instructions', ...)`

**Then steps** (21 assertion steps):

| Step pattern | Asserts `sharedCtx.fileContent` contains |
|---|---|
| `it contains instructions to check {string} for the {string} setting` | Both param strings present in content |
| `the check happens before or during the TDD loop, not after` | `## Unit Tests` appears before `### 5.` (Verification Frequency) |
| `the RED phase includes writing unit tests alongside step definitions when unit tests are enabled` | Content contains "RED" and "unit test" and "step definition" |
| `unit tests are written before implementation code (test-first)` | "before implementation" present |
| `unit tests are written as part of the vertical slice for each scenario` | "vertical slice for each scenario" present |
| `there is no separate post-loop section for writing all unit tests at once` | No batch unit test section after Section 4 |
| `the GREEN phase verifies that both the BDD scenario and unit tests pass` | GREEN phase mentions both BDD scenario and unit tests passing |
| `implementation is considered GREEN only when both pass` | "only when both" present |
| `it describes skipping unit tests when the {string} setting is {string}` | "skip" or "Skip" + setting value present |
| `only BDD scenarios drive the TDD loop in this case` | "Only BDD scenarios drive the TDD loop" present |
| `it describes skipping unit tests when the {string} section is absent from {string}` | "absent" + skip language present |
| `the behavior is identical to when unit tests are disabled` | "identical" present |
| `it references {string} for guidance on writing good unit tests` | Param string + "unit test" present |
| `it references {string} for guidance on mocking in unit tests` | Param string + "mocking" present |
| `it describes BDD scenarios as the independent proof layer` | "independent proof layer" present |
| `it distinguishes unit tests as finer-grained coverage written by the same agent` | "finer-grained coverage" and "same agent" present |
| `it does not elevate unit test status above BDD scenarios` | "Do not elevate" or "not elevate" present |
| `the enabled-unit-test loop follows this structure:` (DataTable) | For each row: phase keyword + activity keywords present |
| `the disabled-unit-test loop follows this structure:` (DataTable) | For each row: phase keyword + activity keywords present; no unit test mention in disabled phases |
| `the vertical slicing instruction covers both step definitions and unit tests` | Vertical slicing text mentions both "step definition" and "unit test" |
| `it warns against writing all unit tests first then all implementation` | Warning text about "all unit tests first" present |

### Step 4: Run @adw-308 scenarios and fix assertion mismatches

Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` and fix any assertion failures by adjusting either SKILL.md wording or step definition assertion patterns until all 13 scenarios pass.

### Step 5: Verify regression scenarios

Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` to confirm zero regressions in existing scenarios.

## Validation
Execute every command to validate the patch is complete with zero regressions.

1. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — All 13 @adw-308 scenarios must pass (0 undefined, 0 failures)
2. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` — Existing implement_tdd scenarios still pass
3. `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — All regression scenarios pass (zero regressions)
4. `bun run lint` — No lint errors
5. `bunx tsc --noEmit` — Type check passes
6. `bunx tsc --noEmit -p adws/tsconfig.json` — adws type check passes
7. `bun run build` — Build succeeds

## Patch Scope
**Lines of code to change:** ~230 (SKILL.md ~50 lines rewritten/added, step definitions ~180 lines new)
**Risk level:** low — prompt-only change to SKILL.md plus new step definitions; no TypeScript runtime changes
**Testing required:** BDD scenarios @adw-308, @adw-304-implement-tdd, @regression; lint; type check; build
