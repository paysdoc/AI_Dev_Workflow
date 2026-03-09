# Feature: Define IssueTracker and CodeHost Provider Interfaces

## Metadata
issueNumber: `113`
adwId: `1773069451731-3dzo75`
issueJson: `{"number":113,"title":"Define IssueTracker and CodeHost provider interfaces","body":"## Summary\nDefine the two core provider interfaces that abstract away platform-specific operations, enabling ADW to work with different issue trackers (GitHub Issues, Jira, Linear) and code hosting platforms (GitHub, GitLab, Bitbucket).\n\n## User Story\nAs a developer extending ADW, I want well-defined interfaces for issue tracking and code hosting so that I can implement new platform providers without modifying the core workflow logic.\n\n## Acceptance Criteria\n\n### IssueTracker interface\nDefine in adws/providers/types.ts:\n- WorkItem — platform-agnostic issue/ticket representation (id, number, title, body, state, author, labels, comments)\n- WorkItemComment — comment representation (id, body, author, createdAt)\n- IssueTracker interface with methods:\n  - fetchIssue(issueNumber: number): Promise<WorkItem>\n  - commentOnIssue(issueNumber: number, body: string): void\n  - deleteComment(commentId: string): void\n  - closeIssue(issueNumber: number, comment?: string): Promise<boolean>\n  - getIssueState(issueNumber: number): string\n  - fetchComments(issueNumber: number): WorkItemComment[]\n  - moveToStatus(issueNumber: number, status: string): Promise<void>\n\n### CodeHost interface\nDefine in adws/providers/types.ts:\n- MergeRequest — platform-agnostic PR/MR representation (number, title, body, sourceBranch, targetBranch, url, linkedIssueNumber)\n- ReviewComment — review comment representation (id, body, author, createdAt, path, line)\n- CodeHost interface with methods:\n  - getDefaultBranch(): string\n  - createMergeRequest(options: CreateMROptions): string (returns URL)\n  - fetchMergeRequest(mrNumber: number): MergeRequest\n  - commentOnMergeRequest(mrNumber: number, body: string): void\n  - fetchReviewComments(mrNumber: number): ReviewComment[]\n  - listOpenMergeRequests(): MergeRequest[]\n  - getRepoIdentifier(): RepoIdentifier\n\n### RepoIdentifier\n- Platform-agnostic repo identifier type (owner, repo, platform)\n- Validation function to ensure identifier is well-formed\n\n### Shared types\n- RepoContext — immutable context object containing issueTracker, codeHost, cwd, and repoId\n- Ensure all types are exported from adws/providers/index.ts","state":"OPEN","author":"paysdoc","labels":["enhancement"],"createdAt":"2026-03-09T15:17:19Z","comments":[],"actionableComment":null}`

## Feature Description
Define the two core provider interfaces (`IssueTracker` and `CodeHost`) that abstract away platform-specific operations. These interfaces enable ADW to work with different issue trackers (GitHub Issues, Jira, Linear) and code hosting platforms (GitHub, GitLab, Bitbucket) by providing a platform-agnostic contract for all issue tracking and code hosting operations.

This is a foundational change that creates `adws/providers/types.ts` with all the type definitions and interfaces, plus `adws/providers/index.ts` as a barrel export. No existing code is modified — this is purely additive, defining the interfaces that future provider implementations will conform to.

## User Story
As a developer extending ADW,
I want well-defined interfaces for issue tracking and code hosting
So that I can implement new platform providers without modifying the core workflow logic.

## Problem Statement
ADW is currently tightly coupled to GitHub for both issue tracking and code hosting. All operations (fetching issues, posting comments, creating PRs, fetching reviews) are implemented directly against the GitHub API via `gh` CLI calls. This makes it impossible to support alternative platforms like Jira, Linear, GitLab, or Bitbucket without modifying every workflow phase.

## Solution Statement
Define platform-agnostic interfaces (`IssueTracker` and `CodeHost`) in a new `adws/providers/` module that capture exactly the operations the workflow phases currently use. These interfaces are designed to map 1:1 to the existing GitHub functions, so a future `GitHubIssueTracker` and `GitHubCodeHost` implementation can wrap the existing functions without behavior changes. The interfaces include supporting types (`WorkItem`, `WorkItemComment`, `MergeRequest`, `ReviewComment`, `CreateMROptions`, `RepoIdentifier`, `RepoContext`) and a validation function for `RepoIdentifier`.

## Relevant Files
Use these files to implement the feature:

- `guidelines/coding_guidelines.md` — Coding guidelines that must be strictly followed (interfaces over type aliases for object shapes, strict mode, no `any`, enums for constant sets, etc.)
- `adws/README.md` — Full architecture documentation for understanding how workflow phases use GitHub operations
- `adws/types/issueTypes.ts` — Current `GitHubIssue`, `GitHubComment`, `GitHubUser`, `GitHubLabel` types that `WorkItem`/`WorkItemComment` must be able to represent
- `adws/types/workflowTypes.ts` — Current `PRDetails`, `PRReviewComment`, `PRListItem` types that `MergeRequest`/`ReviewComment` must be able to represent
- `adws/types/index.ts` — Existing type barrel export pattern to follow
- `adws/github/issueApi.ts` — Current issue operations (`fetchGitHubIssue`, `commentOnIssue`, `deleteIssueComment`, `closeIssue`, `getIssueState`, `fetchIssueCommentsRest`) whose signatures inform the `IssueTracker` interface
- `adws/github/prApi.ts` — Current PR operations (`fetchPRDetails`, `fetchPRReviewComments`, `commentOnPR`, `fetchPRList`) whose signatures inform the `CodeHost` interface
- `adws/github/pullRequestCreator.ts` — Current `createPullRequest` function whose signature informs `CodeHost.createMergeRequest`
- `adws/github/githubApi.ts` — Current `RepoInfo` type and `getRepoInfo` function that inform `RepoIdentifier` and `CodeHost.getRepoIdentifier`
- `adws/github/gitBranchOperations.ts` — Current `getDefaultBranch` function that informs `CodeHost.getDefaultBranch`
- `adws/github/projectBoardApi.ts` — Current `moveIssueToStatus` function that informs `IssueTracker.moveToStatus`

### New Files
- `adws/providers/types.ts` — All provider interface and type definitions
- `adws/providers/index.ts` — Barrel export for the providers module
- `adws/providers/__tests__/types.test.ts` — Unit tests for validation functions and type contracts

## Implementation Plan

### Phase 1: Foundation
Create the `adws/providers/` directory structure with the barrel export file. Define the `Platform` enum and `RepoIdentifier` type with its validation function, as these are dependencies for both interfaces.

### Phase 2: Core Implementation
Define all data types (`WorkItem`, `WorkItemComment`, `MergeRequest`, `ReviewComment`, `CreateMROptions`) and the two core interfaces (`IssueTracker`, `CodeHost`). Design each type by mapping from the existing GitHub-specific types to ensure the interfaces can represent all current functionality. Define `RepoContext` as the shared immutable context object.

### Phase 3: Integration
Create the barrel export in `adws/providers/index.ts` to expose all types and interfaces. Write comprehensive unit tests to validate the `RepoIdentifier` validation function, type structure contracts, and ensure the interfaces compile correctly. No existing code is modified in this issue — integration with existing GitHub functions happens in a subsequent issue.

## Step by Step Tasks

### Step 1: Create the providers directory and barrel export
- Create `adws/providers/` directory
- Create `adws/providers/index.ts` as a barrel re-export from `./types`
- Follow the pattern used in `adws/types/index.ts`

### Step 2: Define Platform enum and RepoIdentifier
- In `adws/providers/types.ts`, define a `Platform` enum with values: `GitHub = 'github'`, `GitLab = 'gitlab'`, `Bitbucket = 'bitbucket'`
- Define the `RepoIdentifier` interface with fields: `owner: string`, `repo: string`, `platform: Platform`
- Implement `validateRepoIdentifier(id: RepoIdentifier): void` that throws on invalid identifiers (empty owner, empty repo, invalid platform)
- Reference `adws/github/githubApi.ts` `RepoInfo { owner, repo }` to ensure compatibility

### Step 3: Define WorkItem and WorkItemComment types
- In `adws/providers/types.ts`, define `WorkItemComment` interface: `id: string`, `body: string`, `author: string`, `createdAt: string`
- Define `WorkItem` interface: `id: string`, `number: number`, `title: string`, `body: string`, `state: string`, `author: string`, `labels: string[]`, `comments: WorkItemComment[]`
- Reference `adws/types/issueTypes.ts` `GitHubIssue` and `GitHubComment` to ensure all fields used by phases are representable
- Note: `WorkItem.labels` is `string[]` (just names) vs `GitHubLabel[]` (full objects) — this is intentional for platform-agnostic use

### Step 4: Define the IssueTracker interface
- In `adws/providers/types.ts`, define the `IssueTracker` interface with these methods:
  - `fetchIssue(issueNumber: number): Promise<WorkItem>` — maps to `fetchGitHubIssue`
  - `commentOnIssue(issueNumber: number, body: string): void` — maps to `commentOnIssue`
  - `deleteComment(commentId: string): void` — maps to `deleteIssueComment`
  - `closeIssue(issueNumber: number, comment?: string): Promise<boolean>` — maps to `closeIssue`
  - `getIssueState(issueNumber: number): string` — maps to `getIssueState`
  - `fetchComments(issueNumber: number): WorkItemComment[]` — maps to `fetchIssueCommentsRest`
  - `moveToStatus(issueNumber: number, status: string): Promise<void>` — maps to `moveIssueToStatus`

### Step 5: Define MergeRequest, ReviewComment, and CreateMROptions types
- In `adws/providers/types.ts`, define `ReviewComment` interface: `id: string`, `body: string`, `author: string`, `createdAt: string`, `path?: string`, `line?: number`
- Define `MergeRequest` interface: `number: number`, `title: string`, `body: string`, `sourceBranch: string`, `targetBranch: string`, `url: string`, `linkedIssueNumber?: number`
- Define `CreateMROptions` interface: `title: string`, `body: string`, `sourceBranch: string`, `targetBranch: string`, `linkedIssueNumber?: number`
- Reference `adws/types/workflowTypes.ts` `PRDetails` (maps to `MergeRequest`), `PRReviewComment` (maps to `ReviewComment`)

### Step 6: Define the CodeHost interface
- In `adws/providers/types.ts`, define the `CodeHost` interface with these methods:
  - `getDefaultBranch(): string` — maps to `getDefaultBranch` from `gitBranchOperations.ts`
  - `createMergeRequest(options: CreateMROptions): string` — returns URL, maps to `createPullRequest`
  - `fetchMergeRequest(mrNumber: number): MergeRequest` — maps to `fetchPRDetails`
  - `commentOnMergeRequest(mrNumber: number, body: string): void` — maps to `commentOnPR`
  - `fetchReviewComments(mrNumber: number): ReviewComment[]` — maps to `fetchPRReviewComments`
  - `listOpenMergeRequests(): MergeRequest[]` — maps to `fetchPRList`
  - `getRepoIdentifier(): RepoIdentifier` — maps to `getRepoInfo`

### Step 7: Define RepoContext type
- In `adws/providers/types.ts`, define `RepoContext` as a `Readonly` interface:
  - `issueTracker: IssueTracker`
  - `codeHost: CodeHost`
  - `cwd: string`
  - `repoId: RepoIdentifier`
- Use `Readonly<>` utility type to enforce immutability per coding guidelines

### Step 8: Update barrel export
- Ensure `adws/providers/index.ts` re-exports everything from `./types`
- Verify all interfaces, types, enums, and the validation function are exported

### Step 9: Write unit tests
- Create `adws/providers/__tests__/types.test.ts`
- Test `validateRepoIdentifier`:
  - Valid identifier passes without throwing
  - Empty `owner` throws error
  - Empty `repo` throws error
  - Verify valid `Platform` enum values are accepted
- Test type contracts (compile-time verification):
  - Create mock objects conforming to `WorkItem`, `WorkItemComment`, `MergeRequest`, `ReviewComment`, `CreateMROptions`, `RepoIdentifier`, `RepoContext`
  - Verify objects with missing required fields fail to compile (use `// @ts-expect-error` comments)
- Test `Platform` enum:
  - Has expected values (`github`, `gitlab`, `bitbucket`)
  - Has expected number of members

### Step 10: Run validation commands
- Run `bun run lint` to check for code quality issues
- Run `bunx tsc --noEmit` to verify TypeScript compilation
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify ADW-specific compilation
- Run `bun run test` to run all tests and ensure zero regressions

## Testing Strategy

### Unit Tests
- **`validateRepoIdentifier` validation**: Test valid identifiers pass, empty owner throws, empty repo throws, verify platform enum values
- **Type contract tests**: Create mock objects for each interface/type to verify they compile correctly. Use `// @ts-expect-error` to verify missing required fields cause compilation failures
- **Platform enum tests**: Verify the enum has the expected values and member count
- **Interface structural tests**: Create mock implementations of `IssueTracker` and `CodeHost` to verify the interface contracts are satisfiable

### Edge Cases
- `validateRepoIdentifier` with whitespace-only strings for owner/repo
- `validateRepoIdentifier` with valid Platform enum values
- `WorkItem` with empty comments array and empty labels array
- `MergeRequest` with and without optional `linkedIssueNumber`
- `ReviewComment` with and without optional `path` and `line`
- `CreateMROptions` with and without optional `linkedIssueNumber`

## Acceptance Criteria
- `adws/providers/types.ts` exists and defines all specified interfaces and types
- `WorkItem` interface has fields: id, number, title, body, state, author, labels, comments
- `WorkItemComment` interface has fields: id, body, author, createdAt
- `IssueTracker` interface defines all 7 methods with correct signatures
- `MergeRequest` interface has fields: number, title, body, sourceBranch, targetBranch, url, linkedIssueNumber
- `ReviewComment` interface has fields: id, body, author, createdAt, path, line
- `CreateMROptions` interface has fields: title, body, sourceBranch, targetBranch, linkedIssueNumber
- `CodeHost` interface defines all 7 methods with correct signatures
- `RepoIdentifier` interface has fields: owner, repo, platform
- `Platform` enum has values: github, gitlab, bitbucket
- `validateRepoIdentifier` function exists and validates identifiers
- `RepoContext` is an immutable (Readonly) type with issueTracker, codeHost, cwd, repoId
- All types are exported from `adws/providers/index.ts`
- All unit tests pass
- TypeScript compilation passes with zero errors
- Linter passes with zero errors
- All existing tests continue to pass (zero regressions)

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Verify root TypeScript compilation
- `bunx tsc --noEmit -p adws/tsconfig.json` — Verify ADW-specific TypeScript compilation
- `bun run test` — Run all tests to validate the feature works with zero regressions

## Notes
- **Guidelines compliance**: The `guidelines/coding_guidelines.md` file must be strictly followed. Key points: use interfaces for object shapes (not type aliases), use enums for constant sets (Platform), leverage `Readonly` utility type for immutability, strict mode compliance, no `any` types.
- **No existing code changes**: This issue is purely additive — no existing files are modified. The interfaces are designed so existing GitHub functions can be wrapped behind them in a subsequent issue.
- **Comment formatting stays shared**: The `workflowComments*.ts` markdown generation logic remains as shared utilities. Only the posting mechanism (`commentOnIssue`, `commentOnPR`) goes behind the interfaces.
- **`WorkItem` vs `GitHubIssue`**: `WorkItem` is a simplified, platform-agnostic representation. It uses `string` for author (login name) and `string[]` for labels (just names). The richer `GitHubIssue` type with full `GitHubUser` and `GitHubLabel` objects continues to exist for internal GitHub-specific code during the transition.
- **No new libraries required**: This feature is purely TypeScript type/interface definitions with no external dependencies.
