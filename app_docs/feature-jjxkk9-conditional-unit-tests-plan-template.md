# Conditional Unit Tests in Plan Templates

**ADW ID:** jjxkk9-plan-templates-inclu
**Date:** 2026-03-16
**Specification:** specs/issue-193-adw-jjxkk9-plan-templates-inclu-sdlc_planner-conditional-unit-tests-plan-template.md

## Overview

When `## Unit Tests: disabled` is set in `.adw/project.md`, the test phase already skips unit test execution, but the feature plan template (`.claude/commands/feature.md`) unconditionally generated plans with unit test tasks. This caused the implement agent to create unit test files that would never run, wasting tokens and cluttering the codebase. This feature makes the plan template unit-test-aware by adding conditional instructions that check `.adw/project.md` before including or omitting the `### Unit Tests` section.

## What Was Built

- Conditional instruction in `feature.md` `## Testing Strategy` section that omits `### Unit Tests` when unit tests are disabled or absent
- Conditional guard in `feature.md` `## Step by Step Tasks` section to prevent unit test task generation when disabled
- BDD feature file (`plan_template_unit_tests_conditional.feature`) with 9 scenarios covering the conditional behaviour
- Cucumber step definitions (`planTemplateSteps.ts`) for the new feature scenarios
- Vitest unit tests (`featurePlanTemplate.test.ts`) as the executable equivalent of the 3 `@crucial` BDD scenarios
- Renamed `regressionScenarioProof.ts` → `crucialScenarioProof.ts` and updated `review.md` to use `@crucial` tag terminology consistently

## Technical Implementation

### Files Modified

- `.claude/commands/feature.md`: Added two conditional instruction blocks — one in `## Step by Step Tasks` and one in `## Testing Strategy / ### Unit Tests` — instructing the plan agent to read `.adw/project.md` and omit unit test content when disabled or absent
- `.claude/commands/review.md`: Updated `@regression` tag references to `@crucial` throughout proof requirements and review instructions
- `adws/agents/crucialScenarioProof.ts` (renamed from `regressionScenarioProof.ts`): Renamed to match the `@crucial` tag convention; generates `## @crucial Scenarios` section in scenario proof files
- `adws/__tests__/featurePlanTemplate.test.ts` (new): Vitest tests that read `feature.md` and assert the conditional instruction strings are present
- `features/plan_template_unit_tests_conditional.feature` (new): BDD scenarios covering disabled, enabled, and absent unit test settings
- `features/step_definitions/planTemplateSteps.ts` (new): Cucumber step definitions for plan template scenarios

### Key Changes

- The `feature.md` plan template now contains a conditional instruction telling the plan agent to read `.adw/project.md`. When `## Unit Tests: disabled` or the setting is absent (disabled is the default), the agent must omit the entire `### Unit Tests` subsection and must not include any unit test creation tasks.
- No TypeScript changes to `planAgent.ts` were needed — the plan agent already runs with primed context that includes `.adw/project.md` via `runPrimedClaudeAgentWithCommand`.
- The `@regression` tag convention was replaced with `@crucial` in `review.md` and the scenario proof agent, aligning terminology across BDD scenarios, review proof generation, and review classification.
- The audit of `bug.md`, `chore.md`, and `patch.md` confirmed none contain a `### Unit Tests` section — no changes were needed.
- Vitest tests were added as the executable validation mechanism for the `@crucial` scenarios (since BDD scenarios require live agent invocation to fully verify).

## How to Use

1. In a target repository's `.adw/project.md`, set `## Unit Tests: disabled` (or omit the `## Unit Tests` section entirely — disabled is the default).
2. Run the ADW feature workflow. The plan agent will execute the `/feature` slash command.
3. The plan agent reads `.adw/project.md` as part of its primed context and evaluates the conditional instruction in `feature.md`.
4. The generated plan will contain no `### Unit Tests` subsection under `## Testing Strategy` and no unit test creation tasks in `## Step by Step Tasks`.
5. The implement agent follows the plan and creates no unit test files.

To enable unit tests in plans, set `## Unit Tests: enabled` in `.adw/project.md`. The plan agent will then include the `### Unit Tests` section and unit test tasks as before.

## Configuration

The conditional behaviour is driven entirely by `.adw/project.md` in the target repository:

| Setting | Plan agent behaviour |
|---|---|
| `## Unit Tests: disabled` | Omits `### Unit Tests` section and unit test tasks |
| `## Unit Tests: enabled` | Includes `### Unit Tests` section and unit test tasks |
| `## Unit Tests` section absent | Same as disabled (default) |

No environment variables or code changes are required.

## Testing

Run Vitest unit tests to validate the conditional instruction strings are present in `feature.md`:

```sh
bun run test -- adws/__tests__/featurePlanTemplate.test.ts
```

The 4 tests cover:
- Disabled instruction (`OMIT this entire ### Unit Tests subsection`) present
- Enabled instruction (`## Unit Tests: enabled`) present
- Absent-equals-disabled instruction present
- Step-by-Step guard instruction (`do NOT include any tasks for creating, writing, or running unit tests`) present

BDD scenarios in `features/plan_template_unit_tests_conditional.feature` are tagged `@crucial` for the three core conditional scenarios and `@adw-jjxkk9-plan-templates-inclu` for all scenarios.

## Notes

- This change requires no TypeScript modifications. The only executable code change is the renaming of `regressionScenarioProof.ts` → `crucialScenarioProof.ts` and the corresponding update to `review.md`.
- The default when `## Unit Tests` is absent is `disabled`, matching the existing behaviour of `parseUnitTestsEnabled()` in `adws/core/projectConfig.ts`.
- The plan agent already has access to `.adw/project.md` through the primed context — this is why no changes to `planAgent.ts` are needed.
- Other plan templates (`bug.md`, `chore.md`, `patch.md`) were audited and confirmed to have no `### Unit Tests` sections; they are unaffected.
