# Feature: Create /implement_tdd skill with core TDD workflow

## Metadata
issueNumber: `304`
adwId: `78f2zu-create-implement-tdd`
issueJson: `{"number":304,"title":"Create /implement_tdd skill with core TDD workflow","body":"## Parent PRD\n\n`specs/prd/tdd-bdd-integration.md`\n\n## What to build\n\nCreate a new `/implement_tdd` skill in `.claude/skills/implement-tdd/` that serves as an autonomous TDD meta-prompt for the build agent. Same pattern as `/implement` (shapes how the agent works; the plan content shapes what it builds), but instructs the agent to follow red-green-refactor using BDD scenarios as RED tests.\n\nThe skill:\n- Has `target: true` in SKILL.md frontmatter so it gets copied to target repos during `adw_init`\n- Contains `SKILL.md` with the autonomous TDD build workflow\n- Copies the existing TDD reference files (`tests.md`, `mocking.md`, `interface-design.md`, `deep-modules.md`, `refactoring.md`) into the skill directory so they travel with `target: true`\n- Reads `.feature` files tagged `@adw-{issueNumber}` as RED tests\n- Instructs the build agent to: for each behavior/task, write/complete the step definition (RED), verify it fails, implement code (GREEN), verify it passes, refactor if needed\n- Includes test harness awareness so step definitions can use the mock infrastructure\n- Lets the agent decide verification frequency based on plan task structure\n- Does NOT ask for user approval (the plan serves as the specification)\n- Reports completed work with `git diff --stat`\n\nSee PRD section: \"New `/implement_tdd` skill\" for full details.\n\n## Acceptance criteria\n\n- [ ] `.claude/skills/implement-tdd/SKILL.md` exists with `target: true` frontmatter\n- [ ] SKILL.md contains autonomous TDD workflow: read plan + scenarios, red-green-refactor loop, report results\n- [ ] TDD reference files (tests.md, mocking.md, interface-design.md, deep-modules.md, refactoring.md) are present in the skill directory\n- [ ] The skill instructs vertical slicing (one test → one implementation → repeat), explicitly warns against horizontal slicing\n- [ ] The skill references test harness infrastructure for step definitions needing runtime support\n- [ ] The skill does not include interactive approval steps\n- [ ] The skill can be invoked manually via `/implement_tdd` with a plan + scenarios and produces a working implementation\n\n## Blocked by\n\nNone - can start immediately\n\n## User stories addressed\n\n- User story 1\n- User story 2\n- User story 6\n- User story 7\n- User story 13\n- User story 14","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-25T13:48:50Z","comments":[],"actionableComment":null}`

## Feature Description
Create a new `/implement_tdd` skill that serves as an autonomous TDD meta-prompt for the ADW build agent. This is the autonomous counterpart to the existing interactive `/tdd` skill — same red-green-refactor philosophy, but driven by the plan (not user prompts) and BDD scenarios as RED tests.

The skill lives in `.claude/skills/implement-tdd/` with `target: true` so it gets copied to target repos during `adw_init`. It bundles the existing TDD reference files (`tests.md`, `mocking.md`, `interface-design.md`, `deep-modules.md`, `refactoring.md`) so they travel with the skill.

The core workflow: read the plan and `.feature` files tagged `@adw-{issueNumber}`, then for each behavior/task, write or complete the step definition (RED), verify it fails, implement code (GREEN), verify it passes, refactor if needed. The agent decides verification frequency based on the plan's task structure.

## User Story
As an ADW operator
I want the build agent to follow a TDD red-green-refactor loop using BDD scenarios as RED tests
So that behavioral drift is caught during build rather than in a separate test phase, and step definitions are generated incrementally rather than requiring a separate phase

## Problem Statement
The current `/implement` command is a straight "read plan, write code" flow with no intermediate verification against BDD scenarios. Tests only run after the entire implementation is complete, meaning behavioral drift isn't caught until late in the pipeline. Additionally, the separate step definition generation phase costs extra tokens and removes the most valuable scenarios (those requiring runtime infrastructure) as "ungeneratable."

## Solution Statement
Create a new `/implement_tdd` skill that instructs the build agent to follow the TDD red-green-refactor cycle, using BDD scenarios as RED tests. The agent generates step definitions incrementally during its TDD loop, eliminating the need for a separate step definition phase. The skill includes references to the test harness infrastructure so that scenarios requiring mock GitHub API, Claude CLI stub, git remote mock, or fixture repos are handled properly rather than being discarded.

## Relevant Files
Use these files to implement the feature:

- `.claude/skills/tdd/SKILL.md` — The existing interactive TDD skill. Used as a reference for TDD philosophy, anti-patterns, and workflow structure. The new skill adapts this for autonomous operation.
- `.claude/skills/tdd/tests.md` — TDD reference: good vs. bad test examples. Must be copied to the new skill directory.
- `.claude/skills/tdd/mocking.md` — TDD reference: when/how to mock at system boundaries. Must be copied to the new skill directory.
- `.claude/skills/tdd/interface-design.md` — TDD reference: designing interfaces for testability. Must be copied to the new skill directory.
- `.claude/skills/tdd/deep-modules.md` — TDD reference: small interface + deep implementation concept. Must be copied to the new skill directory.
- `.claude/skills/tdd/refactoring.md` — TDD reference: refactor candidates after TDD cycle. Must be copied to the new skill directory.
- `.claude/commands/implement.md` — The current implement command. Used as a structural reference for how the plan is passed as `$ARGUMENTS` and how reporting works with `git diff --stat`.
- `specs/prd/tdd-bdd-integration.md` — The parent PRD containing the full specification for the `/implement_tdd` skill, including workflow details, test harness awareness, and unit test conditional logic.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow during implementation.
- `app_docs/feature-sgud8b-copy-target-skills-adw-init.md` — Documents the `target: true` frontmatter convention and how skills get copied during `adw_init`. Confirms that entire skill directories (all files) are copied when `SKILL.md` has `target: true`.
- `app_docs/feature-lnef5d-mock-infrastructure-layer.md` — Documents the test harness (mock GitHub API, Claude CLI stub, git remote mock, fixture repos). The skill must reference this infrastructure for step definitions needing runtime support.
- `.adw/scenarios.md` — BDD scenario configuration showing the scenario directory (`features/`) and how to run scenarios by tag.

### New Files
- `.claude/skills/implement-tdd/SKILL.md` — The autonomous TDD build workflow skill. Main deliverable.
- `.claude/skills/implement-tdd/tests.md` — Copy of `.claude/skills/tdd/tests.md`
- `.claude/skills/implement-tdd/mocking.md` — Copy of `.claude/skills/tdd/mocking.md`
- `.claude/skills/implement-tdd/interface-design.md` — Copy of `.claude/skills/tdd/interface-design.md`
- `.claude/skills/implement-tdd/deep-modules.md` — Copy of `.claude/skills/tdd/deep-modules.md`
- `.claude/skills/implement-tdd/refactoring.md` — Copy of `.claude/skills/tdd/refactoring.md`

## Implementation Plan
### Phase 1: Foundation
Copy the five TDD reference files from `.claude/skills/tdd/` to `.claude/skills/implement-tdd/`. These files are unchanged — they serve as on-demand references that the skill can load when needed. The copy ensures they travel with the `target: true` skill during `adw_init`.

### Phase 2: Core Implementation
Author `.claude/skills/implement-tdd/SKILL.md` with `target: true` frontmatter. The skill body is a meta-prompt template that instructs the build agent to:
1. Read the plan (passed as `$ARGUMENTS`) and discover `.feature` files tagged `@adw-{issueNumber}`.
2. Follow a vertical-slice TDD loop: for each plan task, write/complete the step definition (RED), verify it fails, implement code (GREEN), verify it passes, refactor if warranted.
3. When `## Unit Tests: enabled` in `.adw/project.md`, also write unit tests before implementing each behavior.
4. Reference the test harness infrastructure (mock GitHub API, Claude CLI stub, git remote mock, fixture repos) when step definitions need runtime support.
5. Decide verification frequency based on the plan's step-by-step task structure.
6. Report completed work with `git diff --stat`.

The skill explicitly warns against horizontal slicing (writing all tests first, then all code) and does NOT include interactive approval steps — the plan serves as the specification.

### Phase 3: Integration
Verify the skill integrates with the existing skill infrastructure:
- `parseFrontmatterTarget()` in `adws/phases/worktreeSetup.ts` recognizes `target: true` and copies the entire skill directory during `adw_init`.
- The skill can be invoked manually via `/implement_tdd` with a plan as input.
- Lint and type checks pass with no regressions.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1: Copy TDD reference files to new skill directory
- Create the directory `.claude/skills/implement-tdd/`
- Copy `.claude/skills/tdd/tests.md` to `.claude/skills/implement-tdd/tests.md` (unchanged)
- Copy `.claude/skills/tdd/mocking.md` to `.claude/skills/implement-tdd/mocking.md` (unchanged)
- Copy `.claude/skills/tdd/interface-design.md` to `.claude/skills/implement-tdd/interface-design.md` (unchanged)
- Copy `.claude/skills/tdd/deep-modules.md` to `.claude/skills/implement-tdd/deep-modules.md` (unchanged)
- Copy `.claude/skills/tdd/refactoring.md` to `.claude/skills/implement-tdd/refactoring.md` (unchanged)

### Step 2: Create SKILL.md with autonomous TDD workflow
- Create `.claude/skills/implement-tdd/SKILL.md`
- Add YAML frontmatter with `name: implement-tdd`, `description:` (describing autonomous TDD build), and `target: true`
- Write the skill body as a meta-prompt template with the following sections:

**Inputs section:**
- Plan content is passed as `$ARGUMENTS`
- Instructions to discover `.feature` files tagged `@adw-{issueNumber}` in the scenario directory
- Instructions to read `.adw/project.md` to check `## Unit Tests: enabled/disabled`
- Instructions to read `.adw/commands.md` for the scenario run command (`## Run Scenarios by Tag`) and `.adw/scenarios.md` for scenario directory

**Anti-Pattern Warning (Horizontal Slicing):**
- Explicit, prominent warning against horizontal slicing (writing all tests first, then all code)
- Direct the agent to use vertical slicing: one test → one implementation → repeat
- Include the visual diagram from the existing `/tdd` SKILL.md showing WRONG (horizontal) vs RIGHT (vertical)

**TDD Loop section (core workflow):**
- For each step-by-step task in the plan:
  1. Identify which BDD scenario(s) cover this task
  2. **RED**: Write or complete the Cucumber step definition for the scenario. Run the scenario to verify it fails (expected: undefined/pending steps or assertion failures)
  3. **GREEN**: Implement the minimal code to make the scenario pass. Run the scenario again to verify it passes
  4. **REFACTOR**: Look for refactor candidates (reference [refactoring.md](refactoring.md)). Run scenarios after each refactor to ensure no regressions
- When `## Unit Tests: enabled`, also write a unit test before implementing each behavior (BDD scenario remains the independent proof layer)
- Agent decides when to run scenarios: can batch verification after related tasks or run per-task based on plan structure

**Test Harness Awareness section:**
- Reference the available test infrastructure for step definitions needing runtime support:
  - Mock GitHub API server (`test/mocks/github-api-server.ts`) — for scenarios involving GitHub API calls
  - Claude CLI stub (`test/mocks/claude-cli-stub.ts`) — for scenarios involving Claude Code CLI interactions
  - Git remote mock (`test/mocks/git-remote-mock.ts`) — for scenarios involving git operations
  - Fixture repo setup (`test/fixtures/cli-tool/`) — for scenarios needing a real git-initialized working directory
  - Test harness (`test/mocks/test-harness.ts`) — orchestrates all mock infrastructure
- Instruct the agent: do NOT classify any scenario as "ungeneratable" — the test harness provides the mock infrastructure for runtime-dependent scenarios

**TDD Reference Files section:**
- Point to bundled reference files with guidance on when to consult each:
  - [tests.md](tests.md) — good vs. bad test examples (consult when writing assertions)
  - [mocking.md](mocking.md) — when/how to mock (consult when step definitions touch external services)
  - [interface-design.md](interface-design.md) — designing for testability (consult when creating new interfaces)
  - [deep-modules.md](deep-modules.md) — small interface + deep implementation (consult during refactor phase)
  - [refactoring.md](refactoring.md) — refactor candidates (consult after GREEN phase)

**Instructions section:**
- Read the plan and implement it following the TDD loop above
- Only read the files listed in the plan's `## Relevant Files` section (same constraint as `/implement`)
- Do NOT ask for user approval at any point — the plan is the specification
- If a scenario cannot be made to pass and the plan doesn't address it, flag it with a comment in the code and move on

**Report section:**
- Summarize the work done in a concise bullet point list
- For each behavior: note whether RED→GREEN succeeded or if issues were flagged
- Report the files and total lines changed with `git diff --stat`

### Step 3: Run validation commands
- Run `bun run lint` to verify no lint errors
- Run `bun run build` to verify no build errors
- Run `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` for type checks
- Verify the new skill directory contains all 6 files (SKILL.md + 5 reference files)
- Verify `SKILL.md` frontmatter contains `target: true`

## Testing Strategy

### Edge Cases
- The skill must work when no `.feature` files tagged `@adw-{issueNumber}` exist (agent should proceed with plan implementation without TDD loop, similar to `/implement`)
- The skill must handle `## Unit Tests: disabled` correctly (skip unit test writing)
- The skill must handle `## Unit Tests: enabled` correctly (write unit tests alongside step definitions)
- The skill must handle plans with no `## Step by Step Tasks` section gracefully
- The skill must work in target repos where test harness paths (`test/mocks/`) don't exist (step definitions should use whatever infrastructure is available)

## Acceptance Criteria
- [ ] `.claude/skills/implement-tdd/SKILL.md` exists with `target: true` in YAML frontmatter
- [ ] SKILL.md contains the autonomous TDD workflow: read plan + scenarios, red-green-refactor loop, report results
- [ ] TDD reference files (`tests.md`, `mocking.md`, `interface-design.md`, `deep-modules.md`, `refactoring.md`) are present in `.claude/skills/implement-tdd/`
- [ ] The skill instructs vertical slicing (one test → one implementation → repeat) and explicitly warns against horizontal slicing
- [ ] The skill references test harness infrastructure for step definitions needing runtime support
- [ ] The skill does not include interactive approval steps (no user confirmation prompts)
- [ ] The skill reports completed work with `git diff --stat`
- [ ] `bun run lint` passes with no new errors
- [ ] `bun run build` passes with no new errors
- [ ] `bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json` pass

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `ls -la .claude/skills/implement-tdd/` — Verify all 6 files exist (SKILL.md, tests.md, mocking.md, interface-design.md, deep-modules.md, refactoring.md)
- `head -5 .claude/skills/implement-tdd/SKILL.md` — Verify `target: true` appears in YAML frontmatter
- `grep -c 'target: true' .claude/skills/implement-tdd/SKILL.md` — Verify exactly one `target: true` in frontmatter
- `grep -c 'horizontal' .claude/skills/implement-tdd/SKILL.md` — Verify the anti-pattern warning about horizontal slicing exists
- `grep -c 'vertical' .claude/skills/implement-tdd/SKILL.md` — Verify vertical slicing instructions exist
- `grep -c 'test-harness\|github-api-server\|claude-cli-stub\|git-remote-mock' .claude/skills/implement-tdd/SKILL.md` — Verify test harness references exist
- `grep -c 'approval\|confirm\|ask the user' .claude/skills/implement-tdd/SKILL.md` — Should be 0 (no interactive approval steps)
- `diff .claude/skills/tdd/tests.md .claude/skills/implement-tdd/tests.md` — Verify reference file is identical copy
- `diff .claude/skills/tdd/mocking.md .claude/skills/implement-tdd/mocking.md` — Verify reference file is identical copy
- `diff .claude/skills/tdd/interface-design.md .claude/skills/implement-tdd/interface-design.md` — Verify reference file is identical copy
- `diff .claude/skills/tdd/deep-modules.md .claude/skills/implement-tdd/deep-modules.md` — Verify reference file is identical copy
- `diff .claude/skills/tdd/refactoring.md .claude/skills/implement-tdd/refactoring.md` — Verify reference file is identical copy
- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors
- `bunx tsc --noEmit` — Type check main project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check adws project

## Notes
- This issue is scoped to creating the `/implement_tdd` skill only. Orchestrator pipeline changes (routing in `buildAgent.ts`, alignment phase, step def phase removal) are separate issues per the PRD.
- The five TDD reference files are identical copies from `.claude/skills/tdd/`. They are duplicated (not symlinked) because the `copyDirContents()` function in `worktreeSetup.ts` copies files, and both skill directories need to be self-contained for `target: true` copying.
- The `copyDirContents()` helper is flat (files only, no subdirectory recursion), so the new skill directory should contain only files, no nested subdirectories.
- The existing interactive `/tdd` skill remains unchanged. `/implement_tdd` is a separate, autonomous skill.
- When eventually wired into the build agent (separate issue), the plan will be passed as `$ARGUMENTS` — same pattern as `/implement`.
- Follow `guidelines/coding_guidelines.md` throughout implementation.
