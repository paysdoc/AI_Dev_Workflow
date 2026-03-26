# Patch: Rewrite SKILL.md Section 3+4 for unit test TDD integration and create step definitions

## Metadata
adwId: `dfrwyt-unit-test-support-in`
reviewChangeRequest: `specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md`

## Issue Summary
**Original Spec:** specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md
**Issue:** SKILL.md Section 4 ("Unit Tests - Conditional") was NOT modified — `git diff origin/dev` shows zero changes to `.claude/skills/implement-tdd/SKILL.md`. The primary acceptance criteria — enhancing the unit test conditional instructions to integrate into the red-green-refactor loop — is unimplemented. Additionally, all 12 @adw-308 scenarios fail because 24 step definitions are undefined.
**Solution:** (1) Enhance SKILL.md Section 3 with conditional unit test mentions in each phase. (2) Rewrite SKILL.md Section 4 with comprehensive unit test workflow integrated into the TDD loop. (3) Create step definitions for all undefined @adw-308 steps.

## Files to Modify
Use these files to implement the patch:

- `.claude/skills/implement-tdd/SKILL.md` — Enhance Section 3 (RED/GREEN/REFACTOR phases + vertical slicing example) and rewrite Section 4 with comprehensive unit test workflow
- `features/step_definitions/implementTddUnitTestSteps.ts` — **New file.** Step definitions for all 12 @adw-308 scenarios

Read-only references (do NOT modify):
- `.claude/skills/implement-tdd/tests.md` — Referenced by SKILL.md for test quality guidance
- `.claude/skills/implement-tdd/mocking.md` — Referenced by SKILL.md for mocking guidance
- `features/implement_tdd_unit_test_support.feature` — The 12 @adw-308 scenarios that must pass
- `features/step_definitions/implementTddSkillSteps.ts` — Existing step def patterns to follow
- `features/step_definitions/commonSteps.ts` — Provides `sharedCtx` with `.fileContent`
- `guidelines/coding_guidelines.md` — Coding guidelines

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Read reference files

Read these files to understand the context:
- `.claude/skills/implement-tdd/SKILL.md` — current content to modify
- `features/implement_tdd_unit_test_support.feature` — scenarios that define what the step defs must assert
- `features/step_definitions/implementTddSkillSteps.ts` — existing step def patterns
- `features/step_definitions/commonSteps.ts` — `sharedCtx` interface
- `.claude/skills/implement-tdd/tests.md` and `mocking.md` — referenced quality guidance files
- `guidelines/coding_guidelines.md`

### Step 2: Enhance SKILL.md Section 3 — Add conditional unit test mentions

In Section 3 "Red-Green-Refactor Loop", make these targeted additions:

**2a. Vertical slicing code block** — After the existing `RIGHT (vertical)` example, add a unit-test-enabled variant:

```
RIGHT (vertical, unit tests enabled):
  RED → GREEN: step1 + unit-test1 → impl1
  RED → GREEN: step2 + unit-test2 → impl2
  ...
```

Add a warning: "Do NOT write all unit tests first then all implementation — this is horizontal slicing."

**2b. RED phase** — After "Write the step definitions needed for this scenario", add a paragraph:
> When unit tests are enabled (see Section 4), also write a unit test for the function/module being introduced — test-first, before implementation code. The unit test is part of the vertical slice for this scenario.

**2c. GREEN phase** — After "Write the minimal code needed to make this scenario pass", add:
> When unit tests are enabled, implementation must also pass the unit test. The scenario is only GREEN when both the BDD scenario and the unit test pass.

**2d. REFACTOR phase** — After "Run the scenario after each refactor step to stay GREEN", add:
> When unit tests are enabled, also run unit tests after refactoring to keep both green.

### Step 3: Rewrite SKILL.md Section 4 — Comprehensive unit test workflow

Replace the current Section 4 content (lines 63-67 of SKILL.md) with this expanded section:

```markdown
### 4. Unit Tests (Conditional)

Check `.adw/project.md` for the `## Unit Tests` section before starting the TDD loop. Also read `.adw/commands.md` `## Run Tests` to learn the project's unit test runner command.

**When unit tests are enabled:**

Unit tests are a first-class part of the red-green-refactor loop, integrated per-scenario (not batched after all scenarios):

- **RED phase**: For each scenario, write a unit test alongside the step definition — before writing implementation code (test-first). The unit test targets the specific function or module being introduced in this scenario. Follow [tests.md](tests.md) for good vs bad test patterns: test behavior through public interfaces, not implementation details. Follow [mocking.md](mocking.md) for mocking guidance: mock only at system boundaries (external APIs, databases), never mock your own classes or internal collaborators.
- **GREEN phase**: Implementation must pass both the BDD scenario AND the unit test. A scenario is only GREEN when both pass.
- **REFACTOR phase**: After refactoring, verify both the BDD scenario and unit tests still pass.

BDD scenarios are the **independent proof layer** — they were written by a separate agent and verify behavior independently. Unit tests provide finer-grained coverage but are written by the same agent as the implementation, so they carry accommodation risk. Do not elevate unit test status above BDD scenarios.

**When unit tests are disabled or the section is absent:** skip unit tests entirely. Only BDD scenarios drive the TDD loop. The behavior is identical whether the setting is explicitly "disabled" or the `## Unit Tests` section is absent from `.adw/project.md`.
```

### Step 4: Create step definitions file

Create `features/step_definitions/implementTddUnitTestSteps.ts` with all 24 unique step definitions for the 12 @adw-308 scenarios. All steps inspect `sharedCtx.fileContent` (SKILL.md is loaded by the Background step). Follow `implementTddSkillSteps.ts` assertion style.

**When steps (3, no-op — content already loaded by Background):**
1. `When('the content is inspected for the red-green-refactor loop instructions', ...)` — no-op, content already in `sharedCtx.fileContent`
2. `When('the content is inspected for the GREEN phase instructions', ...)` — no-op
3. `When('the content is inspected for unit test instructions', ...)` — no-op

**Then steps (21, assert against `sharedCtx.fileContent`):**
4. `it contains instructions to check {string} for the {string} setting` — assert content includes both the file path and setting heading
5. `the check happens before or during the TDD loop, not after` — assert `Unit Tests` section index < `Verification Frequency` section index
6. `the RED phase includes writing unit tests alongside step definitions when unit tests are enabled` — assert RED section mentions both "unit test" and "step definition"
7. `unit tests are written before implementation code (test-first)` — assert "before" + "implementation" or "test-first"
8. `unit tests are written as part of the vertical slice for each scenario` — assert "vertical" and "unit test" co-occur
9. `there is no separate post-loop section for writing all unit tests at once` — negative assert: no batch-after-loop instruction
10. `the GREEN phase verifies that both the BDD scenario and unit tests pass` — assert GREEN + both + pass
11. `implementation is considered GREEN only when both pass` — assert "only" + "GREEN" + "both pass"
12. `it describes skipping unit tests when the {string} setting is {string}` — assert skip/disabled language
13. `only BDD scenarios drive the TDD loop in this case` — assert "only BDD scenarios"
14. `it describes skipping unit tests when the {string} section is absent from {string}` — assert absent case
15. `the behavior is identical to when unit tests are disabled` — assert absent = disabled treated identically
16. `it references {string} for guidance on writing good unit tests` — assert file referenced in unit test context
17. `it references {string} for guidance on mocking in unit tests` — assert file referenced in mocking context
18. `it describes BDD scenarios as the independent proof layer` — assert "independent proof layer"
19. `it distinguishes unit tests as finer-grained coverage written by the same agent` — assert "finer-grained" or "same agent"
20. `it does not elevate unit test status above BDD scenarios` — assert "Do not elevate" or equivalent
21. `the enabled-unit-test loop follows this structure:` (DataTable) — validate each row: RED has "unit test", GREEN has "both", REFACTOR has "both green"
22. `the disabled-unit-test loop follows this structure:` (DataTable) — validate standard loop without unit test requirement
23. `the vertical slicing instruction covers both step definitions and unit tests` — assert vertical slicing mentions unit tests
24. `it warns against writing all unit tests first then all implementation` — assert WRONG example or explicit warning about batching

### Step 5: Run validation

Run all validation commands to confirm the patch resolves the issue with zero regressions.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — All 12 @adw-308 scenarios must pass (previously all Undefined)
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` — Existing implement_tdd scenarios still pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — All regression scenarios pass (includes 8 new @adw-308 @regression scenarios)
- `bun run lint` — Linter passes
- `bunx tsc --noEmit` — Type check passes
- `bunx tsc --noEmit -p adws/tsconfig.json` — adws type check passes

## Patch Scope
**Lines of code to change:** ~50 lines modified/added in SKILL.md (Section 3 enhancements + Section 4 rewrite), ~200 lines in new step definitions file
**Risk level:** low
**Testing required:** BDD scenarios tagged @adw-308 verify SKILL.md content through step definitions; @regression and @adw-304-implement-tdd ensure no regressions. This is a prompt-only change to SKILL.md — no TypeScript runtime code changes.
