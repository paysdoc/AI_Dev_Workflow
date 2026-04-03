# Cron Stage Detection: Migrate from Comment Parsing to State File

**ADW ID:** gq51dc-migrate-cron-stage-d
**Date:** 2026-04-03
**Specification:** specs/issue-379-adw-gq51dc-migrate-cron-stage-d-sdlc_planner-cron-stage-from-state-file.md

## Overview

Migrates the cron trigger's workflow stage detection from parsing GitHub issue comment headers to reading `workflowStage` from the top-level state file (`agents/<adwId>/state.json`). This decouples stage detection from comment formatting and makes the state file the single source of truth for workflow status, consistent with the state file architecture introduced in #378.

## What Was Built

- New `cronStageResolver.ts` module encapsulating all stage-resolution logic as pure, testable functions
- `extractLatestAdwId()` — scans issue comments newest-to-oldest to extract the adw-id via regex
- `getLastActivityFromState()` — computes the most recent phase timestamp from the state file's `phases` map
- `isActiveStage()` — pattern-based classification (`starting`, `*_running`, `*_completed`) replacing the hardcoded `ACTIVE_STAGES` set
- `isRetriableStage()` — identifies `abandoned` as retriable, replacing the hardcoded `RETRIABLE_STAGES` set
- `resolveIssueWorkflowStage()` — composes adw-id extraction + state file read + timestamp computation with injectable `readState` dependency
- Updated `trigger_cron.ts` to use the new module and prefer state file timestamps for grace period checks
- Comprehensive unit tests in `cronStageResolver.test.ts`

## Technical Implementation

### Files Modified

- `adws/triggers/cronStageResolver.ts` (**new**): Pure functions for resolving workflow stage from the state file; follows the `cronRepoResolver.ts` extraction pattern with dependency injection for testability
- `adws/triggers/trigger_cron.ts`: Replaced `getIssueWorkflowStage()`, `ACTIVE_STAGES`, `RETRIABLE_STAGES`, and `isWithinGracePeriod()` with imports from `cronStageResolver`; grace period now prefers state file timestamps
- `adws/triggers/__tests__/cronStageResolver.test.ts` (**new**): Unit tests covering all exported functions and edge cases

### Key Changes

- **Removed `ACTIVE_STAGES` set** (18 explicit stage names) — replaced by `isActiveStage()` using `endsWith('_running') || endsWith('_completed')` pattern matching, which handles any future phase without code changes
- **Removed `RETRIABLE_STAGES` set** — replaced by `isRetriableStage()` returning `stage === 'abandoned'` (the state file equivalent of comment-based `error`/`review_failed`/`build_failed`)
- **Removed `getIssueWorkflowStage()`** — which filtered ADW comments and called `parseWorkflowStageFromComment()`; replaced by `resolveIssueWorkflowStage()` reading from state file
- **Grace period now uses state file timestamps** — `resolution.lastActivityMs` (most recent `startedAt`/`completedAt` across all phases) takes priority over `issue.updatedAt`, giving more accurate activity detection
- **Explicit `paused` exclusion** — `paused` is now explicitly excluded with its own `reason: 'paused'` rather than falling through the `ACTIVE_STAGES` set, with the comment explaining the pause queue scanner handles it

## How to Use

The feature is fully internal to the cron trigger — no operator-facing changes are required.

1. Cron runs as usual via `trigger_cron.ts`
2. For each open issue, `resolveIssueWorkflowStage(issue.comments)` is called
3. If an adw-id is found in comments, `agents/<adwId>/state.json` is read for `workflowStage`
4. `isActiveStage()` / `isRetriableStage()` classify the stage to decide eligibility
5. Grace period uses state file phase timestamps when available

To use `cronStageResolver` functions directly (e.g., in other triggers):

```typescript
import {
  resolveIssueWorkflowStage,
  isActiveStage,
  isRetriableStage,
  extractLatestAdwId,
  getLastActivityFromState,
} from './cronStageResolver';

const resolution = resolveIssueWorkflowStage(issue.comments);
// resolution.stage   — workflowStage from state file, or null
// resolution.adwId   — adw-id from comments, or null
// resolution.lastActivityMs — most recent phase timestamp, or null
```

## Configuration

No new configuration. Uses existing `GRACE_PERIOD_MS` from `adws/core` and `AGENTS_STATE_DIR` (via `AgentStateManager`) for state file path resolution.

## Testing

```bash
# Run the new unit tests
bun vitest run adws/triggers/__tests__/cronStageResolver.test.ts

# Run the full test suite to verify no regressions
bun run test
```

The test suite covers:
- `extractLatestAdwId`: newest-comment-first scan, null for no ADW comments, mixed ADW/non-ADW comments
- `getLastActivityFromState`: most recent timestamp across phases, null for empty phases, startedAt-only phases
- `isActiveStage`: `starting`, `*_running`, `*_completed` as active; `completed`, `paused`, `abandoned` as not active
- `isRetriableStage`: `abandoned` is retriable; all others are not
- `resolveIssueWorkflowStage`: null stage for no comments, null stage for missing state file, correct stage + timestamps when state file exists

## Notes

- Issues with no adw-id in comments, or with an adw-id but a missing/deleted state file, are treated as fresh candidates (eligible). This matches the previous behaviour for issues with no ADW comment.
- `paused` is intentionally excluded from both active and retriable — the pause queue scanner (`pauseQueueScanner.ts`) handles resume, not the backlog sweeper.
- State file `workflowStage` values (`starting`, `<phase>_running`, `<phase>_completed`, `completed`, `paused`, `abandoned`) differ from the old comment-based stage names. Pattern-based classification means new phases are automatically handled.
- See `app_docs/feature-z16ycm-add-top-level-workfl-top-level-workflow-state.md` for the full state file format and `workflowStage` value reference.
