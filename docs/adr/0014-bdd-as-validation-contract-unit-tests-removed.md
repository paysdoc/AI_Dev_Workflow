---
status: accepted
date: 2026-03-13
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/issue-164-adw-1773386463517-mvb88d-sdlc_planner-bdd-scenario-config.md
  - kind: contemporaneous
    source: specs/issue-165-adw-hpq6cn-implement-scenario-p-sdlc_planner-scenario-planner-agent.md
  - kind: contemporaneous
    source: specs/issue-166-adw-9dc0tj-implement-plan-scena-sdlc_planner-plan-scenario-validation.md
  - kind: contemporaneous
    source: specs/issue-167-adw-q9kms5-refactor-test-phase-sdlc_planner-refactor-test-phase-bdd-first.md
  - kind: contemporaneous
    source: specs/issue-168-adw-9emriw-refactor-review-phas-sdlc_planner-bdd-scenario-review-proof.md
  - kind: contemporaneous
    source: specs/issue-169-adw-1773386141689-alfbmn-sdlc_planner-remove-adw-unit-tests.md
  - kind: contemporaneous
    source: specs/issue-202-adw-m8wft2-chore-remove-all-uni-sdlc_planner-remove-unit-tests.md
supersedes: []
superseded-by: ["0018"]
---

# BDD scenarios as the validation contract, ADW unit tests removed

## Context and Problem Statement

Until 2026-03-13 the pipeline ran Build, PR, Tests, Review in that order, review proof was code-diff analysis with lint and type checks, and ADW carried 93 unit test files in 12 `__tests__/` directories (count from `specs/issue-169-plan.md`). The tests were written by the same agents that wrote the code. Issues #164 to #169 asked what should count as proof that a change does what its issue asked for.

## Decision Drivers

* "an agent can write tests that always pass" (#169).
* The unit tests "primarily test mocked implementations rather than real behaviour, and they clutter the context window" (#169).
* "a PR should not be created for untested work" (#167).

## Considered Options

None recorded.

## Decision Outcome

BDD scenarios became the validation contract for every workflow, and ADW's own unit tests were deleted.

* **Configuration (#164).** Each target repo declares its scenario directory and run commands in `.adw/scenarios.md`. Two tags were defined: `@adw-{issueNumber}` for the scenarios of one issue and `@crucial` for the regression safety net.
* **Separate author (#165).** A scenario agent (`/scenario_writer`, `adws/agents/scenarioAgent.ts`) writes the scenarios from the issue. It runs in parallel with the plan agent, not after it.
* **Issue as arbiter (#166).** Plan and scenarios are compared before the build. Where they disagree, "The GitHub issue is the sole arbiter of truth", not the plan and not the scenarios.
* **Order (#167).** Build, then the issue's scenarios, then PR, then review. No PR is opened while the issue's scenarios fail after retries.
* **Review proof (#168).** Review proof became the result of running the `@crucial` scenarios, with a fallback to code-diff proof for repos without `.adw/scenarios.md`.
* **Unit tests (#167, #169, #202).** Unit tests became opt-in per repo through `## Unit Tests` in `.adw/project.md`, default disabled. ADW set the flag to `disabled` and deleted its test files (#169, merged 2026-03-13). #202 (2026-03-16) then removed `vitest.config.ts`, the `vitest` dependency and the test scripts.

### Consequences

* Good, because the proof of a change is written by an agent that did not write the implementation.
* Good, because untested work no longer reaches a pull request.
* Bad, because logic bugs in pure functions had no fast, fine-grained check. This led to [ADR-0018](0018-unit-tests-restored-alongside-bdd.md).
* Bad, because nothing constrained what a scenario asserted. Most step definitions became file-shape checks, which [ADR-0037](0037-tiered-regression-suite-with-fixed-vocabulary.md) later removed.

### Confirmation

Checked against the code on 2026-09-29:

* `.adw/scenarios.md` exists and declares `## Scenario Directory` and `## Run Scenarios by Tag`.
* `adws/adwSdlc.tsx` runs `runPhasesParallel(config, tracker, [executePlanPhase, executeScenarioPhase])`, and calls `executePRPhase` only after the scenario test loop and review.
* `getDefaultReviewProofConfig` (`adws/core/projectConfig.ts`) lists the tag `@adw-{issueNumber}`.
* `.claude/commands/align_plan_scenarios.md` states the issue is "the SOLE ARBITER OF TRUTH".
* The unit-test part is not in force: `find adws -name '*.test.ts'` returns 152 files and `.adw/project.md` says `## Unit Tests: enabled`.

No CI gate enforces this decision; it is carried by the orchestrator scripts.

## More Information

* **Part that no longer holds:** the removal of ADW's unit tests and the claim that BDD makes them redundant. Replaced by [ADR-0018](0018-unit-tests-restored-alongside-bdd.md).
* Later refinements that keep the contract but change its mechanics: `@crucial` was renamed `@regression` on 2026-03-16 (#194); the validate, resolve, re-validate loop became one alignment pass in [ADR-0024](0024-tdd-in-build-phase-single-pass-alignment.md); scenario execution moved out of review into the test phase in [ADR-0031](0031-active-test-phase-passive-review-judge.md); the per-repo unit-test flag moved to `.github/adw.yml` with default enabled in [ADR-0043](0043-multi-language-test-seam.md).
* #169 needed a review round: the build agent updated the documents but did not delete the test files, and a reviewer caught it (`specs/issue-169-plan.md`).
