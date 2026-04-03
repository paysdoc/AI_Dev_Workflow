# Merge Orchestrator and Cron `awaiting_merge` Handoff

**ADW ID:** `dcy9qz-create-thin-merge-or`
**Date:** 2026-04-03
**Specification:** `specs/issue-381-adw-dcy9qz-create-thin-merge-or-sdlc_planner-merge-orchestrator-cron-handoff.md`

## Overview

This feature closes the final gap in the orchestrator lifecycle redesign by introducing `adwMerge.tsx` — a thin merge orchestrator that the cron spawns when it detects a state file with `workflowStage === 'awaiting_merge'`. Previously, orchestrators would write `awaiting_merge` to state and exit, but nothing would pick up the work to actually merge the PR. The cron now treats `awaiting_merge` as a special handoff stage that bypasses the grace period and spawns the merge orchestrator immediately.

## What Was Built

- **`adws/adwMerge.tsx`** — New thin merge orchestrator (255 lines) with injectable deps for full testability
- **`adws/triggers/cronIssueFilter.ts`** — Extracted and enhanced issue evaluation/filtering logic (131 lines), supporting `action: 'merge'` path
- **`adws/triggers/cronStageResolver.ts`** — New module that reads workflow stage from state files instead of parsing comment headers (109 lines)
- **`adwMerge.tsx` unit tests** — `adws/__tests__/adwMerge.test.ts` covering all merge outcome branches
- **Cron `awaiting_merge` detection tests** — `adws/triggers/__tests__/triggerCronAwaitingMerge.test.ts`
- **`cronStageResolver` tests** — Extended `adws/triggers/__tests__/cronStageResolver.test.ts`
- **`OrchestratorId.Merge`** registered in constants, `merge-orchestrator` mapped in `deriveOrchestratorScript()`

## Technical Implementation

### Files Modified

- `adws/core/constants.ts`: Added `Merge: 'merge-orchestrator'` to the `OrchestratorId` registry
- `adws/core/orchestratorLib.ts`: Added `deriveOrchestratorScript()` function with full name→script map including `'merge-orchestrator': 'adwMerge'`
- `adws/types/agentTypes.ts`: Added `PhaseExecutionState` interface; extended `AgentState` with `workflowStage`, `phases`, `orchestratorScript` fields
- `adws/triggers/trigger_cron.ts`: Removed inline `evaluateIssue`/`filterEligibleIssues`; now delegates to extracted modules; added `action === 'merge'` spawn path in `checkAndTrigger()`

### New Files

- `adws/adwMerge.tsx`: Thin merge orchestrator (no worktree setup at start, no `CostTracker`/`PhaseRunner`)
- `adws/triggers/cronStageResolver.ts`: State-file-based stage resolution replacing comment-header parsing
- `adws/triggers/cronIssueFilter.ts`: Pure `evaluateIssue()` and `filterEligibleIssues()` functions; extracted from `trigger_cron.ts` for testability
- `adws/__tests__/adwMerge.test.ts`: Unit tests for `executeMerge()` (all branches)
- `adws/triggers/__tests__/triggerCronAwaitingMerge.test.ts`: Unit tests for cron `awaiting_merge` detection and spawn routing

### Key Changes

- **`awaiting_merge` bypasses grace period**: The cron previously treated `awaiting_merge` as an unknown stage and excluded it. It now detects it explicitly and spawns `adwMerge.tsx` without waiting for the grace period, since the original orchestrator has already exited.
- **Stage resolution from state files**: `cronStageResolver.ts` reads `workflowStage` directly from `agents/<adwId>/state.json` instead of parsing ADW comment headers. This is more reliable and enables the adwId to be forwarded to the merge orchestrator.
- **Dependency injection in `adwMerge.tsx`**: The `executeMerge()` function accepts a `MergeDeps` interface, making all side effects (state reads/writes, PR lookup, merge, issue comments) injectable for unit testing.
- **`EligibleIssue` enriched with `action` and `adwId`**: `filterEligibleIssues()` now returns `EligibleIssue[]` with `action: 'spawn' | 'merge'` and optional `adwId`, forwarded through `checkAndTrigger()` to route to the correct spawn path.
- **Worktree re-creation on demand**: The merge orchestrator calls `ensureWorktree()` only when the PR is open and needs merging — not at startup. If the original worktree was cleaned up, it is recreated from the branch name.

## How to Use

The merge flow is fully automated via the cron. No manual intervention is required for the normal happy path:

1. An orchestrator (e.g. `adwSdlc`) completes its lifecycle and writes `workflowStage: 'awaiting_merge'` to state, then exits.
2. On the next cron cycle (every 20 seconds), `checkAndTrigger()` calls `filterEligibleIssues()`.
3. `cronStageResolver` reads the state file for the issue's adw-id and returns `stage: 'awaiting_merge'`.
4. `evaluateIssue()` returns `{ eligible: true, action: 'merge', adwId }` — no grace period check.
5. The cron spawns `adwMerge.tsx` with `<issueNumber> <adwId> [--target-repo owner/repo]` and unrefs the child.
6. `adwMerge.tsx` reads the state file, finds the branch, looks up the PR via `gh pr list`, and calls `mergeWithConflictResolution()`.
7. On success: writes `completed` to state, posts a completion comment on the issue.
8. On failure: posts a failure comment on the PR, writes `abandoned` to state.

To invoke the merge orchestrator manually (for debugging):

```bash
bunx tsx adws/adwMerge.tsx <issueNumber> <adwId> [--target-repo owner/repo]
```

## Configuration

No new environment variables. The merge orchestrator inherits the same `--target-repo` / `--clone-url` arguments as other orchestrators. The cron forwards `buildCronTargetRepoArgs()` to the spawned `adwMerge.tsx` process.

## Testing

```bash
# Unit tests (adwMerge + cronStageResolver + cronIssueFilter)
bun vitest run

# BDD regression suite
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

Key unit test coverage:
- `executeMerge()`: already-merged PR → `completed`; closed PR → `abandoned`; merge success → `completed`; merge failure after retries → `abandoned`; missing state file → `abandoned`; missing branch name → `abandoned`
- `evaluateIssue()`: `awaiting_merge` bypasses grace period; non-`awaiting_merge` respects grace period; `awaiting_merge` without adwId → ineligible
- `cronStageResolver`: `isActiveStage('awaiting_merge')` → false; `isRetriableStage('awaiting_merge')` → false

## Notes

- `awaiting_merge` is intentionally NOT added to `ACTIVE_STAGES` or `RETRIABLE_STAGES` — it is a distinct handoff stage with its own spawn routing.
- The merge orchestrator does not call `initializeWorkflow()` — it reads state directly and only creates a worktree if needed for conflict resolution.
- `processedIssues.add(issue.number)` is called before spawning the merge orchestrator to prevent duplicate spawning within the same cron cycle.
- Concurrent detection of the same `awaiting_merge` issue across multiple cron cycles is safe because `processedIssues` is cycle-local; however the merge orchestrator itself validates that `workflowStage === 'awaiting_merge'` before proceeding, making it idempotent.
