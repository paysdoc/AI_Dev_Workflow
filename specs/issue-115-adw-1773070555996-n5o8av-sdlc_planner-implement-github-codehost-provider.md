# Feature: Implement GitHub CodeHost Provider

## Metadata
issueNumber: `115`
adwId: `1773070555996-n5o8av`
issueJson: `{"number":115,"title":"Implement GitHub CodeHost provider","body":"## Summary\nWrap the existing GitHub PR/code-review operations (`prApi.ts`, `pullRequestCreator.ts`, `prCommentDetector.ts`) and the GitHub-specific `getDefaultBranch()` behind the `CodeHost` interface.\n\n## Dependencies\n- #113 — Provider interfaces must be defined first\n\n## User Story\nAs a developer, I want the existing GitHub PR and code review functionality wrapped in the CodeHost interface so that phases can consume it through the abstraction without behavior changes.\n\n## Acceptance Criteria\n\n### Create `adws/providers/github/githubCodeHost.ts`\n- Implement `CodeHost` interface\n- Constructor takes `RepoIdentifier` — bound to specific repo at creation time\n- Wrap existing functions:\n  - `fetchPRDetails` → `fetchMergeRequest` (transform `PRDetails` → `MergeRequest`)\n  - `commentOnPR` → `commentOnMergeRequest`\n  - `fetchPRReviewComments` → `fetchReviewComments` (transform `PRReviewComment` → `ReviewComment`)\n  - `fetchPRList` → `listOpenMergeRequests` (transform `PRListItem` → `MergeRequest`)\n  - `getDefaultBranch` from `gitBranchOperations.ts` → `getDefaultBranch` (currently uses `gh repo view` — GitHub-specific)\n  - `createPullRequest` from `pullRequestCreator.ts` → `createMergeRequest`\n- Factory function: `createGitHubCodeHost(repoId: RepoIdentifier): CodeHost`\n\n### Fix existing inconsistencies\n- `fetchPRReviews(owner, repo, prNumber)` takes explicit owner/repo instead of `repoInfo` — normalize to use bound `RepoIdentifier`\n- `getDefaultBranch(cwd?)` has no repo targeting — fix to use bound repo context\n\n### Type mapping\n- Add `PRDetails` ↔ `MergeRequest` and `PRReviewComment` ↔ `ReviewComment` mappers to `adws/providers/github/mappers.ts`\n\n### Tests\n- Unit tests for the provider in `adws/providers/github/__tests__/`\n- Test repo binding — methods always use bound repo\n- Test type mapping functions\n\n## Notes\n- `prCommentDetector.ts` (`getUnaddressedComments`, `hasUnaddressedComments`) combines git log parsing (VCS-agnostic) with PR API calls (GitHub-specific). The PR API portion goes through `CodeHost`; the git log parsing stays as a shared utility.\n- The underlying `prApi.ts` and `pullRequestCreator.ts` stay intact during this phase.","state":"OPEN","author":"paysdoc","labels":["enhancement"],"createdAt":"2026-03-09T15:17:52Z","comments":[],"actionableComment":null}`

## Feature Description
Wrap the existing GitHub PR/code-review operations (`prApi.ts`, `pullRequestCreator.ts`, `prCommentDetector.ts`) and the GitHub-specific `getDefaultBranch()` behind the platform-agnostic `CodeHost` interface defined in `adws/providers/types.ts`. This creates a concrete GitHub implementation of the `CodeHost` abstraction, enabling workflow phases to consume PR and code-hosting operations through the interface without coupling to GitHub-specific APIs. The underlying `prApi.ts` and `pullRequestCreator.ts` remain intact — this is a thin adapter layer.

## User Story
As a developer
I want the existing GitHub PR and code review functionality wrapped in the CodeHost interface
So that workflow phases can consume it through the abstraction without behavior changes and new platforms (GitLab, Bitbucket) can be added without modifying phase logic.

## Problem Statement
The existing GitHub PR operations (`fetchPRDetails`, `commentOnPR`, `fetchPRReviewComments`, `fetchPRList`, `createPullRequest`, `getDefaultBranch`) are called directly by workflow phases, creating tight coupling to GitHub. The `CodeHost` interface was defined in #113 but has no concrete implementation yet. Additionally, some existing functions have inconsistent signatures — `fetchPRReviews` takes explicit `owner`/`repo` strings instead of `RepoInfo`, and `getDefaultBranch` has no repo targeting.

## Solution Statement
Create a `GitHubCodeHost` class that implements the `CodeHost` interface, bound to a specific `RepoIdentifier` at construction time. Each method delegates to the existing `prApi.ts`, `pullRequestCreator.ts`, and `gitBranchOperations.ts` functions, passing the bound repo as a `RepoInfo` parameter. Type mappers convert between GitHub-specific types (`PRDetails`, `PRReviewComment`, `PRListItem`) and platform-agnostic types (`MergeRequest`, `ReviewComment`). A factory function `createGitHubCodeHost(repoId)` provides the public API. The existing functions remain untouched — the provider is a pure adapter.

## Relevant Files
Use these files to implement the feature:

- `guidelines/coding_guidelines.md` — Coding standards to follow (strict TypeScript, no `any`, immutability, modularity, single responsibility, files under 300 lines)
- `adws/providers/types.ts` — Defines `CodeHost`, `MergeRequest`, `ReviewComment`, `CreateMROptions`, `RepoIdentifier`, `Platform` interfaces. The contract this implementation must satisfy.
- `adws/providers/index.ts` — Barrel export for the providers module. Needs to re-export the new GitHub provider.
- `adws/providers/__tests__/types.test.ts` — Existing provider type tests. Reference for test patterns and mock structures.
- `adws/github/prApi.ts` — Existing functions to wrap: `fetchPRDetails`, `fetchPRReviews`, `fetchPRReviewComments`, `commentOnPR`, `fetchPRList`. Uses `RepoInfo` and `getTargetRepo()`.
- `adws/github/pullRequestCreator.ts` — Existing `createPullRequest` function. Takes `GitHubIssue`, plan/build summaries, base branch, cwd, and `RepoInfo`.
- `adws/github/prCommentDetector.ts` — Contains `getUnaddressedComments` and `hasUnaddressedComments`. The PR API calls go through CodeHost; git log parsing stays as shared utility. **Not wrapped in this phase** — only noted for context.
- `adws/github/gitBranchOperations.ts` — Existing `getDefaultBranch(cwd?)` function using `gh repo view`. GitHub-specific, needs to be wrapped.
- `adws/github/githubApi.ts` — Defines `RepoInfo` interface (`{ owner, repo }`). Re-exports issue and PR API functions.
- `adws/types/workflowTypes.ts` — Defines `PRDetails`, `PRReviewComment`, `PRListItem` types. Source types for mappers.
- `adws/types/issueTypes.ts` — Defines `GitHubUser`, `GitHubIssue` types. Needed for understanding `createPullRequest` signature.
- `adws/core/index.ts` — Core barrel export. Reference for import paths.
- `adws/github/__tests__/prApi.test.ts` — Test patterns: `vi.mock('child_process')`, `vi.mock('../../core/utils')`, `vi.mock('../../core/targetRepoRegistry')`, `beforeEach(vi.clearAllMocks)`.

### New Files
- `adws/providers/github/githubCodeHost.ts` — `GitHubCodeHost` class implementing `CodeHost` interface + `createGitHubCodeHost` factory function
- `adws/providers/github/mappers.ts` — Pure mapper functions: `mapPRDetailsToMergeRequest`, `mapPRReviewCommentToReviewComment`, `mapPRListItemToMergeRequest`
- `adws/providers/github/index.ts` — Barrel export for the GitHub provider module
- `adws/providers/github/__tests__/mappers.test.ts` — Unit tests for type mapping functions
- `adws/providers/github/__tests__/githubCodeHost.test.ts` — Unit tests for the GitHubCodeHost provider class

## Implementation Plan
### Phase 1: Foundation — Type Mappers
Create the pure mapper functions that convert between GitHub-specific types and platform-agnostic types. These are pure functions with no side effects, making them easy to test in isolation:
- `mapPRDetailsToMergeRequest(pr: PRDetails): MergeRequest`
- `mapPRReviewCommentToReviewComment(comment: PRReviewComment): ReviewComment`
- `mapPRListItemToMergeRequest(item: PRListItem): MergeRequest` (partial — only `number`, `sourceBranch` available from `PRListItem`)

### Phase 2: Core Implementation — GitHubCodeHost Class
Create the `GitHubCodeHost` class that implements `CodeHost`. The class:
- Stores a `RepoIdentifier` at construction time
- Derives a `RepoInfo` (`{ owner, repo }`) from the `RepoIdentifier` for passing to existing functions
- Delegates each method to the corresponding existing function
- Uses mappers to transform return types
- `createMergeRequest` adapts `CreateMROptions` to the `createPullRequest` signature (which takes a `GitHubIssue` — the adapter constructs a minimal issue object from the options)

### Phase 3: Integration — Exports and Barrel Files
- Create `adws/providers/github/index.ts` exporting the factory function and class
- Update `adws/providers/index.ts` to re-export from the GitHub submodule

## Step by Step Tasks

### Step 1: Create Type Mappers (`adws/providers/github/mappers.ts`)
- Read `adws/types/workflowTypes.ts` to understand `PRDetails`, `PRReviewComment`, `PRListItem` shapes
- Read `adws/providers/types.ts` to understand `MergeRequest`, `ReviewComment` shapes
- Create `adws/providers/github/mappers.ts` with three pure mapper functions:
  - `mapPRDetailsToMergeRequest(pr: PRDetails): MergeRequest` — maps `headBranch` → `sourceBranch`, `baseBranch` → `targetBranch`, `issueNumber` → `linkedIssueNumber`
  - `mapPRReviewCommentToReviewComment(comment: PRReviewComment): ReviewComment` — maps `id` (number → string), `author.login` → `author`, drops `updatedAt`/`isBot`, keeps `path`/`line` as optional
  - `mapPRListItemToMergeRequest(item: PRListItem): MergeRequest` — maps `headBranch` → `sourceBranch`, sets `title`/`body`/`targetBranch`/`url` to empty strings since `PRListItem` doesn't carry them, sets `number` from item
- All functions must be pure with no side effects

### Step 2: Create Mapper Tests (`adws/providers/github/__tests__/mappers.test.ts`)
- Create `adws/providers/github/__tests__/` directory
- Write unit tests for each mapper function:
  - Test `mapPRDetailsToMergeRequest` with full data, with null `issueNumber`, with empty body
  - Test `mapPRReviewCommentToReviewComment` with full data, with optional `path`/`line` as empty/null, with bot vs human author
  - Test `mapPRListItemToMergeRequest` verifying partial fields are populated correctly
- Run tests to verify mappers work: `bun run test -- adws/providers/github/__tests__/mappers.test.ts`

### Step 3: Create GitHubCodeHost Class (`adws/providers/github/githubCodeHost.ts`)
- Read `adws/github/prApi.ts`, `adws/github/pullRequestCreator.ts`, `adws/github/gitBranchOperations.ts` for function signatures
- Create `GitHubCodeHost` class implementing `CodeHost`:
  - Private `readonly repoId: RepoIdentifier`
  - Private `readonly repoInfo: RepoInfo` derived from `repoId` (`{ owner: repoId.owner, repo: repoId.repo }`)
  - `getRepoIdentifier()`: returns `this.repoId`
  - `getDefaultBranch()`: calls `getDefaultBranch()` from `gitBranchOperations.ts` (delegates to existing function — it uses `gh repo view` which works with the current repo context)
  - `fetchMergeRequest(mrNumber)`: calls `fetchPRDetails(mrNumber, this.repoInfo)` then `mapPRDetailsToMergeRequest`
  - `commentOnMergeRequest(mrNumber, body)`: calls `commentOnPR(mrNumber, body, this.repoInfo)`
  - `fetchReviewComments(mrNumber)`: calls `fetchPRReviewComments(mrNumber, this.repoInfo)` then maps each with `mapPRReviewCommentToReviewComment`
  - `listOpenMergeRequests()`: calls `fetchPRList(this.repoInfo)` then maps each with `mapPRListItemToMergeRequest`
  - `createMergeRequest(options)`: adapts `CreateMROptions` to call `createPullRequest`. Since `createPullRequest` takes a `GitHubIssue`, construct a minimal issue object from `options.title`, `options.body`, and `options.linkedIssueNumber`. Pass `options.targetBranch` as `baseBranch`, and `this.repoInfo`.
- Export factory function `createGitHubCodeHost(repoId: RepoIdentifier): CodeHost`
- Validate `repoId` using `validateRepoIdentifier` in the factory function

### Step 4: Create GitHubCodeHost Tests (`adws/providers/github/__tests__/githubCodeHost.test.ts`)
- Mock `child_process` (`execSync`), `../../core/utils` (`log`), `../../core/targetRepoRegistry` (`getTargetRepo`, `resolveTargetRepoCwd`)
- Mock the underlying GitHub API modules: `../../github/prApi`, `../../github/pullRequestCreator`, `../../github/gitBranchOperations`
- Test factory function:
  - `createGitHubCodeHost` creates a valid `CodeHost`
  - Throws on invalid `RepoIdentifier` (empty owner/repo)
- Test repo binding — every method passes the bound `repoInfo` to the underlying function:
  - `fetchMergeRequest` calls `fetchPRDetails` with correct repo
  - `commentOnMergeRequest` calls `commentOnPR` with correct repo
  - `fetchReviewComments` calls `fetchPRReviewComments` with correct repo
  - `listOpenMergeRequests` calls `fetchPRList` with correct repo
  - `createMergeRequest` calls `createPullRequest` with correct repo
- Test type transformations — verify the mapper is applied to the output:
  - `fetchMergeRequest` returns `MergeRequest` shape
  - `fetchReviewComments` returns `ReviewComment[]` shape
  - `listOpenMergeRequests` returns `MergeRequest[]` shape
- Test `getDefaultBranch` delegates correctly
- Test `getRepoIdentifier` returns the bound repo
- Run tests: `bun run test -- adws/providers/github/__tests__/githubCodeHost.test.ts`

### Step 5: Create Barrel Exports
- Create `adws/providers/github/index.ts`:
  - Export `createGitHubCodeHost` from `./githubCodeHost`
  - Export `GitHubCodeHost` class (for type reference if needed)
  - Export all mappers from `./mappers`
- Update `adws/providers/index.ts`:
  - Add `export * from './types';` (already present)
  - Add `export * from './github';` to re-export the GitHub provider

### Step 6: Run Full Validation
- Run all validation commands to confirm zero regressions
- Verify the new provider integrates cleanly with the existing codebase

## Testing Strategy
### Unit Tests
- **Mapper tests** (`mappers.test.ts`): Test each mapper function with full data, partial data, edge cases (null/undefined optional fields). These are pure functions so no mocking needed.
- **Provider tests** (`githubCodeHost.test.ts`): Mock all underlying GitHub API functions. Verify each `CodeHost` method delegates to the correct function with the bound `repoInfo`, and that return values are properly mapped to platform-agnostic types.
- **Factory function tests**: Verify `createGitHubCodeHost` creates a working instance and validates the `RepoIdentifier`.

### Edge Cases
- `PRDetails` with null `issueNumber` → `MergeRequest` with `undefined` `linkedIssueNumber`
- `PRDetails` with empty body → `MergeRequest` with empty `body` string
- `PRReviewComment` with null `line` and empty `path` → `ReviewComment` with undefined `line` and `path`
- `PRReviewComment` with bot author → still mapped, `author` is just the login string
- `PRListItem` → `MergeRequest` has empty `title`, `body`, `targetBranch`, `url` since list items don't carry those
- `createMergeRequest` with and without `linkedIssueNumber`
- Invalid `RepoIdentifier` (empty owner or repo) → factory throws
- Underlying function throws → error propagates through the provider

## Acceptance Criteria
- `GitHubCodeHost` class fully implements the `CodeHost` interface from `adws/providers/types.ts`
- All six `CodeHost` methods delegate to the correct existing GitHub functions
- `RepoIdentifier` is bound at construction; every API call uses the bound owner/repo
- Type mappers correctly transform `PRDetails` → `MergeRequest`, `PRReviewComment` → `ReviewComment`, `PRListItem` → `MergeRequest`
- Factory function `createGitHubCodeHost` validates the `RepoIdentifier` and returns a `CodeHost`
- Unit tests cover all mapper functions and all provider methods
- All existing tests continue to pass (zero regressions)
- Type checking passes (`bunx tsc --noEmit -p adws/tsconfig.json`)
- Linting passes (`bun run lint`)
- The underlying `prApi.ts`, `pullRequestCreator.ts`, and `gitBranchOperations.ts` are not modified

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type check the full project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check the adws module specifically
- `bun run test -- adws/providers/github/__tests__/mappers.test.ts` — Run mapper tests
- `bun run test -- adws/providers/github/__tests__/githubCodeHost.test.ts` — Run provider tests
- `bun run test -- adws/providers/__tests__/types.test.ts` — Verify existing provider type tests still pass
- `bun run test -- adws/github/__tests__/prApi.test.ts` — Verify existing PR API tests still pass
- `bun run test` — Run full test suite to verify zero regressions

## Notes
- **`prCommentDetector.ts` is not wrapped in this phase.** It combines git log parsing (VCS-agnostic) with PR API calls (GitHub-specific). The PR API portion will go through `CodeHost` in a future phase; the git log parsing stays as a shared utility.
- **The underlying API modules stay intact.** `prApi.ts`, `pullRequestCreator.ts`, and `gitBranchOperations.ts` are not modified — the provider is a pure adapter layer.
- **`createMergeRequest` adapter complexity.** The existing `createPullRequest` takes a `GitHubIssue` (with many fields) plus `planSummary`/`buildSummary` strings. The `CreateMROptions` interface is simpler (title, body, sourceBranch, targetBranch, linkedIssueNumber). The adapter constructs a minimal `GitHubIssue` from the options and passes empty strings for plan/build summaries since those are baked into the `body` field of `CreateMROptions`.
- **`getDefaultBranch` uses `gh repo view` internally** which infers the repo from the current directory's git remote. For the provider, this works correctly when the cwd matches the bound repo. A future enhancement could pass `--repo owner/repo` for explicit targeting, but that is out of scope for this phase.
- Strictly follow `guidelines/coding_guidelines.md`: strict TypeScript, no `any`, immutable data, pure mappers, meaningful names, JSDoc for public APIs, files under 300 lines.
