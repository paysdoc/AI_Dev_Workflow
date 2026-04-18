# Fix Board Column Order and Preserve Option IDs in ensureColumns

**ADW ID:** elre2t-fix-board-column-ord
**Date:** 2026-04-18
**Specification:** specs/issue-450-adw-elre2t-fix-board-column-ord-sdlc_planner-fix-board-column-order-ids.md

## Overview

Two bugs in `GitHubBoardManager.ensureColumns` caused Status column corruption whenever ADW added a missing column to a GitHub Projects V2 board: newly added columns were always appended instead of inserted at the correct `BOARD_COLUMNS.order` position, and every existing option lost its GitHub option ID (causing project items to display a blank Status). This fix preserves existing option IDs through the merge and inserts missing columns using an anchor-based ordering rule.

## What Was Built

- `mergeStatusOptions` rewritten to insert missing ADW columns at order-correct positions using an anchor lookup against already-present ADW columns
- `StatusOption` type widened to carry an optional `id` so IDs fetched from GitHub flow through the merge
- `updateStatusFieldOptions` updated to include `id` in the GraphQL mutation payload when present, preventing GitHub from deleting and recreating existing options
- `getStatusFieldOptions` query extended to fetch `color` and `description` alongside `id name` so the merge has all fields needed
- `addStatusOption` per-column method replaced by a single `updateStatusFieldOptions` call with the full merged list
- 13 new unit tests covering column ordering, ID preservation, and non-ADW option stability
- Existing 6 unit tests updated to assert canonical ordering post-fix

## Technical Implementation

### Files Modified

- `adws/providers/github/githubBoardManager.ts`: Widened `StatusOption` type; rewrote `mergeStatusOptions` as a pure exported function with anchor-based insertion; updated `updateStatusFieldOptions` to conditionally include `id`; extended `getStatusFieldOptions` GraphQL query to return `color description`; removed per-column `addStatusOption` method
- `adws/providers/__tests__/boardManager.test.ts`: Added 13 new tests for ordering and ID preservation; updated 4 existing tests to assert canonical `[Blocked, Todo, In Progress, Review, Done]` order post-fix

### Key Changes

- **Anchor-based insertion**: for each missing ADW column, the algorithm finds the highest-order ADW column already in `merged` with `order <= missing.order` and inserts immediately after it; falls back to prepending before the first ADW column, or sequential prepend when `merged` is empty
- **ID preservation**: `mergeStatusOptions` now maps `opt.id` through for both non-ADW (verbatim) and ADW-overwrite (canonical name/color/description but original `id`) branches; `updateStatusFieldOptions` omits `id` key entirely for new options to avoid GitHub rejecting null for non-nullable scalars
- **No-op short-circuit unchanged**: `changed` detection excludes the `id` field so a preserved ID does not trigger a needless mutation
- **`withProjectBoardAuth` refactored**: PAT token swap now wraps all board operations (`findBoard`, `createBoard`, `ensureColumns`) via a shared private method instead of being inlined in `findBoard` only

## How to Use

This fix is transparent — `ensureColumns` is called automatically during `initializeWorkflow`. No configuration changes are needed.

1. Run any workflow that calls `initializeWorkflow` (e.g. `bunx tsx adws/adwSdlc.tsx <issue-number>`).
2. If the board is missing any ADW columns, they will be inserted at the correct position without disturbing existing columns or orphaning any project items.
3. Verify board column order in the GitHub Projects V2 UI: `[Blocked, Todo, In Progress, Review, Done]` followed by any custom columns.

## Configuration

No new configuration. The existing `GITHUB_PAT` env var continues to be used for PAT fallback when the GitHub App token cannot access Projects V2.

## Testing

```bash
bun run lint
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json
bun run test:unit
```

All four commands must pass with zero errors. The new `describe('mergeStatusOptions')` block encodes both bug conditions — ordering and ID preservation — as assertions that fail against the pre-fix code and pass after.

## Notes

- Already-corrupted items (boards where `Blocked` was previously added programmatically and items lost their Status) are out of scope. This fix prevents future corruption only.
- The uncommitted color change in `adws/providers/types.ts` is explicitly out of scope.
- The fix is backward compatible: `ProjectV2SingleSelectFieldOptionInput` already accepts an optional `id`; omitting it for new options continues to work as before.
- `findBoard`, `createBoard`, `getStatusFieldOptions`, and the fire-and-forget wiring in `workflowInit.ts` are functionally unchanged.
