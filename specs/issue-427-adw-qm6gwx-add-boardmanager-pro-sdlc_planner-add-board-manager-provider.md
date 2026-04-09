# Feature: Add BoardManager provider interface with board creation and Blocked status

## Metadata
issueNumber: `427`
adwId: `qm6gwx-add-boardmanager-pro`
issueJson: `{"number":427,"title":"Add BoardManager provider interface with board creation and Blocked status","body":"## Summary\n\nAdd a `BoardManager` provider interface that ensures a GitHub Projects V2 board exists with the required ADW columns. Wire up `Blocked` status on terminal workflow failures.\n\n## Requirements\n\n### BoardManager interface (`providers/types.ts`)\n\nNew provider-level interface alongside `IssueTracker` and `CodeHost`:\n\n```ts\ninterface BoardManager {\n  findBoard(): Promise<string | null>;\n  createBoard(name: string): Promise<string>;\n  ensureColumns(boardId: string): Promise<boolean>;\n}\n```\n\n### BoardStatus enum extension\n\nExtend `BoardStatus` with `Blocked`, `Todo`, and `Done`.\n\n### BOARD_COLUMNS constant (`providers/types.ts`)\n\nCanonical column definition with order, color, and description:\n\n| Order | Status | Color | Description |\n|-------|--------|-------|-------------|\n| 1 | Blocked | RED | This item cannot be completed |\n| 2 | Todo | GRAY | This item hasn't been started |\n| 3 | In Progress | YELLOW | This is actively being worked on |\n| 4 | Review | PURPLE | This item is being peer reviewed |\n| 5 | Done | GREEN | This has been completed |\n\n### RepoContext\n\nAdd `boardManager` property to `RepoContext`.\n\n### GitHub implementation\n\n- `findBoard()` — query `repository.projectsV2` (existing pattern)\n- `createBoard(name)` — detect user vs org owner, create project via `createProjectV2` mutation, link to repo. Board named after the repo (e.g., `paysdoc.nl`). Owner node ID is an internal concern\n- `ensureColumns(boardId)` — add missing columns with color + description, leave existing columns untouched. Colors and descriptions can only be set on creation (API limitation)\n\n### workflowInit integration\n\n- Run board setup early in `initializeWorkflow`, before worktree setup\n- Fire-and-forget: log warnings on failure, never block the workflow\n- Runs on every workflow invocation (no caching)\n\n### Blocked status on error paths\n\n- `handleWorkflowError` (`workflowCompletion.ts`) — move to `Blocked` instead of `InProgress`\n- `handlePRReviewWorkflowError` (`prReviewCompletion.ts`) — move to `Blocked` via `config.base.issueNumber`\n- `handleRateLimitPause` — **no change**, stays `InProgress`. Resume path naturally restores `InProgress` via the first phase that runs\n\n### Done status\n\nHandled by GitHub auto-close when a PR with close keyword is merged. No ADW code needed.\n\n### Jira / GitLab\n\nStub implementations that return false / throw \"not implemented\".\n\n## Out of scope\n\n- Column visibility (GitHub API does not support auto-hiding empty columns)\n- Updating colors on existing columns (GitHub API does not support it)","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-04-09T09:53:37Z","comments":[],"actionableComment":null}`

## Feature Description
Add a `BoardManager` provider interface to ADW that ensures a GitHub Projects V2 board exists with the required ADW status columns (Blocked, Todo, In Progress, Review, Done). The interface sits alongside `IssueTracker` and `CodeHost` in the provider abstraction layer. The GitHub implementation uses GraphQL to find or create a board, link it to the repo, and ensure all required columns exist with correct colors and descriptions. Terminal workflow errors move issues to `Blocked` instead of `InProgress`. Jira and GitLab get stub implementations.

## User Story
As an ADW operator
I want the workflow to automatically ensure a project board exists with the correct columns
So that issue status tracking is consistent across all repositories without manual board setup

## Problem Statement
ADW currently moves issues to `InProgress` and `Review` on an existing board but does not create the board or ensure the required columns exist. Terminal workflow failures leave issues in `InProgress`, making it hard to distinguish stalled issues from blocked ones. There is no `Blocked` status to signal that an issue hit an unrecoverable error.

## Solution Statement
1. Define a `BoardManager` interface in `providers/types.ts` with `findBoard`, `createBoard`, and `ensureColumns` methods.
2. Extend `BoardStatus` with `Blocked`, `Todo`, and `Done`.
3. Add a `BOARD_COLUMNS` constant defining the canonical column set with order, color, and description.
4. Implement `GitHubBoardManager` using GraphQL mutations (owner detection, project creation, repo linking, column creation).
5. Wire board setup into `initializeWorkflow` as fire-and-forget.
6. Change error handlers to move issues to `Blocked` on terminal failures.
7. Add stub implementations for Jira and GitLab.

## Relevant Files
Use these files to implement the feature:

- `adws/providers/types.ts` — Add `BoardManager` interface, extend `BoardStatus` enum, add `BOARD_COLUMNS` constant, add `boardManager` to `RepoContext`
- `adws/providers/repoContext.ts` — Resolve `BoardManager` implementation and include in `RepoContext`
- `adws/providers/github/githubIssueTracker.ts` — Reference for GitHub provider pattern (class + factory function)
- `adws/providers/github/githubCodeHost.ts` — Reference for GitHub provider pattern (class + factory function)
- `adws/providers/github/index.ts` — Export new `createGitHubBoardManager`
- `adws/github/projectBoardApi.ts` — Existing GraphQL patterns for Projects V2 (`findRepoProjectId`, `getStatusFieldOptions`, PAT fallback)
- `adws/phases/workflowInit.ts` — Wire board setup into `initializeWorkflow`
- `adws/phases/workflowCompletion.ts` — Change `handleWorkflowError` to move to `Blocked`
- `adws/phases/prReviewCompletion.ts` — Add `Blocked` status move to `handlePRReviewWorkflowError`
- `adws/providers/jira/index.ts` — Add stub `BoardManager` export
- `adws/providers/gitlab/index.ts` — Add stub `BoardManager` export
- `guidelines/coding_guidelines.md` — Coding guidelines to follow

### Conditional Documentation
- `app_docs/feature-1773072529842-bmkqrg-jira-issue-tracker-provider.md` — Jira provider patterns
- `app_docs/feature-1773073902212-9l2nv9-repo-context-factory.md` — RepoContext factory and platform resolution patterns
- `app_docs/feature-1773341233172-9jw507-gitlab-codehost-provider.md` — GitLab provider patterns

### New Files
- `adws/providers/github/githubBoardManager.ts` — GitHub implementation of `BoardManager`
- `adws/providers/jira/jiraBoardManager.ts` — Jira stub implementation of `BoardManager`
- `adws/providers/gitlab/gitlabBoardManager.ts` — GitLab stub implementation of `BoardManager`

## Implementation Plan
### Phase 1: Foundation
Extend the provider type system with the `BoardManager` interface, `BoardStatus` enum values, and `BOARD_COLUMNS` constant. Add `boardManager` to `RepoContext`. These shared types underpin all subsequent work.

### Phase 2: Core Implementation
Implement `GitHubBoardManager` using existing GraphQL patterns from `projectBoardApi.ts`:
- `findBoard()` reuses the `findRepoProjectId` query pattern
- `createBoard()` detects user vs org owner via node ID lookup, creates the project, and links it to the repo
- `ensureColumns()` reads existing status options and creates missing ones with color and description

Add stub implementations for Jira and GitLab that throw "not implemented" or return false.

### Phase 3: Integration
- Wire `BoardManager` resolution into `repoContext.ts` alongside existing `IssueTracker` and `CodeHost` resolution
- Add fire-and-forget board setup call in `initializeWorkflow` before worktree setup
- Change `handleWorkflowError` to use `BoardStatus.Blocked` instead of `BoardStatus.InProgress`
- Add `Blocked` status move to `handlePRReviewWorkflowError`

## Step by Step Tasks

### Step 1: Extend BoardStatus enum and add BOARD_COLUMNS constant
- In `adws/providers/types.ts`, add `Blocked = 'Blocked'`, `Todo = 'Todo'`, and `Done = 'Done'` to the `BoardStatus` enum
- Add a `BoardColumnDefinition` interface with `order: number`, `status: BoardStatus`, `color: string`, `description: string`
- Add a `BOARD_COLUMNS` constant (readonly array of `BoardColumnDefinition`) with the five canonical columns:
  - `{ order: 1, status: BoardStatus.Blocked, color: 'RED', description: 'This item cannot be completed' }`
  - `{ order: 2, status: BoardStatus.Todo, color: 'GRAY', description: "This item hasn't been started" }`
  - `{ order: 3, status: BoardStatus.InProgress, color: 'YELLOW', description: 'This is actively being worked on' }`
  - `{ order: 4, status: BoardStatus.Review, color: 'PURPLE', description: 'This item is being peer reviewed' }`
  - `{ order: 5, status: BoardStatus.Done, color: 'GREEN', description: 'This has been completed' }`

### Step 2: Add BoardManager interface and update RepoContext
- In `adws/providers/types.ts`, add the `BoardManager` interface:
  ```ts
  interface BoardManager {
    findBoard(): Promise<string | null>;
    createBoard(name: string): Promise<string>;
    ensureColumns(boardId: string): Promise<boolean>;
  }
  ```
- Update the `RepoContext` type to include an optional `boardManager?: BoardManager` property

### Step 3: Implement GitHubBoardManager
- Create `adws/providers/github/githubBoardManager.ts`
- Follow the same class + factory function pattern as `githubIssueTracker.ts` and `githubCodeHost.ts`
- Constructor takes `RepoIdentifier`, validates it, converts to `RepoInfo`
- `findBoard()`: query `repository.projectsV2(first: 1)` — reuse the same GraphQL pattern as `findRepoProjectId` in `projectBoardApi.ts`. Include the PAT fallback pattern from `moveIssueToStatus`
- `createBoard(name)`:
  - Look up the owner node ID via `query { repository(owner, name) { owner { id } } }`
  - Detect if owner is a user or org via `query { repositoryOwner(login) { __typename } }`
  - Create the project via `createProjectV2` mutation with `ownerId` and `title`
  - Link project to repo via `linkProjectV2ToRepository` mutation
  - Return the new project ID
- `ensureColumns(boardId)`:
  - Read existing status field options via the `getStatusFieldOptions` pattern
  - Compare against `BOARD_COLUMNS` — for each missing column, create it via `createProjectV2StatusUpdate` mutation (using `updateProjectV2` or the status field create mutation) with color and description
  - Leave existing columns untouched
  - Return `true` if all columns exist (including newly created ones)
- Export factory function `createGitHubBoardManager(repoId: RepoIdentifier): BoardManager`
- Update `adws/providers/github/index.ts` to export `createGitHubBoardManager`

### Step 4: Add Jira and GitLab stub implementations
- Create `adws/providers/jira/jiraBoardManager.ts`:
  - Class `JiraBoardManager` implementing `BoardManager`
  - All methods throw `new Error('BoardManager not implemented for Jira')`
  - Factory function `createJiraBoardManager(): BoardManager`
- Create `adws/providers/gitlab/gitlabBoardManager.ts`:
  - Class `GitLabBoardManager` implementing `BoardManager`
  - All methods throw `new Error('BoardManager not implemented for GitLab')`
  - Factory function `createGitLabBoardManager(): BoardManager`
- Update `adws/providers/jira/index.ts` to export `createJiraBoardManager`
- Update `adws/providers/gitlab/index.ts` to export `createGitLabBoardManager`

### Step 5: Wire BoardManager into RepoContext factory
- In `adws/providers/repoContext.ts`:
  - Import `BoardManager` from `./types` and the platform-specific factory functions
  - Add a `resolveBoardManager(platform: Platform, repoId: RepoIdentifier): BoardManager` function following the same pattern as `resolveIssueTracker` and `resolveCodeHost`
  - In `createRepoContext`, resolve the `BoardManager` using the code host platform (board management is a code host concern, not issue tracker)
  - Include `boardManager` in the returned frozen object

### Step 6: Wire board setup into workflowInit
- In `adws/phases/workflowInit.ts`, after `RepoContext` creation (around line 264) and before worktree setup:
  - If `repoContext?.boardManager` exists, call a fire-and-forget board setup:
    ```ts
    if (repoContext?.boardManager) {
      Promise.resolve().then(async () => {
        try {
          const repoName = repoIdForContext.repo;
          let boardId = await repoContext.boardManager!.findBoard();
          if (!boardId) {
            boardId = await repoContext.boardManager!.createBoard(repoName);
            log(`Created project board "${repoName}"`, 'success');
          }
          await repoContext.boardManager!.ensureColumns(boardId);
          log('Board columns verified', 'success');
        } catch (error) {
          log(`Board setup failed (non-blocking): ${error}`, 'warn');
        }
      });
    }
    ```
  - This is fire-and-forget: errors are logged as warnings, never thrown

### Step 7: Change error handlers to use Blocked status
- In `adws/phases/workflowCompletion.ts` `handleWorkflowError`:
  - Change `BoardStatus.InProgress` to `BoardStatus.Blocked` in the `moveToStatus` call (line 149)
- In `adws/phases/prReviewCompletion.ts` `handlePRReviewWorkflowError`:
  - Add a `moveToStatus` call using `config.base.issueNumber`:
    ```ts
    if (repoContext) {
      postPRStageComment(repoContext, prNumber, 'pr_review_error', ctx);
      repoContext.issueTracker.moveToStatus(config.base.issueNumber, BoardStatus.Blocked).catch(() => {});
    }
    ```
  - Import `BoardStatus` if not already imported (already imported via `prReviewPhase.ts` re-export chain, verify)
- Verify `handleRateLimitPause` remains unchanged (stays `InProgress`) — no code change needed

### Step 8: Write unit tests
- Create `adws/providers/__tests__/boardManager.test.ts`:
  - Test `BOARD_COLUMNS` has exactly 5 entries with correct order, status, color, and description
  - Test `BoardStatus` enum includes `Blocked`, `Todo`, `Done`, `InProgress`, `Review`
  - Test Jira stub throws "not implemented" for all methods
  - Test GitLab stub throws "not implemented" for all methods

### Step 9: Validate
- Run `bun run lint` to check for code quality issues
- Run `bunx tsc --noEmit` to verify no TypeScript errors in root config
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify no TypeScript errors in adws config
- Run `bun run build` to verify no build errors
- Run `bun run test` to verify all existing tests pass with zero regressions

## Testing Strategy
### Unit Tests
- `BOARD_COLUMNS` constant correctness (5 entries, correct order/status/color/description)
- `BoardStatus` enum completeness (all 5 statuses present)
- Jira stub `BoardManager` throws "not implemented" for `findBoard`, `createBoard`, `ensureColumns`
- GitLab stub `BoardManager` throws "not implemented" for `findBoard`, `createBoard`, `ensureColumns`

### Edge Cases
- `findBoard()` returns `null` when no project is linked — `createBoard` should be called
- `findBoard()` returns a valid ID — `createBoard` should be skipped
- `ensureColumns()` when all columns already exist — should return `true` without creating any
- `ensureColumns()` when some columns exist — should only create missing ones
- `createBoard()` for user-owned repos vs org-owned repos — different owner detection path
- Board setup failure in `initializeWorkflow` — should log warning and not block workflow
- PAT fallback when app token cannot access Projects V2

## Acceptance Criteria
- `BoardManager` interface exists in `adws/providers/types.ts` with `findBoard`, `createBoard`, `ensureColumns`
- `BoardStatus` enum includes `Blocked`, `Todo`, and `Done`
- `BOARD_COLUMNS` constant defines all 5 columns with correct order, color, and description
- `RepoContext` includes an optional `boardManager` property
- `GitHubBoardManager` implements all three methods using GraphQL
- Jira and GitLab stubs throw "not implemented"
- `initializeWorkflow` runs board setup fire-and-forget before worktree setup
- `handleWorkflowError` moves issues to `Blocked` (not `InProgress`)
- `handlePRReviewWorkflowError` moves issues to `Blocked`
- `handleRateLimitPause` keeps issues at `InProgress` (unchanged)
- All existing tests pass with zero regressions
- TypeScript compiles without errors
- Linter passes

## Validation Commands
- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type check root TypeScript configuration
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check adws TypeScript configuration
- `bun run build` — Build the application to verify no build errors
- `bun run test` — Run all tests to validate zero regressions

## Notes
- The `guidelines/coding_guidelines.md` must be followed throughout implementation. Key points: strict TypeScript, immutability (use `readonly`), interfaces for object shapes, enums for named constant sets, meaningful error messages.
- Colors and descriptions can only be set on column creation (GitHub API limitation). Existing columns are left untouched even if their color/description differs from `BOARD_COLUMNS`.
- The `Done` status is handled by GitHub auto-close when a PR with close keyword is merged — no ADW code change needed for that path.
- Column visibility is out of scope (GitHub API does not support auto-hiding empty columns).
- The PAT fallback pattern from `projectBoardApi.ts` (`moveIssueToStatus`) should be reused in `GitHubBoardManager` for consistent auth handling.
- `boardManager` is resolved from the code host platform (not issue tracker) since project boards are a code host concern.
