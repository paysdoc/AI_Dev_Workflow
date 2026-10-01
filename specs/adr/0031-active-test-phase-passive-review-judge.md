---
status: accepted
date: 2026-04-08
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/prd/test-review-refactor.md
  - kind: contemporaneous
    source: specs/issue-394-adw-f704s2-cron-janitor-for-orp-sdlc_planner-dev-server-janitor.md
  - kind: contemporaneous
    source: specs/issue-395-adw-dd5jfe-dev-server-lifecycle-sdlc_planner-dev-server-lifecycle-helper.md
  - kind: contemporaneous
    source: specs/issue-396-adw-8zhro4-prreviewworkflowconf-sdlc_planner-prreviewworkflowconfig-composition.md
  - kind: contemporaneous
    source: specs/issue-397-adw-zqb2k1-wire-stepdefphase-in-sdlc_planner-wire-stepdef-into-orchestrators.md
  - kind: contemporaneous
    source: specs/issue-399-adw-8ogjrg-scenariotestphase-sc-sdlc_planner-scenario-test-fix-phases.md
  - kind: contemporaneous
    source: specs/issue-401-adw-cudwfe-review-phase-rewrite-sdlc_planner-passive-judge-review-phase.md
  - kind: contemporaneous
    source: specs/issue-403-adw-01s6z7-delete-e2e-machinery-sdlc_planner-delete-legacy-e2e-machinery.md
  - kind: recalled
    source: "Martin Koster, 2026-09-29"
  - kind: recalled
    source: "Martin Koster, 2026-09-30"
supersedes: ["0024"]
superseded-by: []
---

# Active test phase, passive review judge

## Context and Problem Statement

ADW workflows leaked `next dev` processes into target-repo worktrees. One chore worktree collected more than 12 Next.js processes in 5 days, one of them holding `.next/dev/lock` for 47 hours and blocking later starts. The PRD traces the leak to the review phase: `review.md` always invoked `prepare_app.md`, three parallel review agents each started a dev server, and nothing stopped them. The leak was "a symptom of a deeper architectural problem: the review phase has accreted test-execution responsibilities that belong to the test phase". Two test stacks existed side by side (Playwright E2E and BDD scenarios), and the PR-review workflow could not use the shared phase runner because its config type was incompatible with `WorkflowConfig`.

## Decision Drivers

* No process may outlive the workflow that started it.
* One phase runs tests; one phase judges. Neither does the other's work.
* One test path, not two.
* PR review should get state writes, board moves, rate-limit pause and cost posting from `phaseRunner` like every other orchestrator.

## Considered Options

For the dev-server lifecycle:

* Own the lifecycle in TypeScript, inside the test phase
* A `prepare_app` and `teardown_app` slash-command pair
* Keep UI navigation in review as a fallback ("Strategy C")

For the PR-review config: composition (`base: WorkflowConfig`), or inheritance.

## Decision Outcome

Chosen option: "own the lifecycle in TypeScript", because the slash-command pair "was abandoned in favor of trashing E2E entirely and routing all dev server lifecycle through TS". For the config, composition was chosen so that shared phases keep taking `WorkflowConfig` and PR-only fields do not pollute it.

* **The test phase is active.** Two phases: `unitTestPhase` and `scenarioTestPhase`. The scenario phase runs the issue's scenarios and the regression scenarios by tag and writes one proof artifact, `scenario_proof.md`, with a section per tag.
* **The review phase is passive.** A single review agent reads the proof and judges the change against the issue. "It does not run tests. It does not navigate the application. It does not start a dev server." Strategy C and `REVIEW_AGENT_COUNT` were deleted.
* **Fix loops belong to the orchestrator.** Scenario failures go to `scenarioFixPhase` in a test, fix, retest loop. Review blockers go to a patch, build, retest loop.
* **Dev server lifecycle.** `withDevServer` spawns the start command in its own process group with `{PORT}` substituted, probes a health path every second for up to 20 seconds, retries the start up to 3 times, runs the work anyway after 3 failures, and kills the process group in a `finally` block. It is used only when `.adw/commands.md` declares a `## Start Dev Server` other than `N/A`.
* **Janitor.** A cron probe reaps dev servers orphaned by a killed orchestrator. It leaves a worktree alone when the workflow stage is non-terminal and the orchestrator PID is alive, or when the worktree is younger than 30 minutes.
* **E2E removed.** The Playwright path, the `e2e-tests/` convention and the commands `prepare_app`, `start`, `in_loop_review` and `test_e2e` were deleted. All test execution goes through the scenario phase; the runner behind it is the target repo's choice.
* **Step-definition phase re-wired.** `executeStepDefPhase`, dead code since [ADR-0024](0024-tdd-in-build-phase-single-pass-alignment.md), runs between build and unit test, "so step definitions are generated against built code rather than a phantom interface".
* **PR-review config by composition.** `PRReviewWorkflowConfig` holds `base: WorkflowConfig`, and `adwPrReview.tsx` runs its phases through `runPhase`.

### Consequences

* Good, because a dev server is started and stopped by the same TypeScript function, so a normal exit cannot leak it.
* Good, because review is one agent reading one file: cheaper and repeatable.
* Good, because PR review gained four features through one structural change.
* Bad, because target repos without scenario proof or custom proof lose UI-level validation; the PRD accepts this.
* Bad, because existing target repos had to migrate off `## Run E2E Tests` by hand.
* Bad, because the janitor can only act after the 30-minute grace period, so an orphan lives at least that long.

### Confirmation

Checked against the code on 2026-09-29:

* `adws/phases/reviewPhase.ts` opens with "Does not run tests, start a dev server, navigate the application, or invoke prepare_app". `.claude/commands/review.md` has Strategy A and B only.
* `adws/core/devServerLifecycle.ts` sets `PROBE_INTERVAL_MS = 1000`, `PROBE_TIMEOUT_MS = 20000`, `MAX_START_ATTEMPTS = 3` and spawns with `detached: true`.
* `trigger_cron.ts` calls `runJanitorPass()` every `JANITOR_INTERVAL_CYCLES` (15 cycles of 20 seconds); `JANITOR_GRACE_PERIOD_MS` is 30 minutes.
* `grep -rn REVIEW_AGENT_COUNT adws` returns nothing; the four deleted commands are absent from `.claude/commands/`; no `runE2E*` or Playwright code remains under `adws/`.
* `executeStepDefPhase` is called in the five orchestrators named by #397.
* Unit tests exist for the three deep modules. `bunx vitest run` passed `devServerLifecycle.test.ts` (31 tests) and `scenarioTestPhase.test.ts` (16 tests). `devServerJanitor.test.ts` could not be loaded because `@paysdoc/devplatform` is not installed in this checkout; it was not run. No CI workflow runs the unit suite.

## Divergence

1. **The reviewer's proof instructions contradict the passive judge.** ADW's own `.adw/review_proof.md` tells the reviewer to run `@review-proof` and `@adw-{issueNumber}` scenarios itself. `review.md` gives Strategy A priority when a proof path is passed, so this text is reached only without one. No `.feature` file carries the `@review-proof` tag. Ruling (owner, 2026-09-30): "This is an architectural mistake. Scenario A and Scenario B contradict one another and neither works properly. This needs redesigning." The passive-judge decision stands.

## More Information

* Supersedes, in part, ADR-0024: only the removal of the step-definition phase.
* The PRD is the output of one grill session on 2026-04-08. Its rollout rule, small PRs merged while the cron runs from a separate clone, is recorded in [ADR-0019](0019-dev-and-main-branches-with-runner-clone.md). The phase runner is recorded in [ADR-0020](0020-shared-phase-runner-and-core-decomposition.md).
* The PRD's phase order ends "review → document → KPI → PR". The KPI phase was removed later ([ADR-0045](0045-kpi-module-removed.md)).
* Settled (owner, 2026-09-29): the `## Run E2E Tests` heading is kept on purpose, as the scenario writer's tool descriptor. No code under `adws/` parses it; ADW's own `.adw/commands.md` carries it and `.claude/commands/scenario_writer.md` reads it (see [ADR-0043](0043-multi-language-test-seam.md)).
