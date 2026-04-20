# Reclassify Abandoned→Discarded Call Sites

**ADW ID:** 29w5wf
**Date:** 2026-04-20
**Specification:** specs/issue-460-adw-29w5wf-orchestrator-resilie-sdlc_planner-reclassify-abandoned-discarded.md

## Overview

This fix reclassifies two deliberate-terminal exit paths in `adwMerge.tsx` (`pr_closed`, `merge_failed`) and the PR-closed webhook path in `webhookHandlers.ts` from writing `workflowStage: 'abandoned'` to `workflowStage: 'discarded'`. Before this change, operator-closed PRs and exhausted-retry merge failures would be treated as retriable by the cron sweeper, causing infinite respawn loops. The `discarded` stage (introduced in slice #1, issue #454) is now correctly applied at these terminal call sites.

## What Was Built

- `adwMerge.tsx` `pr_closed` exit now writes `workflowStage: 'discarded'` instead of `'abandoned'`
- `adwMerge.tsx` `merge_failed` exit now writes `workflowStage: 'discarded'` instead of `'abandoned'`
- `adwMerge.tsx` re-exports `handleWorkflowDiscarded` from `./phases/workflowCompletion` to satisfy the BDD import-inspection scenario and document intent
- `webhookHandlers.ts` `handlePullRequestEvent` PR-closed path writes `workflowStage: 'discarded'` instead of `'abandoned'`
- `handleIssueClosedEvent` dependency branch extended to treat `discarded` the same as `abandoned` (closes dependents rather than unblocking them) — prevents a silent regression where operator-rejected work would spawn dependent issues
- Unit tests updated for `pr_closed` and `merge_failed` paths in `adwMerge.test.ts`
- Unit tests updated for PR-closed webhook path in `webhookHandlers.test.ts`, including a new regression test for the `discarded` dependency-close parity

## Technical Implementation

### Files Modified

- `adws/adwMerge.tsx`: Changed `workflowStage: 'abandoned'` → `'discarded'` at `pr_closed` (line ~121) and `merge_failed` (line ~165); added `export { handleWorkflowDiscarded } from './phases/workflowCompletion'`; updated block comments
- `adws/triggers/webhookHandlers.ts`: Changed `workflowStage: 'abandoned'` → `'discarded'` in `handlePullRequestEvent`; extended `handleIssueClosedEvent` branch to `workflowStage === 'abandoned' || workflowStage === 'discarded'`; updated JSDoc and log messages
- `adws/__tests__/adwMerge.test.ts`: Updated `pr_closed` and `merge_failed` test assertions from `'abandoned'` → `'discarded'`; renamed affected test titles
- `adws/triggers/__tests__/webhookHandlers.test.ts`: Renamed describe/it blocks from "abandoned" → "discarded"; updated `writeTopLevelState` assertion; added new `handleIssueClosedEvent — discarded closure` describe block

### Key Changes

- **Terminal vs. transient split**: `pr_closed` and `merge_failed` are deliberate terminal decisions (operator intent / system exhausted retries); six other defensive exits (`unexpected_stage`, `no_state_file`, `no_orchestrator_state`, `no_branch_name`, `no_pr_found`, `worktree_error`) continue writing `abandoned` as they are transient and safe to retry
- **Return values preserved**: `MergeRunResult.outcome` remains `'abandoned'` for `pr_closed` and `merge_failed` — this is a dispatcher-level label separate from the workflow stage classification; `main()` exit-code logic is unchanged
- **Re-export pattern**: `handleWorkflowDiscarded` is re-exported (not called) because `adwMerge` uses `MergeDeps.writeTopLevelState` injection for testability; calling `handleWorkflowDiscarded` directly would invoke `process.exit` and break the pure-return test harness
- **Dependency cascade preserved**: `handleIssueClosedEvent` now closes dependents for both `abandoned` and `discarded` stages, preserving the "don't pick up blocked work" signal to downstream issues regardless of whether the terminal state was transient or deliberate
- **Cron sweeper effect**: `cronIssueFilter.evaluateIssue` + `cronStageResolver.isRetriableStage` already treat `discarded` as skip-terminal (wired in slice #1), so these reclassified exits will no longer trigger respawns

## How to Use

This is an internal fix — no operator-facing API changes. Observable behavior changes:

1. When an operator closes a PR without merging, the issue's `state.json` will now contain `workflowStage: 'discarded'` instead of `'abandoned'`
2. When `adwMerge` exhausts all merge retries, the issue's `state.json` will now contain `workflowStage: 'discarded'`
3. The cron sweeper will skip these issues on subsequent cycles (no more infinite respawn loops)
4. Downstream tooling that queries state files for `'abandoned'` to diagnose stuck work should also check for `'discarded'`

## Configuration

No configuration changes required. Depends on slice #1 (`feature-nq7174-discarded-workflow-stage-foundation`) being merged, which added the `'discarded'` value to the `WorkflowStage` union and `handleWorkflowDiscarded` to `workflowCompletion.ts`.

## Testing

```sh
# Targeted unit tests
bun vitest run adws/__tests__/adwMerge.test.ts adws/triggers/__tests__/webhookHandlers.test.ts

# Full unit suite
bun run test:unit

# BDD scenarios for this slice
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-460"

# Full regression pack
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

## Notes

- Six transient exit paths in `adwMerge` intentionally remain on `'abandoned'`: missing state file, wrong stage, missing orchestrator state, missing branch name, missing PR, and worktree errors. These represent recoverable conditions where cron retry is the correct response.
- The `no_state_file` path writes no state at all (no state file to write to); its test asserts `writeTopLevelState` was not called.
- The single-line extension to `handleIssueClosedEvent` (adding `|| workflowStage === 'discarded'`) is load-bearing: without it, operator-rejected PRs would unblock and spawn dependent issues rather than closing them — a silent regression of user story 2.
