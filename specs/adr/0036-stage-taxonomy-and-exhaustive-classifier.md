---
status: accepted
date: 2026-04-20
recorded: 2026-09-29
provenance:
  - kind: contemporaneous
    source: specs/prd/orchestrator-coordination-resilience.md
  - kind: contemporaneous
    source: specs/issue-454-adw-nq7174-orchestrator-resilie-sdlc_planner-add-discarded-workflow-stage.md
  - kind: contemporaneous
    source: specs/issue-460-adw-29w5wf-orchestrator-resilie-sdlc_planner-reclassify-abandoned-discarded.md
  - kind: contemporaneous
    source: specs/issue-636-adw-d0hv98-refactor-exhaustive-sdlc_planner-exhaustive-stage-classifier.md
  - kind: contemporaneous
    source: specs/issue-637-adw-tg4om4-fix-make-phase-timeo-sdlc_planner-recover-phase-timeout-stage.md
supersedes: []
superseded-by: []
---

# Every workflow stage has one recovery class, and the compiler checks that none is missed

## Context and Problem Statement

Every recovery decision (respawn, take over, skip, merge) is derived from one field, the persisted `workflowStage`. Two problems came up two months apart.

In April 2026 the stage `abandoned` was used for three different situations: a crash, a defensive exit of the merge orchestrator, and a PR closed by a human. All passed through the same "is retriable" predicate. The PRD: some paths "retry forever when they should stay terminal".

In June 2026 the meaning of a stage was spread over three hand-written string predicates in `cronStageResolver.ts` and `takeoverHandler.ts`. A new stage matched none of them and the compiler said nothing. The watchdog's stage `phase_timeout` was written but never recovered, which stranded issue #612 for hours (#636, #637).

## Decision Drivers

* A human's "no" (a closed PR) must not be retried.
* A new stage must not be able to fall through every recovery path unnoticed.
* Cron and takeover decide differently for the same stage, and that difference should be written down.

## Considered Options

* For `phase_timeout`: move it into the `retriable` class, or keep its class and add a branch for it in each consumer.
* For the old predicate `isActiveStage`: delete it, or keep it as a bridge for two consumers.

No alternatives to the abandoned/discarded split or to the exhaustive `switch` are recorded.

## Decision Outcome

1. 2026-04-20 (PRD, #454, #460). `abandoned` means a transient failure that may be retried. A new stage `discarded` means a terminal outcome that is never retried. Each write site was reclassified by what the exit means. A PR closed without merge writes `discarded`. `handleWorkflowError` keeps writing `abandoned`, and `handleWorkflowDiscarded` exists so that "the call site's intent is explicit at the point of writing". The cron sweeper skips `discarded` as it skips `completed`. State files already on disk were not migrated.
2. 2026-06-19 (#636). `classifyStage` in `adws/core/stageClassifier.ts` maps every `WorkflowStage` literal to one of six classes: `active`, `awaiting_merge`, `retriable`, `resumable`, `terminal`, `human_gated`. It is a `switch` whose `default` assigns the stage to `never`, so a stage without a case fails to compile. `classifyStageString` handles the raw strings that the phase runner writes (`<phase>_running`, `<phase>_completed`). The change preserved behaviour.
3. 2026-06-19 (#637). `phase_timeout` stays `resumable` and gets its own recovery branch in the cron filter and in the takeover handler. The plan chose this over reclassifying because it "keeps every other `resumable` stage" unchanged. `isActiveStage` was kept as a bridge for `devServerJanitor` and `webhookHandlers`, because the `active` class is a different set and switching could let the janitor remove the worktree of a live orchestrator.

A class does not fix an action. Each consumer maps the class to its own decision.

### Consequences

* Good, because adding a stage without classifying it is a build error.
* Good, because a closed PR stays closed, and a transient failure is retried.
* Good, because the family matching on stage strings lives in one function.
* Bad, because recovery for `phase_timeout` is keyed on the raw stage string in two consumers, outside the taxonomy.
* Bad, because the phase runner writes stage strings that are not in the `WorkflowStage` union, so the compiler guard does not cover them.
* Bad, because more than one definition of "in progress" remains: the `active` class, the `isActiveStage` bridge, and the hung detector's own `endsWith('_running')` test.

### Confirmation

Checked on 2026-09-29.

* `adws/core/stageClassifier.ts` contains the `never` guard. `cronIssueFilter.ts`, `cronStageResolver.ts` and `takeoverHandler.ts` import `classifyStageString`.
* `'discarded'` is written in `adwMerge.tsx` (PR closed), `webhookHandlers.ts` (PR closed) and `workflowCompletion.ts`, and excluded in `cronIssueFilter.ts`.
* `adws/core/__tests__/stageClassifier.test.ts` was run with Vitest and passed.
* The compile-time guard is enforced by `bunx tsc --noEmit` (`bun run test`). It was not run for this record, because `@paysdoc/devplatform` is not installed in the checkout used. No CI workflow runs the type check or the unit tests.

## More Information

* The taxonomy has grown since. Today `terminal` holds `completed`, `discarded`, `paused` and `paused_auth` ([ADR-0039](0039-host-wide-auth-gate.md)); `human_gated` holds `merge_blocked` ([ADR-0038](0038-stateless-merge-gate.md)), `human_gated` ([ADR-0047](0047-resume-in-place.md)) and `review_failed` ([ADR-0048](0048-one-adwid-per-issue-and-review-failed-gate.md)).
* The PRD of April classified a merge that failed after all retries as `discarded`. `adwMerge.tsx` writes `merge_blocked` for it today; that change belongs to [ADR-0038](0038-stateless-merge-gate.md).
* The plans for #636 and #637 name a parent PRD, `specs/prd/stage-recovery-resume-in-place.md`. It is not in the repository, and the #636 plan says it inferred the taxonomy from the issue body and the existing predicates. The class names could therefore not be checked against that PRD.
* `hungOrchestratorDetector.ts` was left outside the classifier by #636 as a follow-up. It still has its own test (line 73).
* The rest of the April PRD is recorded in [ADR-0034](0034-coordination-kernel.md).
