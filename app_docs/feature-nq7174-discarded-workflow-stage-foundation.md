# Discarded Workflow Stage Foundation

**ADW ID:** nq7174-orchestrator-resilie
**Date:** 2026-04-20
**Specification:** specs/issue-454-adw-nq7174-orchestrator-resilie-sdlc_planner-add-discarded-workflow-stage.md

## Overview

Introduces `discarded` as a first-class terminal `WorkflowStage` — the deliberate, non-retriable counterpart to `abandoned`. Before this change, the cron backlog sweeper treated all `abandoned` issues as re-eligible, causing an infinite respawn loop for deliberate exits like "operator closed the PR." This slice lays the foundation (type, skip predicates, write helper, comment formatter) without yet reclassifying any existing call site.

## What Was Built

- `discarded` added to the `WorkflowStage` union in `workflowTypes.ts`
- `cronIssueFilter.evaluateIssue` returns `{ eligible: false, reason: 'discarded' }` — skips before grace-period check
- `cronStageResolver` JSDoc updated to clarify why `discarded` is not retriable (guards against future regression)
- `handleWorkflowDiscarded(config, reason, costUsd?, modelUsage?)` helper in `workflowCompletion.ts` — writes `discarded`, posts terminal comment, exits 0
- `formatDiscardedComment` formatter and `case 'discarded'` switch arm in `workflowCommentsIssue.ts`
- `STAGE_HEADER_MAP` entry in `workflowCommentParsing.ts` so `parseWorkflowStageFromComment` round-trips the new header
- Unit tests in `cronStageResolver.test.ts` and `triggerCronAwaitingMerge.test.ts`

## Technical Implementation

### Files Modified

- `adws/types/workflowTypes.ts`: Added `'discarded'` to `WorkflowStage` union in the Terminal/handoff section
- `adws/triggers/cronIssueFilter.ts`: New `discarded` branch in `evaluateIssue`, placed before the grace-period check so deliberate terminals are never re-spawned
- `adws/triggers/cronStageResolver.ts`: Extended JSDoc on `isRetriableStage` to explain why `discarded` must not be added (loop-forever guard)
- `adws/phases/workflowCompletion.ts`: New exported `handleWorkflowDiscarded` function after `handleWorkflowError`
- `adws/github/workflowCommentsIssue.ts`: `formatDiscardedComment` function and `case 'discarded'` in `formatWorkflowComment` switch
- `adws/core/workflowCommentParsing.ts`: `':no_entry: ADW Workflow Discarded': 'discarded'` entry in `STAGE_HEADER_MAP`
- `adws/triggers/__tests__/cronStageResolver.test.ts`: `isActiveStage` and `isRetriableStage` assertions for `discarded`
- `adws/triggers/__tests__/triggerCronAwaitingMerge.test.ts`: Three new tests covering the skip path, grace-period ordering invariant, and `filterEligibleIssues` annotation

### Key Changes

- **`handleWorkflowDiscarded` exits 0, not 1**: A discard is a deliberate terminal decision (not a crash), matching `handleRateLimitPause` precedent. `handleWorkflowError` is untouched — it still writes `abandoned` and exits 1.
- **`discarded` check precedes the grace-period check** in `evaluateIssue`: ensures a recently-discarded issue cannot accidentally re-enter via the grace-period branch.
- **`completeExecution(..., true)`** (success flag) in `handleWorkflowDiscarded`: the orchestrator itself did not fail; the upstream decision terminated it cleanly.
- **`STAGE_ORDER` not extended**: that list drives resume-point calculation; terminal-failure stages are excluded from resume by design.
- **No call sites reclassified**: `adwMerge.tsx` and `webhookHandlers.ts` still write `abandoned` — reclassification is slice #2.

## How to Use

Slice #2 will call `handleWorkflowDiscarded` at each deliberate-terminal exit site. Pattern:

```ts
import { handleWorkflowDiscarded } from '../phases/workflowCompletion';

// Inside an orchestrator or adwMerge handler:
handleWorkflowDiscarded(config, 'pr_closed_by_operator');
// exits 0; writes workflowStage: 'discarded'; posts ## :no_entry: ADW Workflow Discarded comment
```

The `reason` string is forwarded as the **Reason:** line in the GitHub comment. Pass a short semantic label (`pr_closed`, `merge_failed_after_retries`, etc.) rather than a full sentence.

## Configuration

No new configuration. The `WorkflowStage` union is the conceptual enum; `AgentState.workflowStage` remains typed as `string` at runtime, so no schema migration is needed for existing state files.

## Testing

```bash
bun vitest run adws/triggers/__tests__/cronStageResolver.test.ts
bun vitest run adws/triggers/__tests__/triggerCronAwaitingMerge.test.ts
bun run test:unit
bunx tsc --noEmit -p adws/tsconfig.json
```

## Notes

- `handleWorkflowDiscarded` has no dedicated unit test in this slice — the first real call site arrives in slice #2 (`adwMerge.tsx` reclassification), which will exercise the helper end-to-end.
- A future iteration may want a dedicated "Discarded" board column. For now, `handleWorkflowDiscarded` moves the issue to `BoardStatus.Blocked`, matching `handleWorkflowError` behaviour.
- The issue acceptance criterion names `cronIssueFilter.test.ts`; the repo's actual test file for that module is `triggerCronAwaitingMerge.test.ts`. Coverage is equivalent — extending the existing file avoids fragmenting tests for the same module.
