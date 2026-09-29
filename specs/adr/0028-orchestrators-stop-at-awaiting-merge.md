---
status: accepted
date: 2026-04-03
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/issue-380-adw-bpn4sv-orchestrators-exit-a-sdlc_planner-orchestrator-awaiting-merge-handoff.md
  - kind: contemporaneous
    source: specs/issue-381-adw-dcy9qz-create-thin-merge-or-sdlc_planner-merge-orchestrator-cron-handoff.md
  - kind: contemporaneous
    source: specs/issue-382-adw-lvakyr-remove-webhook-auto-sdlc_planner-simplify-webhook-handlers.md
  - kind: contemporaneous
    source: "adws/known_issues.md, entry duplicate-auto-merge (first seen 2026-04-02)"
supersedes: ["0017"]
superseded-by: []
---

# Orchestrators stop at `awaiting_merge`; the cron spawns a merge orchestrator

## Context and Problem Statement

Under [ADR-0017](0017-auto-merge-by-webhook-then-orchestrator.md) two code paths merged pull requests: the webhook on an approved review, and `executeAutoMergePhase` at the end of each review-capable orchestrator. The orchestrator's own approval fired the webhook path, so both ran for the same PR. `adws/known_issues.md` records the result: both "invoke `/resolve_conflict` agents independently, both try to push and merge", and whichever merged first triggered worktree cleanup, so the other failed with `spawnSync /bin/sh ENOENT`. Separately, phases that ran after PR creation kept the worktree alive until the orchestrator exited (#380).

## Decision Drivers

* One merge path, so that two processes never resolve conflicts for the same PR.
* Nothing that needs the worktree runs after the PR is opened.
* The webhook does no orchestration (#382: three handlers "perform overlapping orchestration").

## Considered Options

None recorded. The #380 spec, written the same morning, still said that merging "shifts to the webhook-triggered auto-merge handler"; #381 and #382 placed it with the cron instead. No comparison of the two is recorded.

## Decision Outcome

Building and merging are separate processes joined by one state value.

* **Orchestrators stop.** Once the PR is open an orchestrator writes `workflowStage: 'awaiting_merge'` to the top-level state file ([ADR-0029](0029-top-level-state-file-as-source-of-truth.md)) as its last stage write and exits. It does not call `completeWorkflow`, which would overwrite the stage with `completed`. #380 moved the document and diff-evaluation phases ahead of the PR phase because they need the worktree.
* **The cron dispatches.** `evaluateIssue` returns action `merge` for `awaiting_merge`, bypassing the grace period because the original orchestrator has exited. The cron spawns `adwMerge.tsx <issueNumber> <adwId>` and skips the dependency and concurrency checks.
* **`adwMerge.tsx` merges.** It does not call `initializeWorkflow()`. It reads the state, finds the PR by branch name, applies the merge gate ([ADR-0038](0038-stateless-merge-gate.md)), calls `mergeWithConflictResolution`, then writes `completed` and posts the completion comment.
* **The webhook does not merge.** `handleApprovedReview` was removed; an approved review is answered `ignored`. `pull_request.closed` marks abandoned PRs only, and `issues.closed` is the single cleanup point.

### Consequences

* Good, because exactly one process type merges, and it holds the per-issue spawn lock while it does.
* Good, because the orchestrator's lifetime is no longer tied to the merge.
* Bad, because merging depends on a live cron for the repository. #501 had to make the webhook ensure the cron on every delivery after PRs stayed in `awaiting_merge` ([ADR-0012](0012-webhook-gatekeeper-cron-sweeper.md)).
* Bad, because `adwMerge.tsx` may have to recreate a worktree (`ensureWorktree`) to resolve conflicts.
* Bad, because `executeAutoMergePhase` is still exported from `adws/phases/autoMergePhase.ts` although no orchestrator calls it.

### Confirmation

Checked against the code on 2026-09-29:

* `grep -rn awaiting_merge adws/*.tsx` shows the write in `adwSdlc.tsx`, `adwChore.tsx`, `adwPlanBuildReview.tsx` and `adwPlanBuildTestReview.tsx`; `adwPrReview.tsx` writes it through `completePRReviewWorkflow`.
* `adws/triggers/trigger_cron.ts` spawns `adws/adwMerge.tsx` for action `merge`, guarded by `shouldDispatchMerge`.
* `grep -rn handleApprovedReview adws` matches only `adws/known_issues.md`.
* `bunx vitest run` on `triggerCronAwaitingMerge.test.ts` and `cronIssueFilter.test.ts` passed. `adws/__tests__/adwMerge.test.ts` and `mergeDispatchGate.test.ts` could not be loaded in this checkout because `@paysdoc/devplatform` is not installed; they were not run.
* `features/regression/smoke/adw_sdlc_happy_path.feature` and `adw_chore_diff_verdicts.feature` assert the `awaiting_merge` stage and zero PR-merge calls. They were not run for this ADR.

## More Information

Later changes that kept the decision and refined it:

* #434 (2026-04-16) moved PR approval out of the orchestrators into the review phase.
* #488 (2026-04-25) replaced the cron's in-memory `processedMerges` set with a check of the on-disk spawn lock (`adws/triggers/mergeDispatchGate.ts`), so an `adwMerge` that exits without merging is dispatched again.
* #527 (2026-05-26) added the `merge_blocked` stage for merges that cannot complete; recovery is by `## Retry` ([ADR-0032](0032-explicit-cancel-and-retry-directives.md)).
* Whether `awaiting_merge` may be written after a failed review is recorded in [ADR-0048](0048-one-adwid-per-issue-and-review-failed-gate.md).
* Unresolved: #380 says nothing that needs the worktree runs after PR creation. Today `adwSdlc.tsx` runs `executeProofPublishPhase` and `executePromotionRotAdvisory` between the PR phase and the `awaiting_merge` write, and `adws/phases/promotionRotAdvisory.ts` runs its agent with `cwd: worktreePath`. `adwPlanBuildTestReview.tsx` also runs `executeProofPublishPhase` there. No source records whether the #380 rule was relaxed on purpose.
