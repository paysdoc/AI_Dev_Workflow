# Harden Project Board Status Propagation

**ADW ID:** wrzj5j-harden-project-board
**Date:** 2026-03-18
**Specification:** specs/issue-229-adw-c3urq8-harden-project-board-sdlc_planner-harden-project-board-status.md

## Overview

This feature makes project board status propagation robust, observable, and richer in tracking. Previously, `moveIssueToStatus` silently swallowed failures at `warn` level, tokens could expire mid-workflow, and only two transition points (plan start → "In Progress", completion → "Review") existed. The feature promotes errors to `error`-level logging, returns a `boolean` result, refreshes tokens before GraphQL calls, and adds intermediate status transitions for build, test, and PR phases.

## What Was Built

- **Observability upgrade**: `moveIssueToStatus` now logs failures at `error` level (previously `warn`), surfacing failures in monitoring
- **Return type**: `moveIssueToStatus` and `IssueTracker.moveToStatus` now return `Promise<boolean>` — `true` on success/already-at-target, `false` on failure
- **Token refresh**: `refreshTokenIfNeeded()` is called at the top of `moveIssueToStatus` before any GraphQL calls, preventing stale-token failures in long-running workflows
- **Intermediate transitions**: New board status transitions at build start ("Building"), test start ("Testing"), PR creation ("In Review"), and workflow error ("In Progress")
- **BDD scenarios**: New `features/harden_project_board_status.feature` with Cucumber step definitions covering all acceptance criteria

## Technical Implementation

### Files Modified

- `adws/github/projectBoardApi.ts`: Changed return type to `Promise<boolean>`, promoted error log level, added `refreshTokenIfNeeded()` call, added explicit `return true/false` at all code paths
- `adws/providers/types.ts`: Updated `IssueTracker.moveToStatus` interface signature from `Promise<void>` to `Promise<boolean>`
- `adws/providers/github/githubIssueTracker.ts`: Updated return type and propagates the boolean from `moveIssueToStatus`
- `adws/providers/jira/jiraIssueTracker.ts`: Updated return type; added explicit `return true/false` at all paths; promoted catch-block log from `warn` to `error`
- `adws/phases/buildPhase.ts`: Added `moveToStatus(issueNumber, 'Building')` at the entry of `executeBuildPhase`
- `adws/phases/testPhase.ts`: Added `moveToStatus(issueNumber, 'Testing')` at the entry of `executeTestPhase`
- `adws/phases/prPhase.ts`: Added `moveToStatus(issueNumber, 'In Review')` after PR creation
- `adws/phases/workflowCompletion.ts`: Added fire-and-forget `moveToStatus(issueNumber, 'In Progress').catch(() => {})` in `handleWorkflowError`
- `features/harden_project_board_status.feature`: New BDD feature file covering acceptance criteria
- `features/step_definitions/hardenProjectBoardStatusSteps.ts`: New Cucumber step definitions

### Key Changes

- **`projectBoardApi.ts`**: Every early-return path now returns an explicit `boolean`. "Already at target status" paths return `true`; "no project / not found / status not found" paths return `false`; catch block returns `false` after logging at `error`
- **Token refresh**: `refreshTokenIfNeeded(owner, repo)` is called (fire-and-forget style — it manages its own async internally) before `findRepoProjectId` to ensure a fresh GitHub App installation token
- **`handleWorkflowError`**: Uses `.catch(() => {})` instead of `await` because the function has return type `never` (calls `process.exit(1)`); this prevents unhandled rejection warnings while still attempting the board update
- **Jira parity**: `JiraIssueTracker.moveToStatus` now mirrors GitHub's error handling semantics — `error`-level logging on failure, explicit `boolean` returns
- **Interface contract**: The `IssueTracker` interface change is backwards-compatible for callers because all phase callers `await` but ignore the return value (fire-and-forget semantics preserved)

## How to Use

The feature is transparent to workflow operators — no configuration is required. Once deployed, the project board will automatically reflect these status transitions:

1. **"In Progress"** — set at plan phase start (existing, unchanged)
2. **"Building"** — set at build phase entry
3. **"Testing"** — set at test phase entry
4. **"In Review"** — set after PR is successfully created
5. **"Review"** — set at workflow completion (existing, unchanged)
6. **"In Progress"** — reset on workflow error (fire-and-forget)

Status names use fuzzy matching via `matchStatusOption`. If a board column doesn't exist for a given status name, `moveIssueToStatus` logs at `info` level and returns `false` — no crash.

## Configuration

No new configuration required. Status column names ("Building", "Testing", "In Review") rely on the existing fuzzy matching in `matchStatusOption` inside `projectBoardApi.ts`. Boards without those columns will silently skip the transition and return `false`.

## Testing

Run the regression BDD scenarios:

```sh
bunx cucumber-js --tags "@regression"
```

The new `features/harden_project_board_status.feature` covers all acceptance criteria. Type-check with:

```sh
bunx tsc --noEmit
bunx tsc --noEmit -p adws/tsconfig.json
```

## Notes

- Phase callers treat `moveToStatus` as fire-and-forget — they `await` but do not branch on the `boolean` result. The return value is available for future retry or observability logic without requiring caller changes.
- `refreshTokenIfNeeded` is a no-op when GitHub App auth is not configured, so non-App setups are unaffected.
- The `handleWorkflowError` "In Progress" transition is best-effort; the process exits immediately after, so the board update may not complete before termination.
