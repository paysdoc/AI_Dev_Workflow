# Patch: Enhance SKILL.md Section 4 with unit test TDD loop integration

## Metadata
adwId: `dfrwyt-unit-test-support-in`
reviewChangeRequest: `Issue #1: SKILL.md Section 4 was not enhanced. The spec requires rewriting Section 4 to integrate unit tests as a first-class part of the TDD loop (RED: write step def + unit test, GREEN: pass both, REFACTOR: keep both green), add test framework awareness via .adw/commands.md, reference tests.md and mocking.md, and include an independence reminder. None of this was done — the file is unchanged from the baseline. Resolution: Implement Task 2 from the spec: enhance SKILL.md Section 4 with the complete unit test workflow, test framework awareness, quality references, and independence reminder. Also integrate conditional unit test mentions into Section 3's red-green-refactor loop description.`

## Issue Summary
**Original Spec:** `specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md`
**Issue:** SKILL.md Section 4 ("Unit Tests - Conditional", lines 63-67) is minimal — it checks `.adw/project.md` for the `## Unit Tests` setting but only says "write Vitest/Jest unit tests for any non-trivial logic" without integrating unit tests into the red-green-refactor loop. Missing: RED phase expansion (write unit test + step def together), GREEN phase expansion (both must pass), test framework awareness (`.adw/commands.md` `## Run Tests`), quality references in unit test context, vertical slicing for unit tests, and BDD independence reminder. Section 3 has no conditional unit test references.
**Solution:** Rewrite Section 4 to provide prescriptive unit test workflow instructions covering all 9 requirements from the spec. Add brief conditional unit test notes to Section 3's RED/GREEN/REFACTOR phases. This is a prompt-only change (SKILL.md markdown) — no runtime TypeScript code changes. Step definitions for the `@adw-308` BDD scenarios are handled by companion patch `patch-adw-dfrwyt-unit-test-support-in-step-definitions.md`.

## Files to Modify

- `.claude/skills/implement-tdd/SKILL.md` — Rewrite Section 4 (lines 63-67) and add conditional notes to Section 3 RED/GREEN/REFACTOR phases (lines 44-57)

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Rewrite SKILL.md Section 4 — Unit Tests (Conditional)

Replace the current Section 4 content (lines 63-67):

```md
### 4. Unit Tests (Conditional)

Check `.adw/project.md` for the `## Unit Tests` section:
- If unit tests are **enabled**: write Vitest/Jest unit tests for any non-trivial logic introduced, following the guidelines in [tests.md](tests.md) and [mocking.md](mocking.md). The BDD scenario remains the independent proof layer.
- If unit tests are **disabled** or the section is absent: skip unit tests entirely.
```

With expanded content that addresses all 9 requirements from the spec. The new Section 4 must contain:

1. **Setting check**: Instruct the agent to check `.adw/project.md` for the `## Unit Tests` setting. This check happens before or during the TDD loop (Section 4 is numbered before Section 5, satisfying the positional requirement).

2. **When disabled or absent**: Skip unit tests entirely — only BDD scenarios drive the TDD loop. Explicitly state that absent is treated identically to disabled.

3. **When enabled — RED phase integration**: Write a unit test alongside the step definition for each scenario during the RED phase. Unit tests are written **before implementation** (test-first). They target the specific function/module being introduced. Written per-scenario as part of the vertical slice — NOT as a separate batch after the loop. Reference [tests.md](tests.md) for guidance on writing good unit tests (test behavior through public interfaces).

4. **When enabled — GREEN phase integration**: Implementation must pass **both** the BDD scenario AND the unit test. Only considered GREEN when both pass.

5. **When enabled — REFACTOR**: Clean up while keeping both the scenario and unit test green.

6. **Test framework awareness**: Read `.adw/commands.md` `## Run Tests` for the project's unit test runner command. Do not hard-code a framework — use whatever the project specifies.

7. **Quality references**: Reference [mocking.md](mocking.md) for mocking guidance — mock at system boundaries only, not internal collaborators.

8. **Independence reminder**: BDD scenarios are the **independent proof layer** — written by a separate agent, they verify behavior independently. Unit tests provide **finer-grained** supplementary coverage but are written by the **same build agent** as the implementation. Unit tests do NOT replace or elevate above BDD scenarios.

9. **Vertical slicing enforcement**: Unit tests follow the same vertical slicing principle as step definitions — write per-scenario, not batched. Warn against writing all unit tests first then all implementation (mirror the existing WRONG/RIGHT pattern from Section 3).

### Step 2: Add conditional unit test notes to Section 3 loop phases

Add brief conditional notes to the Section 3 RED/GREEN/REFACTOR sub-sections. These are cross-references to Section 4, not full duplications:

- **RED phase** (after line 45 "Write the step definitions needed for this scenario"): Add a bullet noting that when unit tests are enabled (see Section 4), also write a unit test targeting the logic being introduced

- **GREEN phase** (after line 50 "Write the minimal code needed to make this scenario pass"): Add a bullet noting that when unit tests are enabled, the unit test must also pass

- **REFACTOR phase** (after line 56 "Run the scenario after each refactor step to stay GREEN"): Add a bullet noting that when unit tests are enabled, run unit tests too to keep both green

Keep these additions minimal (one bullet each). Section 4 has the full details.

## Validation
Execute every command to validate the patch is complete with zero regressions.

**Note:** BDD scenario validation requires the companion step definitions patch (`patch-adw-dfrwyt-unit-test-support-in-step-definitions.md`) to be applied first. Without step definitions, scenarios will report "undefined" steps.

- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — All 13 new scenarios pass (requires companion step definitions patch)
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` — Existing implement_tdd scenarios still pass (regression check)
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — All regression scenarios pass
- `bun run lint` — No lint errors
- `bunx tsc --noEmit` — Type check passes
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check adws project passes
- `bun run build` — Build succeeds

## Patch Scope
**Lines of code to change:** ~60-80 (Section 4: ~50-60 lines replacing 5 lines; Section 3: ~6 lines added across 3 sub-sections)
**Risk level:** low
**Testing required:** BDD scenarios tagged `@adw-308`, `@adw-304-implement-tdd`, and `@regression` must all pass. This is a prompt-only change (SKILL.md markdown). No runtime TypeScript code changes. Depends on companion patch for step definitions.
