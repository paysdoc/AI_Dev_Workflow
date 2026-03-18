# Feature: Harden project board status propagation

## Metadata
issueNumber: `229`
adwId: `c3urq8-harden-project-board`
issueJson: `{"number":229,"title":"Harden project board status propagation","body":"...","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-18T10:25:12Z","comments":[],"actionableComment":null}`

## Feature Description
Make the project board status propagation system robust, observable, and richer in status tracking. Currently `projectBoardApi.ts` silently swallows errors at `warn` level, the GitHub App installation token may expire mid-workflow before later `moveToStatus` calls, and only two transition points exist (plan start → "In Progress", completion → "Review"). This feature promotes error logging, adds a boolean return type, refreshes tokens before GraphQL calls, and adds intermediate status transitions for build, test, and PR phases.

## User Story
As a workflow operator
I want project board statuses to reflect actual workflow progress with reliable error reporting
So that I can monitor workflow progress on the project board and diagnose failures through error-level logs

## Problem Statement
1. `moveIssueToStatus` logs failures at `warn` level — they don't surface in monitoring.
2. `moveIssueToStatus` returns `void` — callers have no programmatic way to know if the update succeeded.
3. The GitHub App installation token (1-hour TTL) may expire during long SDLC workflows, causing silent `moveToStatus` failures at completion time.
4. Only two board transitions exist (plan start → "In Progress", completion → "Review"), so the board doesn't reflect intermediate workflow progress.

## Solution Statement
- **B1**: Change the catch-block log level in `moveIssueToStatus` from `warn` to `error`.
- **B2**: Change `moveIssueToStatus` return type from `Promise<void>` to `Promise<boolean>`. Return `true` on success/already-at-target, `false` on failure. Update the `IssueTracker` interface and both provider implementations (GitHub, Jira).
- **C1**: Call `refreshTokenIfNeeded()` at the top of `moveIssueToStatus` in `projectBoardApi.ts` before making GraphQL calls.
- **D**: Add `moveToStatus` calls at build start ("Building"), test start ("Testing"), and after PR creation ("In Review"). Add a "In Progress" transition on workflow error in `handleWorkflowError`.

## Relevant Files
Use these files to implement the feature:

- `adws/github/projectBoardApi.ts` — Core `moveIssueToStatus` function. Change log level, return type, and add token refresh.
- `adws/github/githubAppAuth.ts` — Contains `refreshTokenIfNeeded()` to import.
- `adws/providers/types.ts` — `IssueTracker` interface with `moveToStatus` signature.
- `adws/providers/github/githubIssueTracker.ts` — GitHub implementation of `IssueTracker.moveToStatus`.
- `adws/providers/jira/jiraIssueTracker.ts` — Jira implementation of `IssueTracker.moveToStatus`.
- `adws/phases/buildPhase.ts` — Add "Building" status transition at build entry.
- `adws/phases/testPhase.ts` — Add "Testing" status transition at test entry.
- `adws/phases/prPhase.ts` — Add "In Review" status transition after PR creation.
- `adws/phases/workflowCompletion.ts` — Already has "Review" transition. Add "In Progress" on error.
- `adws/phases/planPhase.ts` — Already has "In Progress" transition (no changes needed, reference only).
- `guidelines/coding_guidelines.md` — Coding guidelines to follow.

## Implementation Plan
### Phase 1: Foundation — Observability & Return Type
Change `moveIssueToStatus` in `projectBoardApi.ts` to log at `error` level and return `boolean`. Propagate the return type change through the `IssueTracker` interface and both provider implementations.

### Phase 2: Token Refresh
Import `refreshTokenIfNeeded` from `githubAppAuth` into `projectBoardApi.ts` and call it at the top of `moveIssueToStatus` before any GraphQL calls.

### Phase 3: Intermediate Status Transitions
Add `moveToStatus` calls in `buildPhase.ts`, `testPhase.ts`, `prPhase.ts`, and `workflowCompletion.ts` (error handler) following the existing guard pattern.

## Step by Step Tasks

### Step 1: Update `moveIssueToStatus` return type and log level in `projectBoardApi.ts`
- Change the return type of `moveIssueToStatus` from `Promise<void>` to `Promise<boolean>`.
- In the catch block (line 269), change the log level from `'warn'` to `'error'`.
- Add `return true` after the successful `updateProjectItemStatus` call and `log` statement.
- Add `return true` at each early-return point where the issue is already at the target status (the "already in" cases).
- Add `return false` in the catch block.
- For the informational early returns (no project, issue not found, no status field, status not found), return `false`.

### Step 2: Add token refresh in `projectBoardApi.ts`
- Import `refreshTokenIfNeeded` from `'../github/githubAppAuth'` (same package, so `'./githubAppAuth'`).
- At the top of `moveIssueToStatus`, before the `findRepoProjectId` call, add: `refreshTokenIfNeeded(repoInfo.owner, repoInfo.repo);`

### Step 3: Update `IssueTracker` interface in `adws/providers/types.ts`
- Change `moveToStatus(issueNumber: number, status: string): Promise<void>;` to `moveToStatus(issueNumber: number, status: string): Promise<boolean>;`

### Step 4: Update GitHub `IssueTracker` implementation in `adws/providers/github/githubIssueTracker.ts`
- Change `moveToStatus` return type from `Promise<void>` to `Promise<boolean>`.
- Return the boolean result from `moveIssueToStatus`.

### Step 5: Update Jira `IssueTracker` implementation in `adws/providers/jira/jiraIssueTracker.ts`
- Change `moveToStatus` return type from `Promise<void>` to `Promise<boolean>`.
- Return `true` after a successful transition (`doTransition` call).
- Return `true` when already at the target status (the "already in" early return).
- Return `false` when no matching transition is found.
- Return `false` in the catch block.

### Step 6: Add "Building" status transition in `buildPhase.ts`
- At the top of `executeBuildPhase`, before the plan loading logic, add:
  ```typescript
  if (repoContext) {
    await repoContext.issueTracker.moveToStatus(issueNumber, 'Building');
  }
  ```

### Step 7: Add "Testing" status transition in `testPhase.ts`
- At the top of `executeTestPhase`, before the unit tests gate, add:
  ```typescript
  if (repoContext) {
    await repoContext.issueTracker.moveToStatus(issueNumber, 'Testing');
  }
  ```

### Step 8: Add "In Review" status transition in `prPhase.ts`
- After the PR is successfully created (after the `postIssueStageComment(... 'pr_created' ...)` call, inside the `shouldExecuteStage` block), add:
  ```typescript
  if (repoContext) {
    await repoContext.issueTracker.moveToStatus(issueNumber, 'In Review');
  }
  ```

### Step 9: Add "In Progress" status transition on workflow error in `workflowCompletion.ts`
- In `handleWorkflowError`, after the error comment is posted (after the `postIssueStageComment(... 'error' ...)` call), add:
  ```typescript
  if (repoContext) {
    repoContext.issueTracker.moveToStatus(issueNumber, 'In Progress').catch(() => {});
  }
  ```
  Note: Use `.catch(() => {})` instead of `await` because `handleWorkflowError` returns `never` (calls `process.exit(1)`) — we fire-and-forget here since the process is about to terminate. The `.catch` prevents unhandled rejection warnings.

### Step 10: Run validation commands
- Run `bun run lint` to check for linting issues.
- Run `bunx tsc --noEmit` to type-check the main project.
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to type-check the ADW module.
- Run `bunx cucumber-js --tags "@regression"` to run regression BDD scenarios.

## Testing Strategy
### Edge Cases
- `moveIssueToStatus` is called when no project board is linked → returns `false`, logs info, no crash.
- `moveIssueToStatus` is called with a status that doesn't exist on the board → returns `false`, logs info.
- `refreshTokenIfNeeded` is called when GitHub App auth is not configured → no-op (existing behavior).
- Token refresh fails → `refreshTokenIfNeeded` logs error internally, `moveIssueToStatus` proceeds with potentially stale token and the subsequent GraphQL call may fail → caught, logged at `error`, returns `false`.
- `handleWorkflowError` fires `moveToStatus('In Progress')` but the process exits before it completes → acceptable, the `.catch()` prevents unhandled rejection.
- Phase callers treat `moveToStatus` as fire-and-forget — they `await` but ignore the return value. This is intentional; the boolean return enables future retry logic without requiring caller changes now.

## Acceptance Criteria
- `moveIssueToStatus` catch block logs at `error` level (not `warn`).
- `moveIssueToStatus` returns `Promise<boolean>` — `true` on success/already-at-target, `false` on failure.
- `IssueTracker.moveToStatus` returns `Promise<boolean>` in the interface and both implementations (GitHub, Jira).
- `refreshTokenIfNeeded()` is called at the start of `moveIssueToStatus` in `projectBoardApi.ts`.
- `executeBuildPhase` calls `moveToStatus(issueNumber, 'Building')` at entry.
- `executeTestPhase` calls `moveToStatus(issueNumber, 'Testing')` at entry.
- `executePRPhase` calls `moveToStatus(issueNumber, 'In Review')` after PR creation.
- `handleWorkflowError` calls `moveToStatus(issueNumber, 'In Progress')` on error.
- All validation commands pass with zero errors.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type-check the root project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the ADW module
- `bunx cucumber-js --tags "@regression"` — Run regression BDD scenarios

## Notes
- No new libraries are needed.
- Phase callers continue to use fire-and-forget semantics — they `await` the `moveToStatus` call but don't branch on the result. The boolean return value is purely for future retry/observability enhancements.
- The status names ("Building", "Testing", "In Review") rely on the existing fuzzy matching in `matchStatusOption`. If a board doesn't have these columns, `moveIssueToStatus` handles it gracefully by logging and returning `false`.
- The `handleWorkflowError` function has return type `never` (it calls `process.exit(1)`), so the `moveToStatus` call there must be fire-and-forget with `.catch(() => {})` rather than `await`.
