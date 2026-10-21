---
status: accepted
date: 2026-10-02
recorded: 2026-10-04
provenance:
  - kind: transcript
    source: "Claude Code session 2dc3e364, 2026-10-01 to 2026-10-04"
supersedes: ["0031"]
superseded-by: []
---

# A dev server that will not start on the issue branch is a failed review; a successful start resets the count

## Context and Problem Statement

[ADR-0031](0031-active-test-phase-passive-review-judge.md) has `withDevServer` retry the start three times and then run the work anyway. With the scenarios of a `web` repository running against that server ([ADR-0061](0061-application-type-decides-evidence-web-repos-run-playwright-bdd.md)), "run anyway" means every scenario errors (verified in the spike of 2026-10-02: with the server down both scenarios error, exit 1) and the failure is reported as a scenario failure, which sends the fix agent after the scenarios instead of the server.

A server that does not start on the issue branch, after the baseline of [ADR-0060](0060-baseline-gate-on-the-base-branch.md) showed that it starts on the base branch, was broken by the change.

The decision covers the dev-server start in the scenario phase of every orchestrator.

## Considered Options

* Run the work anyway after three failed starts (ADR-0031)
* Fail the scenario phase and send the server output to the scenario fix loop
* Treat a failed start as a failed review: the builder gets a blocker with the server output

## Decision Outcome

Chosen: "treat a failed start as a failed review". The owner (2026-10-02): "The adw needs to keep trying. If it doesn't start up it is a hard problem and probably means that the builder made a mistake. In other words, treat a failing start as a failed review. However, once that problem is solved the number of failed reviews resets."

* A failed start produces a review blocker carrying the server's output; the builder fixes it through the review patch loop.
* Each failed start uses one review attempt. When the cap is reached the issue goes to `review_failed` ([ADR-0048](0048-one-adwid-per-issue-and-review-failed-gate.md)).
* When the server starts, the failed-review count resets to zero, so the server problem does not eat the attempts the real review may need.
* The lifecycle itself (process group, probe, kill in `finally`) and the janitor stand.

### Consequences

* Good, because the fix goes to whoever broke the start, with the evidence, rather than to a scenario fix agent facing a wall of connection errors.
* Good, because "run anyway" can no longer produce a scenario verdict that is really a server verdict.
* Bad, because a flaky start (a slow machine, a port in use) now costs a review attempt; the reset limits the damage but does not remove it.
* Bad, because the review attempt counter gains a second writer, which the orchestrators must keep consistent.

### Confirmation

Implemented. Checked on 2026-10-07 in the working tree on top of `70c749ac`:

* The lifecycle: `withDevServer` is gone from `adws/core/devServerLifecycle.ts` (`grep -rn "withDevServer" adws` prints nothing). `withHealthyDevServer` is the only way to run work under a dev server, and it never runs the work against a server that did not start: it returns `{ started: false, output }`, the output of the last attempt, and leaves the meaning of the failure to its caller. The process group, the probe, `MAX_START_ATTEMPTS` and the stop that waits for the group stand.
* The scenario phase: `executeScenarioTestPhase` (`adws/phases/scenarioTestPhase.ts`) starts the server that `readDeclaredDevServer` (`adws/phases/declaredDevServer.ts`) reads from the worktree's raw `.adw/commands.md`, the one `executeBaselinePhase` starts on the base branch, and starts it through `withHealthyDevServer`. A repository that declares no server runs its scenarios without one, although `parseCommandsMd` fills the parsed config with `bun run dev`. On a failed start the phase runs no scenario, clears `ctx.scenarioProof`, records the phase cost as failed and returns `devServer` as a `DevServerStart` with status `failed`, the start command with its port, the health URL and the server's output.
* The fix loop: `runScenarioTestFixLoop` (`adws/phases/scenarioTestFixLoop.ts`) hands a failed start back at once, before the pass check, with no scenario fix agent, no fidelity check, no pre-existing-regression gate and no scenario retry counted; every other result carries the last `devServer`.
* The loop: `runReviewRetryLoop` (`adws/phases/reviewRetryLoop.ts`) is the one owner of the review attempt counter. A failed start runs no review agent: `serverStartBlocker` makes one patch blocker that carries the tail of the server's output, the command and the health URL, `recordFailedStartReview` posts the `review_failed` comment with it, `executeReviewPatchCycle` hands it to the patch agent and the build agent, and a new start attempt follows each patch. The rules are pure, in `adws/core/devServerFailure.ts`: `countFailedStart` and `countFailedReview` each use one attempt, `isReviewBudgetSpent` stops the loop at `MAX_REVIEW_RETRY_ATTEMPTS`, and `countStartedServer` sets the failed count to zero when the start that succeeds follows a failed start. A server that starts on every re-test never resets the count, so a review whose blockers persist still reaches `review_failed`. The total of failed reviews is never reset and is what the orchestrators record as `totalReviewRetries`.
* The orchestrators: `adwSdlc`, `adwPlanBuildReview`, `adwPlanBuildTestReview`, `adwChore` and `adwPrReview` run the loop in place of the copy of it each carried, and end at `review_failed` as for any exhausted review. `adwChore` escalates a failed start into the loop even when the diff judge rules the chore safe, with its own escalation comment, and records the judge's real verdict next to the review's. `adwPlanBuildTest` has no review patch loop, so a failed start ends its run at `review_failed` without a pull request.
* The baseline: `executeBaselinePhase` still parks a base-branch start failure as `human_gated` with the park reason `base_server_down` and the server's output in the park comment, before the plan phase, and never touches the review counter.
* Unit tests, with a fake lifecycle where the lifecycle is the point: `adws/core/__tests__/devServerFailure.test.ts` (increment, reset, cap, the output tail), `devServerLifecycle.test.ts` and `devServerLifecycle.healthy.test.ts`; `adws/phases/__tests__/declaredDevServer.test.ts`, `scenarioTestPhase.server.test.ts` (with `scenarioTestPhase.test.ts` and `scenarioTestPhase.runner.test.ts`), `scenarioTestFixLoop.test.ts` (with `scenarioTestFixLoop.regression.test.ts`) and `reviewRetryLoop.test.ts` (the real scenario phase over a scripted lifecycle: blocker with output, a new start after the patch, increment, reset, cap; with `reviewRetryLoop.counter.test.ts` and `reviewRetryLoop.blocker.test.ts`); `adws/__tests__/adwPlanBuildReview.test.ts`, `adwPlanBuildTestReview.test.ts`, `adwChore.test.ts` (with `adwChore.devServer.test.ts`) and `adwPlanBuildTest.test.ts`.
* Scenarios: `features/per-issue/feature-993.feature`, which runs real orchestrator processes on feature-990's harness (`features/per-issue/step_definitions/feature-993-*.ts`), and the `@adw-993` scenario of `features/per-issue/feature-992.feature`, which runs the real scenario phase under a declared dev server.

## More Information

* Supersedes, in part, ADR-0031: only the rule "runs the work anyway after 3 failures".
* The baseline start on the base branch is governed by ADR-0060 and parks the issue instead; the review counter is untouched there.
