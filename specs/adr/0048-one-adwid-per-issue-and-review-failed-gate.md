---
status: accepted
date: 2026-06-29
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/prd/pr-review-adwid-consolidation-and-review-failed-gate.md
  - kind: contemporaneous
    source: specs/issue-719-*.md, specs/issue-720-*.md, specs/issue-721-*.md, specs/issue-722-*.md
  - kind: recalled
    source: "Martin Koster, 2026-09-29"
supersedes: []
superseded-by: []
---

# One adwId per issue, and a failed review blocks the workflow

## Context and Problem Statement

Issue #712 (PR #715) got stuck. The SDLC orchestrator had left it at `awaiting_merge` ([ADR-0028](0028-orchestrators-stop-at-awaiting-merge.md)). A human review comment then started PR-review runs, each of which minted its own adwId and ended at an inert stage. The cron resolves the owner of an issue from the newest adwId in its comments, so it began reading the PR-review state and stopped dispatching the merge. The PR stayed approved and unmerged until the merge orchestrator was run by hand on 2026-06-29.

The investigation found a second problem. When the review retry loop was exhausted with blockers unresolved, the orchestrator still created the PR and wrote `awaiting_merge`. The PRD notes that only the missing approval, branch protection and the `hitl` gate stood in the way of a bad merge.

## Decision Drivers

* An addressed PR must reach the merge path without manual invocation.
* Broken work must not ship silently.
* A failed review must not start an unattended loop of expensive reruns.
* State, logs and comments for one issue belong under one identity.

## Considered Options

None recorded. The PRD describes only the behaviour being replaced.

## Decision Outcome

Five changes, shipped as #719 to #722 on 2026-06-29.

* **PR-review hands off.** A PR-review run whose review passed writes `awaiting_merge`, and the existing cron merge dispatch picks it up.
* **`review_failed` stage.** An orchestrator that exhausts its review retries with blockers writes `review_failed` and stops. The stage is classified with `merge_blocked` and `human_gated`: the cron neither spawns nor merges it. A human recovers it with `## Retry` ([ADR-0032](0032-explicit-cancel-and-retry-directives.md)), which re-arms the workflow so the review runs again. On the SDLC path a failed review also skips the document phase and PR creation.
* **One shared gate.** The pure function `decidePostReviewOutcome(reviewPassed)` maps the verdict to the stage and is the single place where that decision is made.
* **One adwId per issue.** PR-review takes `(issueNumber, adwId)` and reuses the latest adwId in the issue's comments, the same resolver the cron uses. It generates a new one only when none exists. PRs not linked to an issue are skipped.
* **Resume routing.** `resolveResumeSpawn` reads the persisted `orchestratorScript` so that a retry resumes the orchestrator that failed. PR-review overwrites `orchestratorScript` when it takes over an SDLC adwId. The PRD states that resuming the SDLC orchestrator instead would drop the human's review comments, because SDLC works from the issue spec.

### Consequences

* Good, because the merge signal can no longer be shadowed by a newer adwId.
* Good, because a failed review is a visible, human-gated state and costs nothing until a human acts.
* Bad, because a `review_failed` SDLC issue has no PR; the human inspects the branch named in the issue comment.
* Bad, because issues that already carried several adwIds were not consolidated. The PRD expects discovery of the latest one to heal them after one cycle.
* Bad, because ADW does not act on PRs that are not linked to an issue.

### Confirmation

Checked on 2026-09-29:

* `adws/phases/decidePostReviewOutcome.ts` exists; `adws/adwSdlc.tsx` and `adws/adwPrReview.tsx` call it.
* `adws/core/stageClassifier.ts` maps `review_failed` to `human_gated`, pinned by `adws/core/__tests__/stageClassifier.test.ts`.
* `adws/triggers/cronIssueFilter.ts` returns `eligible: false` for `review_failed`, pinned by `adws/triggers/__tests__/cronIssueFilter.test.ts`.
* `adws/triggers/retryHandler.ts` handles `review_failed` and calls `resolveResumeSpawn`, as does the takeover path in `trigger_cron.ts`.
* `adws/adwPrReview.tsx` documents `<issueNumber> <adwId>` as its canonical form, and the cron and webhook spawn it that way. A PR number alone remains as a manual fallback.

Unit tests also cover `resolvePrReviewTarget` and `resolveResumeSpawn`. No CI gate checks that every orchestrator uses the gate.

## Divergence

The gate is not applied by every orchestrator that has a review loop. Reading the code on 2026-09-29:

* `adws/adwChore.tsx` runs a review loop when the diff judge escalates ([ADR-0027](0027-llm-diff-gate-for-chores.md)). After the loop it runs the document phase, opens the PR, pre-approves it when the issue has no `hitl` label, and writes `awaiting_merge` (lines 96 to 134). Nothing tests `reviewPassed`; the value is only stored in metadata.
* `adws/adwPlanBuildReview.tsx` and `adws/adwPlanBuildTestReview.tsx` likewise open the PR and write `awaiting_merge` after the loop without testing `reviewPassed`. They do not pre-approve.

Ruling by the owner on 2026-09-29: the gate applies to every orchestrator with a review loop. A chore normally has none; once the diff judge escalates, the normal review rules apply. The behaviour of `adwChore.tsx` is a bug. The ruling named `adwChore.tsx`; the other two orchestrators fall within its scope but were not named. The false green on #840 (2026-09-22) was a chore run.

## More Information

* Incident of record: #712 and PR #715.
* Stage taxonomy: [ADR-0036](0036-stage-taxonomy-and-exhaustive-classifier.md). Merge gate: [ADR-0038](0038-stateless-merge-gate.md).
* Whether an issue has been filed for the divergence was not checked.
