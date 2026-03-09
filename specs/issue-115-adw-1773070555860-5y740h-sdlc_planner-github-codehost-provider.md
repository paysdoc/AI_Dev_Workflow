# Feature: Implement GitHub CodeHost Provider

## Metadata
issueNumber: `115`
adwId: `1773070555860-5y740h`
issueJson: `{"number":115,"title":"Implement GitHub CodeHost provider","body":"## Summary\nWrap the existing GitHub PR/code-review operations (`prApi.ts`, `pullRequestCreator.ts`, `prCommentDetector.ts`) and the GitHub-specific `getDefaultBranch()` behind the `CodeHost` interface.\n\n## Dependencies\n- #113 — Provider interfaces must be defined first\n\n## User Story\nAs a developer, I want the existing GitHub PR and code review functionality wrapped in the CodeHost interface so that phases can consume it through the abstraction without behavior changes.\n\n## Acceptance Criteria\n\n### Create `adws/providers/github/githubCodeHost.ts`\n- Implement `CodeHost` interface\n- Constructor takes `RepoIdentifier` — bound to specific repo at creation time\n- Wrap existing functions:\n  - `fetchPRDetails` → `fetchMergeRequest` (transform `PRDetails` → `MergeRequest`)\n  - `commentOnPR` → `commentOnMergeRequest`\n  - `fetchPRReviewComments` → `fetchReviewComments` (transform `PRReviewComment` → `ReviewComment`)\n  - `fetchPRList` → `listOpenMergeRequests` (transform `PRListItem` → `MergeRequest`)\n  - `getDefaultBranch` from `gitBranchOperations.ts` → `getDefaultBranch` (currently uses `gh repo view` — GitHub-specific)\n  - `createPullRequest` from `pullRequestCreator.ts` → `createMergeRequest`\n- Factory function: `createGitHubCodeHost(repoId: RepoIdentifier): CodeHost`\n\n### Fix existing inconsistencies\n- `fetchPRReviews(owner, repo, prNumber)` takes explicit owner/repo instead of `repoInfo` — normalize to use bound `RepoIdentifier`\n- `getDefaultBranch(cwd?)` has no repo targeting — fix to use bound repo context\n\n### Type mapping\n- Add `PRDetails` ↔ `MergeRequest` and `PRReviewComment` ↔ `ReviewComment` mappers to `adws/providers/github/mappers.ts`\n\n### Tests\n- Unit tests for the provider in `adws/providers/github/__tests__/`\n- Test repo binding — methods always use bound repo\n- Test type mapping functions\n\n## Notes\n- `prCommentDetector.ts` (`getUnaddressedComments`, `hasUnaddressedComments`) combines git log parsing (VCS-agnostic) with PR API calls (GitHub-specific). The PR API portion goes through `CodeHost`; the git log parsing stays as a shared utility.\n- The underlying `prApi.ts` and `pullRequestCreator.ts` stay intact during this phase.","state":"OPEN","author":"paysdoc","labels":["enhancement"],"createdAt":"2026-03-09T15:17:52Z","comments":[],"actionableComment":null}`

## Feature Description
Implement the `CodeHost` interface (defined in issue #113) with a GitHub-specific provider that wraps the existing PR, code review, and branch operations. The `GitHubCodeHost` class will bind to a `RepoIdentifier` at construction time and delegate all operations to the existing functions in `prApi.ts`, `pullRequestCreator.ts`, and `gitBranchOperations.ts`, applying type transformations between GitHub-specific types (`PRDetails`, `PRReviewComment`, `PRListItem`) and the platform-agnostic types (`MergeRequest`, `ReviewComment`). This is the first concrete provider implementation and establishes the pattern for future GitLab/Bitbucket providers.

## User Story
As a developer,
I want the existing GitHub PR and code review functionality wrapped in the CodeHost interface
So that workflow phases can consume it through the abstraction without behavior changes, and future platform support (GitLab, Bitbucket) can be added by implementing the same interface.

## Problem Statement
The ADW workflow scripts currently call GitHub-specific functions directly (`fetchPRDetails`, `commentOnPR`, `createPullRequest`, `getDefaultBranch`). This couples all workflow phases to GitHub, making it impossible to support alternative code hosting platforms without modifying every phase. The `CodeHost` interface was defined in #113 but has no concrete implementation yet.

## Solution Statement
Create a `GitHubCodeHost` class that implements the `CodeHost` interface by wrapping the existing GitHub functions. The class is constructed with a `RepoIdentifier` (bound to a specific repo at creation time) and converts between GitHub-specific types and platform-agnostic types using dedicated mapper functions. The existing `prApi.ts`, `pullRequestCreator.ts`, and `gitBranchOperations.ts` files remain untouched — the provider simply delegates to them while normalizing the API surface. A factory function `createGitHubCodeHost()` provides a clean creation interface.

## Relevant Files
Use these files to implement the feature:

- `guidelines/coding_guidelines.md` — Strict coding standards to follow (immutability, type safety, modularity, <300 lines per file, JSDoc for public APIs, no `any`)
- `adws/providers/types.ts` — The `CodeHost` interface definition, `RepoIdentifier`, `MergeRequest`, `ReviewComment`, `CreateMROptions`, `Platform` enum — the contracts this provider must implement
- `adws/providers/index.ts` — Barrel export for providers; must be updated to re-export the new GitHub provider
- `adws/providers/__tests__/types.test.ts` — Existing type tests showing testing patterns for the provider layer
- `adws/github/prApi.ts` — Contains `fetchPRDetails`, `fetchPRReviews`, `fetchPRReviewComments`, `commentOnPR`, `fetchPRList` — the functions to wrap for PR operations
- `adws/github/pullRequestCreator.ts` — Contains `createPullRequest` — the function to wrap for merge request creation
- `adws/github/gitBranchOperations.ts` — Contains `getDefaultBranch` (uses `gh repo view`, GitHub-specific) and `getCurrentBranch`
- `adws/github/githubApi.ts` — Contains `RepoInfo` type and `getRepoInfo()` — the existing repo identification used by all GitHub functions
- `adws/github/prCommentDetector.ts` — Contains `getUnaddressedComments`, `hasUnaddressedComments` — the PR API portion should go through `CodeHost`; git log parsing stays as shared utility (not part of this task, noted for context)
- `adws/types/workflowTypes.ts` — Contains `PRDetails`, `PRReviewComment`, `PRListItem` — the GitHub-specific types that need mappers to/from provider types
- `adws/types/issueTypes.ts` — Contains `GitHubUser`, `GitHubIssue` — referenced by workflow types
- `adws/core/targetRepoRegistry.ts` — Contains `getTargetRepo()` and `resolveTargetRepoCwd()` — used by existing GitHub functions for multi-repo support

### New Files
- `adws/providers/github/githubCodeHost.ts` — The `GitHubCodeHost` class implementing `CodeHost`
- `adws/providers/github/mappers.ts` — Type mapping functions: `PRDetails` ↔ `MergeRequest`, `PRReviewComment` ↔ `ReviewComment`, `PRListItem` → `MergeRequest`
- `adws/providers/github/index.ts` — Barrel export for the GitHub provider module
- `adws/providers/github/__tests__/mappers.test.ts` — Unit tests for mapper functions
- `adws/providers/github/__tests__/githubCodeHost.test.ts` — Unit tests for the `GitHubCodeHost` class

## Implementation Plan

### Phase 1: Foundation — Type Mappers
Create the mapper functions that convert between GitHub-specific types and platform-agnostic provider types. These are pure functions with no side effects, making them easy to test in isolation. This establishes the data transformation layer before wiring up the provider class.

### Phase 2: Core Implementation — GitHubCodeHost Class
Implement the `GitHubCodeHost` class that holds a bound `RepoIdentifier` and delegates each `CodeHost` method to the corresponding existing GitHub function, applying the mappers from Phase 1. Handle the inconsistencies noted in the issue:
- `fetchPRReviews(owner, repo, prNumber)` — normalize by extracting `owner`/`repo` from the bound `RepoIdentifier`
- `getDefaultBranch(cwd?)` — add `--repo owner/repo` flag to target the bound repo explicitly
- `createMergeRequest(options)` — implement using `gh pr create` directly with `CreateMROptions` since the existing `createPullRequest` couples issue-specific body generation

### Phase 3: Integration — Barrel Exports & Wiring
Update barrel exports so the new provider is accessible from `adws/providers`. Add the factory function `createGitHubCodeHost(repoId: RepoIdentifier): CodeHost` for clean instantiation.

## Step by Step Tasks

### Step 1: Create type mapper functions
- Create `adws/providers/github/mappers.ts`
- Implement `mapPRDetailsToMergeRequest(pr: PRDetails): MergeRequest`:
  - `number` → `number` (direct)
  - `title` → `title` (direct)
  - `body` → `body` (direct)
  - `headBranch` → `sourceBranch`
  - `baseBranch` → `targetBranch`
  - `url` → `url` (direct)
  - `issueNumber` → `linkedIssueNumber` (map `null` → `undefined`)
- Implement `mapPRReviewCommentToReviewComment(comment: PRReviewComment): ReviewComment`:
  - `id` (number) → `id` (string via `String(id)`)
  - `author.login` → `author`
  - `body` → `body` (direct)
  - `createdAt` → `createdAt` (direct)
  - `path` → `path` (map empty string `''` → `undefined`)
  - `line` → `line` (map `null` → `undefined`)
- Implement `mapPRListItemToMergeRequest(item: PRListItem): MergeRequest`:
  - `number` → `number` (direct)
  - `headBranch` → `sourceBranch`
  - Set `title`, `body`, `targetBranch`, `url` to empty strings (list items lack these fields)
- Add JSDoc documentation to all mapper functions
- Import types from `../../types/workflowTypes` and `../types`

### Step 2: Create mapper unit tests
- Create `adws/providers/github/__tests__/mappers.test.ts`
- Test `mapPRDetailsToMergeRequest`:
  - Maps all fields correctly
  - Converts `null` issueNumber to `undefined` linkedIssueNumber
  - Converts non-null issueNumber to linkedIssueNumber
  - Handles empty body
- Test `mapPRReviewCommentToReviewComment`:
  - Maps all fields correctly
  - Converts numeric `id` to string
  - Extracts `author.login` to flat `author` string
  - Maps empty `path` string to `undefined`
  - Maps `null` line to `undefined`
  - Preserves non-empty `path` and non-null `line`
- Test `mapPRListItemToMergeRequest`:
  - Maps `number` and `headBranch` → `sourceBranch`
  - Sets `title`, `body`, `targetBranch`, `url` to empty strings

### Step 3: Create the GitHubCodeHost class
- Create `adws/providers/github/githubCodeHost.ts`
- Define `GitHubCodeHost` class implementing `CodeHost`:
  - Private readonly `repoId: RepoIdentifier` field
  - Private readonly `repoInfo: RepoInfo` computed from `repoId` (for passing to existing functions)
  - Constructor takes `RepoIdentifier`, validates it via `validateRepoIdentifier`, stores it
  - `getRepoIdentifier(): RepoIdentifier` — returns the bound `repoId`
  - `getDefaultBranch(): string` — uses `execSync` with `gh repo view --repo {owner}/{repo} --json defaultBranchRef --jq '.defaultBranchRef.name'` to target the bound repo explicitly (fixes the inconsistency where the existing function only targets the cwd repo)
  - `fetchMergeRequest(mrNumber: number): MergeRequest` — calls `fetchPRDetails(mrNumber, this.repoInfo)` then maps via `mapPRDetailsToMergeRequest`
  - `commentOnMergeRequest(mrNumber: number, body: string): void` — calls `commentOnPR(mrNumber, body, this.repoInfo)`
  - `fetchReviewComments(mrNumber: number): ReviewComment[]` — calls `fetchPRReviewComments(mrNumber, this.repoInfo)` then maps each via `mapPRReviewCommentToReviewComment`
  - `listOpenMergeRequests(): MergeRequest[]` — calls `fetchPRList(this.repoInfo)` then maps each via `mapPRListItemToMergeRequest`
  - `createMergeRequest(options: CreateMROptions): string` — uses `execSync` with `gh pr create --repo {owner}/{repo} --title ... --body-file ... --base ... --head ...` to create the PR with the provided options directly (the existing `createPullRequest` couples issue-specific body generation; this method uses the pre-built title/body from `CreateMROptions`). Push the source branch first via `pushBranch`. Return the PR URL.
- Export factory function `createGitHubCodeHost(repoId: RepoIdentifier): CodeHost`
- Import types and functions from existing modules

### Step 4: Create GitHubCodeHost unit tests
- Create `adws/providers/github/__tests__/githubCodeHost.test.ts`
- Mock all external dependencies (`child_process.execSync`, `adws/github/prApi`, `adws/github/gitCommitOperations`)
- Test constructor:
  - Stores the `RepoIdentifier`
  - Throws on invalid `RepoIdentifier` (empty owner/repo)
- Test `getRepoIdentifier()`:
  - Returns the exact bound `RepoIdentifier`
- Test `getDefaultBranch()`:
  - Calls `gh repo view --repo owner/repo` with the bound repo
  - Returns parsed branch name
  - Throws meaningful error on failure
- Test `fetchMergeRequest()`:
  - Calls `fetchPRDetails` with the bound repoInfo
  - Returns correctly mapped `MergeRequest`
- Test `commentOnMergeRequest()`:
  - Calls `commentOnPR` with the bound repoInfo
- Test `fetchReviewComments()`:
  - Calls `fetchPRReviewComments` with the bound repoInfo
  - Returns correctly mapped `ReviewComment[]`
- Test `listOpenMergeRequests()`:
  - Calls `fetchPRList` with the bound repoInfo
  - Returns correctly mapped `MergeRequest[]`
- Test `createMergeRequest()`:
  - Calls `gh pr create` with the correct `--repo`, `--title`, `--base`, `--head` flags
  - Returns the PR URL
  - Returns empty string on failure
- Test repo binding:
  - All methods consistently use the bound repo, never fall back to `getTargetRepo()`
  - Create two instances with different repos and verify each uses its own binding
- Test factory function `createGitHubCodeHost`:
  - Returns a valid `CodeHost` instance
  - Passes through `RepoIdentifier` correctly

### Step 5: Create barrel exports
- Create `adws/providers/github/index.ts`:
  - Export `GitHubCodeHost` class
  - Export `createGitHubCodeHost` factory function
  - Export all mapper functions from `./mappers`
- Update `adws/providers/index.ts`:
  - Add `export * from './github'` to re-export the GitHub provider module

### Step 6: Run validation commands
- Run `bun run lint` to check for code quality issues
- Run `bunx tsc --noEmit` to verify no type errors
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify ADW-specific type checks
- Run `bun run test` to verify all tests pass with zero regressions

## Testing Strategy

### Unit Tests
- **Mapper tests** (`mappers.test.ts`): Pure function tests validating every field mapping between GitHub-specific types and provider types. Each mapper gets dedicated test cases for normal values, edge cases (null → undefined, empty strings, numeric → string conversions), and boundary conditions.
- **GitHubCodeHost tests** (`githubCodeHost.test.ts`): Mock-based tests that verify the class correctly delegates to existing GitHub functions with the bound `RepoIdentifier`, applies mappers to return values, and handles errors. Tests verify repo binding is consistent across all methods.

### Edge Cases
- `PRDetails.issueNumber` is `null` — mapper should produce `undefined` for `linkedIssueNumber`
- `PRReviewComment.path` is empty string `''` — mapper should produce `undefined` (not empty string)
- `PRReviewComment.line` is `null` — mapper should produce `undefined`
- `PRReviewComment.id` is a number — mapper should convert to string
- `PRReviewComment.author` is a `GitHubUser` object — mapper should extract `.login` string
- `RepoIdentifier` with empty owner or repo — constructor should throw via `validateRepoIdentifier`
- `getDefaultBranch` returns empty string from gh CLI — should throw meaningful error
- `createMergeRequest` fails (gh CLI error) — should return empty string
- `fetchPRList` returns empty array — `listOpenMergeRequests` should return empty array
- Multiple `GitHubCodeHost` instances with different repos operate independently

## Acceptance Criteria
- `GitHubCodeHost` class fully implements the `CodeHost` interface from `adws/providers/types.ts`
- Constructor accepts `RepoIdentifier` and all methods use the bound repo (no fallback to `getTargetRepo()`)
- Factory function `createGitHubCodeHost(repoId: RepoIdentifier): CodeHost` is exported
- Mapper functions `mapPRDetailsToMergeRequest`, `mapPRReviewCommentToReviewComment`, `mapPRListItemToMergeRequest` are pure, tested, and exported from `adws/providers/github/mappers.ts`
- All mapper field transformations are correct (null → undefined, type conversions, field renames)
- `getDefaultBranch()` targets the bound repo via `--repo owner/repo` flag (fixes existing inconsistency)
- `createMergeRequest()` uses `CreateMROptions` directly (title, body, sourceBranch, targetBranch) without coupling to issue-specific logic
- `fetchPRReviewComments` is called with the bound `repoInfo` (normalizes the `fetchPRReviews` owner/repo inconsistency)
- Existing `prApi.ts`, `pullRequestCreator.ts`, and `gitBranchOperations.ts` remain unmodified
- Barrel exports updated: `adws/providers/github/index.ts` → `adws/providers/index.ts`
- All unit tests pass
- TypeScript compiles with no errors (`bunx tsc --noEmit` and `bunx tsc --noEmit -p adws/tsconfig.json`)
- Linter passes (`bun run lint`)
- All existing tests continue to pass with zero regressions

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type-check the main project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the ADW subsystem
- `bun run test` — Run all tests to validate zero regressions
- `bun run build` — Build the application to verify no build errors

## Notes
- The `guidelines/coding_guidelines.md` must be strictly followed: no `any`, strict mode, JSDoc on public APIs, files under 300 lines, pure functions where possible, interfaces for object shapes.
- The existing `prCommentDetector.ts` is NOT wrapped in this task. It combines git log parsing (VCS-agnostic) with PR API calls (GitHub-specific). A future task will refactor it to use the `CodeHost` interface for the PR API portion.
- The underlying `prApi.ts` and `pullRequestCreator.ts` stay intact — no modifications to existing files except barrel exports.
- The `createMergeRequest` wrapper intentionally does NOT use the existing `createPullRequest` from `pullRequestCreator.ts` because that function couples issue-specific body generation (it takes `GitHubIssue`, `planSummary`, `buildSummary`). The `CodeHost` interface expects pre-built `title`/`body` via `CreateMROptions`, so the wrapper uses `gh pr create` directly. The existing `createPullRequest` remains available for workflows that need the issue-specific body generation.
- The `RepoInfo` type from `githubApi.ts` (`{ owner, repo }`) is a subset of `RepoIdentifier` (`{ owner, repo, platform }`). The `GitHubCodeHost` constructor derives a `RepoInfo` from the bound `RepoIdentifier` for passing to existing functions.
