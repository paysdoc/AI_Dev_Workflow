---
status: accepted
date: 2026-10-02
recorded: 2026-10-04
provenance:
  - kind: transcript
    source: "Claude Code session 2dc3e364, 2026-10-01 to 2026-10-04"
supersedes: []
superseded-by: []
---

# A red base branch parks the issue before any work; pre-existing failures are not the fix agent's job

## Context and Problem Statement

With static checks as gates ([ADR-0058](0058-static-checks-in-the-test-phase-reviewer-runs-nothing.md)) and a fix loop without a cap ([ADR-0059](0059-fix-loops-no-progress-stop-and-suppression-guard.md)), a failure the branch inherited from `dev` would be charged to the issue: the fix agent would try to repair code the issue never touched, or the loop would run until a human noticed. The same holds for a regression scenario that already fails on the base branch, and for a dev server that does not start there.

The decision covers the start of every orchestrator that runs the gates, and the handling of a regression scenario that fails.

## Decision Drivers

* Work is never built on a red base; the owner decides what to do with one.
* Failures that are not the issue's are kept away from the fix agent.
* A full regression run on the base branch for every issue is too expensive to be the default.
* Every park tells the human what to do: the owner (2026-10-04) on the pre-existing-regression park: "leave instructions for the human in the comments".

## Considered Options

For the baseline: run the static checks on the base branch first and park when red; skip the baseline and let the fix loop handle everything; run the baseline and fix the base in the same run.

For the regression scenarios: a full baseline run; none; no baseline run, but re-run a failing scenario alone on the base branch to classify it.

For a classified pre-existing failure: park as `human_gated`; carry on and list it as pre-existing; carry on and file a separate issue.

## Decision Outcome

* **Baseline first.** Before any work, the static checks run on the base branch. If the repository declares a dev server, it is started there too. A red baseline parks the issue as `human_gated`.
* **Directives.** `## Retry` re-runs the baseline and parks again if it is still red. `## Continue` waives the baseline: this run fixes everything, pre-existing failures included.
* **No baseline regression run.** When a regression scenario fails on the change, TypeScript re-runs just that scenario on the base branch. If it fails there too it is pre-existing: it does not go to the fix agent, and the issue parks as `human_gated`, the same rule as for a red baseline, with the same directive meanings.
* **Every park comment carries instructions**: what failed, that it also fails on the base branch where that is the case, and what `## Retry` and `## Continue` each do. This applies to all parks introduced by this redesign.
* **Rejected:** filing a separate issue for a pre-existing regression failure, because every new issue starts a pipeline run, so one red base would spawn a fix run from every issue that touches it.

### Consequences

* Good, because the fix agent only ever works on what the issue changed.
* Good, because a broken `dev` is noticed on the first issue that meets it, with a comment that says so.
* Bad, because a baseline costs one static-check run and one dev-server start per issue.
* Bad, because every issue parks while `dev` is red; the owner must fix `dev` or `## Continue` one run to do it.
* Bad, because the re-run of a regression scenario on the base branch needs a second checkout or worktree of the base, which the orchestrators do not have today.

### Confirmation

Implemented. Checked on 2026-10-06 in the working tree on top of `570948f4`:

* `adws/phases/baselinePhase.ts` (`executeBaselinePhase`) runs as the first phase of every orchestrator that runs gates, before the plan phase (in `adwTest`, before the unit-test phase): `grep -l "executeBaselinePhase" adws/adw*.tsx` lists `adwChore`, `adwPlanBuild`, `adwPlanBuildDocument`, `adwPlanBuildReview`, `adwPlanBuildTest`, `adwPlanBuildTestReview`, `adwPrReview`, `adwSdlc` and `adwTest`, and `adwPrReview` names the phase `pr_review_baseline`. It does three things. It checks the base branch out as a detached worktree (`adws/phases/baseWorktree.ts`, `.worktrees/base-issue-<N>-<adwId>`). It installs the base branch's dependencies and runs the check runner there (`runBaselineChecks`, `adws/core/baselineGate.ts`). It starts, and stops again, the dev server that the base branch's `.adw/commands.md` declares (`withHealthyDevServer`, `adws/core/devServerLifecycle.ts`).
* A red baseline parks the issue as `human_gated` (`parkWorkflow`, `adws/phases/workflowPark.ts`) with the `baseline_red` or `base_server_down` comment of `adws/forge/parkComment.ts`; a green one records `baseline.status: 'passed'` in the top-level state. `## Retry` re-arms the park (`decideRetryAction`, `adws/triggers/retryHandler.ts`), and the resumed run re-runs the baseline. `## Continue` on a `baseline_red`, `base_server_down` or `pre_existing_regression` park records a waiver and re-arms it (`adws/triggers/continueHandler.ts`, called by `trigger_cron.ts` and `trigger_webhook.ts`; `parkReason` in the top-level state names the park), and the resumed baseline phase finds the waiver and runs no check.
* `runScenarioTestFixLoop` re-runs each failing `@regression` scenario alone in the base checkout (`adws/phases/baseScenarioRerun.ts`, `adws/core/regressionTriage.ts`). One that fails there too never reaches the fix agent: the issue parks with the `pre_existing_regression` comment (`adws/phases/preExistingRegressionGate.ts`). With a waiver every failure goes to the fix agent. No full regression run happens on the base branch.
* The base worktree is removed when the orchestrator process exits (`buildBaseWorktreePort` registers the removal as an `exit` handler), on every path that ends in `process.exit`: a normal end, a park, an error, a pause. A killed process cannot run the handler and leaves its checkout behind. `## Cancel` (`adws/triggers/cancelHandler.ts`) and issue close (`handleIssueClosedEvent`, `adws/triggers/webhookHandlers.ts`) remove it through `GitContext.removeWorktreesForIssue`, which matches `-issue-<N>-` in the worktree name; the dev-server janitor finds it by the same pattern (`extractIssueNumberFromDirName`, `adws/triggers/devServerJanitor.ts`) and stops what still runs in it; the next run of the same workflow removes it by name before it makes its own.
* Unit tests: `adws/core/__tests__/baselineGate.test.ts` (with `baselineGate.record.test.ts`), `regressionTriage.test.ts` and `devServerLifecycle.healthy.test.ts`; `adws/phases/__tests__/baseWorktree.test.ts`, `baselinePhase.test.ts` (with `baselinePhase.directives.test.ts`), `baseScenarioRerun.test.ts` (with `baseScenarioRerun.server.test.ts`), `preExistingRegressionGate.test.ts` and `scenarioTestFixLoop.regression.test.ts`; `adws/triggers/__tests__/continueHandler.test.ts`. They use a fake check runner, a fake scenario runner and a fake worktree: red parks, green records, the waiver is honoured, the single re-run classifies pre-existing.
* Scenarios: `features/per-issue/feature-990.feature`, which runs real orchestrator processes, and the four `@adw-990` park-comment scenarios of `features/per-issue/feature-989.feature`.

## More Information

* `## Retry` and `## Continue` already exist as comment directives ([ADR-0032](0032-explicit-cancel-and-retry-directives.md), `adws/core/workflowCommentParsing.ts`). This decision gives them meanings for the new parks; it adds no directive.
* The dev-server start on the base branch follows the lifecycle of [ADR-0031](0031-active-test-phase-passive-review-judge.md) and the failure rule of [ADR-0062](0062-dev-server-start-failure-is-a-failed-review.md) does not apply to it: a base-branch start failure parks, it does not count as a failed review.
