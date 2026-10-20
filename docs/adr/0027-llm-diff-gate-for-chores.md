---
status: accepted
date: 2026-03-27
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/issue-327-adw-wc1uva-auto-approve-and-mer-sdlc_planner-chore-auto-approve-llm-gate.md
supersedes: []
superseded-by: []
---

# LLM diff gate for chores

## Context and Problem Statement

Chore issues are meant to be config-only, documentation-only, dependency bumps or CI changes. Until #327 they ran through `adwPlanBuild.tsx`, which stopped after opening the PR and waited for a human. That made low-risk changes queue behind manual review. Merging them unchecked was not safe either: "the build agent could drift beyond the issue description" (#327). The decision covers `adws/adwChore.tsx`, `adws/phases/diffEvaluationPhase.ts`, `adws/agents/diffEvaluatorAgent.ts` and `.claude/commands/diff_evaluator.md`.

## Decision Drivers

* Chores should ship without a human in the path.
* The classification of an issue as a chore says what was asked, not what the build agent changed.
* `/pr_review` work "must never auto-merge" (#327).

## Considered Options

For where the chore pipeline lives:

* A dedicated orchestrator, `adwChore.tsx`
* Keeping chores on `adwPlanBuild.tsx` and adding the gate there. #327 does not list this as an option; it follows from the reason the issue gives for the dedicated orchestrator.

For the gate itself, none recorded.

## Decision Outcome

Chosen option: "a dedicated orchestrator", because it "avoids contaminating `/pr_review` routing through `adwPlanBuild.tsx`" (#327).

After the build, an LLM judges the diff and the verdict decides how much scrutiny the chore gets.

* **The judge.** `/diff_evaluator` runs on Haiku and returns `{"verdict": "safe | regression_possible", "reason": "..."}`. Haiku was chosen as enough for "binary classification on small diffs".
* **`safe`** applies only when every change is documentation, CI configuration, behaviour-neutral config, a version bump or a pure rename. The chore skips review and documentation and goes to approval and merge.
* **`regression_possible`** applies when any change touches application source, tests, build or runtime config, or adds or removes a package. The chore escalates to review, with its patch loop, and documentation before approval.
* **Fail-safe.** An agent error or an unparseable answer counts as `regression_possible`.
* **Audit trail.** Verdict and reason are posted as a comment on the issue.
* **Routing.** `/chore` issues go to `adwChore.tsx`. The chore path has no scenario writer and no plan-scenario alignment.

### Consequences

* Good, because most chores merge without a human and without the cost of a review agent.
* Good, because a build that strays into source code is caught by what it changed, not by how the issue was labelled.
* Bad, because the gate is an LLM judgement on a cheap model; a wrong `safe` verdict skips review entirely.
* Bad, because an escalated chore gets review without ever having had issue-specific scenarios written for it.

### Confirmation

Checked against the code on 2026-09-29:

* `adws/types/issueRouting.ts` maps `'/chore'` to `adws/adwChore.tsx`.
* `adws/core/modelRouting.ts` maps `'/diff_evaluator'` to `'haiku'`.
* `executeDiffEvaluationPhase` initialises `verdict` to `'regression_possible'` and keeps it when the agent throws or returns no parsed verdict. `diffEvaluatorSchema` restricts `verdict` to the two values.
* `adwChore.tsx` runs the review loop and the document phase only when `diffResult.verdict !== 'safe'`.
* `features/regression/smoke/adw_chore_diff_verdicts.feature` and `features/regression/surfaces/row-09-adwReview-diffEvaluationPhase-happy.feature` are written for the gate, but they do not execute it: their When steps are pending. See [ADR-0037](0037-tiered-regression-suite-with-fixed-vocabulary.md). No test or CI gate enforces this decision today.

## More Information

The code has moved on from the pipeline drawn in #327. None of this changes the gate:

* The diff is evaluated before the PR is opened, not after, because the phase needs the worktree.
* Step definitions, unit tests and the scenario test loop run for every chore, before the gate. In #327 tests ran only on escalation.
* An empty diff is classed `safe` without calling the agent.
* The orchestrator no longer merges. It pre-approves the PR when the issue has no `hitl` label and stops at `awaiting_merge`; see [ADR-0028](0028-orchestrators-stop-at-awaiting-merge.md) and [ADR-0038](0038-stateless-merge-gate.md).
* `/pr_review` now has its own orchestrator, `adwPrReview.tsx`.

Related:

* An escalated chore has a review loop, so the review-failed gate applies to it. `adwChore.tsx` does not test `reviewPassed` after the loop. That divergence is recorded in [ADR-0048](0048-one-adwid-per-issue-and-review-failed-gate.md).
* Model choice per command is recorded in [ADR-0010](0010-model-and-effort-routing-per-command.md).
* `README.md` says an unguarded auto-merge once produced a regression that led to this design. #327 records no such incident; the claim was not verified.
