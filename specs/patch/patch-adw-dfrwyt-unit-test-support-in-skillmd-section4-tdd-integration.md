# Patch: Enhance SKILL.md Section 4 with comprehensive unit test TDD integration

## Metadata
adwId: `dfrwyt-unit-test-support-in`
reviewChangeRequest: `specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md`

## Issue Summary
**Original Spec:** specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md
**Issue:** SKILL.md (`.claude/skills/implement-tdd/SKILL.md`) has zero changes against origin/dev. Section 4 ("Unit Tests - Conditional") still contains the original 3-line minimal content. The spec requires enhancing Section 4 with comprehensive test-first workflow instructions, references to tests.md and mocking.md, GREEN phase dual-verification, test framework awareness via .adw/commands.md, and a BDD-as-independent-proof-layer reminder. Additionally, all 13 @adw-308 BDD scenarios fail because their 26 step definitions are undefined.
**Solution:** (1) Rewrite SKILL.md Section 4 with comprehensive unit test workflow instructions integrated into the red-green-refactor loop. (2) Add conditional unit test mentions to Section 3's RED/GREEN/REFACTOR phases. (3) Implement all 26 undefined step definitions for the @adw-308 scenarios in a new step definitions file.

## Files to Modify
Use these files to implement the patch:

- `.claude/skills/implement-tdd/SKILL.md` — Rewrite Section 4 and add conditional unit test mentions to Section 3's RED/GREEN/REFACTOR phases
- `features/step_definitions/implementTddUnitTestSteps.ts` — **New file.** All 26 undefined step definitions for the @adw-308 scenarios. Separate from existing `implementTddSkillSteps.ts` to keep files focused.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Rewrite SKILL.md Section 4 ("Unit Tests - Conditional")

Replace the current Section 4 content (lines 63-67):
```
### 4. Unit Tests (Conditional)

Check `.adw/project.md` for the `## Unit Tests` section:
- If unit tests are **enabled**: write Vitest/Jest unit tests for any non-trivial logic introduced, following the guidelines in [tests.md](tests.md) and [mocking.md](mocking.md). The BDD scenario remains the independent proof layer.
- If unit tests are **disabled** or the section is absent: skip unit tests entirely.
```

With the following comprehensive content:

```markdown
### 4. Unit Tests (Conditional)

Check `.adw/project.md` for the `## Unit Tests` section before entering the TDD loop.

**When enabled** — unit tests become a first-class part of the red-green-refactor loop:

1. **Test framework**: Read `.adw/commands.md` `## Run Tests` for the project's unit test runner command.
2. **RED phase — write unit test alongside step definition**: For each scenario's vertical slice, write a unit test before implementation (test-first) alongside the step definition. The unit test targets the specific function or module being introduced. Follow [tests.md](tests.md) for good vs bad test patterns. Follow [mocking.md](mocking.md) for mocking guidance — mock at system boundaries only. Write the unit test as part of this scenario's slice, NOT as a separate batch after the loop.
3. **GREEN phase — both must pass**: Implementation is considered GREEN only when both the BDD scenario AND the unit test pass. Run the unit test runner (from `## Run Tests`) alongside the scenario runner. Do not move on until both are green.
4. **REFACTOR phase — keep both green**: After refactoring, verify both the BDD scenario and unit tests still pass.

**When disabled or absent** — skip unit tests entirely. Only BDD scenarios drive the TDD loop. This is the default behavior.

**Independence reminder**: BDD scenarios are the independent proof layer — they were written by a separate agent and verify behavior independently. Unit tests provide finer-grained coverage but are written by the same agent as the implementation, so they are supplementary. Do not elevate unit test status above BDD scenarios.
```

### Step 2: Add conditional unit test mentions to Section 3

Update the Section 3 Red-Green-Refactor loop phases to conditionally mention unit tests:

**RED phase** — after the existing "Write the step definitions needed for this scenario" bullet, add:
```
- If unit tests are enabled (see Section 4), also write a unit test for the function/module this scenario introduces — before writing any implementation
```

**GREEN phase** — after the existing "Write the minimal code needed to make this scenario pass" bullet, add:
```
- If unit tests are enabled, also run the unit test runner — the scenario is not GREEN until both the BDD scenario and unit test pass
```

**REFACTOR phase** — after the existing "Run the scenario after each refactor step to stay GREEN" bullet, add:
```
- If unit tests are enabled, also verify unit tests still pass after each refactor step
```

**Vertical slicing** — update the WRONG/RIGHT diagram section. After the existing "Vertical slicing only." paragraph (line 29), add:
```
When unit tests are enabled, vertical slicing applies to unit tests as well — write the unit test as part of each scenario's slice. Do NOT write all unit tests first then all implementation.
```

### Step 3: Implement all 26 undefined step definitions

Create `features/step_definitions/implementTddUnitTestSteps.ts` with all step definitions needed by the @adw-308 feature file. Each step inspects `sharedCtx.fileContent` (the SKILL.md content loaded by the Background steps).

**When steps (content routing — no-ops, content is already loaded):**
- `When('the content is inspected for the red-green-refactor loop instructions', ...)` — no-op, content already in sharedCtx
- `When('the content is inspected for the GREEN phase instructions', ...)` — no-op
- `When('the content is inspected for unit test instructions', ...)` — no-op

**Then steps — .adw/project.md setting check (scenario lines 21-22):**
- `Then('it contains instructions to check {string} for the {string} setting', ...)` — assert `sharedCtx.fileContent` includes both the file path string and the setting heading string
- `Then('the check happens before or during the TDD loop, not after', ...)` — assert Section 4 heading number (4) is referenced before or during the loop, OR that `.adw/project.md` is mentioned in Section 4 which precedes Section 5+

**Then steps — RED phase / test-first (scenario lines 31-32, 37-38):**
- `Then('the RED phase includes writing unit tests alongside step definitions when unit tests are enabled', ...)` — assert content mentions writing unit test in RED phase alongside step definition
- `Then('unit tests are written before implementation code \\(test-first)', ...)` — assert content mentions writing unit tests before implementation (test-first)
- `Then('unit tests are written as part of the vertical slice for each scenario', ...)` — assert content describes unit tests within each vertical slice, not as a batch
- `Then('there is no separate post-loop section for writing all unit tests at once', ...)` — assert no section that batches all unit tests after the loop

**Then steps — GREEN phase (scenario lines 47-48):**
- `Then('the GREEN phase verifies that both the BDD scenario and unit tests pass', ...)` — assert GREEN phase mentions both BDD scenario and unit test must pass
- `Then('implementation is considered GREEN only when both pass', ...)` — assert "GREEN only when both" or similar phrasing

**Then steps — disabled/absent (scenario lines 57-58, 63-64):**
- `Then('it describes skipping unit tests when the {string} setting is {string}', ...)` — assert content describes skipping unit tests when disabled
- `Then('only BDD scenarios drive the TDD loop in this case', ...)` — assert content says only BDD scenarios drive the loop when disabled
- `Then('it describes skipping unit tests when the {string} section is absent from {string}', ...)` — assert content covers absent case
- `Then('the behavior is identical to when unit tests are disabled', ...)` — assert absent is treated same as disabled (both in same sentence/bullet)

**Then steps — references (scenario lines 73, 78):**
- `Then('it references {string} for guidance on writing good unit tests', ...)` — assert content references tests.md in the unit test section context
- `Then('it references {string} for guidance on mocking in unit tests', ...)` — assert content references mocking.md in the unit test section context

**Then steps — independence (scenario lines 87-89):**
- `Then('it describes BDD scenarios as the independent proof layer', ...)` — assert content includes "independent proof layer"
- `Then('it distinguishes unit tests as finer-grained coverage written by the same agent', ...)` — assert content mentions finer-grained/supplementary + same agent
- `Then('it does not elevate unit test status above BDD scenarios', ...)` — assert content does NOT position unit tests as primary/above BDD

**Then steps — loop structure with DataTable (scenario lines 98-102, 107-111):**
- `Then('the enabled-unit-test loop follows this structure:', ...)` — validate each DataTable row's phase and activity are represented in SKILL.md content (RED has unit test, GREEN has both pass, REFACTOR has both green)
- `Then('the disabled-unit-test loop follows this structure:', ...)` — validate each DataTable row's phase and activity are represented (RED has step definition only, GREEN has scenario only, REFACTOR has scenario green only)

**Then steps — vertical slicing (scenario lines 120-121):**
- `Then('the vertical slicing instruction covers both step definitions and unit tests', ...)` — assert vertical slicing section mentions both step definitions and unit tests
- `Then('it warns against writing all unit tests first then all implementation', ...)` — already exists in `implementTddSkillSteps.ts` line 127-133 but only checks for "WRONG" or "all tests first". Verify this existing step also matches the new SKILL.md content. If it doesn't match, add a duplicate-safe version in the new file.

### Step 4: Run @adw-308 scenarios and fix failures iteratively

Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` and fix any step definition assertion failures by adjusting either the SKILL.md content or the step definition assertions until all 13 scenarios pass.

### Step 5: Run regression scenarios

Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` to verify the existing @adw-304-implement-tdd scenarios and all other regression scenarios still pass with the modified SKILL.md.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — All 13 @adw-308 scenarios pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` — Existing implement_tdd scenarios still pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — All regression scenarios pass
- `bun run lint` — No linting errors
- `bunx tsc --noEmit` — Type check passes
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW type check passes
- `bun run build` — Build succeeds

## Patch Scope
**Lines of code to change:** ~250 (SKILL.md ~80 lines rewritten/added, step definitions ~170 lines in new file)
**Risk level:** low
**Testing required:** BDD scenario validation — all 13 @adw-308 scenarios must pass, all @regression scenarios must continue to pass. This is a prompt-only change (SKILL.md markdown) plus test infrastructure (step definitions) — no runtime TypeScript code changes.
