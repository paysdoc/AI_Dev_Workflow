# BoardManager Provider Interface

**ADW ID:** qm6gwx-add-boardmanager-pro
**Date:** 2026-04-09
**Specification:** specs/issue-427-adw-qm6gwx-add-boardmanager-pro-sdlc_planner-add-board-manager-provider.md

## Overview

Adds a `BoardManager` provider interface that automatically ensures a GitHub Projects V2 board exists for a repository, with all five required ADW status columns (Blocked, Todo, In Progress, Review, Done). Terminal workflow failures now move issues to `Blocked` instead of `InProgress`, making stalled issues distinguishable from actively blocked ones.

## What Was Built

- `BoardManager` interface in `adws/providers/types.ts` with `findBoard`, `createBoard`, and `ensureColumns` methods
- `BoardStatus` enum extended with `Blocked`, `Todo`, and `Done` values
- `BOARD_COLUMNS` constant defining the canonical five-column set with order, color, and description
- `BoardColumnDefinition` interface for typed column definitions
- `GitHubBoardManager` class implementing all three methods via GraphQL
- Stub implementations for Jira and GitLab (throw "not implemented")
- `resolveBoardManager` factory in `repoContext.ts` wired alongside `resolveIssueTracker` and `resolveCodeHost`
- Fire-and-forget board setup in `initializeWorkflow` (runs before worktree setup, never blocks)
- `handleWorkflowError` moves issues to `Blocked` (was `InProgress`)
- `handlePRReviewWorkflowError` now also moves issues to `Blocked`
- Unit tests for `BOARD_COLUMNS`, `BoardStatus` enum, and stub implementations

## Technical Implementation

### Files Modified

- `adws/providers/types.ts`: Added `BoardManager` interface, `BoardColumnDefinition` interface, `BOARD_COLUMNS` constant, extended `BoardStatus` with `Blocked`/`Todo`/`Done`, added optional `boardManager` to `RepoContext`
- `adws/providers/repoContext.ts`: Added `resolveBoardManager` resolver and wired `boardManager` into `createRepoContext`
- `adws/phases/workflowInit.ts`: Added fire-and-forget board setup block after `RepoContext` creation
- `adws/phases/workflowCompletion.ts`: Changed `handleWorkflowError` to use `BoardStatus.Blocked`
- `adws/phases/prReviewCompletion.ts`: Added `moveToStatus(Blocked)` call in `handlePRReviewWorkflowError`
- `adws/providers/github/index.ts`: Exported `createGitHubBoardManager`
- `adws/providers/gitlab/index.ts`: Exported `createGitLabBoardManager`
- `adws/providers/jira/index.ts`: Exported `createJiraBoardManager`

### New Files

- `adws/providers/github/githubBoardManager.ts`: Full GitHub implementation using `gh api graphql`
- `adws/providers/gitlab/gitlabBoardManager.ts`: Stub that throws "not implemented"
- `adws/providers/jira/jiraBoardManager.ts`: Stub that throws "not implemented"
- `adws/providers/__tests__/boardManager.test.ts`: Unit tests for constants and stubs
- `features/board_manager_provider.feature`: BDD scenarios for the feature

### Key Changes

- **PAT fallback**: `GitHubBoardManager.findBoard()` reuses the same PAT fallback pattern as `moveIssueToStatus` — if the app token cannot access Projects V2, it retries with `GITHUB_PAT`
- **Owner detection for board creation**: `createBoard()` looks up the owner node ID via `repository.owner.id` — the GitHub API requires a node ID, not a login, for `createProjectV2`
- **Column idempotency**: `ensureColumns()` reads existing status options and only creates missing ones; existing columns are left untouched (GitHub API cannot update colors/descriptions after creation)
- **Fire-and-forget wiring**: Board setup in `initializeWorkflow` is wrapped in `Promise.resolve().then(async () => {...})` so it never delays or blocks workflow execution
- **Optional provider**: `resolveBoardManager` is called inside a `try/catch` in `createRepoContext`; unsupported platforms simply leave `boardManager` as `undefined`

## Canonical Board Columns

| Order | Status | Color | Description |
|-------|--------|-------|-------------|
| 1 | Blocked | RED | This item cannot be completed |
| 2 | Todo | GRAY | This item hasn't been started |
| 3 | In Progress | YELLOW | This is actively being worked on |
| 4 | Review | PURPLE | This item is being peer reviewed |
| 5 | Done | GREEN | This has been completed |

## How to Use

Board setup is fully automatic — no manual steps required:

1. On every workflow invocation, `initializeWorkflow` triggers board setup fire-and-forget
2. `findBoard()` queries the repository's linked Projects V2 boards
3. If no board is found, `createBoard(repoName)` creates one named after the repo and links it
4. `ensureColumns(boardId)` adds any missing columns with the correct color and description
5. Failures are logged as warnings and never block the workflow

To trigger `Blocked` status manually, let a workflow hit an unrecoverable error — `handleWorkflowError` and `handlePRReviewWorkflowError` both call `moveToStatus(Blocked)`.

## Configuration

No additional configuration required. The `BoardManager` uses the same `GITHUB_PAT` and GitHub App credentials already configured for the workflow. The `boardManager` property on `RepoContext` is resolved automatically from the code host platform (GitHub only; Jira/GitLab are stubs).

## Testing

```bash
bun run test
```

Key test file: `adws/providers/__tests__/boardManager.test.ts`

Tests cover:
- `BOARD_COLUMNS` has exactly 5 entries with correct `order`, `status`, `color`, `description`
- `BoardStatus` enum includes all five values (`Blocked`, `Todo`, `InProgress`, `Review`, `Done`)
- Jira stub throws "not implemented" for all three methods
- GitLab stub throws "not implemented" for all three methods

## Notes

- **`Done` status**: Handled by GitHub auto-close when a PR with a close keyword is merged. No ADW code writes `Done` directly.
- **Column visibility**: Out of scope — the GitHub API does not support auto-hiding empty columns.
- **Color/description immutability**: GitHub only accepts color and description at column creation time. Existing columns with wrong colors cannot be updated via the API.
- **`handleRateLimitPause` unchanged**: Rate-limit pauses keep issues at `InProgress`. The resume path restores the correct status via the first phase that runs after resumption.
- **Platform resolution**: `boardManager` is resolved from the code host platform (not the issue tracker platform) because project boards are a code host concern.
