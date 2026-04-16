# Fix Board Update Mutation

**ADW ID:** w12d7t-fix-board-setup-upda
**Date:** 2026-04-16
**Specification:** specs/issue-432-adw-w12d7t-fix-board-setup-upda-sdlc_planner-fix-board-update-mutation.md

## Overview

Fixes two defects in `GitHubBoardManager` that caused board column setup to always fail. The `addStatusOption` method passed an invalid `projectId` argument to the `updateProjectV2Field` GraphQL mutation, which GitHub's `UpdateProjectV2FieldInput` does not accept. Additionally, the per-column update strategy was a replacement operation that would wipe all existing options on each call rather than merging new ones in.

## What Was Built

- Removed the broken `addStatusOption` private method entirely
- Extended `getStatusFieldOptions` query to also fetch `color` and `description` for each option
- Extracted a pure, exported `mergeStatusOptions()` helper function implementing the merge algorithm
- Replaced the per-column loop in `ensureColumns` with a single bulk `updateStatusFieldOptions` call
- The new bulk update uses `gh api graphql --input -` (JSON piped to stdin) to pass the array argument, avoiding `gh` CLI flat-flag limitations
- Added 6 unit tests covering all merge scenarios in `boardManager.test.ts`

## Technical Implementation

### Files Modified

- `adws/providers/github/githubBoardManager.ts`: Removed `addStatusOption`, added `mergeStatusOptions` (exported pure function), added `updateStatusFieldOptions`, rewrote `ensureColumns`, extended `getStatusFieldOptions` to fetch `color`/`description`
- `adws/providers/__tests__/boardManager.test.ts`: Added `describe('mergeStatusOptions')` block with 6 unit tests

### Key Changes

- **`mergeStatusOptions(existing, adwColumns)`** — pure exported function that builds the merged option list. Existing non-ADW options are preserved; existing options matching an ADW column by name (case-insensitive) are overwritten with `BOARD_COLUMNS` defaults; missing ADW columns are appended. Returns `{ merged, changed, added }`.
- **`updateStatusFieldOptions(fieldId, options)`** — private method that issues a single `updateProjectV2Field` mutation using `gh api graphql --input -` with a JSON body piped via stdin, avoiding the `singleSelectOptions` array-of-objects limitation of `-f` flags.
- **`ensureColumns`** — now calls `mergeStatusOptions`, short-circuits with `return true` when `changed` is false (no-op), otherwise calls `updateStatusFieldOptions` with the full merged list and logs only newly added column names.
- **`getStatusFieldOptions`** — query extended from `options { id name }` to `options { id name color description }` with matching return type updates.
- **No `projectId` in mutation input** — `updateProjectV2Field` only accepts `fieldId` plus field properties; the old code included `projectId` which GitHub's API rejects immediately.

## How to Use

This fix is transparent to callers. The `ensureColumns` method in `GitHubBoardManager` is called fire-and-forget by `initializeWorkflow` in `adws/phases/workflowInit.ts`. After this fix:

1. Calling any workflow that invokes `initializeWorkflow` (e.g., `bunx tsx adws/adwPlanBuild.tsx 123`) will silently ensure all 5 ADW status columns exist.
2. If all ADW columns are already present with correct properties, no API call is made.
3. If any column is missing or has incorrect color/description, a single bulk `updateProjectV2Field` call is made with the full merged list (preserving any non-ADW custom columns).

## Configuration

No configuration changes required. The fix uses existing `BOARD_COLUMNS` from `adws/providers/types.ts` and the same `execSync`/`gh` CLI invocation pattern.

## Testing

```bash
# Lint
bun run lint

# Type check (root)
bunx tsc --noEmit

# Type check (adws)
bunx tsc --noEmit -p adws/tsconfig.json

# Unit tests (includes the new mergeStatusOptions describe block)
bun run test:unit
```

The 6 new unit tests cover:
- Empty board: all 5 ADW columns added
- All ADW columns already present: `changed` is `false`, no mutation needed
- Partial overlap: missing columns appended, `changed` is `true`
- Non-ADW columns preserved in merged list
- ADW columns with wrong color/description overwritten
- Case-insensitive name matching (`"todo"` matches `BoardStatus.Todo`)

## Notes

- The `gh api graphql --input -` pattern (JSON piped to stdin) is required because `singleSelectOptions` is an array of objects and cannot be passed as flat `-f` string flags.
- The fire-and-forget behavior in `workflowInit.ts` (lines 270–285) is unchanged — board setup never blocks the workflow; a non-blocking warning is logged on failure.
- `createBoard()` mutations are out of scope and were not touched.
- The `mergeStatusOptions` function is exported to enable direct unit testing without mocking `execSync`.
