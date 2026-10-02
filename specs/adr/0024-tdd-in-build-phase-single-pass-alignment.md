---
status: accepted
date: 2026-03-25
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/prd/tdd-bdd-integration.md
  - kind: contemporaneous
    source: specs/issue-303-adw-y55dlm-remove-ungeneratable-sdlc_planner-remove-ungeneratable-step-def-classification.md
  - kind: contemporaneous
    source: specs/issue-304-adw-78f2zu-create-implement-tdd-sdlc_planner-implement-tdd-skill.md
  - kind: contemporaneous
    source: specs/issue-305-adw-a1vf0g-single-pass-alignmen-sdlc_planner-single-pass-alignment-phase.md
  - kind: contemporaneous
    source: specs/issue-306-adw-0s1m68-build-agent-routing-sdlc_planner-tdd-routing-pipeline.md
  - kind: contemporaneous
    source: specs/issue-307-adw-yxq5og-review-phase-step-de-sdlc_planner-step-def-independence-check.md
  - kind: contemporaneous
    source: specs/issue-308-adw-dfrwyt-unit-test-support-in-sdlc_planner-tdd-unit-test-support.md
  - kind: recalled
    source: "Martin Koster, 2026-09-29"
supersedes: []
superseded-by: ["0031"]
---

# TDD in the build phase and single-pass plan-scenario alignment

## Context and Problem Statement

After [ADR-0014](0014-bdd-as-validation-contract-unit-tests-removed.md) the build agent ran `/implement`, "a straight 'read plan, write code' flow with no intermediate verification" (PRD). Tests ran only after the whole implementation. Before the build, a validation loop compared plan text with scenario text through an LLM, for up to N rounds. The step-definition agent then removed the scenarios that needed runtime infrastructure as "ungeneratable", although the harness of [ADR-0021](0021-behavioural-test-harness-with-mocked-boundaries.md) supplied that infrastructure. The PRD's summary: the pipeline "throws away the most useful ones, and never uses the remaining ones to guide implementation".

## Decision Drivers

* Catch behavioural drift during the build, where a fix is cheap in tokens.
* Fewer agent spawns per run. The PRD estimates a net saving of 1 to N-1 spawns.
* Keep scenario author and implementer independent of each other.

## Considered Options

For packaging the TDD prompt: a skill, or a slash command. Otherwise none recorded.

## Decision Outcome

* **TDD in the build.** The build agent uses the `implement-tdd` skill when `.feature` files tagged `@adw-{issueNumber}` exist, and `/implement` when they do not. The issue's scenarios are the RED tests. Work is sliced vertically: one scenario, its step definitions, its implementation, then the next.
* **A skill, not a command**, because a skill "can reference multiple files" and travels to target repos with `target: true` (PRD, user story 14). The TDD reference files are copied into the skill directory.
* **Single-pass alignment.** `executeAlignmentPhase` replaces the validate, resolve, re-validate loop. One agent reads plan and scenarios once and resolves conflicts, with the GitHub issue as source of truth. There is no retry. A conflict it cannot resolve becomes a warning in the plan; the phase never fails the workflow.
* **Plan and scenario agents stay parallel**, "so that neither agent's output influences the other" (user story 11).
* **No "ungeneratable" scenarios.** The step-definition prompt lost that classification and gained a description of the mock harness (#303).
* **No separate step-definition phase.** The build agent was to write step definitions inside its loop (#306). This part was reversed; see More Information.
* **Independence check in review (#307).** Because one agent now writes both step definitions and implementation, review was to check that step definitions test behaviour through public interfaces "rather than tautologically asserting what the build agent wrote".
* **Unit tests in the loop (#308).** Where a repo enables unit tests, the build agent writes one before each behaviour. They do not replace scenario proof; see [ADR-0018](0018-unit-tests-restored-alongside-bdd.md).

### Consequences

* Good, because each behaviour is seen to fail and then pass before the next one starts.
* Good, because alignment costs one agent run instead of up to N.
* Bad, because the implementing agent also writes the step definitions, which weakens the independence ADR-0014 relied on. The review check was meant to cover this.
* Bad, because an unresolved plan-scenario conflict no longer stops the run; it travels on as a warning.

### Confirmation

Checked against the code on 2026-09-29:

* `runBuildAgent` (`adws/agents/buildAgent.ts`) sets `useTdd = scenarioFiles.length > 0` and picks `/implement-tdd` or `/implement`.
* `adwSdlc.tsx`, `adwPlanBuildReview.tsx` and `adwPlanBuildTestReview.tsx` call `executeAlignmentPhase` directly after `runPhasesParallel(..., [executePlanPhase, executeScenarioPhase])`.
* `executePlanValidationPhase` is still exported from `adws/phases/planValidationPhase.ts`, but `grep executePlanValidationPhase adws/*.tsx` finds no orchestrator that calls it.
* `grep -i ungeneratable .claude/commands/generate_step_definitions.md` returns nothing.
* `.claude/skills/implement-tdd/` holds `SKILL.md` and the five reference files.

No CI gate enforces this decision.

## More Information

* **Part that no longer holds:** dropping the step-definition phase. [ADR-0031](0031-active-test-phase-passive-review-judge.md) wired `executeStepDefPhase` back in between build and unit test. The build agent may still write step definitions in its loop.
* `date` is 2026-03-25: issues #303 to #308 were filed and the first slices merged that day. The PRD file was committed on 2026-03-26 (ea29d31d), in the commit that renamed the command from `/implement_tdd` to `/implement-tdd`.
