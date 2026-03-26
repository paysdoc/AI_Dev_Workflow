# Patch: Add .adw/commands.md reference and Section 3 unit test integration to SKILL.md

## Metadata
adwId: `6w7p98-unit-test-support-in`
reviewChangeRequest: `Issue #2: SKILL.md Section 4 ('Unit Tests - Conditional') was NOT modified. Resolution: Rewrite SKILL.md Section 4 per the spec and integrate conditional unit test mentions into Section 3 loop description.`

## Issue Summary
**Original Spec:** specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md
**Issue:** After the dfrwyt patch rewrote Section 4 with comprehensive unit test workflow, two spec requirements remain unaddressed: (1) Section 4 does not instruct reading `.adw/commands.md` `## Run Tests` for the project's unit test runner, and (2) Section 3's red-green-refactor loop description has zero unit test mentions — the spec requires conditional notes so the agent knows the loop expands when unit tests are enabled.
**Solution:** Add a `.adw/commands.md ## Run Tests` instruction to Section 4, and add brief conditional notes to Section 3's RED/GREEN/REFACTOR phase descriptions referencing Section 4 when unit tests are enabled.

## Files to Modify
Use these files to implement the patch:

- `.claude/skills/implement-tdd/SKILL.md` — Add `.adw/commands.md ## Run Tests` reference in Section 4; add conditional unit test notes in Section 3's RED/GREEN/REFACTOR phases.

## Implementation Steps
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add `.adw/commands.md ## Run Tests` reference to Section 4
- In Section 4, after the conditional check block (line 67: `If unit tests are **enabled**: integrate unit tests...`), add an instruction to read `.adw/commands.md` `## Run Tests` for the project's unit test runner command.
- This should appear before the tables, as a setup instruction: "Read `.adw/commands.md` `## Run Tests` for the project's unit test runner command."
- Also reference this in the GREEN phase description where the agent runs unit tests.

### Step 2: Add conditional unit test notes to Section 3 loop description
- In Section 3's **RED** phase (line 44-47), add a note: "When unit tests are enabled (see Section 4), also write a unit test alongside the step definition."
- In Section 3's **GREEN** phase (line 49-52), add a note: "When unit tests are enabled, both the BDD scenario and unit test must pass."
- In Section 3's **REFACTOR** phase (line 54-57), add a note: "When unit tests are enabled, ensure both the BDD scenario and unit test remain green after refactoring."
- Keep notes brief — a single sentence each. Section 4 has the full details; Section 3 just needs to signal that the loop expands.

## Validation
Execute every command to validate the patch is complete with zero regressions.

- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — All 13 @adw-308 scenarios pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` — Existing implement_tdd scenarios still pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — All regression scenarios pass (zero regressions)
- `bun run lint` — No lint errors
- `bun run build` — Build succeeds

## Patch Scope
**Lines of code to change:** ~10 lines (3-4 lines in Section 3, 2-3 lines in Section 4)
**Risk level:** low
**Testing required:** BDD scenario validation via @adw-308 and @regression tags. This is a prompt-only change (SKILL.md markdown) — no TypeScript runtime code changes.
