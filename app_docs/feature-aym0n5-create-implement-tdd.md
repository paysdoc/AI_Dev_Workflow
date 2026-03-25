# /implement_tdd Skill — Autonomous TDD Build Agent

**ADW ID:** aym0n5-create-implement-tdd
**Date:** 2026-03-25
**Specification:** specs/issue-304-adw-78f2zu-create-implement-tdd-sdlc_planner-implement-tdd-skill.md

## Overview

The `/implement_tdd` skill is an autonomous TDD meta-prompt for the ADW build agent. It extends the existing `/implement` pattern with a red-green-refactor loop, using BDD scenarios tagged `@adw-{issueNumber}` as RED tests. Unlike the interactive `/tdd` skill, this skill is fully autonomous — the plan drives what gets built; no user approval steps are included.

## What Was Built

- **`.claude/skills/implement-tdd/SKILL.md`** — Core deliverable: the autonomous TDD build workflow meta-prompt with `target: true` frontmatter
- **Five TDD reference files** copied from `.claude/skills/tdd/` into the new skill directory so they travel with the skill during `adw_init`:
  - `tests.md` — good vs. bad test examples
  - `mocking.md` — when/how to mock at system boundaries
  - `interface-design.md` — designing interfaces for testability
  - `deep-modules.md` — small interface + deep implementation concept
  - `refactoring.md` — refactor candidates after TDD cycle
- **`features/implement_tdd_skill.feature`** — BDD scenarios (`@adw-304-implement-tdd`) verifying all acceptance criteria
- **`features/step_definitions/implementTddSkillSteps.ts`** — Cucumber step definitions for the feature scenarios

## Technical Implementation

### Files Modified

- `.claude/skills/implement-tdd/SKILL.md`: New file — autonomous TDD build workflow with `target: true`, vertical-slicing instructions, test harness awareness, conditional unit test logic, and `$ARGUMENTS`-based plan input
- `.claude/skills/implement-tdd/tests.md`: Copied from `.claude/skills/tdd/tests.md` (unchanged)
- `.claude/skills/implement-tdd/mocking.md`: Copied from `.claude/skills/tdd/mocking.md` (unchanged)
- `.claude/skills/implement-tdd/interface-design.md`: Copied from `.claude/skills/tdd/interface-design.md` (unchanged)
- `.claude/skills/implement-tdd/deep-modules.md`: Copied from `.claude/skills/tdd/deep-modules.md` (unchanged)
- `.claude/skills/implement-tdd/refactoring.md`: Copied from `.claude/skills/tdd/refactoring.md` (unchanged)
- `features/implement_tdd_skill.feature`: BDD scenarios verifying the skill's structure and content
- `features/step_definitions/implementTddSkillSteps.ts`: Step definitions for the above scenarios

### Key Changes

- **`target: true` frontmatter** in `SKILL.md` ensures the entire skill directory (all 6 files) is copied to target repos by `copyTargetSkillsAndCommands()` during `adw_init`
- **Vertical-slicing enforcement**: SKILL.md contains explicit WRONG/RIGHT diagram warning against horizontal slicing (write all tests then all code); mandates one scenario → one implementation at a time
- **Test harness awareness**: SKILL.md references all five mock infrastructure components (`test/mocks/github-api-server.ts`, `claude-cli-stub.ts`, `git-remote-mock.ts`, `test-harness.ts`, `test/fixtures/cli-tool/`) so no scenario is classified as "ungeneratable"
- **Conditional unit tests**: SKILL.md reads `.adw/project.md` for `## Unit Tests` enabled/disabled flag before deciding whether to write Vitest unit tests alongside step definitions
- **Plan as specification**: `$ARGUMENTS` receives the plan content; no interactive approval steps exist in the workflow

## How to Use

1. Invoke the skill manually via `/implement_tdd` with a plan as input:
   ```
   /implement_tdd <paste plan content here>
   ```
2. The skill reads the plan and discovers `.feature` files tagged `@adw-{issueNumber}` in the `features/` directory
3. For each scenario (in order), the agent follows red-green-refactor:
   - **RED**: Write/complete the Cucumber step definition, run the scenario to confirm it fails
   - **GREEN**: Implement minimal code to make the scenario pass, run to confirm
   - **REFACTOR**: Check for duplication and shallow modules, run scenarios after each refactor
4. When all scenarios are green, the agent reports completed work with `git diff --stat`

When the skill is wired into the build agent orchestrator (separate issue), the plan will be passed automatically as `$ARGUMENTS` — same pattern as `/implement`.

## Configuration

- **`target: true`** in `SKILL.md` frontmatter: required for the skill to be copied to target repos during `adw_init`. Verified by `parseFrontmatterTarget()` in `adws/phases/worktreeSetup.ts`.
- **`.adw/project.md` `## Unit Tests`**: set to `enabled` or `disabled` in the target repo to control whether the skill writes Vitest unit tests alongside step definitions.
- **`.adw/scenarios.md`**: provides the scenario directory and run-by-tag command. The skill reads this at startup.
- **`.adw/commands.md` `## Run Scenarios by Tag`**: the exact command used to verify RED/GREEN state for each scenario.

## Testing

Run the BDD scenarios for this feature:

```bash
bunx cucumber-js --tags "@adw-304-implement-tdd"
```

Run only the regression subset:

```bash
bunx cucumber-js --tags "@adw-304-implement-tdd and @regression"
```

Validate acceptance criteria manually:

```bash
ls -la .claude/skills/implement-tdd/
head -5 .claude/skills/implement-tdd/SKILL.md
grep -c 'target: true' .claude/skills/implement-tdd/SKILL.md
grep -c 'horizontal' .claude/skills/implement-tdd/SKILL.md
grep -c 'vertical' .claude/skills/implement-tdd/SKILL.md
```

## Notes

- This issue creates the skill only. Orchestrator changes (routing in `buildAgent.ts`, alignment phase, removal of the separate step definition phase) are tracked in separate issues per the PRD (`specs/prd/tdd-bdd-integration.md`).
- The five TDD reference files are **duplicated** (not symlinked) from `.claude/skills/tdd/` because `copyDirContents()` in `worktreeSetup.ts` is flat (files only, no subdirectory recursion). Both skill directories must be self-contained.
- The existing interactive `/tdd` skill is unchanged. `/implement_tdd` is a separate, autonomous skill intended for pipeline use.
- If no `.feature` files tagged `@adw-{issueNumber}` exist in the target repo, the skill falls back to plain plan implementation (same behavior as `/implement`).
