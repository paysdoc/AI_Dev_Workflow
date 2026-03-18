# PR-Review: Formalize board status types and relocate In Review transition

## PR-Review Description
Two review comments on PR #230:

1. **testPhase.ts (line 51)** — Status strings like `'Building'`, `'Testing'`, `'In Review'`, `'In Progress'`, and `'Review'` are arbitrary magic strings scattered across phase files. The reviewer requests creating a type and mapping to formalize the available board statuses. The coding guidelines explicitly state: "Enums — Use enums for named constant sets. Avoid magic numbers and strings."

2. **prPhase.ts (line 64)** — The `moveToStatus('In Review')` call fires immediately after PR creation, but the reviewer wants the issue to remain in its current status until the review and document agents are done. The existing `completeWorkflow` function in `workflowCompletion.ts` already calls `moveToStatus('Review')` after all phases (review + document) complete, which satisfies this requirement. The fix is to remove the premature transition from `prPhase.ts`.

## Summary of Original Implementation Plan
The original plan (`specs/issue-229-adw-c3urq8-harden-project-board-sdlc_planner-harden-project-board-status.md`) hardened project board status propagation by:
- Promoting `moveIssueToStatus` error logging from `warn` to `error`
- Changing `moveIssueToStatus` return type to `Promise<boolean>`
- Updating `IssueTracker.moveToStatus` interface and both providers (GitHub, Jira)
- Adding `refreshTokenIfNeeded()` before GraphQL calls
- Adding intermediate status transitions: `'Building'` (buildPhase), `'Testing'` (testPhase), `'In Review'` (prPhase), and `'In Progress'` on error (workflowCompletion)

## Relevant Files
Use these files to resolve the review:

- `adws/providers/types.ts` — Contains `IssueTracker` interface. Add `BoardStatus` enum here and update `moveToStatus` signature to use it.
- `adws/phases/buildPhase.ts` — Uses `'Building'` magic string on line 40. Replace with `BoardStatus.Building`.
- `adws/phases/testPhase.ts` — Uses `'Testing'` magic string on line 51. Replace with `BoardStatus.Testing`.
- `adws/phases/prPhase.ts` — Contains the `moveToStatus('In Review')` call on line 64 that must be removed entirely.
- `adws/phases/planPhase.ts` — Uses `'In Progress'` magic string on line 32. Replace with `BoardStatus.InProgress`.
- `adws/phases/workflowCompletion.ts` — Uses `'Review'` on line 61 and `'In Progress'` on line 180. Replace with `BoardStatus.Review` and `BoardStatus.InProgress`.
- `adws/phases/prReviewCompletion.ts` — Uses `'Review'` on line 135. Replace with `BoardStatus.Review`.
- `adws/providers/github/githubIssueTracker.ts` — Update `moveToStatus` parameter type from `string` to `BoardStatus`.
- `adws/providers/jira/jiraIssueTracker.ts` — Update `moveToStatus` parameter type from `string` to `BoardStatus`.
- `adws/github/projectBoardApi.ts` — Underlying function keeps `string` parameter (handles fuzzy matching), no changes needed.
- `features/harden_project_board_status.feature` — Update BDD scenario for removed 'In Review' in prPhase and add scenario for `BoardStatus` enum.
- `features/step_definitions/hardenProjectBoardStatusSteps.ts` — Update step definitions to match new scenarios.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Define `BoardStatus` enum in `adws/providers/types.ts`
- Add a `BoardStatus` string enum above the `IssueTracker` interface with the following values:
  ```typescript
  export enum BoardStatus {
    InProgress = 'In Progress',
    Building = 'Building',
    Testing = 'Testing',
    Review = 'Review',
  }
  ```
- Update the `IssueTracker.moveToStatus` signature from `status: string` to `status: BoardStatus`.

### Step 2: Update `adws/providers/github/githubIssueTracker.ts`
- Import `BoardStatus` from `'../types'`.
- Change the `moveToStatus` parameter type from `status: string` to `status: BoardStatus`.
- The body remains the same — `BoardStatus` enum values are strings, so `moveIssueToStatus(issueNumber, status, this.repoInfo)` works as-is.

### Step 3: Update `adws/providers/jira/jiraIssueTracker.ts`
- Import `BoardStatus` from `'../types'`.
- Change the `moveToStatus` parameter type from `status: string` to `status: BoardStatus`.
- The body remains the same — the string enum value flows through to `matchTransition` seamlessly.

### Step 4: Update `adws/phases/planPhase.ts`
- Import `BoardStatus` from `'../providers/types'`.
- Replace `'In Progress'` with `BoardStatus.InProgress` on line 32.

### Step 5: Update `adws/phases/buildPhase.ts`
- Import `BoardStatus` from `'../providers/types'`.
- Replace `'Building'` with `BoardStatus.Building` on line 40.

### Step 6: Update `adws/phases/testPhase.ts`
- Import `BoardStatus` from `'../providers/types'`.
- Replace `'Testing'` with `BoardStatus.Testing` on line 51.

### Step 7: Remove `moveToStatus('In Review')` from `adws/phases/prPhase.ts`
- Remove the `moveToStatus('In Review')` call on line 64 (inside the `if (repoContext)` block on lines 62-65).
- The `completeWorkflow` function already moves to `'Review'` after all phases complete, satisfying the reviewer's intent.
- No `BoardStatus` import is needed in this file since no `moveToStatus` call remains.

### Step 8: Update `adws/phases/workflowCompletion.ts`
- Import `BoardStatus` from `'../providers/types'`.
- Replace `'Review'` with `BoardStatus.Review` on line 61.
- Replace `'In Progress'` with `BoardStatus.InProgress` on line 180.

### Step 9: Update `adws/phases/prReviewCompletion.ts`
- Import `BoardStatus` from `'../providers/types'`.
- Replace `'Review'` with `BoardStatus.Review` on line 135.

### Step 10: Update BDD feature file `features/harden_project_board_status.feature`
- Change the scenario "prPhase.ts calls moveToStatus with In Review after PR creation" — since 'In Review' is removed from prPhase, update this scenario to instead verify that prPhase.ts does NOT contain a moveToStatus call (confirming the removal).
- Add a new scenario verifying that `adws/providers/types.ts` contains a `BoardStatus` enum with the expected values.
- Add a new scenario verifying that phase files use `BoardStatus.` enum references instead of raw strings.

### Step 11: Update BDD step definitions `features/step_definitions/hardenProjectBoardStatusSteps.ts`
- Update the step definition for the changed prPhase scenario to assert that prPhase.ts does NOT contain `moveToStatus`.
- Add step definitions for the new BoardStatus enum scenarios.

### Step 12: Run validation commands
- Run `bun run lint` to check for linting issues.
- Run `bunx tsc --noEmit` to type-check the root project.
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to type-check the ADW module.
- Run `bunx cucumber-js --tags "@adw-wrzj5j-harden-project-board"` to run the feature-specific BDD scenarios.

## Validation Commands
Execute every command to validate the review is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type-check the root project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the ADW module
- `bunx cucumber-js --tags "@adw-wrzj5j-harden-project-board"` — Run the feature-specific BDD scenarios
- `bunx cucumber-js --tags "@regression"` — Run all regression BDD scenarios

## Notes
- `projectBoardApi.ts` keeps its `string` parameter because it handles fuzzy matching (`matchStatusOption`). The `BoardStatus` enum values are strings, so they pass through seamlessly.
- The `completeWorkflow` function in `workflowCompletion.ts` (line 61) already moves to `'Review'` after all phases including review and document are done — this satisfies the reviewer's second comment without any additional code.
- `prReviewCompletion.ts` also calls `moveToStatus('Review')` — this is the PR review workflow completion (separate from the SDLC workflow), and correctly transitions after all review work is done.
- The `handleWorkflowError` function in `workflowCompletion.ts` uses fire-and-forget `.catch(() => {})` pattern for `moveToStatus` because the function returns `never`. This pattern is preserved with the `BoardStatus` enum.
