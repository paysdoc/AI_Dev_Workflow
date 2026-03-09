# Feature: GitHub IssueTracker Provider

## Metadata
issueNumber: `114`
adwId: `1773070548003-fbxjed`
issueJson: `{"number":114,"title":"Implement GitHub IssueTracker provider","body":"## Summary\nWrap the existing GitHub issue operations (`issueApi.ts`, `projectBoardApi.ts`) behind the `IssueTracker` interface, creating the first concrete provider implementation.\n\n## Dependencies\n- #113 — Provider interfaces must be defined first\n\n## User Story\nAs a developer, I want the existing GitHub issue functionality wrapped in the IssueTracker interface so that phases can consume it through the abstraction without behavior changes.\n\n## Acceptance Criteria\n\n### Create `adws/providers/github/githubIssueTracker.ts`\n- Implement `IssueTracker` interface\n- Constructor takes `RepoIdentifier` — the provider is bound to a specific repo at creation time (no global registry fallback)\n- Wrap existing functions from `issueApi.ts`:\n  - `fetchGitHubIssue` → `fetchIssue` (transform `GitHubIssue` → `WorkItem`)\n  - `commentOnIssue` → `commentOnIssue`\n  - `deleteIssueComment` → `deleteComment`\n  - `closeIssue` → `closeIssue`\n  - `getIssueState` → `getIssueState`\n  - `fetchIssueCommentsRest` → `fetchComments` (transform `IssueCommentSummary` → `WorkItemComment`)\n- Wrap `moveIssueToStatus` from `projectBoardApi.ts` → `moveToStatus`\n- Factory function: `createGitHubIssueTracker(repoId: RepoIdentifier): IssueTracker`\n\n### Type mapping\n- Create mapping functions between `GitHubIssue` ↔ `WorkItem` and `IssueCommentSummary` ↔ `WorkItemComment`\n- These mappers live in `adws/providers/github/mappers.ts`\n\n### Tests\n- Unit tests for the provider in `adws/providers/github/__tests__/`\n- Test that the provider is correctly bound to its repo — calling methods should always use the bound repo, never fall back to global state\n- Test type mapping functions\n\n## Notes\n- The underlying `issueApi.ts` functions stay intact during this phase — the provider is a wrapper, not a replacement.\n- Each method must pass the bound `RepoIdentifier` explicitly to the underlying function — no reliance on `getTargetRepo()`.","state":"OPEN","author":"paysdoc","labels":["enhancement"],"createdAt":"2026-03-09T15:17:35Z","comments":[],"actionableComment":null}`

## Feature Description
Implement the first concrete provider for the `IssueTracker` interface defined in #113. This wraps the existing GitHub-specific issue operations (`issueApi.ts` and `projectBoardApi.ts`) behind the platform-agnostic `IssueTracker` interface. The provider is bound to a specific `RepoIdentifier` at construction time, passing it explicitly to every underlying function call — eliminating reliance on the global `getTargetRepo()` registry. Mapper functions translate between GitHub-specific types (`GitHubIssue`, `IssueCommentSummary`) and provider-agnostic types (`WorkItem`, `WorkItemComment`).

## User Story
As a developer
I want the existing GitHub issue functionality wrapped in the IssueTracker interface
So that workflow phases can consume it through the abstraction without behavior changes, enabling future support for other issue trackers (Jira, Linear, GitLab)

## Problem Statement
The ADW workflow phases currently call GitHub-specific functions directly (`fetchGitHubIssue`, `commentOnIssue`, etc.) and rely on the global `getTargetRepo()` registry for repository context. This tightly couples the workflow logic to GitHub and makes it impossible to support alternative issue trackers without modifying every phase.

## Solution Statement
Create a `GitHubIssueTracker` class that implements the `IssueTracker` interface from `adws/providers/types.ts`. The class is bound to a `RepoIdentifier` at construction time and delegates to the existing `issueApi.ts` and `projectBoardApi.ts` functions, converting its `RepoIdentifier` to the `RepoInfo` format those functions expect. Separate mapper functions handle type conversions between GitHub-specific types and the provider-agnostic `WorkItem`/`WorkItemComment` types.

## Relevant Files
Use these files to implement the feature:

- `adws/providers/types.ts` — Defines the `IssueTracker` interface, `WorkItem`, `WorkItemComment`, `RepoIdentifier`, and `Platform` enum that the provider must implement.
- `adws/providers/index.ts` — Provider barrel export; must be updated to re-export the new GitHub provider module.
- `adws/providers/__tests__/types.test.ts` — Existing tests for provider types; reference for test patterns and conventions.
- `adws/github/issueApi.ts` — Contains the underlying GitHub issue functions to wrap: `fetchGitHubIssue`, `commentOnIssue`, `deleteIssueComment`, `closeIssue`, `getIssueState`, `fetchIssueCommentsRest`.
- `adws/github/projectBoardApi.ts` — Contains `moveIssueToStatus` to wrap for the `moveToStatus` method.
- `adws/github/githubApi.ts` — Defines `RepoInfo` type used by the underlying functions; the provider must convert `RepoIdentifier` → `RepoInfo`.
- `adws/types/issueTypes.ts` — Defines `GitHubIssue`, `IssueCommentSummary`, `GitHubUser`, `GitHubLabel`, `GitHubComment` types used for mapping.
- `adws/core/index.ts` — Core barrel export; reference for export patterns.
- `guidelines/coding_guidelines.md` — Coding guidelines that must be followed (immutability, pure functions, strict types, no decorators).

### New Files
- `adws/providers/github/mappers.ts` — Type mapping functions: `mapGitHubIssueToWorkItem`, `mapIssueCommentSummaryToWorkItemComment`.
- `adws/providers/github/githubIssueTracker.ts` — `GitHubIssueTracker` class implementing `IssueTracker`, plus `createGitHubIssueTracker` factory function.
- `adws/providers/github/index.ts` — Barrel export for the GitHub provider module.
- `adws/providers/github/__tests__/mappers.test.ts` — Unit tests for the mapper functions.
- `adws/providers/github/__tests__/githubIssueTracker.test.ts` — Unit tests for the provider class.

## Implementation Plan
### Phase 1: Foundation
Create the mapper functions that convert between GitHub-specific types (`GitHubIssue`, `IssueCommentSummary`) and the platform-agnostic types (`WorkItem`, `WorkItemComment`). These are pure functions with no side effects, making them easy to test in isolation. Also create a helper to convert `RepoIdentifier` → `RepoInfo`.

### Phase 2: Core Implementation
Implement the `GitHubIssueTracker` class that implements the `IssueTracker` interface. The class stores a `RepoIdentifier` at construction time (validated via `validateRepoIdentifier`), converts it to `RepoInfo`, and delegates each method to the corresponding function from `issueApi.ts` or `projectBoardApi.ts`. The `deleteComment` method receives a `string` ID per the interface but must convert it to a `number` for `deleteIssueComment`.

### Phase 3: Integration
Export the new module through barrel files (`adws/providers/github/index.ts` and `adws/providers/index.ts`) so it is available to consumers. Write comprehensive tests verifying repo-binding, type mapping correctness, and delegation behavior.

## Step by Step Tasks

### Step 1: Create mapper functions
- Create `adws/providers/github/mappers.ts`
- Implement `mapGitHubIssueToWorkItem(issue: GitHubIssue): WorkItem`:
  - Map `issue.number` → `WorkItem.number`
  - Map `issue.number.toString()` → `WorkItem.id` (GitHub issues use number as ID)
  - Map `issue.title`, `issue.body`, `issue.state` directly
  - Map `issue.author.login` → `WorkItem.author`
  - Map `issue.labels.map(l => l.name)` → `WorkItem.labels`
  - Map `issue.comments.map(c => mapGitHubCommentToWorkItemComment(c))` → `WorkItem.comments`
- Implement `mapGitHubCommentToWorkItemComment(comment: GitHubComment): WorkItemComment`:
  - Map `comment.id` → `WorkItemComment.id`
  - Map `comment.body` → `WorkItemComment.body`
  - Map `comment.author.login` → `WorkItemComment.author`
  - Map `comment.createdAt` → `WorkItemComment.createdAt`
- Implement `mapIssueCommentSummaryToWorkItemComment(comment: IssueCommentSummary): WorkItemComment`:
  - Map `comment.id.toString()` → `WorkItemComment.id` (numeric ID → string)
  - Map `comment.body` → `WorkItemComment.body`
  - Map `comment.authorLogin` → `WorkItemComment.author`
  - Map `comment.createdAt` → `WorkItemComment.createdAt`
- Implement `toRepoInfo(repoId: RepoIdentifier): RepoInfo`:
  - Return `{ owner: repoId.owner, repo: repoId.repo }`
  - This is the bridge between the provider's `RepoIdentifier` and the existing functions' `RepoInfo`

### Step 2: Create mapper unit tests
- Create `adws/providers/github/__tests__/mappers.test.ts`
- Test `mapGitHubIssueToWorkItem`:
  - Full issue with all fields populated (comments, labels, milestone, assignees)
  - Issue with empty comments, labels, body
  - Issue with bot author
  - Verify `id` is string version of `number`
- Test `mapGitHubCommentToWorkItemComment`:
  - Standard comment mapping
  - Comment with null `updatedAt` (should not affect output)
- Test `mapIssueCommentSummaryToWorkItemComment`:
  - Standard mapping with numeric id converted to string
  - Verify all fields mapped correctly
- Test `toRepoInfo`:
  - Verify only `owner` and `repo` are extracted, `platform` is dropped

### Step 3: Implement GitHubIssueTracker class
- Create `adws/providers/github/githubIssueTracker.ts`
- Import `IssueTracker`, `RepoIdentifier`, `validateRepoIdentifier`, `WorkItem`, `WorkItemComment` from `../../types`
- Import mapper functions from `./mappers`
- Import underlying functions from `../../github/issueApi` and `../../github/projectBoardApi`
- Implement class `GitHubIssueTracker` implementing `IssueTracker`:
  - Private readonly `repoId: RepoIdentifier`
  - Private readonly `repoInfo: RepoInfo` (pre-computed via `toRepoInfo`)
  - Constructor takes `repoId: RepoIdentifier`, calls `validateRepoIdentifier(repoId)`, stores both
  - `async fetchIssue(issueNumber: number): Promise<WorkItem>` — calls `fetchGitHubIssue(issueNumber, this.repoInfo)`, maps result via `mapGitHubIssueToWorkItem`
  - `commentOnIssue(issueNumber: number, body: string): void` — calls `commentOnIssue(issueNumber, body, this.repoInfo)` from issueApi (note: import with alias to avoid name collision)
  - `deleteComment(commentId: string): void` — calls `deleteIssueComment(Number(commentId), this.repoInfo)`
  - `async closeIssue(issueNumber: number, comment?: string): Promise<boolean>` — calls `closeIssue(issueNumber, comment, this.repoInfo)` from issueApi
  - `getIssueState(issueNumber: number): string` — calls `getIssueState(issueNumber, this.repoInfo)` from issueApi
  - `fetchComments(issueNumber: number): WorkItemComment[]` — calls `fetchIssueCommentsRest(issueNumber, this.repoInfo)`, maps each via `mapIssueCommentSummaryToWorkItemComment`
  - `async moveToStatus(issueNumber: number, status: string): Promise<void>` — calls `moveIssueToStatus(issueNumber, status, this.repoInfo)` from projectBoardApi
- Export factory function `createGitHubIssueTracker(repoId: RepoIdentifier): IssueTracker` that returns `new GitHubIssueTracker(repoId)`

### Step 4: Create barrel exports
- Create `adws/providers/github/index.ts`:
  - `export { createGitHubIssueTracker } from './githubIssueTracker';`
  - `export * from './mappers';`
- Update `adws/providers/index.ts`:
  - Add `export * from './github';` alongside the existing `export * from './types';`

### Step 5: Write GitHubIssueTracker unit tests
- Create `adws/providers/github/__tests__/githubIssueTracker.test.ts`
- Mock `adws/github/issueApi` (all 6 functions)
- Mock `adws/github/projectBoardApi` (`moveIssueToStatus`)
- Test construction:
  - Valid `RepoIdentifier` with `Platform.GitHub` — no error
  - Invalid `RepoIdentifier` (empty owner/repo) — throws validation error
- Test repo binding:
  - Call each method on the provider
  - Verify the underlying function was called with the bound `RepoInfo` (`{ owner, repo }`) — never `undefined`
  - Verify `getTargetRepo()` is never called (it should not be imported by the provider)
- Test `fetchIssue`:
  - Mock `fetchGitHubIssue` to return a `GitHubIssue`
  - Verify result is a properly mapped `WorkItem`
  - Verify `repoInfo` was passed to the underlying function
- Test `commentOnIssue`:
  - Verify delegates to underlying `commentOnIssue` with correct args and bound `repoInfo`
- Test `deleteComment`:
  - Pass string ID `"123"`
  - Verify underlying `deleteIssueComment` receives numeric `123` and bound `repoInfo`
- Test `closeIssue`:
  - With and without optional comment
  - Verify delegates correctly
- Test `getIssueState`:
  - Verify delegates and returns the state string
- Test `fetchComments`:
  - Mock `fetchIssueCommentsRest` to return `IssueCommentSummary[]`
  - Verify result is properly mapped `WorkItemComment[]`
- Test `moveToStatus`:
  - Verify delegates to `moveIssueToStatus` with correct args
- Test `createGitHubIssueTracker` factory:
  - Returns an object satisfying `IssueTracker` interface
  - Methods are callable

### Step 6: Validate
- Run `bun run lint` — verify no lint errors
- Run `bunx tsc --noEmit` — verify no TypeScript errors
- Run `bunx tsc --noEmit -p adws/tsconfig.json` — verify adws-specific type check passes
- Run `bun run test` — verify all tests pass with zero regressions

## Testing Strategy
### Unit Tests
- **Mapper tests** (`mappers.test.ts`): Pure function tests covering all field mappings, edge cases (empty arrays, null fields, bot users), and the `toRepoInfo` helper.
- **Provider tests** (`githubIssueTracker.test.ts`): Mock-based tests verifying delegation to underlying functions, repo-binding correctness (every call passes bound `RepoInfo`), type conversion through mappers, factory function behavior, and constructor validation.

### Edge Cases
- `GitHubIssue` with no comments, no labels, empty body
- `GitHubIssue` with bot author (`isBot: true`) — `WorkItem.author` should still be the login string
- `deleteComment` receiving string ID that must be parsed to number — verify `Number("123")` works correctly
- `deleteComment` with non-numeric string — this should not happen per the interface contract but worth documenting
- `closeIssue` called without optional `comment` parameter
- `moveToStatus` when underlying function resolves silently (no project board linked)
- Constructor with invalid `RepoIdentifier` — should throw synchronously

## Acceptance Criteria
- `adws/providers/github/githubIssueTracker.ts` exists and exports `createGitHubIssueTracker`
- `GitHubIssueTracker` class implements all 7 methods of `IssueTracker` interface
- Constructor validates and stores `RepoIdentifier`; every method passes bound `RepoInfo` to underlying functions
- `adws/providers/github/mappers.ts` exports `mapGitHubIssueToWorkItem`, `mapGitHubCommentToWorkItemComment`, `mapIssueCommentSummaryToWorkItemComment`, and `toRepoInfo`
- All mapper functions are pure — no side effects, no imports of global state
- Unit tests for mappers cover all field mappings and edge cases
- Unit tests for provider verify repo-binding, delegation, and type mapping
- `bun run lint` passes
- `bunx tsc --noEmit` passes
- `bunx tsc --noEmit -p adws/tsconfig.json` passes
- `bun run test` passes with zero regressions

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Run root TypeScript type check
- `bunx tsc --noEmit -p adws/tsconfig.json` — Run adws-specific TypeScript type check
- `bun run test` — Run full test suite to validate zero regressions

## Notes
- The underlying `issueApi.ts` and `projectBoardApi.ts` functions remain unchanged — the provider is a pure wrapper.
- The `deleteComment` method on the `IssueTracker` interface takes a `string` ID, but GitHub's `deleteIssueComment` expects a `number`. The provider handles this conversion via `Number(commentId)`.
- The existing `commentOnIssue` function name in `issueApi.ts` collides with the `IssueTracker` method name. Use import aliasing (`import { commentOnIssue as ghCommentOnIssue }`) to avoid confusion.
- `guidelines/coding_guidelines.md` must be strictly followed: immutability, pure functions for mappers, strict TypeScript types, no decorators, functional style.
- No new libraries are required.
