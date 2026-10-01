---
status: accepted
date: 2026-04-09
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/issue-27-adw-add-clear-comments-5xsyia-sdlc_planner-add-clear-comments-listener.md
  - kind: contemporaneous
    source: specs/issue-425-adw-9jpn7u-replace-clear-with-c-sdlc_planner-replace-clear-with-cancel.md
  - kind: contemporaneous
    source: specs/issue-527-adw-22y8n3-adwmerge-dead-ends-i-sdlc_planner-merge-blocked-recovery-path.md
  - kind: contemporaneous
    source: specs/issue-908-adw-2fgeai-retry-resumes-a-work-sdlc_planner-retry-resumes-paused-workflow.md
supersedes: []
superseded-by: []
---

# A human steers a workflow with `## Cancel` and `## Retry` comments

## Context and Problem Statement

An operator needs to intervene in a workflow from the issue itself, without a terminal on the ADW host. The first directive, `## Clear` (#27, 2026-02-26), only deleted the issue's comments. Agent processes, worktrees, local branches and `agents/<adwId>/` directories stayed behind and had to be cleaned by hand before the issue could run again (#425). Later, stages that automation must never leave on its own (`merge_blocked`, and afterwards `human_gated`, `review_failed` and a stranded `paused`) needed a way back that did not destroy the work done so far.

## Decision Drivers

* Re-running an issue must not need manual cleanup on the host.
* A stage that stops automatic retries, to prevent respawn loops, must still be recoverable by a person.
* A directive must never start a second orchestrator next to a live one.

## Considered Options

For recovering a failed merge (#527):

* Keep the terminal `discarded` stage and merge by hand
* Use `## Cancel`
* Add a second, targeted directive, `## Retry`

For the original reset (#425), none recorded.

## Decision Outcome

Two heading-based directives, matched case-insensitively on a line of their own (`/^## Cancel$/mi`, `/^## Retry$/mi`), handled by both triggers. The cron acts when the directive is the latest comment on an issue; the webhook acts on the `issue_comment` event.

* **`## Cancel` is the full reset.** `handleCancelDirective` sends SIGTERM to each orchestrator PID found through the adwIds in the comments, removes the issue's worktrees, deletes each `agents/<adwId>/` directory, clears the issue's comments and drops the issue from the cron's dedup set. Each step logs and continues on error. The issue then reads as fresh and is picked up again.
* **`## Retry` is the targeted recovery.** Chosen for #527 because `## Cancel` "is too heavy and routes to a full re-spawn, not a targeted merge re-attempt", while `discarded` removed the issue from automation for good. `decideRetryAction` maps the stage to one action:

| Stage | Action |
|---|---|
| `merge_blocked` | write `awaiting_merge`, clear `mergeRetryCount` |
| `human_gated`, `review_failed` | write `phase_timeout`, reset `resumeAttempts` |
| `paused` | remove the pause-queue entry, respawn the owning orchestrator, post the `resumed` comment |
| `paused_auth`, any active stage, anything else | nothing, with a log line giving the reason |

### Consequences

* Good, because the anti-loop stages stay closed to automation and open to a person.
* Good, because `## Retry` on the first three stages is a state write only; the worktree and branch are kept.
* Bad, because `## Cancel` deletes the issue's comment history and local state; nothing of the cancelled run remains on the issue.
* Bad, because the `paused` path releases the spawn lock right after spawning, so a second directive in that gap starts a duplicate that exits when it cannot take the lock. #908 accepts this window.
* Bad, because a child that dies at startup after `## Retry` on `paused` leaves no queue entry; the operator has to post `## Retry` again (#908).

### Confirmation

Checked against the code on 2026-09-29:

* `CANCEL_COMMENT_PATTERN` and `RETRY_COMMENT_PATTERN` are in `adws/core/workflowCommentParsing.ts`; `grep -rn "isClearComment\|## Clear" adws README.md` returns nothing.
* `trigger_cron.ts` and `trigger_webhook.ts` both call `handleCancelDirective` and `handleRetryDirective`.
* `decideRetryAction` in `adws/triggers/retryHandler.ts` has the four paths in the table.
* `cancelHandler.test.ts` and `retryHandler.test.ts` exist but could not be loaded in this checkout because `@paysdoc/devplatform` is not installed; they were not run.
* `features/regression/smoke/cancel_directive.feature` does not exercise `cancelHandler.ts`. The `cancelled` stage it asserts is written by its fixture (`test/fixtures/jsonl/manifests/cancel-directive.json`); no code under `adws/` writes that stage.
* Removal of local branches, listed in #425, happens inside `gitContext.removeWorktreesForIssue` from `@paysdoc/devplatform` and was not checked.

## More Information

* `merge_blocked` and the merge handoff: [ADR-0028](0028-orchestrators-stop-at-awaiting-merge.md). `human_gated`: [ADR-0047](0047-resume-in-place.md). `review_failed`: [ADR-0048](0048-one-adwid-per-issue-and-review-failed-gate.md). `paused`: [ADR-0025](0025-rate-limit-pause-and-resume-queue.md) and [ADR-0055](0055-rate-limit-structured-signals-two-tier-wait.md).
* A third heading directive, `## Continue` (`ACTIONABLE_COMMENT_PATTERN`), starts or continues a workflow from a comment. #27 names its predecessor `## Take action`; the sources read for this ADR do not record the rename.
* `UBIQUITOUS_LANGUAGE.md` describes `## Retry` as a no-op for every stage except `merge_blocked`. That is out of date; the code has four paths.
