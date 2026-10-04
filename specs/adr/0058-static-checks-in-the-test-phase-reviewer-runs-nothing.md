---
status: accepted
date: 2026-10-01
recorded: 2026-10-04
provenance:
  - kind: transcript
    source: "Claude Code session 2dc3e364, 2026-10-01 to 2026-10-04"
supersedes: ["0031", "0005"]
superseded-by: []
---

# Static checks are deterministic gates in the test phase; the reviewer runs nothing and `review_proof.md` is gone

## Context and Problem Statement

[ADR-0031](0031-active-test-phase-passive-review-judge.md) made the review phase a passive judge, but the proof design around it never worked. The owner's ruling on its Divergence item (2026-09-30) was: "Scenario A and Scenario B contradict one another and neither works properly. This needs redesigning."

Checked on 2026-10-01 at `c351b62b` and again on 2026-10-02 at `origin/dev`:

* `.claude/commands/review.md` Strategy A tells the reviewer to run `bunx tsc --noEmit` and `bun run lint` itself, hardcoded, and to treat a failed `@adw-{issueNumber}` scenario as tech debt while the default tag configuration calls it a blocker. Strategy B tells the reviewer to follow the prose of `.adw/review_proof.md`, which in ADW's own repo tells it to run scenarios. Strategy B is reached only when no scenarios are configured; nothing covers the case where neither applies.
* `.adw/review_proof.md` has two incompatible readers. `parseReviewProofMd` in `adws/core/projectConfig.ts` wants `## Tags` and `## Supplementary Checks` tables; `adw_init` writes prose; so the tag configuration is always the default and `supplementaryChecks` is parsed but never used.
* The unit-test phase runs the `/test` agent, which runs lint, type check and build, but the phase's verdict comes from the JUnit report only, so those results are discarded. The `runLinter`, `typeCheck`, `additionalTypeChecks` and `runBuild` values of `.adw/commands.md` have no TypeScript consumer. The whole phase is skipped when `unitTests` is `false` in `.github/adw.yml`.
* No step of the review judges the diff against the issue.

The owner's intent for `review_proof.md` (2026-10-01): "the review instructions that differentiates repos (e.g. CLI/automation tool in AI_Dev_Workflow, Web/UI project in Vestmatic). However, the review_proof files were not supposed to actively run all the tests. It should be passive, like review.md."

The decision covers the unit-test phase, the review prompt and phase, and the `.adw/review_proof.md` file in every target repository.

## Decision Drivers

* The reviewer must be passive: it judges, it does not check. A check it runs itself is a check nobody else can see or gate on.
* A verdict a machine can give must not be given by an agent.
* No silent green: a check that was configured must run and must count.
* One rule per situation, held in framework code rather than in prose copied into every repository.

## Considered Options

For where the static checks run:

* In the unit-test phase, run by TypeScript from `.adw/commands.md`
* In the review phase, run by the reviewer (the current Strategy A)
* In a new phase of their own

For the per-repository review instructions:

* Keep `review_proof.md` as prose guidance, machine-readable evidence requirements elsewhere
* Guidance per application type only, inside the review prompt; no per-repository file
* Both: a framework section per type plus an optional per-repository file

## Decision Outcome

Chosen: "in the unit-test phase, run by TypeScript" and "guidance per application type only, inside the review prompt". The owner's reason for dropping the per-repository file: "I can always add option 2 at some later point when I need it."

* **The reviewer is absolutely passive.** It runs no command that checks code. It reads results.
* **Static checks live in the unit-test phase.** Type check, additional type checks, lint and build. TypeScript runs each command named in `.adw/commands.md`; the exit code is the verdict. An agent is called only to fix a failure, never to decide whether something passed.
* **They always run.** `unitTests: false` in `.github/adw.yml` turns off only the test run itself. The unit-test phase is no longer skipped as a whole.
* **Green gates are a precondition of review in every orchestrator.** Static checks, unit tests and scenarios must pass before the reviewer is called. The reviewer never raises a blocker about a test, lint or type result. Consequence: `adwPlanBuildReview`, which runs the scenario phase without the fix loop, must use the loop like the other orchestrators.
* **The reviewer judges only what a machine cannot.** Whether the diff does what the issue asks, no more and no less; whether the scenarios really test the issue and are independent of the implementation; the visual evidence of [ADR-0063](0063-per-issue-scenario-images-are-the-visual-evidence.md); the coding guidelines; the guidance for the repository's application type.
* **`review_proof.md` is deleted in every repository.** Its parser, the `## Tags` and `## Supplementary Checks` tables and `supplementaryChecks` go with it. The scenario tags are fixed in framework code: `@regression` and `@adw-{issueNumber}`, both blocking.
* **Per-type guidance is a section of the review prompt**, one per application type of [ADR-0061](0061-application-type-decides-evidence-web-repos-run-playwright-bdd.md).

### Consequences

* Good, because a lint or type failure now stops the run before review, with the real output, instead of depending on whether an agent chose to run the command and read it.
* Good, because the reviewer's job shrinks to judgement, which is cheaper and repeatable.
* Good, because one file and two parsers disappear from every target repository.
* Bad, because a repository that wants review guidance of its own has no place for it until a later decision adds one.
* Bad, because [ADR-0049](0049-promotion-sweep-files-human-gated-issue.md) relies on `@adw-{N}` being optional for promotion issues; with both tags blocking, the promotion path needs its own rule for an issue that has no per-issue scenarios.

### Confirmation

Partly implemented. Checked on 2026-10-04 in the working tree on top of `01c4bb99`:

* `adws/core/checkRunner.ts` (`runStaticChecks`) runs `## Type Check`, `## Additional Type Checks`, `## Run Linter` and `## Run Build` from the parsed `.adw/commands.md`, in that order, and returns one verdict per check with its exit code and captured output. The exit code is the verdict, and `N/A` is reported as skipped. Unit tests: `adws/core/__tests__/checkRunner.test.ts` (fake process runner: verdict per exit code, `N/A` skipped, output captured, fixed order) and `adws/core/__tests__/checkRunner.integration.test.ts` (the default shell runner).
* `adws/phases/unitTestPhase.ts` (`executeUnitTestPhase`) runs the check runner before the test run whatever `unitTests` says. A red check goes to the static-check fix loop of [ADR-0059](0059-fix-loops-no-progress-stop-and-suppression-guard.md), with the check's output in the execution log. `unitTests: false` skips only the test run. Unit tests: `adws/phases/__tests__/unitTestPhase.test.ts`.
* `.claude/commands/test.md` runs only `## Run Tests`: `grep -nE "Run Linter|Type Check|Run Build|bun run lint|tsc --noEmit|bun run build" .claude/commands/test.md` returns nothing.
* Outside `adws/core/projectConfig.ts`, the only TypeScript reader of `runLinter`, `typeCheck`, `additionalTypeChecks` and `runBuild` is `checkRunner.ts`.

The PRD `specs/prd/review-proof-redesign.md` and the issues filed from it still carry the rest. Checked on 2026-10-02 at `origin/dev` (`fb379646` on 2026-10-04): `review.md` still has Strategy A and B; `adw_init.md` step 6 still writes `review_proof.md`; `projectConfig.ts` still parses `## Tags` and `## Supplementary Checks`; `adwPlanBuildReview.tsx` still calls `executeScenarioTestPhase` outside the fix loop.

## More Information

* Supersedes, in part, ADR-0031: the proof design (`review.md` Strategy A and B, `scenario_proof.md` as the reviewer's only input). The passive judge, the active test phase, the dev-server lifecycle and the janitor stand; the lifecycle's failure rule is changed by [ADR-0062](0062-dev-server-start-failure-is-a-failed-review.md).
* Supersedes, in part, ADR-0005: `review_proof.md` is no longer one of the `.adw/` files.
* The fix loops that follow a red check are in [ADR-0059](0059-fix-loops-no-progress-stop-and-suppression-guard.md); the baseline on the base branch in [ADR-0060](0060-baseline-gate-on-the-base-branch.md).
* The step-definition independence check added by #937 (2026-10-02) is part of what the reviewer judges.
