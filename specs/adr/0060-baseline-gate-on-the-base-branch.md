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

Not yet implemented; carried by `specs/prd/review-proof-redesign.md`. Checked on 2026-10-02 at `origin/dev`: no orchestrator runs anything on the base branch before the plan phase; `adws/phases/scenarioTestFixLoop.ts` sends every failing scenario to the fix agent.

## More Information

* `## Retry` and `## Continue` already exist as comment directives ([ADR-0032](0032-explicit-cancel-and-retry-directives.md), `adws/core/workflowCommentParsing.ts`). This decision gives them meanings for the new parks; it adds no directive.
* The dev-server start on the base branch follows the lifecycle of [ADR-0031](0031-active-test-phase-passive-review-judge.md) and the failure rule of [ADR-0062](0062-dev-server-start-failure-is-a-failed-review.md) does not apply to it: a base-branch start failure parks, it does not count as a failed review.
