---
status: superseded
date: 2026-03-18
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/issue-225-adw-cwiuik-1773818764164-sdlc_planner-auto-merge-approved-pr.md
  - kind: contemporaneous
    source: specs/issue-258-adw-fvzdz7-auto-approve-and-mer-sdlc_planner-auto-approve-merge-after-review.md
  - kind: contemporaneous
    source: "commits e50bc44c (2026-03-18), 93ce7027 (2026-03-21)"
supersedes: []
superseded-by: ["0028"]
---

# Merge approved PRs from the webhook, then also from the orchestrator

## Context and Problem Statement

ADW opened pull requests but did not merge them. `trigger_webhook.ts` spawned `adwPrReview.tsx` for every `pull_request_review` event whatever the review state, so an approved PR went through another review cycle and the operator merged it by hand (#225). After that was fixed, a PR that had passed ADW's own review phase still waited for a human approval before anything merged it (#258).

## Decision Drivers

* #225: approved PRs "still go through a full PR review cycle instead of being merged", which caused "unnecessary delay and toil".
* #258: waiting for a manual approval "requires human attention for a routine step that the system has already validated".
* GitHub does not let the author of a PR approve it, and ADW authors PRs under its GitHub App identity ([ADR-0016](0016-github-app-identity.md)).

## Considered Options

None recorded.

## Decision Outcome

The decision was taken in two steps.

1. **Webhook merge (#225, 2026-03-18).** A `pull_request_review` event with state `approved` invoked an auto-merge handler in `adws/triggers/autoMergeHandler.ts` instead of spawning `adwPrReview.tsx`. The handler checked for conflicts against the base branch, ran the `/resolve_conflict` agent when there were any, pushed, and ran `gh pr merge --merge`. A merge that failed on a fresh conflict looped back, capped at `MAX_AUTO_MERGE_ATTEMPTS` (3); on exhaustion it commented on the PR. Other review states kept spawning `adwPrReview.tsx`.
2. **Orchestrator merge (#258, 2026-03-21).** `adwPlanBuildReview`, `adwPlanBuildTestReview` and `adwSdlc` gained a final phase, `executeAutoMergePhase`, that approved the PR and merged it once the review phase passed with no blockers. `approvePR()` unset `GH_TOKEN` for the call so the operator's `gh auth login` identity approved the bot-authored PR. The retry loop was extracted into a shared `mergeWithConflictResolution`. A failed merge was non-fatal: a PR comment, and the workflow still completed.

### Consequences

* Good, because a PR that passed review merged with no human step.
* Good, because conflict resolution and the retry loop lived in one shared function.
* Bad, because two code paths could merge the same PR. The #258 spec accepted this: "No webhook race condition guard is needed: if the orchestrator's approval triggers the webhook auto-merge path concurrently, the second merge attempt fails harmlessly because the PR is already merged."
* Bad, because the orchestrator needed its worktree until the merge finished.

### Confirmation

This decision is no longer in force. Checked on 2026-09-29:

* `grep -rn handleApprovedReview adws` matches only `adws/known_issues.md`.
* `trigger_webhook.ts` answers an approved review with `ignored`; its comment reads "Approved reviews are no-ops: merge is handled by cron + adwMerge.tsx".
* `grep -rn executeAutoMergePhase adws` shows the definition in `adws/phases/autoMergePhase.ts` and two re-exports, and no orchestrator calling it.

## More Information

* Replaced by [ADR-0028](0028-orchestrators-stop-at-awaiting-merge.md), which gives the reason.
* `mergeWithConflictResolution` survived the replacement and is called by `adws/adwMerge.tsx`.
* The `hitl` label gate was added to `executeAutoMergePhase` on 2026-03-27 (#329) while this decision was in force. The merge gate is recorded in [ADR-0038](0038-stateless-merge-gate.md).
