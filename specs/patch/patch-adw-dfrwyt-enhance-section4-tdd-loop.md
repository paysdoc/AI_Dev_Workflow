# Patch: Enhance SKILL.md Section 4 with full unit test TDD loop integration

## Metadata
adwId: `dfrwyt-unit-test-support-in`
reviewChangeRequest: `Issue #1: SKILL.md Section 4 was not enhanced — the diff shows zero changes to .claude/skills/implement-tdd/SKILL.md relative to origin/dev. The spec requires expanding Section 4 with detailed unit test workflow instructions (test-first guidance, RED/GREEN phase integration, references to tests.md and mocking.md, independence reminder). None of this was implemented.`

## Issue Summary
**Original Spec:** specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md
**Issue:** SKILL.md Section 4 ("Unit Tests - Conditional") contains only 4 lines of minimal text from issue #304. It checks `.adw/project.md` but does not integrate unit tests into the red-green-refactor loop. The diff against `origin/dev` shows zero changes — none of the spec requirements were implemented.
**Solution:** Rewrite SKILL.md Section 4 to describe the full unit test workflow integrated into the TDD loop. Also add conditional unit test references in Section 3's RED/GREEN/REFACTOR phases so unit tests are a first-class part of the loop when enabled.

## Files to Modify
Use these files to implement the patch:

- `.claude/skills/implement-tdd/SKILL.md` — Rewrite Section 4 and add conditional unit test notes in Section 3

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Read current SKILL.md and reference files
- Read `.claude/skills/implement-tdd/SKILL.md` to understand the current Section 3 and Section 4 structure
- Read `.claude/skills/implement-tdd/tests.md` and `mocking.md` to understand the quality guidance being referenced
- Read `.adw/commands.md` to understand the `## Run Tests` command format

### Step 2: Rewrite Section 4 ("Unit Tests - Conditional")
Replace the current minimal Section 4 (lines 63-67) with a comprehensive section:

```markdown
### 4. Unit Tests (Conditional)

Check `.adw/project.md` for the `## Unit Tests` section. Read `.adw/commands.md` `## Run Tests` for the project's unit test runner command.

- If unit tests are **disabled** or the `## Unit Tests` section is absent: skip unit tests entirely. Only BDD scenarios drive the TDD loop.
- If unit tests are **enabled**: integrate unit tests into the red-green-refactor loop as described below.

**When unit tests are enabled**, the TDD loop expands to include unit tests alongside step definitions:

**RED phase — Write step definition + unit test**
- For each scenario, write the step definition AND a unit test targeting the specific function/module being introduced
- Unit tests must be written BEFORE implementation code (test-first)
- Unit tests are written as part of the vertical slice for each scenario — do NOT batch all unit tests in a separate post-loop section
- Follow [tests.md](tests.md) for good vs bad test patterns: test behavior through public interfaces, not implementation details
- Follow [mocking.md](mocking.md) for mocking guidance: mock only at system boundaries (external APIs, databases), never mock your own classes/modules

**GREEN phase — Pass both scenario and unit test**
- Implementation must pass BOTH the BDD scenario AND the unit test
- The implementation is only considered GREEN when both pass

**REFACTOR phase — Keep both green**
- After refactoring, verify both the BDD scenario and the unit test still pass

**Independence reminder:** BDD scenarios are the independent proof layer — they were written by a separate agent and verify behavior independently. Unit tests provide finer-grained coverage but are written by the same agent as the implementation, so they are supplementary. Do not elevate unit test status above BDD scenarios.
```

### Step 3: Add conditional unit test notes in Section 3
Add brief conditional notes into the existing Section 3 RED/GREEN/REFACTOR phases (lines 44-61) so the loop structure references unit tests when enabled:

- **RED phase** (after "Write the step definitions needed for this scenario"): Add a note: "If unit tests are enabled (see Section 4), also write a unit test for the function/module being introduced"
- **GREEN phase** (after "Write the minimal code needed to make this scenario pass"): Add a note: "If unit tests are enabled, also verify the unit test passes — both must be GREEN"
- **REFACTOR phase** (after "Run the scenario after each refactor step to stay GREEN"): Add a note: "If unit tests are enabled, run both the scenario and unit test after each refactor"

Keep these as brief conditional additions that don't bloat Section 3. The detailed instructions remain in Section 4.

### Step 4: Update the vertical slicing section in Section 3
In the vertical slicing instructions at the top of Section 3 (lines 29-39), extend the WRONG/RIGHT examples to include unit tests:

```
WRONG (horizontal):
  RED:   step1, step2, step3, step4
  GREEN: impl1, impl2, impl3, impl4

WRONG (horizontal — unit tests batched):
  RED:   step1+ut1, step2+ut2, step3+ut3
  GREEN: impl1, impl2, impl3

RIGHT (vertical):
  RED → GREEN: step1 (+ut1 if enabled) → impl1
  RED → GREEN: step2 (+ut2 if enabled) → impl2
  ...
```

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` — Verify existing implement_tdd scenarios still pass (SKILL.md changes must not break #304 scenarios)
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run all regression scenarios to verify zero regressions
- `bun run lint` — Run linter
- `bunx tsc --noEmit` — Type check main project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check adws project
- `bun run build` — Build verification

## Patch Scope
**Lines of code to change:** ~50 lines in SKILL.md (Section 4 rewritten from 4→25 lines, Section 3 gains ~10 lines of conditional notes, vertical slicing gains ~4 lines)
**Risk level:** low — prompt-only change to a markdown skill file, no TypeScript runtime changes
**Testing required:** All @adw-304-implement-tdd scenarios pass, all @regression scenarios pass, lint + typecheck clean
