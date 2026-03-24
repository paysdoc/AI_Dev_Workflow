# Fix BoardStatus Invalid Enum Values

**ADW ID:** tdlgz7-fix-boardstatus-enum
**Date:** 2026-03-23
**Specification:** specs/issue-271-adw-tdlgz7-fix-boardstatus-enum-sdlc_planner-fix-boardstatus-invalid-values.md

## Overview

Removes the `Building` and `Testing` values from the `BoardStatus` enum in `adws/providers/types.ts` because they have no corresponding columns on the GitHub project board. Build and test phases now call `moveToStatus` with `BoardStatus.InProgress` instead, preventing the silent no-op failures that occurred when the fuzzy matcher could not match non-existent board column names.

## What Was Built

- Removed `Building = 'Building'` and `Testing = 'Testing'` from the `BoardStatus` enum
- Updated `buildPhase.ts` to pass `BoardStatus.InProgress` instead of `BoardStatus.Building`
- Updated `testPhase.ts` to pass `BoardStatus.InProgress` instead of `BoardStatus.Testing`
- Updated existing BDD scenarios in `harden_project_board_status.feature` to assert the corrected behaviour
- Added new BDD feature file `fix_boardstatus_invalid_values.feature` with regression scenarios

## Technical Implementation

### Files Modified

- `adws/providers/types.ts`: Removed `Building` and `Testing` members from the `BoardStatus` enum; enum now contains only `InProgress` and `Review`
- `adws/phases/buildPhase.ts`: Changed `BoardStatus.Building` → `BoardStatus.InProgress` in the `moveToStatus` call at phase entry
- `adws/phases/testPhase.ts`: Changed `BoardStatus.Testing` → `BoardStatus.InProgress` in the `moveToStatus` call at phase entry
- `features/harden_project_board_status.feature`: Updated five scenarios that previously asserted `Building`/`Testing` exist; they now assert `InProgress` and the absence of the removed values
- `features/fix_boardstatus_invalid_values.feature`: New feature file with nine `@regression`-tagged scenarios covering enum correctness, phase-file assertions, and Jira provider alignment

### Key Changes

- The `BoardStatus` enum is now strictly limited to values that exist on the real project board (`In Progress`, `Review`); aspirational intermediate states have been removed
- Both `buildPhase.ts` and `testPhase.ts` now make a semantically correct (and non-failing) call to keep the issue in "In Progress" throughout these phases
- The Jira provider required no code changes — it receives `BoardStatus` as a parameter, so updating the enum and callers is sufficient
- Existing `harden_project_board_status.feature` scenarios were tagged with `@adw-tdlgz7-fix-boardstatus-enum` to link them to this fix
- New BDD scenarios explicitly assert the absence of `Building` and `Testing` throughout the codebase, preventing regression

## How to Use

No user-facing configuration changes are required. The fix is transparent: issues tracked on the GitHub project board will now correctly remain in "In Progress" during the build and test phases rather than staying at whatever status they had before those phases began.

Valid `BoardStatus` transitions programmatically set by ADW:

| Phase | Board status set |
|---|---|
| Plan | In Progress |
| Build | In Progress |
| Test | In Progress |
| PR review completion | Review |

## Configuration

No configuration changes. The `BoardStatus` enum is an internal TypeScript enum in `adws/providers/types.ts`; no `.adw/` or environment variable changes are needed.

## Testing

Run the following commands to validate the fix:

```sh
bun run lint
bun run build
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-tdlgz7-fix-boardstatus-enum"
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@adw-wrzj5j-harden-project-board"
NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"
```

## Notes

- The `moveToStatus` calls in `buildPhase.ts` and `testPhase.ts` are technically redundant (the plan phase already sets "In Progress"), but they are kept to make the intent explicit and to guard against future phase reordering.
- The root cause was that `Building` and `Testing` were added in issue #229 as aspirational board columns that were never created on the GitHub project board.
- The Jira `matchTransition` call now receives `'In Progress'` instead of `'Building'`/`'Testing'`, which correctly matches Jira's "In Progress" transition.
