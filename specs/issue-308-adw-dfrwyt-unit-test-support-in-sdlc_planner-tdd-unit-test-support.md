# Feature: Unit test support in /implement_tdd when enabled in project config

## Metadata
issueNumber: `308`
adwId: `dfrwyt-unit-test-support-in`
issueJson: `{"number":308,"title":"Unit test support in /implement_tdd when enabled in project config","body":"## Parent PRD\n\n`specs/prd/tdd-bdd-integration.md`\n\n## What to build\n\nExtend the `/implement_tdd` skill to support projects with `## Unit Tests: enabled` in `.adw/project.md`. When unit tests are enabled, the build agent writes unit tests during the TDD loop alongside step definitions.\n\nThe workflow becomes:\n1. For each behavior/task: write unit test + step definition (RED)\n2. Implement code (GREEN)\n3. Verify both unit test and scenario pass\n4. Refactor\n\nBDD scenarios remain the independent proof layer — they were written by a separate agent and verify behavior independently. Unit tests provide finer-grained coverage but are written by the same agent as the implementation, so they carry the accommodation risk that the review phase independence check (issue #307) mitigates.\n\nWhen `## Unit Tests: disabled` or absent, behavior is unchanged — only BDD scenarios drive the TDD loop.\n\nSee PRD sections: \"New `/implement_tdd` skill\" (point 3) and the broader solution description for context on the dual-layer testing model.\n\n## Acceptance criteria\n\n- [ ] `/implement_tdd` SKILL.md reads `## Unit Tests` setting from `.adw/project.md`\n- [ ] When enabled, the build agent writes unit tests during the TDD loop\n- [ ] When disabled or absent, only BDD scenarios drive the TDD loop (no unit tests written)\n- [ ] Unit tests are written before implementation (test-first) alongside step definitions\n- [ ] The skill references `tests.md` and `mocking.md` for unit test quality guidance\n- [ ] Existing BDD regression scenarios continue to pass\n\n## Blocked by\n\n- Blocked by #304 (Create `/implement_tdd` skill)\n\n## User stories addressed\n\n- User story 10","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-25T13:49:42Z","comments":[{"author":"paysdoc","createdAt":"2026-03-25T21:57:20Z","body":"## Take action"}],"actionableComment":null}`

## Feature Description
Extend the `/implement_tdd` skill's conditional unit test support (Section 4 of SKILL.md) to provide comprehensive, test-first unit test instructions when `## Unit Tests: enabled` is set in `.adw/project.md`. Currently, Section 4 contains minimal conditional instructions — it tells the agent to check `.adw/project.md` and write unit tests when enabled, but lacks the detailed workflow integration that makes unit tests a first-class citizen in the red-green-refactor loop alongside step definitions.

When unit tests are enabled, the build agent should write a unit test **before** implementation (test-first), run it to confirm RED, implement code to pass both the unit test and the BDD scenario, then verify both pass. The skill must reference `tests.md` and `mocking.md` for quality guidance so that unit tests follow the established patterns (test behavior through public interfaces, mock only at system boundaries).

When `## Unit Tests: disabled` or absent, behavior is unchanged — only BDD scenarios drive the TDD loop.

## User Story
As an ADW operator running a project with `## Unit Tests: enabled`
I want the `/implement_tdd` build agent to write unit tests during the TDD loop alongside step definitions
So that I get finer-grained test coverage while BDD scenarios remain the independent proof layer

## Problem Statement
The current `/implement_tdd` SKILL.md Section 4 ("Unit Tests - Conditional") is a minimal afterthought that checks `.adw/project.md` but doesn't integrate unit test writing into the core red-green-refactor loop. The instructions say "write Vitest/Jest unit tests for any non-trivial logic introduced" but don't specify:
- **When** in the loop to write them (before or after implementation)
- **How** they fit with step definitions (write unit test alongside step def in the RED phase)
- **What** verification looks like when both unit tests and scenarios must pass
- **How** to read the project-specific test framework configuration from `.adw/commands.md`

This means when unit tests are enabled, the build agent lacks the prescriptive workflow guidance it has for BDD scenarios, resulting in inconsistent behavior.

## Solution Statement
Enhance SKILL.md Section 4 to integrate unit tests as a first-class part of the TDD loop when enabled:

1. **RED phase expansion**: When unit tests are enabled, the RED phase writes both a step definition AND a unit test before implementation. The unit test targets the specific function/module being introduced, following `tests.md` guidance.
2. **GREEN phase expansion**: Implementation must pass both the BDD scenario AND the unit test.
3. **Test framework awareness**: The skill reads `.adw/commands.md` `## Run Tests` command for the project's unit test runner.
4. **Quality references**: Explicit references to `tests.md` (good vs bad test patterns) and `mocking.md` (mock at boundaries only) guide unit test quality.
5. **Independence reminder**: The skill reminds that BDD scenarios are the independent proof layer; unit tests are supplementary coverage written by the same agent as implementation.

## Relevant Files
Use these files to implement the feature:

- `.claude/skills/implement-tdd/SKILL.md` — The main file to modify. Section 4 ("Unit Tests - Conditional") needs enhancement to integrate unit tests into the red-green-refactor loop.
- `.claude/skills/implement-tdd/tests.md` — Already exists. Contains good vs bad test examples. SKILL.md must reference this for unit test quality guidance when enabled.
- `.claude/skills/implement-tdd/mocking.md` — Already exists. Contains mocking strategy. SKILL.md must reference this for unit test mocking guidance when enabled.
- `adws/core/projectConfig.ts` — Contains `parseUnitTestsEnabled()` function. Read-only reference to understand how the setting is parsed.
- `features/implement_tdd_skill.feature` — Existing BDD scenarios for issue #304. The unit test conditional scenario (line 87-93) is already present but only has the `@adw-304-implement-tdd` tag (not `@regression`). New scenarios for issue #308 should be added.
- `features/step_definitions/implementTddSkillSteps.ts` — Existing step definitions for the implement_tdd scenarios. New step definitions may be needed for new scenarios.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow during implementation.
- `.adw/commands.md` — Contains project-specific commands including `## Run Tests` for unit test execution.
- `app_docs/feature-aym0n5-create-implement-tdd.md` — Documentation for the original `/implement_tdd` skill creation (read-only reference).
- `specs/prd/tdd-bdd-integration.md` — Parent PRD. Section on "New `/implement_tdd` skill" point 3 describes the unit test integration requirement.

### New Files
- `features/implement_tdd_unit_test_support.feature` — New BDD feature file with `@adw-308` tagged scenarios verifying the enhanced unit test support in SKILL.md.

## Implementation Plan
### Phase 1: Foundation
Read and understand the current SKILL.md structure, particularly Section 4 ("Unit Tests - Conditional") and the red-green-refactor loop in Section 3. Understand how step definitions and BDD scenarios integrate into the loop so that unit tests can follow the same pattern. Read `tests.md` and `mocking.md` to understand the quality guidance that unit tests should reference.

### Phase 2: Core Implementation
Enhance SKILL.md Section 4 to provide comprehensive unit test instructions when enabled:

1. **Expand the conditional block** to describe the full unit test workflow integrated into the red-green-refactor loop:
   - RED: Write step definition + unit test (when enabled)
   - GREEN: Implement to pass both scenario and unit test
   - REFACTOR: Ensure both still pass after refactoring
2. **Add test framework awareness**: Instruct the agent to read `.adw/commands.md` `## Run Tests` for the unit test runner command.
3. **Add explicit references** to `tests.md` and `mocking.md` for unit test quality guidance (these files are already referenced in Section 7, but Section 4 should also reference them specifically for unit test guidance).
4. **Add independence reminder**: Note that BDD scenarios are the independent proof layer; unit tests are supplementary.

### Phase 3: Integration
Write BDD scenarios in a new feature file to verify the enhanced SKILL.md content. Ensure existing `@regression` scenarios from issue #304 continue to pass. Add step definitions for any new scenario steps not covered by existing step definitions.

## Step by Step Tasks

### Task 1: Read and understand current state
- Read `.claude/skills/implement-tdd/SKILL.md` fully
- Read `.claude/skills/implement-tdd/tests.md` and `mocking.md`
- Read `features/implement_tdd_skill.feature` and `features/step_definitions/implementTddSkillSteps.ts`
- Read `adws/core/projectConfig.ts` to understand `parseUnitTestsEnabled()`
- Read `.adw/commands.md` for project-specific test commands
- Read `guidelines/coding_guidelines.md`

### Task 2: Enhance SKILL.md Section 4 — Unit Tests (Conditional)
- Rewrite Section 4 to provide a complete unit test workflow when enabled:
  - Instruct the agent to read `.adw/commands.md` `## Run Tests` for the unit test runner
  - Describe writing unit tests BEFORE implementation (test-first) alongside step definitions in the RED phase
  - Reference [tests.md](tests.md) for good vs bad test patterns when writing unit tests
  - Reference [mocking.md](mocking.md) for mocking guidance (mock at system boundaries only)
  - Explain that both the unit test AND the BDD scenario must pass in the GREEN phase
  - Remind that BDD scenarios are the independent proof layer; unit tests supplement coverage
  - Keep the "disabled or absent → skip entirely" path unchanged
- Integrate unit test mentions into the Section 3 red-green-refactor loop description where appropriate, noting that the unit test step is conditional on the `## Unit Tests` setting

### Task 3: Create BDD feature file for issue #308
- Create `features/implement_tdd_unit_test_support.feature` with `@adw-308` tag
- Write scenarios verifying:
  - SKILL.md instructs reading `.adw/project.md` for `## Unit Tests` setting
  - SKILL.md describes writing unit tests before implementation (test-first) when enabled
  - SKILL.md describes skipping unit tests when disabled or absent
  - SKILL.md references `tests.md` for unit test quality when enabled
  - SKILL.md references `mocking.md` for unit test mocking when enabled
  - SKILL.md instructs reading `.adw/commands.md` `## Run Tests` for unit test runner when enabled
  - SKILL.md describes verifying both unit tests and BDD scenarios pass in GREEN phase
  - SKILL.md describes BDD scenarios as the independent proof layer
- Tag key regression scenarios with both `@adw-308` and `@regression`

### Task 4: Write step definitions for new scenarios
- Add step definitions in `features/step_definitions/` for any new steps not covered by existing `implementTddSkillSteps.ts`
- Reuse existing steps where possible (e.g., "the file ... is read", "the content is inspected")
- Ensure new steps follow existing patterns in the step definitions directory

### Task 5: Run validation commands
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` to verify new scenarios pass
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` to verify no regressions
- Run `bun run lint` to check code quality
- Run `bunx tsc --noEmit` to verify type safety
- Run `bun run build` to verify no build errors

## Testing Strategy

### Edge Cases
- `.adw/project.md` contains `## Unit Tests: enabled` (inline colon format) — unit test workflow should activate
- `.adw/project.md` contains `## Unit Tests` heading with body `enabled` — unit test workflow should activate
- `.adw/project.md` contains `## Unit Tests: disabled` — unit tests skipped entirely
- `.adw/project.md` has no `## Unit Tests` section — unit tests skipped (disabled is default)
- `.adw/commands.md` has `## Run Tests: N/A` — the skill should still reference `## Run Tests` generically; the "N/A" handling is the agent's responsibility at runtime
- Target repo uses Jest instead of Vitest — the skill should say "Vitest/Jest" or refer to whatever `## Run Tests` specifies, not hard-code a framework

## Acceptance Criteria
- [ ] SKILL.md Section 4 reads `## Unit Tests` setting from `.adw/project.md`
- [ ] When enabled, SKILL.md instructs writing unit tests BEFORE implementation (test-first) alongside step definitions in the RED phase
- [ ] When disabled or absent, SKILL.md instructs skipping unit tests entirely — only BDD scenarios drive the TDD loop
- [ ] SKILL.md references `tests.md` for unit test quality guidance when enabled
- [ ] SKILL.md references `mocking.md` for unit test mocking guidance when enabled
- [ ] SKILL.md instructs reading `.adw/commands.md` `## Run Tests` for the project's unit test runner
- [ ] SKILL.md describes verifying both unit tests and BDD scenarios pass in the GREEN phase
- [ ] SKILL.md reminds that BDD scenarios are the independent proof layer
- [ ] BDD scenarios tagged `@adw-308` pass
- [ ] Existing `@regression` BDD scenarios continue to pass

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-308"` — Run new scenarios for this issue
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-304-implement-tdd"` — Verify existing implement_tdd scenarios still pass
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run all regression scenarios to verify zero regressions
- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors
- `bunx tsc --noEmit` — Type check main project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check adws project

## Notes
- The `guidelines/coding_guidelines.md` must be followed. Specifically, the testing note: "BDD scenarios are ADW's validation mechanism. Unit tests remain available as an opt-in for target repos configured via `.adw/project.md`." This aligns with the feature's approach — unit tests are opt-in per project.
- The existing Section 4 already contains the basic conditional check; this task deepens it with prescriptive workflow instructions.
- The `tests.md` and `mocking.md` files are already referenced in Section 7 ("Design Guidance") of SKILL.md. Section 4 should add specific references in the context of unit test writing.
- This is a prompt-only change (modifying SKILL.md markdown). No TypeScript runtime code needs to change — the `parseUnitTestsEnabled()` function and `testPhase.ts` already handle the runtime behavior correctly.
- The `.adw/project.md` for the ADW project itself has `## Unit Tests: disabled`, so this feature only affects target repos that opt in. The skill already has `target: true` so it gets deployed to target repos during `adw_init`.
