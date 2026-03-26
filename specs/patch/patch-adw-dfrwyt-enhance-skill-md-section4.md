# Patch: Enhance SKILL.md Section 4 with comprehensive unit test workflow

## Metadata
adwId: `dfrwyt-unit-test-support-in`
reviewChangeRequest: `Issue #2: SKILL.md Section 4 was NOT modified. The git diff shows zero changes to .claude/skills/implement-tdd/SKILL.md. This is the primary deliverable of issue #308 — enhancing Section 4 ('Unit Tests - Conditional') to integrate unit tests as a first-class part of the red-green-refactor loop with references to tests.md and mocking.md, test framework awareness via .adw/commands.md, and the independence reminder about BDD scenarios.`

## Issue Summary
**Original Spec:** `specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md`
**Issue:** SKILL.md Section 4 ("Unit Tests - Conditional") was not modified. It still contains only the original 3-line minimal check from issue #304. The primary deliverable of #308 is expanding this section to integrate unit tests as a first-class part of the red-green-refactor loop — RED: write step def + unit test, GREEN: pass both, REFACTOR: keep both green — with test framework awareness, quality references, and the BDD independence reminder. Section 3 also needs conditional unit test mentions in its RED/GREEN/REFACTOR phases and vertical slicing example.
**Solution:** Rewrite SKILL.md Section 4 and augment Section 3 to match what the 12 `@adw-308` BDD scenarios assert against. This is a prompt-only change — no TypeScript runtime code.

## Files to Modify
Use these files to implement the patch:

- `.claude/skills/implement-tdd/SKILL.md` — Rewrite Section 4 and augment Section 3 with conditional unit test integration

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Read reference files for context
- Read `.claude/skills/implement-tdd/tests.md` to understand the test quality patterns Section 4 must reference
- Read `.claude/skills/implement-tdd/mocking.md` to understand the mocking guidance Section 4 must reference
- Read `features/implement_tdd_unit_test_support.feature` to understand the exact assertions the 12 scenarios make against SKILL.md content

### Step 2: Augment SKILL.md Section 3 — Add conditional unit test mentions to red-green-refactor loop
In the existing Section 3 ("Red-Green-Refactor Loop"), make these surgical additions:

- **Vertical slicing example**: Update the WRONG/RIGHT example to show unit tests when enabled:
  ```
  WRONG (horizontal):
    RED:   step1 + unit-test1, step2 + unit-test2, step3, step4
    GREEN: impl1, impl2, impl3, impl4

  RIGHT (vertical):
    RED → GREEN: step1 (+ unit-test1 if enabled) → impl1
    RED → GREEN: step2 (+ unit-test2 if enabled) → impl2
    ...
  ```
- **RED phase**: After "Write the step definitions needed for this scenario (or verify they already exist)", add a conditional note: when unit tests are enabled (see Section 4), also write a unit test targeting the function/module being introduced — test-first, before implementation.
- **GREEN phase**: After "Run the scenario to verify it passes", add: when unit tests are enabled, verify both the BDD scenario AND the unit test pass. Implementation is considered GREEN only when both pass.
- **REFACTOR phase**: After "Run the scenario after each refactor step to stay GREEN", add: when unit tests are enabled, ensure both scenario and unit test remain green after refactoring.

Key assertions satisfied by this step:
- "the RED phase includes writing unit tests alongside step definitions when unit tests are enabled"
- "unit tests are written before implementation code (test-first)"
- "unit tests are written as part of the vertical slice for each scenario"
- "the vertical slicing instruction covers both step definitions and unit tests"
- "it warns against writing all unit tests first then all implementation"
- "the GREEN phase verifies that both the BDD scenario and unit tests pass"
- "implementation is considered GREEN only when both pass"
- Enabled/disabled loop structure DataTable assertions
- "there is no separate post-loop section for writing all unit tests at once"

### Step 3: Rewrite SKILL.md Section 4 — Comprehensive unit test workflow
Replace the current minimal Section 4 content with a comprehensive section. The current content is:

```markdown
### 4. Unit Tests (Conditional)

Check `.adw/project.md` for the `## Unit Tests` section:
- If unit tests are **enabled**: write Vitest/Jest unit tests for any non-trivial logic introduced, following the guidelines in [tests.md](tests.md) and [mocking.md](mocking.md). The BDD scenario remains the independent proof layer.
- If unit tests are **disabled** or the section is absent: skip unit tests entirely.
```

Replace with a section that covers:

1. **Setting check** (must appear before/during the loop, not after): "Check `.adw/project.md` for the `## Unit Tests` section." — this satisfies the "it contains instructions to check `.adw/project.md` for the `## Unit Tests` setting" and "the check happens before or during the TDD loop, not after" assertions.

2. **When disabled or absent** — skip unit tests entirely. Only BDD scenarios drive the TDD loop. The absent case is identical to disabled. This satisfies:
   - "it describes skipping unit tests when the `## Unit Tests` setting is `disabled`"
   - "only BDD scenarios drive the TDD loop in this case"
   - "it describes skipping unit tests when the `## Unit Tests` section is absent from `.adw/project.md`"
   - "the behavior is identical to when unit tests are disabled"

3. **When enabled** — full integration into the red-green-refactor loop:
   - **Test framework awareness**: Read `.adw/commands.md` `## Run Tests` for the project's unit test runner command.
   - **RED phase**: Write a unit test BEFORE implementation (test-first) alongside the step definition. The unit test targets the specific function/module being introduced. Follow [tests.md](tests.md) for good vs bad test patterns.
   - **GREEN phase**: Implementation must pass both the BDD scenario AND the unit test. Both must be GREEN before moving on.
   - **REFACTOR phase**: Ensure both scenario and unit test remain green after refactoring.
   - **Mocking**: Follow [mocking.md](mocking.md) — mock at system boundaries only.
   - **Vertical slice**: Unit tests are written as part of the vertical slice for each scenario, not batched separately.

4. **Independence reminder**: BDD scenarios are the independent proof layer — written by a separate agent. Unit tests provide finer-grained coverage but are written by the same agent as the implementation, so they carry accommodation risk. Unit tests are supplementary; they do not replace or elevate above BDD scenarios. This satisfies:
   - "it describes BDD scenarios as the independent proof layer"
   - "it distinguishes unit tests as finer-grained coverage written by the same agent"
   - "it does not elevate unit test status above BDD scenarios"

5. **Quality references**: Reference [tests.md](tests.md) for good vs bad test examples and [mocking.md](mocking.md) for when and how to mock. This satisfies:
   - "it references `tests.md` for guidance on writing good unit tests"
   - "it references `mocking.md` for guidance on mocking in unit tests"

### Step 4: Verify SKILL.md content against scenario assertions
After writing the enhanced SKILL.md, manually verify these key phrases are present in the file:

- `.adw/project.md` and `## Unit Tests` — referenced before `## Report`
- `step definition` and `unit test` in the RED phase context with "before implementation" or "test-first"
- `both` with `pass` or `GREEN` in the GREEN phase context
- `disabled` and `skip` in the disabled path
- `absent` and `skip` (or identical to disabled) in the absent path
- `tests.md` referenced for unit test quality
- `mocking.md` referenced for mocking guidance
- `independent proof layer` for BDD scenarios
- `finer-grained` or `same agent` for unit tests
- `supplementary` or similar — unit tests not elevated above BDD
- Vertical slicing mentions both `step definitions` and `unit tests`
- No post-loop batch instruction for writing all unit tests at once

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `grep -c "Unit Tests" .claude/skills/implement-tdd/SKILL.md` — Verify Section 4 has been expanded (expect multiple matches, not just 2)
- `grep -c "independent proof layer" .claude/skills/implement-tdd/SKILL.md` — Verify independence reminder is present (expect >= 1)
- `grep -c "tests.md" .claude/skills/implement-tdd/SKILL.md` — Verify tests.md reference in Section 4 context (expect >= 2, one in Section 4, one in Section 7)
- `grep -c "mocking.md" .claude/skills/implement-tdd/SKILL.md` — Verify mocking.md reference in Section 4 context (expect >= 2)
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` — Verify existing implement_tdd scenarios still pass (no regression from Section 3/4 changes)
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run all regression scenarios to verify zero regressions
- `bun run lint` — Check code quality
- `bunx tsc --noEmit` — Type check main project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check adws project

## Patch Scope
**Lines of code to change:** ~60-80 lines in SKILL.md (augment Section 3, rewrite Section 4)
**Risk level:** low — prompt-only change, no TypeScript runtime code affected
**Testing required:** Existing `@adw-304-implement-tdd` scenarios still pass, all `@regression` scenarios pass, lint and type checks clean. Full `@adw-308` scenario validation requires step definitions (covered by sibling patch `patch-adw-dfrwyt-implement-all-adw308-step-defs.md`).
