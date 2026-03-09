# Feature: Remove revertIssueCostFile

## Metadata
issueNumber: `111`
adwId: `1773068420299-fw4sym`
issueJson: `{"number":111,"title":"cost commit still not correct","body":"/adw_sdlc\n\nIssue 109 was not correctly implemented. \n\nRemove `revertIssueCostFile` from costCsvWriter and all references altogether.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-09T15:00:16Z","comments":[],"actionableComment":null}`

## Feature Description
Remove the `revertIssueCostFile` function from `costCsvWriter.ts` and eliminate all references to it across the entire codebase. This includes removing its export from the barrel `index.ts`, removing all call sites in `webhookHandlers.ts` and `trigger_webhook.ts`, deleting its dedicated test file, and updating all test mocks and assertions that reference it. The "closed-without-merge" PR path and the issue-closed cost revert path should simply rebuild and commit without attempting to delete individual issue CSV files.

## User Story
As a developer maintaining ADW
I want to remove the `revertIssueCostFile` function and all its references
So that the cost commit mechanism is simplified and the incorrect revert behavior is eliminated

## Problem Statement
Issue 109 rewrote the cost commit mechanism but did not remove `revertIssueCostFile`, which was part of the old approach. This function deletes issue cost CSV files when PRs are closed without merging or when issues are closed directly, but this behavior is no longer desired. All references to this function need to be removed to complete the cleanup.

## Solution Statement
Delete the `revertIssueCostFile` function from `costCsvWriter.ts`, remove its export from the barrel file, remove all call sites in webhook handlers and the trigger webhook, delete the dedicated unit test file, and update all remaining test files that mock or assert on this function. For the "closed-without-merge" PR path, simply rebuild the project cost CSV and commit. For the issue-closed handler (`handleIssueCostRevert`), simplify it to only rebuild and commit (or remove the revert logic entirely, keeping just the rebuild+commit if the issue wasn't already handled by a merged PR).

## Relevant Files
Use these files to implement the feature:

- `adws/core/costCsvWriter.ts` — Contains the `revertIssueCostFile` function definition (lines 128-158). Remove the function entirely.
- `adws/core/index.ts` — Barrel exports file. Remove the `revertIssueCostFile` export (line 110).
- `adws/triggers/webhookHandlers.ts` — Imports and calls `revertIssueCostFile` in the closed-without-merge PR path (line 9 import, line 157 call). Remove the import and call.
- `adws/triggers/trigger_webhook.ts` — Imports and calls `revertIssueCostFile` in `handleIssueCostRevert` (line 12 import, line 64 call). Remove the import and simplify `handleIssueCostRevert`.
- `adws/core/__tests__/revertIssueCostFile.test.ts` — Dedicated unit test file for `revertIssueCostFile`. Delete this file entirely.
- `adws/triggers/__tests__/webhookHandlers.test.ts` — Mocks `revertIssueCostFile` (line 37) and has tests that assert on it (lines 226-250, 305, 322). Remove mock and update tests.
- `adws/triggers/__tests__/triggerWebhookIssueClosed.test.ts` — Mocks `revertIssueCostFile` (line 12) and has tests that assert on it (lines 61, 66-70, 74, 83). Remove mock and update tests.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow during implementation. Read-only reference.
- `app_docs/feature-automatically-ccommi-wdlirj-auto-commit-cost-on-pr.md` — Documentation that references `revertIssueCostFile`. Update to reflect removal.
- `.adw/conditional_docs.md` — References `revertIssueCostFile` in condition text (line 39). Update to remove the reference.

## Implementation Plan
### Phase 1: Foundation
Remove the function definition and its export from the core module. Delete the dedicated test file for `revertIssueCostFile`.

### Phase 2: Core Implementation
Update the two call sites (`webhookHandlers.ts` and `trigger_webhook.ts`) to remove all usage of `revertIssueCostFile`. Simplify the closed-without-merge PR path to just rebuild+commit. Simplify `handleIssueCostRevert` to just rebuild+commit (skipping entirely if the issue was already handled by a merged PR).

### Phase 3: Integration
Update all test files to remove mocks, assertions, and test cases that reference `revertIssueCostFile`. Update documentation and conditional docs references.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Remove `revertIssueCostFile` from `costCsvWriter.ts`
- In `adws/core/costCsvWriter.ts`, delete the entire `revertIssueCostFile` function (lines 128-158), including its JSDoc comment.

### Step 2: Remove `revertIssueCostFile` export from `core/index.ts`
- In `adws/core/index.ts`, remove `revertIssueCostFile` from the `costCsvWriter` exports block (line 110).

### Step 3: Delete the dedicated test file
- Delete `adws/core/__tests__/revertIssueCostFile.test.ts` entirely.

### Step 4: Update `webhookHandlers.ts` — remove import and call
- In `adws/triggers/webhookHandlers.ts`:
  - Remove `revertIssueCostFile` from the import on line 9 (keep `rebuildProjectCostCsv` and other imports).
  - In the `handlePullRequestEvent` function, in the `else` branch (closed-without-merge, lines 156-159), remove the `revertIssueCostFile(process.cwd(), repoName, issueNumber);` call. Keep `rebuildProjectCostCsv` and `commitAndPushCostFiles` calls so the total CSV is still rebuilt and committed.

### Step 5: Update `trigger_webhook.ts` — remove import and simplify `handleIssueCostRevert`
- In `adws/triggers/trigger_webhook.ts`:
  - Remove `revertIssueCostFile` from the import on line 12 (keep `rebuildProjectCostCsv` and other imports).
  - Simplify the `handleIssueCostRevert` function (lines 60-72):
    - Keep the `wasMergedViaPR` guard (skip if already handled by merged PR).
    - Keep the `costCommitQueue.enqueue` wrapper and `pullLatestCostBranch` call.
    - Remove the `revertIssueCostFile` call and the `if (reverted.length > 0)` conditional.
    - Always call `fetchExchangeRates`, `rebuildProjectCostCsv`, and `commitAndPushCostFiles` (unconditionally within the queue callback).

### Step 6: Update `webhookHandlers.test.ts`
- In `adws/triggers/__tests__/webhookHandlers.test.ts`:
  - Remove `revertIssueCostFile` from the `costCsvWriter` mock object (line 37).
  - Remove the `revertIssueCostFile` import (line 61).
  - Update the test `'calls revertIssueCostFile, rebuildProjectCostCsv, and commitAndPushCostFiles for closed-without-merge PRs'` (lines 226-250):
    - Rename to something like `'calls rebuildProjectCostCsv and commitAndPushCostFiles for closed-without-merge PRs'`.
    - Remove the `revertIssueCostFile` mock implementation and assertion.
    - Remove `'revert'` from the `callOrder` expected array.
    - Keep assertions on `rebuildProjectCostCsv` and `commitAndPushCostFiles`.
  - Update the test `'falls back to branch name for issue extraction when PR body has no Implements #N (closed without merge)'` (lines 303-326):
    - Remove the `revertIssueCostFile` mock setup (line 305) and assertion (line 322).

### Step 7: Update `triggerWebhookIssueClosed.test.ts`
- In `adws/triggers/__tests__/triggerWebhookIssueClosed.test.ts`:
  - Remove `revertIssueCostFile` from the `costCsvWriter` mock object (line 12).
  - Remove the `revertIssueCostFile` import (line 45).
  - Update the test `'skips cost revert when issue was already handled by merged PR'` (lines 56-64):
    - Remove the `revertIssueCostFile` assertion. Keep assertions on `rebuildProjectCostCsv` and `commitAndPushCostFiles` not being called (since we still skip when `wasMergedViaPR` is true).
  - Update the test `'calls revertIssueCostFile when issue was NOT handled by merged PR'` (lines 66-71):
    - Rename to reflect the new behavior (e.g., `'calls rebuildProjectCostCsv when issue was NOT handled by merged PR'`).
    - Remove the `revertIssueCostFile` assertion. Add assertion for `rebuildProjectCostCsv` being called.
  - Update the test `'does NOT call rebuildProjectCostCsv or commitAndPushCostFiles when revert returns empty array'` (lines 73-80):
    - This test is no longer relevant since there is no revert return value gating the rebuild. Remove or replace with a test that validates rebuild+commit always happens when issue was not handled by merged PR.
  - Update the test `'calls commitAndPushCostFiles with repoName only when files were reverted'` (lines 82-89):
    - Remove the `revertIssueCostFile` mock. Rename to reflect unconditional rebuild+commit behavior. Keep assertions on `rebuildProjectCostCsv` and `commitAndPushCostFiles`.

### Step 8: Update documentation
- In `app_docs/feature-automatically-ccommi-wdlirj-auto-commit-cost-on-pr.md`:
  - Update "What Was Built" section to note that `revertIssueCostFile()` was subsequently removed per issue #111.
  - Update relevant sections referencing `revertIssueCostFile` to indicate the function no longer exists.
- In `.adw/conditional_docs.md`:
  - On line 39, remove `revertIssueCostFile` from the condition text: change `When modifying revertIssueCostFile or rebuildProjectCostCsv in adws/core/costCsvWriter.ts` to `When modifying rebuildProjectCostCsv in adws/core/costCsvWriter.ts`.

### Step 9: Run validation commands
- Run all validation commands to ensure zero regressions.

## Testing Strategy
### Unit Tests
- Verify that the `costCsvWriter` module no longer exports `revertIssueCostFile`.
- Verify the closed-without-merge PR path in `webhookHandlers.ts` calls `rebuildProjectCostCsv` and `commitAndPushCostFiles` without calling `revertIssueCostFile`.
- Verify `handleIssueCostRevert` in `trigger_webhook.ts` calls `rebuildProjectCostCsv` and `commitAndPushCostFiles` unconditionally (when not skipped by `wasMergedViaPR`).
- Verify the `wasMergedViaPR` guard still prevents duplicate processing.

### Edge Cases
- Closed-without-merge PR: should still rebuild project cost CSV and commit, just without deleting individual issue CSV files.
- Issue closed after merged PR: `wasMergedViaPR` guard should still skip the handler entirely.
- Issue closed without PR: should still rebuild and commit cost files.

## Acceptance Criteria
- The `revertIssueCostFile` function no longer exists in `adws/core/costCsvWriter.ts`.
- The `revertIssueCostFile` export no longer exists in `adws/core/index.ts`.
- No file in the codebase imports or calls `revertIssueCostFile`.
- The dedicated test file `adws/core/__tests__/revertIssueCostFile.test.ts` is deleted.
- All existing tests pass with zero regressions.
- The closed-without-merge PR path still rebuilds `total-cost.csv` and commits.
- The issue-closed handler still rebuilds `total-cost.csv` and commits (when not skipped).
- TypeScript compilation succeeds with no errors.
- Linter passes with no errors.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` - Run linter to check for code quality issues
- `bunx tsc --noEmit` - Type-check the root project
- `bunx tsc --noEmit -p adws/tsconfig.json` - Type-check the adws scripts
- `bun run test` - Run all tests to validate zero regressions
- `bun run build` - Build the application to verify no build errors

## Notes
- Follow `guidelines/coding_guidelines.md` strictly: remove unused code, maintain type safety, keep modules under 300 lines.
- The `rebuildProjectCostCsv` function is idempotent and safe to call at any time — it scans all remaining issue CSVs to produce an accurate total. This makes the explicit file deletion by `revertIssueCostFile` unnecessary.
- The `wasMergedViaPR` guard in `handleIssueCostRevert` should be kept to prevent redundant rebuild+commit when the PR merge handler already handled cost files.
- Spec files in `specs/` that reference `revertIssueCostFile` are historical records and do not need to be updated.
