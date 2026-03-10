# Feature: RepoContext Factory with Entry-Point Validation

## Metadata
issueNumber: `116`
adwId: `1773073910340-o5ncqk`
issueJson: `{"number":116,"title":"Create RepoContext factory with entry-point validation","body":"## Summary\nCreate a `RepoContext` factory that constructs an immutable, validated context object at workflow entry points. This replaces the mutable global singleton in `targetRepoRegistry.ts` and ensures operations cannot accidentally target the wrong repository.\n\n## Dependencies\n- #114 — GitHub IssueTracker provider must exist\n- #115 — GitHub CodeHost provider must exist\n\n## User Story\nAs a developer running ADW against external repositories, I want the system to guarantee that all operations target the correct repo, making it impossible to accidentally operate on the wrong repository.\n\n## Acceptance Criteria\n\n### Create `adws/providers/repoContext.ts`\n- `createRepoContext(options: RepoContextOptions): RepoContext` factory function\n- `RepoContextOptions` includes: platform type (github/gitlab), repo URL or identifier, working directory\n- Factory validates:\n  - Repo identifier is well-formed\n  - Working directory exists and contains a git repo\n  - Git remote in the working directory matches the declared repo identifier\n  - Provider instances are successfully created\n- Returns a frozen (Object.freeze) `RepoContext` — immutable after creation\n- Throws descriptive errors on validation failure\n\n### Provider resolution\n- Based on platform type, instantiate the correct `IssueTracker` and `CodeHost` implementations\n- Initially only `github` is supported; throw clear \"unsupported platform\" error for others\n- Support mixed configurations (e.g., GitHub CodeHost + different IssueTracker) — the factory accepts separate platform identifiers for each\n\n### Provider configuration\n- Read provider config from `.adw/providers.md` in the target repo if present:\n  ```markdown\n  ## Code Host\n  github\n\n  ## Issue Tracker\n  github\n  ```\n- Fall back to `github` for both when `.adw/providers.md` is absent (backward compatible)\n\n### Tests\n- Test successful context creation with valid inputs\n- Test validation failures: mismatched remote, missing directory, invalid repo identifier\n- Test immutability — verify the returned context cannot be mutated\n- Test provider config loading from `.adw/providers.md`\n- Test fallback behavior when config is absent\n\n## Notes\n- The `RepoContext` is created once per workflow run in the orchestrator entry point and threaded through to all phases.\n- This does NOT yet remove `targetRepoRegistry.ts` — that happens in a later issue after all consumers are migrated.","state":"OPEN","author":"paysdoc","labels":["enhancement"],"createdAt":"2026-03-09T15:18:12Z","comments":[],"actionableComment":null}`

## Feature Description
Create a `createRepoContext` factory function that constructs an immutable, validated `RepoContext` object at workflow entry points. The factory validates that the working directory exists, contains a git repo, and that the git remote matches the declared repository identifier. It resolves the correct `IssueTracker` and `CodeHost` provider implementations based on platform type (initially GitHub only), and supports reading provider configuration from `.adw/providers.md`. The returned context is frozen via `Object.freeze` to prevent accidental mutation. This replaces the mutable global singleton in `targetRepoRegistry.ts` and guarantees that all operations target the correct repository.

## User Story
As a developer running ADW against external repositories
I want the system to guarantee that all operations target the correct repo
So that it is impossible to accidentally operate on the wrong repository

## Problem Statement
The current `targetRepoRegistry.ts` uses a mutable global singleton (`registryRepoInfo`) that can be set, cleared, and overwritten at any time. This creates risks of accidentally targeting the wrong repository when processing multiple issues or running concurrent workflows. There is no validation that the working directory actually belongs to the declared repository, and no immutability guarantee on the context object passed through workflow phases.

## Solution Statement
Create a `createRepoContext` factory in `adws/providers/repoContext.ts` that:
1. Accepts options specifying platform types, repo identifier, and working directory
2. Validates the working directory exists and contains a `.git` directory
3. Validates the git remote URL in the working directory matches the declared repo identifier
4. Resolves the correct provider implementations (IssueTracker + CodeHost) based on platform type
5. Reads optional provider configuration from `.adw/providers.md` in the target repo
6. Returns a frozen `RepoContext` object that cannot be mutated after creation

This factory is called once per workflow run and the resulting `RepoContext` is threaded through all phases, replacing the need for the global registry. The existing `targetRepoRegistry.ts` is NOT removed in this issue — that happens in a later migration issue.

## Relevant Files
Use these files to implement the feature:

- `guidelines/coding_guidelines.md` — Coding guidelines that must be followed (immutability, type safety, modularity, purity principles)
- `adws/providers/types.ts` — Contains the existing `RepoContext` type, `Platform` enum, `RepoIdentifier`, `IssueTracker`, `CodeHost` interfaces, and `validateRepoIdentifier` function. The factory must return objects conforming to the existing `RepoContext` type.
- `adws/providers/index.ts` — Barrel export file; must be updated to re-export the new factory
- `adws/providers/github/index.ts` — Barrel export for GitHub providers; exports `createGitHubIssueTracker` and `createGitHubCodeHost`
- `adws/providers/github/githubIssueTracker.ts` — GitHub IssueTracker factory (`createGitHubIssueTracker`); used by the RepoContext factory for GitHub platform resolution
- `adws/providers/github/githubCodeHost.ts` — GitHub CodeHost factory (`createGitHubCodeHost`); used by the RepoContext factory for GitHub platform resolution
- `adws/providers/__tests__/types.test.ts` — Existing type tests; reference for test patterns and conventions
- `adws/providers/github/__tests__/githubIssueTracker.test.ts` — Existing GitHub IssueTracker tests; reference for test patterns
- `adws/providers/github/__tests__/githubCodeHost.test.ts` — Existing GitHub CodeHost tests; reference for test patterns
- `adws/github/githubApi.ts` — Contains `getRepoInfo()` and `getRepoInfoFromUrl()` for parsing git remote URLs; useful reference for remote-matching validation
- `adws/core/targetRepoRegistry.ts` — The mutable global singleton being replaced; understanding the current pattern helps design the replacement
- `adws/core/targetRepoManager.ts` — Target repo workspace management (`isRepoCloned`, workspace path resolution); reference for directory/git validation patterns
- `adws/core/projectConfig.ts` — Loads `.adw/` project configuration from target repos; reference for reading markdown config files
- `adws/phases/workflowInit.ts` — Current workflow initialization; shows where `RepoContext` will eventually be created (not modified in this issue)

### New Files
- `adws/providers/repoContext.ts` — The new factory module containing `createRepoContext`, `RepoContextOptions`, provider config loading, and validation logic
- `adws/providers/__tests__/repoContext.test.ts` — Comprehensive tests for the factory

## Implementation Plan
### Phase 1: Foundation
Define the `RepoContextOptions` interface and the provider config types. The options interface supports separate platform identifiers for issue tracker and code host to enable mixed configurations. Add a `ProviderConfig` interface and a `loadProviderConfig` function that reads `.adw/providers.md` from the target repo working directory, falling back to `github` for both providers when the file is absent.

### Phase 2: Core Implementation
Implement the `createRepoContext` factory function with full validation:
1. Validate the `RepoIdentifier` using the existing `validateRepoIdentifier` function
2. Validate the working directory exists and contains a `.git` directory
3. Parse the git remote URL from the working directory and verify it matches the declared owner/repo
4. Resolve platform-specific provider instances using a provider resolver that maps `Platform` to factory functions
5. Freeze and return the `RepoContext` object

### Phase 3: Integration
Export the new factory from the providers barrel (`index.ts`). Write comprehensive tests covering success paths, validation failures, immutability, provider config loading, and fallback behavior.

## Step by Step Tasks

### Step 1: Read reference files
- Read `guidelines/coding_guidelines.md` to ensure adherence to coding standards
- Read `adws/providers/types.ts` for existing `RepoContext` type and `Platform` enum
- Read `adws/providers/github/githubIssueTracker.ts` and `adws/providers/github/githubCodeHost.ts` for factory function signatures
- Read `adws/github/githubApi.ts` for `getRepoInfo()` remote URL parsing pattern
- Read `adws/core/projectConfig.ts` for `.adw/` config loading pattern (reference for loading `.adw/providers.md`)
- Read `adws/providers/__tests__/types.test.ts` for test conventions

### Step 2: Create `adws/providers/repoContext.ts` with types and provider config loading
- Define `RepoContextOptions` interface with fields:
  - `repoId: RepoIdentifier` — the target repository identifier
  - `cwd: string` — the working directory path
  - `issueTrackerPlatform?: Platform` — optional override for issue tracker platform (defaults to `repoId.platform`)
  - `codeHostPlatform?: Platform` — optional override for code host platform (defaults to `repoId.platform`)
- Define `ProviderConfig` interface with `codeHost: Platform` and `issueTracker: Platform` fields
- Implement `loadProviderConfig(cwd: string): ProviderConfig` function:
  - Read `.adw/providers.md` from the `cwd` directory
  - Parse `## Code Host` and `## Issue Tracker` sections
  - Map section content to `Platform` enum values
  - Return `{ codeHost: Platform.GitHub, issueTracker: Platform.GitHub }` as default when file is absent or sections are missing
  - Throw descriptive error if a section contains an unrecognized platform string

### Step 3: Implement validation helpers
- Implement `validateWorkingDirectory(cwd: string): void`:
  - Check `fs.existsSync(cwd)` — throw `RepoContext validation failed: working directory does not exist: {cwd}` if false
  - Check `fs.existsSync(path.join(cwd, '.git'))` — throw `RepoContext validation failed: working directory is not a git repository: {cwd}` if false
- Implement `validateGitRemoteMatch(cwd: string, repoId: RepoIdentifier): void`:
  - Execute `git remote get-url origin` in the `cwd`
  - Parse owner/repo from the remote URL (support both HTTPS and SSH formats, matching the pattern in `githubApi.ts`)
  - Compare parsed owner/repo with `repoId.owner`/`repoId.repo` (case-insensitive)
  - Throw `RepoContext validation failed: git remote 'origin' ({remoteUrl}) does not match declared repo {owner}/{repo}` on mismatch

### Step 4: Implement provider resolution
- Implement `resolveIssueTracker(platform: Platform, repoId: RepoIdentifier): IssueTracker`:
  - Switch on `platform`:
    - `Platform.GitHub` → return `createGitHubIssueTracker(repoId)`
    - All others → throw `Unsupported issue tracker platform: {platform}. Currently only 'github' is supported.`
- Implement `resolveCodeHost(platform: Platform, repoId: RepoIdentifier): CodeHost`:
  - Switch on `platform`:
    - `Platform.GitHub` → return `createGitHubCodeHost(repoId)`
    - All others → throw `Unsupported code host platform: {platform}. Currently only 'github' is supported.`

### Step 5: Implement `createRepoContext` factory function
- Validate `repoId` using `validateRepoIdentifier(repoId)`
- Validate working directory using `validateWorkingDirectory(cwd)`
- Validate git remote match using `validateGitRemoteMatch(cwd, repoId)`
- Determine effective platforms:
  - If `issueTrackerPlatform` / `codeHostPlatform` are provided in options, use those
  - Otherwise, load from `.adw/providers.md` via `loadProviderConfig(cwd)`
  - If no config file exists, fall back to `repoId.platform`
- Resolve providers using `resolveIssueTracker` and `resolveCodeHost`
- Construct the `RepoContext` object and return `Object.freeze({ issueTracker, codeHost, cwd, repoId })`

### Step 6: Update barrel exports
- Add `export { createRepoContext, type RepoContextOptions, type ProviderConfig } from './repoContext';` to `adws/providers/index.ts`

### Step 7: Create `adws/providers/__tests__/repoContext.test.ts`
- Mock `fs` module for `existsSync` checks
- Mock `child_process` `execSync` for `git remote get-url origin` calls
- Mock `createGitHubIssueTracker` and `createGitHubCodeHost` factory functions
- Test suites:
  - **createRepoContext — successful creation**:
    - Creates context with valid inputs (GitHub platform, existing directory, matching remote)
    - Returns frozen object (verify `Object.isFrozen` is true)
    - Contains correct `issueTracker`, `codeHost`, `cwd`, and `repoId` properties
    - Calls `createGitHubIssueTracker` and `createGitHubCodeHost` with the correct `repoId`
  - **createRepoContext — RepoIdentifier validation**:
    - Throws on empty owner
    - Throws on empty repo
    - Throws on whitespace-only owner/repo
  - **createRepoContext — working directory validation**:
    - Throws when directory does not exist
    - Throws when directory exists but has no `.git` subdirectory
    - Error messages include the path for debugging
  - **createRepoContext — git remote validation**:
    - Throws when remote URL does not match declared owner/repo
    - Accepts HTTPS remote URLs
    - Accepts SSH remote URLs
    - Comparison is case-insensitive
  - **createRepoContext — immutability**:
    - Verify `Object.isFrozen(context)` returns true
    - Attempting to assign new properties throws (in strict mode)
    - Attempting to overwrite `cwd` throws
  - **createRepoContext — provider resolution**:
    - Uses GitHub providers when platform is `Platform.GitHub`
    - Throws descriptive error for `Platform.GitLab`
    - Throws descriptive error for `Platform.Bitbucket`
  - **createRepoContext — mixed platform configuration**:
    - Supports `issueTrackerPlatform` override separate from `codeHostPlatform`
    - When only one override is provided, the other uses `repoId.platform`
  - **loadProviderConfig**:
    - Returns default `{ codeHost: Platform.GitHub, issueTracker: Platform.GitHub }` when `.adw/providers.md` is absent
    - Parses valid config file with both sections
    - Handles missing `## Code Host` section (falls back to default)
    - Handles missing `## Issue Tracker` section (falls back to default)
    - Throws on unrecognized platform string
  - **createRepoContext — provider config integration**:
    - Reads provider config from `.adw/providers.md` when no platform overrides are given in options
    - Explicit option overrides take precedence over `.adw/providers.md` values

### Step 8: Run validation commands
- Run `bun run lint` to check for code quality issues
- Run `bunx tsc --noEmit` to verify no TypeScript errors
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify ADW-specific types
- Run `bun run test` to validate all tests pass with zero regressions

## Testing Strategy
### Unit Tests
- Test `createRepoContext` factory with valid GitHub inputs, verifying the returned object has the correct shape and providers
- Test all validation steps independently: `validateRepoIdentifier`, `validateWorkingDirectory`, `validateGitRemoteMatch`
- Test `loadProviderConfig` with various `.adw/providers.md` contents (present, absent, partial, invalid)
- Test provider resolution for each platform value (GitHub succeeds, others throw)
- Test mixed platform configurations (different platforms for issue tracker and code host)
- Test immutability of the returned `RepoContext` via `Object.isFrozen`

### Edge Cases
- Working directory path with spaces or special characters
- Git remote URL in SSH format (`git@github.com:owner/repo.git`) vs HTTPS (`https://github.com/owner/repo`)
- Case mismatch between remote URL owner/repo and declared RepoIdentifier (should match case-insensitively)
- `.adw/providers.md` exists but is empty
- `.adw/providers.md` has only one section (e.g., only `## Code Host` but no `## Issue Tracker`)
- Platform string in config file has leading/trailing whitespace or different casing
- `execSync` for `git remote get-url origin` throws (e.g., no remote named 'origin')

## Acceptance Criteria
- `createRepoContext(options)` factory function exists in `adws/providers/repoContext.ts`
- `RepoContextOptions` interface includes `repoId`, `cwd`, and optional `issueTrackerPlatform`/`codeHostPlatform` overrides
- Factory validates repo identifier is well-formed (delegates to existing `validateRepoIdentifier`)
- Factory validates working directory exists and contains a `.git` directory
- Factory validates git remote in working directory matches the declared repo identifier
- Factory creates correct provider instances based on platform type
- Factory returns a frozen (`Object.freeze`) `RepoContext` — immutable after creation
- Factory throws descriptive errors on validation failure
- Unsupported platforms (GitLab, Bitbucket) throw clear "unsupported platform" errors
- Mixed platform configurations are supported (separate issue tracker and code host platforms)
- Provider config is loaded from `.adw/providers.md` when present, falling back to `github` defaults
- Explicit platform options override `.adw/providers.md` values
- All new code is exported from `adws/providers/index.ts`
- Comprehensive tests cover success paths, validation failures, immutability, config loading, and fallback behavior
- All existing tests continue to pass (zero regressions)
- Code follows guidelines: immutability, type safety, modularity, purity, no decorators, files under 300 lines

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type check root TypeScript configuration
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check ADW-specific TypeScript configuration
- `bun run test` — Run all tests to validate the feature works with zero regressions

## Notes
- This issue does NOT remove `targetRepoRegistry.ts` — that migration happens in a later issue after all consumers are updated to use `RepoContext`.
- The `RepoContext` type already exists in `adws/providers/types.ts` and does not need modification. The factory creates objects that conform to this existing type.
- The `Platform` enum, `validateRepoIdentifier`, `createGitHubIssueTracker`, and `createGitHubCodeHost` already exist from issues #114 and #115.
- Follow the existing pattern of pure validation/mapping functions isolated from side effects. The `validateGitRemoteMatch` function is the only function with a side effect (calling `git remote get-url origin` via `execSync`), which should be isolated and easily mockable.
- The `loadProviderConfig` function follows the same markdown heading-based parsing pattern used in `adws/core/projectConfig.ts`.
- Strictly adhere to `guidelines/coding_guidelines.md`: immutability, type safety, modularity, purity, no `any` types, declarative over imperative.
