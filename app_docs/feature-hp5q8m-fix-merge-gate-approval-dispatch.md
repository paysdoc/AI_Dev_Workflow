# Fix Merge Gate: Replace hitl-Label Gate with PR-Approval Dispatch

**ADW ID:** hp5q8m-awaiting-merge-repla
**Date:** 2026-04-25
**Specification:** specs/issue-488-adw-hp5q8m-awaiting-merge-repla-sdlc_planner-fix-merge-gate-approval-dispatch.md

## Overview

Two compounding defects in the `awaiting_merge` dispatch path caused auto-merge to silently never fire after a human approved a PR: (1) the merge-gate checked the `hitl` label instead of GitHub's authoritative PR approval state, and (2) the dedup primitive (`processedMerges`) was a process-lifetime in-memory Set that permanently suppressed re-dispatch after any non-merge exit. This fix replaces both with correct primitives — `fetchPRApprovalState` as the gate and the on-disk spawn lock as the dedup signal.

## What Was Built

- New `mergeDispatchGate.ts` module exporting `shouldDispatchMerge()` — a lock-aware helper that replaces the process-lifetime `processedMerges` Set
- Rewritten `fetchPRApprovalState` in `prApi.ts` — queries GitHub's `reviewDecision` field (authoritative for branch-protected repos) with a per-reviewer-latest fallback for unprotected repos
- New exported helper `isApprovedFromReviewsList()` for unit-testable per-reviewer aggregation
- Swapped merge gate in `adwMerge.tsx` from `issueHasLabel('hitl')` to `fetchPRApprovalState(prNumber, repoInfo)`; non-approved exits return `awaiting_approval` without writing state
- Removed `processedMerges` Set and `merges` field from `ProcessedSets` / `MutableProcessedSets` across `trigger_cron.ts`, `cronIssueFilter.ts`, and `cancelHandler.ts`
- New unit test files: `mergeDispatchGate.test.ts` and `prApi.test.ts`
- Updated BDD feature file `hitl_label_gate_automerge.feature` with `@adw-488` approval-gate and lock-semantics scenarios; new step definitions in `mergeDispatchGateSteps.ts`

## Technical Implementation

### Files Modified

- `adws/github/prApi.ts`: Added `isApprovedFromReviewsList()` helper; rewrote `fetchPRApprovalState` to query `reviewDecision,reviews` and apply the correct fallback logic
- `adws/adwMerge.tsx`: Swapped `issueHasLabel` for `fetchPRApprovalState` in `MergeDeps`, `buildDefaultDeps()`, and `executeMerge()`; exit reason changed from `hitl_blocked` to `awaiting_approval`; no state write on skip
- `adws/triggers/mergeDispatchGate.ts` *(new)*: `shouldDispatchMerge(repoInfo, issueNumber, deps?)` — reads spawn lock, returns false only when a live PID holds the lock
- `adws/triggers/trigger_cron.ts`: Removed `processedMerges` Set; removed `merges` from `handleCancelDirective` and `filterEligibleIssues` calls; inserted `shouldDispatchMerge` guard before merge spawn
- `adws/triggers/cronIssueFilter.ts`: Dropped `merges` field from `ProcessedSets`; removed `processed.merges.has()` branch from `evaluateIssue`; updated doc comments
- `adws/triggers/cancelHandler.ts`: Dropped `merges` field from `MutableProcessedSets`; removed `processedSets.merges.delete()` call
- `adws/__tests__/adwMerge.test.ts`: Replaced hitl-gate test block with approval-gate block (approved → merges; not approved → `awaiting_approval`, no state write; terminal states win)
- `adws/github/__tests__/prApi.test.ts` *(new)*: Full coverage of `fetchPRApprovalState` and `isApprovedFromReviewsList` cases
- `adws/triggers/__tests__/mergeDispatchGate.test.ts` *(new)*: Four lock-semantics cases (no lock, dead PID, live PID, malformed)
- `adws/triggers/__tests__/triggerCronAwaitingMerge.test.ts`: Removed `processed.merges` fixture fields and deleted two suppressed-merge test cases
- `adws/triggers/__tests__/cancelHandler.test.ts`: Removed `merges` from `MutableProcessedSets` fixtures
- `features/hitl_label_gate_automerge.feature`: Added `@adw-488` approval-gate and `shouldDispatchMerge` lock-semantics scenarios; dropped `@adw-483` adwMerge hitl-gate scenarios
- `features/merge_dispatch_gate_lock_aware.feature` *(new)*: Dedicated feature for lock-aware dispatch scenarios
- `features/step_definitions/mergeDispatchGateSteps.ts` *(new)*: Step definitions for lock-aware dispatch BDD scenarios
- `features/step_definitions/hitlLabelGateAutomergeSteps.ts`: Extended with approval-gate step helpers

### Key Changes

- **Gate replacement**: `adwMerge` no longer blocks on `issueHasLabel('hitl')`; it blocks on `fetchPRApprovalState()`. Removing the `hitl` label is no longer required to trigger a merge.
- **Correct approval semantics**: `fetchPRApprovalState` now prioritizes `reviewDecision === 'APPROVED'` (server-computed, handles CODEOWNERS and required reviewers) and falls back to per-reviewer-latest aggregation only when `reviewDecision` is `null`.
- **Lock-aware dedup**: `shouldDispatchMerge` consults the on-disk spawn lock (`readSpawnLockRecord` + `isProcessLive`) — the same lock `adwMerge` acquires via `runWithRawOrchestratorLifecycle`. A dead-PID or absent lock → dispatch; a live-PID lock → defer for one cycle.
- **No state write on skip**: When `fetchPRApprovalState` returns false, `executeMerge` returns `{ outcome: 'abandoned', reason: 'awaiting_approval' }` without calling `writeTopLevelState`. `workflowStage` remains `awaiting_merge` so the cron re-dispatches on the next cycle.
- **`processedMerges` removed**: The in-memory Set (process-lifetime, could never recover without cron restart) is fully removed. `ProcessedSets` now contains only `spawns`.

## How to Use

This fix is transparent to operators and requires no configuration changes. The changed behavior is:

1. **Before**: Human approves PR → must also remove `hitl` label → cron re-dispatches → merge fires
2. **After**: Human approves PR → on the next cron cycle (≤20s), `adwMerge` dispatches and checks `fetchPRApprovalState` → merge fires

To recover any issue currently stuck due to the old `processedMerges` bug, restart the cron process. After restart, all `awaiting_merge` issues re-evaluate; approved ones will merge on the next cycle.

## Configuration

No new configuration required. The `hitl` label is still applied by `autoMergePhase` as an informational marker (useful for GitHub-side filtering), but it is no longer load-bearing for merge dispatch.

## Testing

```bash
# Unit tests
bun run test:unit

# BDD — new approval-gate and lock-semantics scenarios
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-488"

# BDD — remaining hitl-gate (autoMergePhase) scenarios still pass
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-329-hitl-label-gate"

# Full regression suite
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

Key unit test cases:
- `mergeDispatchGate.test.ts`: no lock → dispatch; dead PID → dispatch; live PID → defer; malformed lock → dispatch
- `prApi.test.ts`: `reviewDecision === 'APPROVED'` → true; CHANGES_REQUESTED → false; null + per-reviewer cases
- `adwMerge.test.ts`: approved → merges; not approved → `awaiting_approval`, no state write; terminal PR states win

## Notes

- The `reason: 'awaiting_approval'` literal replaces `'hitl_blocked'`. Log readers watching for `hitl_blocked` will need updating; no current code branches on that string except `main()`'s exit-code check, which only exits 1 on `merge_failed`.
- `processedSpawns` is intentionally unchanged — it has a similar latent bug class but a smaller blast radius and is out of scope per the issue.
- For unprotected repos (no required reviewers), `reviewDecision` is `null`; `isApprovedFromReviewsList` is the fallback. It correctly handles: approval-then-changes-requested by same reviewer (latest wins), DISMISSED reviews (ignored in latest-review aggregation), `null` author entries (skipped defensively).
- The `hitl` label write in `autoMergePhase.ts` is preserved — it remains useful for GitHub Projects filtering and is explicitly out of scope.
