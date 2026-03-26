# Unit Test Support in /implement_tdd

**ADW ID:** 6w7p98-unit-test-support-in
**Date:** 2026-03-26
**Specification:** specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md

## Overview

Extends the `/implement_tdd` skill (SKILL.md Section 4) to integrate unit tests as a first-class part of the red-green-refactor loop when `## Unit Tests: enabled` is set in `.adw/project.md`. When unit tests are enabled, the build agent writes unit tests test-first alongside step definitions in the RED phase, then verifies both unit tests and BDD scenarios pass in the GREEN phase. When disabled or absent, only BDD scenarios drive the TDD loop — behavior is unchanged.

## What Was Built

- **SKILL.md Section 4 "Unit Tests (Conditional)"** — comprehensive unit test workflow integration into the TDD loop, replacing a minimal placeholder with prescriptive phase-by-phase instructions
- **Dual-mode TDD tables** — enabled vs disabled loop structure shown as markdown tables so the build agent has unambiguous per-phase guidance
- **Quality references** — explicit inline references to `tests.md` and `mocking.md` within Section 4 (not just Section 7), ensuring the agent follows established patterns when writing unit tests
- **Vertical slicing enforcement** — instruction that unit tests follow the same per-scenario vertical slice principle as step definitions (no batching)
- **Independence reminder** — BDD scenarios are the independent proof layer; unit tests supplement but do not replace them
- **Feature file** `features/implement_tdd_unit_test_support.feature` — 12 `@adw-308` scenarios verifying all acceptance criteria, 8 of which are also tagged `@regression`
- **Step definitions** `features/step_definitions/implementTddUnitTestSteps.ts` — 20+ step definition implementations covering all new scenario steps

## Technical Implementation

### Files Modified

- `.claude/skills/implement-tdd/SKILL.md`: New skill file (124 lines). Section 4 provides the conditional unit test workflow; Section 3 describes the core red-green-refactor loop; Section 6 documents available mock test infrastructure.
- `features/implement_tdd_unit_test_support.feature`: New BDD feature file with 8 `@regression` scenarios and 4 additional `@adw-308` scenarios covering the full acceptance criteria.
- `features/step_definitions/implementTddUnitTestSteps.ts`: New step definitions (324 lines) with content-assertion helpers reading from `sharedCtx.fileContent` (populated by the Background step).

### Key Changes

- **Section 4 conditional check**: `if unit tests disabled or absent → skip entirely`, `if enabled → integrate into each scenario's RED/GREEN/REFACTOR cycle` — both branches are explicit and unambiguous.
- **RED phase expansion**: When enabled, RED = write step definition + write unit test (before any implementation code). Follows `tests.md` for test quality and `mocking.md` for boundary-only mocking.
- **GREEN phase gate**: Implementation is only GREEN when both the BDD scenario AND the unit test pass — not one or the other.
- **REFACTOR phase**: Applies to both passing conditions; build agent must keep both green after cleanup.
- **No batching**: Explicit warning: "Do NOT write all unit tests first then all implementation" — mirrors the existing vertical slicing principle for step definitions.

## How to Use

### For target repo operators

1. Add `## Unit Tests: enabled` to your repo's `.adw/project.md`.
2. Ensure `.adw/commands.md` has a `## Run Tests` section with the unit test runner command (e.g. `bun run test` or `npx jest`).
3. Run `/implement_tdd` as usual — the build agent will now write unit tests during the TDD loop.

### For target repos with unit tests disabled (default)

No change needed. If `## Unit Tests` is absent or set to `disabled`, the skill behaves exactly as before — only BDD scenarios drive the loop.

### Verifying the skill behavior

```bash
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

## Configuration

| Setting in `.adw/project.md` | Behavior |
|---|---|
| `## Unit Tests: enabled` | Unit tests written test-first in RED; both must pass in GREEN |
| `## Unit Tests: disabled` | Unit tests skipped; only BDD scenarios drive TDD loop |
| Section absent | Same as disabled (default) |

The unit test runner command is read from `.adw/commands.md` `## Run Tests` — the skill does not hard-code a framework (supports Vitest, Jest, or any runner).

## Testing

```bash
# Run new @adw-308 scenarios
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"

# Verify no regressions in existing implement_tdd skill scenarios
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"

# Full regression suite
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"

# Type check
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json
```

## Notes

- This is a prompt-only change — no TypeScript runtime code was modified. The `parseUnitTestsEnabled()` function and `testPhase.ts` already handle runtime behavior correctly.
- The ADW project itself has `## Unit Tests: disabled` in `.adw/project.md`, so this feature only activates in target repos that opt in.
- SKILL.md has `target: true` in its frontmatter, so it is deployed to target repos during `adw_init`.
- BDD scenarios remain the independent proof layer because they are written by a separate agent (scenario_writer). Unit tests carry accommodation risk since they are written by the same build agent as implementation — this is acknowledged explicitly in SKILL.md.
- `tests.md` and `mocking.md` were referenced in Section 7 ("Design Guidance") prior to this change. Section 4 now adds specific inline references in the context of unit test writing.
