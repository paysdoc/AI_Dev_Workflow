# Feature: Conditional Unit Tests in Plan Templates

## Metadata
issueNumber: `193`
adwId: `jjxkk9-plan-templates-inclu`
issueJson: `{"number":193,"title":"Plan templates include unit tests even when disabled in project config","body":"## Problem\n\nWhen `## Unit Tests: disabled` is set in `.adw/project.md`, the workflow correctly **skips running** unit tests during the test phase (`testPhase.ts`, `adwTest.tsx`). However, the **plan template** (`.claude/commands/feature.md`) always includes a `### Unit Tests` section in its `## Testing Strategy`, regardless of the project config.\n\nThis causes the plan agent to generate a plan that includes unit test tasks. The implement agent then follows the plan and **creates unit test files and code** that will never be executed — wasting tokens and cluttering the codebase.\n\n### Where the config IS checked (correctly)\n- `adws/phases/testPhase.ts` — gates `runUnitTestsWithRetry()` on `parseUnitTestsEnabled()`\n- `adws/adwTest.tsx` — same gate\n\n### Where the config is NOT checked (the gap)\n- `.claude/commands/feature.md` (lines 98-100) — always includes `### Unit Tests` section\n- `adws/agents/planAgent.ts` — does not pass project config to the plan agent\n\n## Solution\n\nConditionally exclude the `### Unit Tests` section from plan templates when unit tests are disabled in `.adw/project.md`.\n\n### Deliverables\n\n#### 1. Make plan templates unit-test-aware\n\nModify `.claude/commands/feature.md` so that the `## Testing Strategy` section conditionally includes or excludes the `### Unit Tests` subsection based on the `## Unit Tests` setting in `.adw/project.md`.\n\n**Approach options (pick the simplest):**\n- Add an instruction in `feature.md` telling the plan agent to read `.adw/project.md` and omit the `### Unit Tests` section if unit tests are disabled\n- Or inject the unit test setting as a variable passed to the command\n\n#### 2. Audit other templates\n\nCheck `bug.md`, `chore.md`, and `patch.md` for similar unit-test references that should also be conditional. Currently only `feature.md` appears affected, but confirm.\n\n#### 3. Tests\n\nAdd or update tests to verify:\n- Plan output omits `### Unit Tests` section when `## Unit Tests: disabled`\n- Plan output includes `### Unit Tests` section when `## Unit Tests: enabled`\n\n## Acceptance Criteria\n\n- [ ] Feature plan template does not include unit test tasks when `## Unit Tests: disabled` in `.adw/project.md`\n- [ ] Feature plan template still includes unit test tasks when `## Unit Tests: enabled`\n- [ ] No unit test files are created during implementation when unit tests are disabled\n- [ ] Other plan templates (`bug.md`, `chore.md`, `patch.md`) are audited and fixed if needed\n- [ ] Existing unit test execution gating in `testPhase.ts` and `adwTest.tsx` remains unchanged\n\n## Dependencies\n\nNone","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-16T11:15:09Z","comments":[],"actionableComment":null}`

## Feature Description
When `## Unit Tests: disabled` is set in `.adw/project.md`, the test phase (`testPhase.ts`, `adwTest.tsx`) correctly skips running unit tests. However, the plan template `.claude/commands/feature.md` always includes a `### Unit Tests` section in its `## Testing Strategy`, regardless of the project config. This causes the plan agent to generate plans with unit test tasks, and the implement agent then creates unit test files and code that will never be executed — wasting tokens and cluttering the codebase.

This feature makes the plan template unit-test-aware by adding a conditional instruction that checks `.adw/project.md` and omits the `### Unit Tests` section when unit tests are disabled. It also audits the other plan templates (`bug.md`, `chore.md`, `patch.md`) for similar references.

## User Story
As an ADW operator
I want plan templates to respect the `## Unit Tests` setting in `.adw/project.md`
So that plans for projects with unit tests disabled do not include unit test tasks, avoiding wasted tokens and codebase clutter from unused test files

## Problem Statement
The plan template `.claude/commands/feature.md` unconditionally includes a `### Unit Tests` section (lines 98-100) in its `## Testing Strategy` output format. The plan agent uses this template to generate implementation plans, and the implement agent faithfully follows the plan — creating unit test files even when the project has disabled unit tests via `## Unit Tests: disabled` in `.adw/project.md`. This creates a gap between the plan phase (which always plans for unit tests) and the test phase (which correctly skips them).

## Solution Statement
Add a conditional instruction in the `feature.md` plan template that tells the plan agent to read `.adw/project.md` and check the `## Unit Tests` setting. When unit tests are disabled (or the setting is absent, since disabled is the default), the `### Unit Tests` section is omitted from the generated plan. When enabled, it remains as-is.

This is the simplest approach because:
- It requires no TypeScript code changes to `planAgent.ts` or any agent files
- The plan agent already has access to `.adw/project.md` through the primed context (via `runPrimedClaudeAgentWithCommand` which runs `/prime` first)
- It follows the existing pattern where slash command templates contain conditional instructions for the agent
- Other templates (`bug.md`, `chore.md`, `patch.md`) do not have a `### Unit Tests` section and require no changes

## Relevant Files
Use these files to implement the feature:

- `.claude/commands/feature.md` — The main plan template that needs modification. Contains the `## Testing Strategy` / `### Unit Tests` section (lines 98-100) that must be made conditional based on `.adw/project.md` settings.
- `.claude/commands/bug.md` — Bug plan template to audit for unit test references. **Audit result: no `### Unit Tests` or `## Testing Strategy` section — no changes needed.**
- `.claude/commands/chore.md` — Chore plan template to audit for unit test references. **Audit result: no `### Unit Tests` or `## Testing Strategy` section — no changes needed.**
- `.claude/commands/patch.md` — Patch plan template to audit for unit test references. **Audit result: no `### Unit Tests` or `## Testing Strategy` section — no changes needed.**
- `adws/core/projectConfig.ts` — Contains `parseUnitTestsEnabled()` function (lines 202-216) that checks the `## Unit Tests` setting. Reference only — no changes needed, but useful context for understanding the expected format.
- `adws/phases/testPhase.ts` — Reference for how the test phase gates unit tests (line 51). No changes needed.
- `adws/adwTest.tsx` — Reference for how the standalone test orchestrator gates unit tests (line 110). No changes needed.
- `adws/agents/planAgent.ts` — Reference for how the plan agent invokes slash commands. No changes needed — the primed agent already has project context.
- `.adw/project.md` — ADW's own project config showing `## Unit Tests: disabled` (line 31). Reference for expected format.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow during implementation.
- `app_docs/feature-the-adw-is-too-speci-tf7slv-generalize-adw-project-config.md` — Documentation on how `.adw/` config works with slash command templates. Reference for the pattern of dynamic injection in templates.
- `app_docs/feature-q9kms5-bdd-scenarios-before-pr.md` — Documentation on `parseUnitTestsEnabled` and the unit test opt-in mechanism. Reference for understanding the expected config format.

## Implementation Plan
### Phase 1: Foundation
No foundational work needed. The `parseUnitTestsEnabled()` function and `.adw/project.md` reading infrastructure already exist. The plan agent already runs with primed context that includes reading `.adw/project.md`.

### Phase 2: Core Implementation
Modify the `## Testing Strategy` section in `.claude/commands/feature.md` to make the `### Unit Tests` subsection conditional:
1. Add a conditional instruction before the `### Unit Tests` section telling the plan agent to check `.adw/project.md` for the `## Unit Tests` setting
2. When `## Unit Tests: disabled` (or absent — disabled is the default), the agent must omit the entire `### Unit Tests` subsection from the plan output
3. When `## Unit Tests: enabled`, the agent includes the `### Unit Tests` subsection as before
4. Also add a conditional instruction in the `## Step by Step Tasks` section to not include unit test creation tasks when unit tests are disabled

### Phase 3: Integration
No integration changes needed. The plan agent (`planAgent.ts`) already passes the slash command to `runPrimedClaudeAgentWithCommand`, which runs `/prime` before executing the command. The primed context includes reading `.adw/project.md`, so the agent has all the information it needs to evaluate the conditional.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Make the `### Unit Tests` section conditional in `feature.md`
- Read `.claude/commands/feature.md`
- Locate the `## Testing Strategy` section in the Plan Format (lines 98-100):
  ```
  ## Testing Strategy
  ### Unit Tests
  <describe unit tests needed for the feature>
  ```
- Replace it with a conditional instruction block:
  ```
  ## Testing Strategy
  ### Unit Tests
  Read `.adw/project.md` from the current working directory. If it contains `## Unit Tests: disabled` or the `## Unit Tests` section is absent, OMIT this entire `### Unit Tests` subsection from the plan. Do not plan any unit test tasks or unit test file creation.
  If `.adw/project.md` contains `## Unit Tests: enabled`, describe the unit tests needed for the feature here.
  ```
- This tells the plan agent to conditionally include/exclude the section based on project config

### Step 2: Add conditional instruction for unit test tasks in `Step by Step Tasks`
- In the same `feature.md` file, locate the `## Step by Step Tasks` section
- Add an instruction after the existing task guidelines telling the agent:
  ```
  IMPORTANT: If `.adw/project.md` contains `## Unit Tests: disabled` or the `## Unit Tests` section is absent, do NOT include any tasks for creating, writing, or running unit tests. Do not create unit test files. Only include unit test tasks when `.adw/project.md` explicitly contains `## Unit Tests: enabled`.
  ```

### Step 3: Verify audit of other templates
- Confirm that `bug.md`, `chore.md`, and `patch.md` do not contain `### Unit Tests` or unit-test-specific sections in their plan formats
- `bug.md` — No `## Testing Strategy` section. No changes needed.
- `chore.md` — No `## Testing Strategy` section. No changes needed.
- `patch.md` — No `## Testing Strategy` section. No changes needed.
- No modifications required for these templates.

### Step 4: Run validation commands
- Execute all validation commands to ensure zero regressions:
  - `bun run lint` — Verify no lint issues introduced
  - `bunx tsc --noEmit` — Verify TypeScript compilation
  - `bunx tsc --noEmit -p adws/tsconfig.json` — Verify ADW TypeScript compilation
  - `bun run test` — Run existing tests to verify no regressions

## Testing Strategy
### Unit Tests
ADW has unit tests disabled (`## Unit Tests: disabled` in `.adw/project.md`). No unit test files should be created for this change. The change is to a markdown template file (`.claude/commands/feature.md`) which contains prompt instructions — not executable code. Validation is performed by:
1. Verifying the template contains the correct conditional instruction by reading the file
2. Verifying the other templates (`bug.md`, `chore.md`, `patch.md`) are not affected
3. Running existing tests to confirm no regressions

### Edge Cases
- `.adw/project.md` does not exist — `parseUnitTestsEnabled` returns `false` (disabled is the default). The plan agent should omit the `### Unit Tests` section.
- `.adw/project.md` exists but has no `## Unit Tests` section — Same as above, disabled is the default. The plan agent should omit the section.
- `## Unit Tests: enabled` — The plan agent should include the `### Unit Tests` section as before.
- `## Unit Tests: disabled` — The plan agent should omit the `### Unit Tests` section.
- `## Unit Tests` heading with body `enabled` — The plan agent should include the `### Unit Tests` section (this is an alternative format supported by `parseUnitTestsEnabled`).

## Acceptance Criteria
- [ ] The `feature.md` plan template `## Testing Strategy / ### Unit Tests` section contains a conditional instruction that checks `.adw/project.md` for the `## Unit Tests` setting
- [ ] When `## Unit Tests: disabled` (or absent), the plan agent is instructed to omit the `### Unit Tests` section entirely
- [ ] When `## Unit Tests: enabled`, the plan agent is instructed to include the `### Unit Tests` section as before
- [ ] The `feature.md` plan template `## Step by Step Tasks` section contains a conditional instruction to not include unit test tasks when disabled
- [ ] `bug.md` does not contain a `### Unit Tests` section (confirmed — no changes needed)
- [ ] `chore.md` does not contain a `### Unit Tests` section (confirmed — no changes needed)
- [ ] `patch.md` does not contain a `### Unit Tests` section (confirmed — no changes needed)
- [ ] Existing unit test execution gating in `testPhase.ts` (line 51) and `adwTest.tsx` (line 110) remains unchanged
- [ ] All validation commands pass with zero regressions

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — TypeScript compilation check
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript compilation check
- `bun run test` — Run tests to validate zero regressions
- Manually verify `.claude/commands/feature.md` contains the conditional instruction around `### Unit Tests`
- Manually verify `.claude/commands/bug.md`, `.claude/commands/chore.md`, `.claude/commands/patch.md` are unchanged

## Notes
- This change only modifies a markdown prompt template (`.claude/commands/feature.md`). No TypeScript source files are changed.
- The plan agent already has access to `.adw/project.md` through the primed context (`runPrimedClaudeAgentWithCommand` runs `/prime` first, which reads `.adw/project.md`). No changes to `planAgent.ts` are needed.
- The `parseUnitTestsEnabled` function in `projectConfig.ts` supports two formats: `## Unit Tests: enabled` (colon-inline) and `## Unit Tests` with body `enabled`. The conditional instruction in the template should reference both formats for clarity.
- The default when `## Unit Tests` is absent is `disabled` (false), matching the behavior of `parseUnitTestsEnabled`.
- Follow coding guidelines in `guidelines/coding_guidelines.md` — particularly the testing guideline: "ADW itself does not use unit tests; BDD scenarios are ADW's validation mechanism."
