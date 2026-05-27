# adwMerge: branchName top-level state resolution

**ADW ID:** bbwalf-adwmerge-reads-branc
**Date:** 2026-05-27
**Specification:** specs/issue-530-adw-bbwalf-adwmerge-reads-branc-sdlc_planner-adwmerge-read-branchname-top-level.md

## Overview

`adwMerge` was stranding completed workflows in the unrecoverable `abandoned` state because it read `branchName` from orchestrator-specific state (`agents/<adwId>/<orchestrator>/state.json`) while the #524 persistence contract writes it to top-level state (`agents/<adwId>/state.json`). This fix reconciles the read and write sites so that `adwMerge` resolves `branchName` from top-level state first, falling back to orchestrator state for older runs, and applies the same top-level-first pattern to the sibling read site in `webhookHandlers`.

## What Was Built

- **Core fix:** `adwMerge.executeMerge` now resolves `branchName` from `topLevelState.branchName` first; only falls back to orchestrator-specific state when top-level lacks it
- **Write-side agreement:** `workflowInit` now also writes `branchName` into the orchestrator `initialState` (conditionally) so both stores agree for new runs
- **Sibling hardening:** `webhookHandlers.handleIssueClosedEvent` remote-branch-deletion path applies the same top-level-first resolution
- **Unit test coverage:** regression, precedence, and fallback cases for both `adwMerge` and `webhookHandlers`
- **BDD scenario:** `features/per-issue/feature-530.feature` documenting the behavioral contract

## Technical Implementation

### Files Modified

- `adws/adwMerge.tsx`: `executeMerge` step 2 changed from orchestrator-only read to top-level-first with orchestrator fallback; no new `MergeDeps` fields introduced
- `adws/phases/workflowInit.ts`: `initialState` write extended with `...(branchName ? { branchName } : {})` to mirror the existing top-level write
- `adws/triggers/webhookHandlers.ts`: `handleIssueClosedEvent` remote-branch-deletion block changed from orchestrator-only to top-level-first fallback; uses the `state` already in scope
- `adws/__tests__/adwMerge.test.ts`: new `describe('executeMerge — branchName resolution (issue #530)')` block with regression, precedence, and fallback cases
- `adws/triggers/__tests__/webhookHandlers.test.ts`: new case asserting `deleteRemoteBranch` uses the top-level branchName when orchestrator state lacks it
- `features/per-issue/feature-530.feature`: per-issue BDD scenario tagged `@adw-530`

### Key Changes

- **Top-level-first ordering keeps all pre-existing tests green**: existing `makeState()` fixtures set no top-level `branchName`, so they exercise the fallback path exactly as before
- **No new injected dependencies**: `topLevelState` is already read at step 1 of `executeMerge`; the fix reuses it
- **Terminal reasons preserved**: `no_orchestrator_state` (fallback finds no orchestrator dir) and `no_branch_name` (neither store has a name) are unchanged
- **Reference pattern**: `remoteReconcile.deriveStageFromRemote` already reads branchName from top-level state — this fix aligns the two divergent sites to the same pattern
- **`findOrchestratorStatePath` shadowing sidestepped**: reading top-level state first bypasses the shadowing bug (a separate issue) for branchName resolution

## How to Use

This is an internal infrastructure fix with no user-facing API changes. The behavior change is:

1. A workflow in `awaiting_merge` whose `branchName` was persisted to top-level state (all runs after #524) will now be picked up and merged automatically by the cron sweep
2. Runs with `branchName` only in orchestrator state (pre-#524 legacy) continue to work via the fallback path
3. If `branchName` is absent from both stores, `adwMerge` still writes `abandoned` with reason `no_branch_name` (unchanged terminal behavior)

## Configuration

No configuration changes required. The fix uses the existing `AgentStateManager.readTopLevelState` path already wired into `executeMerge`.

## Testing

Run targeted test suites:

```bash
bunx vitest run adws/__tests__/adwMerge.test.ts adws/triggers/__tests__/webhookHandlers.test.ts adws/phases/__tests__/workflowInit.test.ts adws/phases/__tests__/branchNameResolution.test.ts
bun run test:unit
bun run lint && bunx tsc --noEmit && bunx tsc --noEmit -p adws/tsconfig.json
```

Key test cases:
- **Regression**: `topLevelState.branchName` set, orchestrator dir absent → merge completes, no `abandoned`/`no_branch_name`
- **Precedence**: top-level `branchName` wins over a different orchestrator `branchName`
- **Fallback**: top-level lacks `branchName`, orchestrator has it → merge completes via fallback (pre-existing path)

## Notes

- The `findOrchestratorStatePath` shadowing bug (which may return the wrong orchestrator dir on adwId reuse) is a distinct compounding cause tracked separately; reading top-level first sidesteps it for branchName resolution but does not fix the underlying shadowing
- `## Retry` / `merge_blocked` recovery semantics (#527/#528) are unaffected — this fix prevents the `abandoned` strand in the first place
- Empty-string `branchName` is treated as absent (consistent with the existing `!branchName` guard), so the `workflowInit` write remains conditional on a truthy value
