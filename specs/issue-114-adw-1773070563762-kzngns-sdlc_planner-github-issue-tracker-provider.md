# Feature: GitHub IssueTracker Provider

## Metadata
issueNumber: `114`
adwId: `1773070563762-kzngns`
issueJson: `{"number":114,"title":"Implement GitHub IssueTracker provider","body":"## Summary\nWrap the existing GitHub issue operations (`issueApi.ts`, `projectBoardApi.ts`) behind the `IssueTracker` interface, creating the first concrete provider implementation.\n\n## Dependencies\n- #113 — Provider interfaces must be defined first\n\n## User Story\nAs a developer, I want the existing GitHub issue functionality wrapped in the IssueTracker interface so that phases can consume it through the abstraction without behavior changes.\n\n## Acceptance Criteria\n\n### Create `adws/providers/github/githubIssueTracker.ts`\n- Implement `IssueTracker` interface\n- Constructor takes `RepoIdentifier` — the provider is bound to a specific repo at creation time (no global registry fallback)\n- Wrap existing functions from `issueApi.ts`:\n  - `fetchGitHubIssue` → `fetchIssue` (transform `GitHubIssue` → `WorkItem`)\n  - `commentOnIssue` → `commentOnIssue`\n  - `deleteIssueComment` → `deleteComment`\n  - `closeIssue` → `closeIssue`\n  - `getIssueState` → `getIssueState`\n  - `fetchIssueCommentsRest` → `fetchComments` (transform `IssueCommentSummary` → `WorkItemComment`)\n- Wrap `moveIssueToStatus` from `projectBoardApi.ts` → `moveToStatus`\n- Factory function: `createGitHubIssueTracker(repoId: RepoIdentifier): IssueTracker`\n\n### Type mapping\n- Create mapping functions between `GitHubIssue` ↔ `WorkItem` and `IssueCommentSummary` ↔ `WorkItemComment`\n- These mappers live in `adws/providers/github/mappers.ts`\n\n### Tests\n- Unit tests for the provider in `adws/providers/github/__tests__/`\n- Test that the provider is correctly bound to its repo — calling methods should always use the bound repo, never fall back to global state\n- Test type mapping functions\n\n## Notes\n- The underlying `issueApi.ts` functions stay intact during this phase — the provider is a wrapper, not a replacement.\n- Each method must pass the bound `RepoIdentifier` explicitly to the underlying function — no reliance on `getTargetRepo()`.","state":"OPEN","author":"paysdoc","labels":["enhancement"],"createdAt":"2026-03-09T15:17:35Z","comments":[],"actionableComment":null}`

## Feature Description
Wrap the existing GitHub issue operations (`issueApi.ts`, `projectBoardApi.ts`) behind the `IssueTracker` interface defined in #113, creating the first concrete provider implementation. This establishes the adapter pattern that decouples workflow phases from GitHub-specific APIs, enabling future support for alternative issue trackers (Jira, Linear, GitLab Issues) without modifying consuming code.

## User Story
As a developer
I want the existing GitHub issue functionality wrapped in the IssueTracker interface
So that phases can consume it through the abstraction without behavior changes

## Problem Statement
The ADW workflow phases currently call GitHub-specific functions directly (`fetchGitHubIssue`, `commentOnIssue`, etc.), tightly coupling them to GitHub. The provider interfaces were defined in #113, but no concrete implementation exists yet. Without a GitHub adapter, the abstraction layer has no usable implementation and phases cannot begin migrating to the platform-agnostic API.

## Solution Statement
Create a `GitHubIssueTracker` class that implements the `IssueTracker` interface by delegating to the existing `issueApi.ts` and `projectBoardApi.ts` functions. The class is bound to a specific `RepoIdentifier` at construction time and converts between GitHub-specific types (`GitHubIssue`, `IssueCommentSummary`) and platform-agnostic types (`WorkItem`, `WorkItemComment`) using dedicated mapper functions. A factory function `createGitHubIssueTracker` provides a clean creation API. The underlying GitHub functions remain unchanged — this is purely an adapter layer.

## Relevant Files
Use these files to implement the feature:

- `adws/providers/types.ts` — Contains the `IssueTracker`, `WorkItem`, `WorkItemComment`, `RepoIdentifier`, and `Platform` type definitions that the provider must implement.
- `adws/providers/index.ts` — Barrel export for providers; must be updated to re-export the new GitHub provider.
- `adws/providers/__tests__/types.test.ts` — Existing provider type tests; reference for test patterns and mock structures.
- `adws/github/issueApi.ts` — Contains the GitHub issue functions to wrap: `fetchGitHubIssue`, `commentOnIssue`, `deleteIssueComment`, `closeIssue`, `getIssueState`, `fetchIssueCommentsRest`.
- `adws/github/projectBoardApi.ts` — Contains `moveIssueToStatus` to wrap.
- `adws/github/githubApi.ts` — Contains the `RepoInfo` interface used by the underlying functions.
- `adws/types/issueTypes.ts` — Contains `GitHubIssue`, `GitHubComment`, `GitHubUser`, `GitHubLabel`, `IssueCommentSummary` type definitions needed for mapper functions.
- `adws/core/targetRepoRegistry.ts` — Contains `getTargetRepo()` — the provider must NOT use this; it must pass its bound `RepoIdentifier` explicitly.
- `adws/README.md` — Architecture overview for understanding existing patterns.
- `guidelines/coding_guidelines.md` — Coding standards that must be followed.

### New Files
- `adws/providers/github/mappers.ts` — Mapper functions to convert `GitHubIssue` → `WorkItem` and `IssueCommentSummary` → `WorkItemComment`.
- `adws/providers/github/githubIssueTracker.ts` — The `GitHubIssueTracker` class implementing `IssueTracker`, plus `createGitHubIssueTracker` factory function.
- `adws/providers/github/index.ts` — Barrel export for the GitHub provider module.
- `adws/providers/github/__tests__/mappers.test.ts` — Unit tests for mapper functions.
- `adws/providers/github/__tests__/githubIssueTracker.test.ts` — Unit tests for the provider class.

## Implementation Plan
### Phase 1: Foundation
Create the mapper functions in `adws/providers/github/mappers.ts` that convert between GitHub-specific types and platform-agnostic types. These are pure functions with no side effects, making them easy to test in isolation. The two key mappers are:
- `mapGitHubIssueToWorkItem(issue: GitHubIssue): WorkItem` — Converts `GitHubIssue` to `WorkItem`, flattening `author.login` to a string, `labels[].name` to `string[]`, and `comments[]` to `WorkItemComment[]`.
- `mapIssueCommentSummaryToWorkItemComment(comment: IssueCommentSummary): WorkItemComment` — Converts `IssueCommentSummary` to `WorkItemComment`, converting numeric `id` to string and `authorLogin` to `author`.

### Phase 2: Core Implementation
Create the `GitHubIssueTracker` class in `adws/providers/github/githubIssueTracker.ts`:
- The class stores a `RepoIdentifier` at construction time.
- Each method extracts `{ owner, repo }` from the stored `RepoIdentifier` and passes it as `RepoInfo` to the underlying GitHub function.
- `fetchIssue` and `fetchComments` use the mapper functions to convert return types.
- `deleteComment` converts the string `commentId` to a number before calling `deleteIssueComment`.
- A `createGitHubIssueTracker(repoId: RepoIdentifier): IssueTracker` factory function is exported for clean instantiation.

### Phase 3: Integration
- Create barrel export in `adws/providers/github/index.ts` re-exporting the provider class, factory function, and mappers.
- Update `adws/providers/index.ts` to re-export from the GitHub provider module.
- No changes needed to existing workflow phases in this issue — migration happens in subsequent issues.

## Step by Step Tasks

### Step 1: Create mapper functions
- Create `adws/providers/github/mappers.ts`
- Import `GitHubIssue`, `IssueCommentSummary` from `../../types/issueTypes`
- Import `WorkItem`, `WorkItemComment` from `../types`
- Implement `mapGitHubIssueToWorkItem(issue: GitHubIssue): WorkItem`:
  - `id`: use `String(issue.number)` (GitHub issues don't have a separate string ID; the number serves as the unique identifier)
  - `number`: `issue.number`
  - `title`: `issue.title`
  - `body`: `issue.body`
  - `state`: `issue.state`
  - `author`: `issue.author.login`
  - `labels`: `issue.labels.map(l => l.name)`
  - `comments`: `issue.comments.map(mapGitHubCommentToWorkItemComment)`
- Implement helper `mapGitHubCommentToWorkItemComment(comment: GitHubComment): WorkItemComment`:
  - `id`: `comment.id` (already a string)
  - `body`: `comment.body`
  - `author`: `comment.author.login`
  - `createdAt`: `comment.createdAt`
- Implement `mapIssueCommentSummaryToWorkItemComment(comment: IssueCommentSummary): WorkItemComment`:
  - `id`: `String(comment.id)` (numeric → string)
  - `body`: `comment.body`
  - `author`: `comment.authorLogin`
  - `createdAt`: `comment.createdAt`

### Step 2: Create mapper unit tests
- Create `adws/providers/github/__tests__/mappers.test.ts`
- Test `mapGitHubIssueToWorkItem`:
  - Maps a full `GitHubIssue` with comments, labels, assignees, milestone to `WorkItem`
  - Correctly extracts `author.login` as flat string
  - Correctly maps `labels[].name` to `string[]`
  - Correctly maps nested `comments[]` to `WorkItemComment[]`
  - Handles empty labels array
  - Handles empty comments array
  - Handles missing/null optional fields (milestone, closedAt)
- Test `mapGitHubCommentToWorkItemComment`:
  - Maps comment id, body, author.login, createdAt correctly
- Test `mapIssueCommentSummaryToWorkItemComment`:
  - Converts numeric `id` to string
  - Maps `authorLogin` to `author`
  - Preserves `body` and `createdAt`

### Step 3: Create GitHubIssueTracker class
- Create `adws/providers/github/githubIssueTracker.ts`
- Import `IssueTracker`, `WorkItem`, `WorkItemComment`, `RepoIdentifier` from `../types`
- Import `fetchGitHubIssue`, `commentOnIssue`, `deleteIssueComment`, `closeIssue`, `getIssueState`, `fetchIssueCommentsRest` from `../../github/issueApi`
- Import `moveIssueToStatus` from `../../github/projectBoardApi`
- Import `type RepoInfo` from `../../github/githubApi`
- Import `mapGitHubIssueToWorkItem`, `mapIssueCommentSummaryToWorkItemComment` from `./mappers`
- Implement `GitHubIssueTracker` class:
  - Private readonly `repoId: RepoIdentifier` field
  - Constructor takes `RepoIdentifier`, stores it
  - Private helper `toRepoInfo(): RepoInfo` that returns `{ owner: this.repoId.owner, repo: this.repoId.repo }`
  - `async fetchIssue(issueNumber: number): Promise<WorkItem>` — calls `fetchGitHubIssue(issueNumber, this.toRepoInfo())`, maps result with `mapGitHubIssueToWorkItem`
  - `commentOnIssue(issueNumber: number, body: string): void` — calls `commentOnIssue(issueNumber, body, this.toRepoInfo())`
  - `deleteComment(commentId: string): void` — calls `deleteIssueComment(Number(commentId), this.toRepoInfo())`
  - `closeIssue(issueNumber: number, comment?: string): Promise<boolean>` — calls `closeIssue(issueNumber, comment, this.toRepoInfo())`
  - `getIssueState(issueNumber: number): string` — calls `getIssueState(issueNumber, this.toRepoInfo())`
  - `fetchComments(issueNumber: number): WorkItemComment[]` — calls `fetchIssueCommentsRest(issueNumber, this.toRepoInfo())`, maps each result with `mapIssueCommentSummaryToWorkItemComment`
  - `async moveToStatus(issueNumber: number, status: string): Promise<void>` — calls `moveIssueToStatus(issueNumber, status, this.toRepoInfo())`
- Export factory function `createGitHubIssueTracker(repoId: RepoIdentifier): IssueTracker` that returns `new GitHubIssueTracker(repoId)`

### Step 4: Create GitHubIssueTracker unit tests
- Create `adws/providers/github/__tests__/githubIssueTracker.test.ts`
- Mock `../../github/issueApi` (all 6 functions)
- Mock `../../github/projectBoardApi` (`moveIssueToStatus`)
- Do NOT mock `../../core/targetRepoRegistry` — the provider should never import or call `getTargetRepo()`
- Create a test `RepoIdentifier` fixture: `{ owner: 'test-owner', repo: 'test-repo', platform: Platform.GitHub }`
- Test `createGitHubIssueTracker`:
  - Returns an object that satisfies `IssueTracker` interface
- Test `fetchIssue`:
  - Calls `fetchGitHubIssue` with correct issue number and `{ owner: 'test-owner', repo: 'test-repo' }`
  - Returns a properly mapped `WorkItem`
- Test `commentOnIssue`:
  - Calls underlying `commentOnIssue` with correct args and bound repo info
- Test `deleteComment`:
  - Converts string commentId to number before calling `deleteIssueComment`
  - Passes bound repo info
- Test `closeIssue`:
  - Delegates to underlying `closeIssue` with bound repo info
  - Passes optional comment parameter
- Test `getIssueState`:
  - Delegates to underlying `getIssueState` with bound repo info
- Test `fetchComments`:
  - Calls `fetchIssueCommentsRest` with bound repo info
  - Maps results to `WorkItemComment[]`
- Test `moveToStatus`:
  - Calls `moveIssueToStatus` with bound repo info
- Test repo binding:
  - Create two trackers with different `RepoIdentifier`s
  - Call the same method on each
  - Verify each passes its own repo info, not the other's
- Test that `getTargetRepo` is never imported or called (verify the mock is not called if set up, or verify the module is not imported)

### Step 5: Create barrel exports
- Create `adws/providers/github/index.ts`:
  - Export `{ GitHubIssueTracker, createGitHubIssueTracker }` from `./githubIssueTracker`
  - Export `{ mapGitHubIssueToWorkItem, mapGitHubCommentToWorkItemComment, mapIssueCommentSummaryToWorkItemComment }` from `./mappers`
- Update `adws/providers/index.ts`:
  - Add `export * from './github';` after existing `export * from './types';`

### Step 6: Run validation commands
- Run `bun run lint` to check for code quality issues
- Run `bunx tsc --noEmit` to verify no TypeScript errors
- Run `bunx tsc --noEmit -p adws/tsconfig.json` for ADW-specific type checking
- Run `bun run test` to validate all tests pass with zero regressions

## Testing Strategy
### Unit Tests
- **Mapper tests** (`mappers.test.ts`): Test pure mapping functions in isolation with various input shapes — full data, minimal data, empty arrays, null optional fields.
- **Provider tests** (`githubIssueTracker.test.ts`): Mock the underlying `issueApi` and `projectBoardApi` functions. Verify the provider delegates correctly with the bound `RepoInfo`, converts types via mappers, and never falls back to `getTargetRepo()`.
- **Factory function test**: Verify `createGitHubIssueTracker` returns an object satisfying the `IssueTracker` interface.

### Edge Cases
- `GitHubIssue` with empty labels array → `WorkItem.labels` should be `[]`
- `GitHubIssue` with empty comments array → `WorkItem.comments` should be `[]`
- `GitHubIssue` with null milestone → should not affect mapping
- `IssueCommentSummary` with numeric id `0` → should map to string `"0"`
- `deleteComment` with string id `"12345"` → should pass `12345` (number) to underlying function
- Two providers bound to different repos calling the same method → each uses its own repo info
- `closeIssue` without optional comment parameter → should pass `undefined` for comment
- `GitHubIssue` with author having no name (null) → should still extract `login` correctly

## Acceptance Criteria
- `adws/providers/github/mappers.ts` exports `mapGitHubIssueToWorkItem`, `mapGitHubCommentToWorkItemComment`, and `mapIssueCommentSummaryToWorkItemComment`
- `adws/providers/github/githubIssueTracker.ts` exports `GitHubIssueTracker` class implementing `IssueTracker` and `createGitHubIssueTracker` factory function
- Constructor takes `RepoIdentifier` and binds it — no reliance on `getTargetRepo()`
- Each method passes the bound repo as `RepoInfo` to the underlying GitHub function
- `fetchIssue` returns a `WorkItem` mapped from `GitHubIssue`
- `fetchComments` returns `WorkItemComment[]` mapped from `IssueCommentSummary[]`
- `deleteComment` converts string `commentId` to number
- All existing tests continue to pass (zero regressions)
- All new tests pass
- TypeScript compiles without errors
- Linter passes without errors
- The underlying `issueApi.ts` and `projectBoardApi.ts` functions are unchanged

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Root-level TypeScript type check
- `bunx tsc --noEmit -p adws/tsconfig.json` — ADW-specific TypeScript type check
- `bun run test` — Run all tests to validate zero regressions
- `bun run test adws/providers/github` — Run GitHub provider tests specifically to verify new functionality

## Notes
- The `guidelines/coding_guidelines.md` must be followed: no `any` types, interfaces for object shapes, `Readonly<>` for immutability, files under 300 lines, meaningful error messages.
- The underlying `issueApi.ts` and `projectBoardApi.ts` functions remain completely unchanged — the provider is a pure wrapper/adapter.
- The `commentOnIssue` name collision between the interface method and the imported function from `issueApi.ts` must be handled with an import alias (e.g., `import { commentOnIssue as ghCommentOnIssue } from '../../github/issueApi'`).
- This issue only covers `IssueTracker`. The `CodeHost` provider implementation will be a separate issue.
- No new libraries are needed for this implementation.
