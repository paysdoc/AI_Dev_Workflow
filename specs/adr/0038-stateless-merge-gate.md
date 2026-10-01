---
status: accepted
date: 2026-04-26
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/issue-329-adw-fygx90-add-hitl-label-gate-sdlc_planner-hitl-label-gate.md
  - kind: contemporaneous
    source: specs/issue-496-adw-tvqgz4-auto-merge-unify-cho-sdlc_planner-unify-auto-merge-hitl-gate.md
  - kind: contemporaneous
    source: specs/issue-848-adw-izqk31-review-phase-approve-sdlc_planner-fix-review-phase-hitl-approval-gate.md
  - kind: contemporaneous
    source: "specs/issue-483-adw-nrr167-*.md and specs/issue-488-adw-hp5q8m-*.md (the two gates that preceded this one)"
supersedes: []
superseded-by: []
---

# The merge gate is one stateless rule: no `hitl` label, or an approved PR

## Context and Problem Statement

ADW merges its own pull requests ([ADR-0028](0028-orchestrators-stop-at-awaiting-merge.md)). Some issues need a person to look before code lands. The `hitl` issue label was introduced for that on 2026-03-27 (#329), inside the auto-merge phase. When merging moved to `adwMerge.tsx` the gate was lost, restored as a label check (#483), then replaced by an approval check (#488). Under the approval-only gate "an unlabeled chore PR on a repo with no branch protection cannot auto-merge unless a human approves it", and chore PRs "sit in `awaiting_merge` forever" (#496). An in-memory dedup set also kept a deferred issue filtered for the lifetime of the cron (#488).

## Decision Drivers

* Unattended merge is the default; holding a merge is an explicit opt-in per issue.
* A human approval must be enough to release a held merge, without also removing the label.
* No stored gate state that can go stale.

## Considered Options

* Label-only gate: merge unless the issue has `hitl` (#483)
* Approval-only gate: merge only when the PR is approved (#488)
* Unified gate: no `hitl` on the issue, or the PR is approved (#496)
* A terminal `blocked_hitl` stage with a manual re-entry (#483)

## Decision Outcome

Chosen option: "unified gate", because approval "was meant to be one of two ways to satisfy the gate, not a replacement" (#496). `blocked_hitl` was rejected in #483 because it needed cron filter changes and a re-entry mechanism, while re-checking each cycle is cheap.

```
gate_open = (no hitl on issue) OR (PR is approved)
```

* `adwMerge.tsx` evaluates the rule on every dispatch, from the live label and the live approval state. When the gate is closed it logs and returns; it writes no state and posts no comment, so the stage stays `awaiting_merge` and the next cron tick asks again.
* `hitl` is read from the issue, never from the PR.
* Every automated approval honours the label. There are two approval sites: the review phase on a passing review, and the chore orchestrator's pre-approval. Both read the issue's labels at approval time and skip when `hitl` is present (#848).
* A review with `CHANGES_REQUESTED` does not hold a merge on an unlabelled issue; only `hitl` does.

### Consequences

* Good, because removing `hitl` or approving the PR releases the merge on the next tick, in either order.
* Good, because there is nothing to reset after a `## Cancel` or a cron restart.
* Bad, because ADW's approval is submitted under the operator's credential and GitHub records it as the operator's. The gate cannot tell it from a human approval, so an approval site that skips the label check defeats `hitl`. This happened on #840 / PR #843 on 2026-09-23 and is what #848 fixed.
* Bad, because a `hitl` label added after an automated approval does not hold the merge. #496 accepts the race; `## Cancel` is the only stop.
* Bad, because the cron spawns an `adwMerge` process on every tick for each held issue.

### Confirmation

Checked against the code on 2026-09-29:

* `executeMerge` in `adws/adwMerge.tsx` reads `issueHasLabel(issueNumber, 'hitl')` and `fetchPRApprovalState(prNumber)` and returns `hitl_blocked_unapproved` without a state write when the label is present and the PR is not approved.
* `grep -rn "approvePullRequest(" adws` outside tests gives two call sites, `adws/phases/reviewPhase.ts` and `adws/adwChore.tsx`; both check `hitl` first.
* `adws/__tests__/adwMerge.test.ts` has a "hitl × approved gate matrix" for the four rules, and `adws/phases/__tests__/reviewPhaseApprovalGate.test.ts` covers the review site. Neither could be loaded in this checkout because `@paysdoc/devplatform` is not installed; they were not run.
* Not checked: the #848 spec says the GitHub tracker's `fetchLabels` returns an empty list on error, which would make the label read fail-open. That code is in `@paysdoc/devplatform`.

## More Information

* The gate does not look at CI checks. See [ADR-0037](0037-tiered-regression-suite-with-fixed-vocabulary.md) and [ADR-0019](0019-dev-and-main-branches-with-runner-clone.md).
* Whether a PR may be approved and handed to the gate after a failed review is recorded in [ADR-0048](0048-one-adwid-per-issue-and-review-failed-gate.md).
* #496 also fixed `fetchPRApprovalState` for repositories without branch protection, where `gh pr view --json reviewDecision` returns an empty string.
* `adws/phases/autoMergePhase.ts` still contains the older gate, including a line that adds the `hitl` label when no approval exists. No orchestrator calls that phase.
