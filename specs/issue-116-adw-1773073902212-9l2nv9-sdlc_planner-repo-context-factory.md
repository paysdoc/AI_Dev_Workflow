# Feature: RepoContext Factory with Entry-Point Validation

## Metadata
issueNumber: `116`
adwId: `1773073902212-9l2nv9`
issueJson: `{"number":116,"title":"Create RepoContext factory with entry-point validation","body":"## Summary\nCreate a `RepoContext` factory that constructs an immutable, validated context object at workflow entry points. This replaces the mutable global singleton in `targetRepoRegistry.ts` and ensures operations cannot accidentally target the wrong repository.\n\n## Dependencies\n- #114 — GitHub IssueTracker provider must exist\n- #115 — GitHub CodeHost provider must exist\n\n## User Story\nAs a developer running ADW against external repositories, I want the system to guarantee that all operations target the correct repo, making it impossible to accidentally operate on the wrong repository.\n\n## Acceptance Criteria\n\n### Create `adws/providers/repoContext.ts`\n- `createRepoContext(options: RepoContextOptions): RepoContext` factory function\n- `RepoContextOptions` includes: platform type (github/gitlab), repo URL or identifier, working directory\n- Factory validates:\n  - Repo identifier is well-formed\n  - Working directory exists and contains a git repo\n  - Git remote in the working directory matches the declared repo identifier\n  - Provider instances are successfully created\n- Returns a frozen (Object.freeze) `RepoContext` — immutable after creation\n- Throws descriptive errors on validation failure\n\n### Provider resolution\n- Based on platform type, instantiate the correct `IssueTracker` and `CodeHost` implementations\n- Initially only `github` is supported; throw clear \"unsupported platform\" error for others\n- Support mixed configurations (e.g., GitHub CodeHost + different IssueTracker) — the factory accepts separate platform identifiers for each\n\n### Provider configuration\n- Read provider config from `.adw/providers.md` in the target repo if present:\n  ```markdown\n  ## Code Host\n  github\n\n  ## Issue Tracker\n  github\n  ```\n- Fall back to `github` for both when `.adw/providers.md` is absent (backward compatible)\n\n### Tests\n- Test successful context creation with valid inputs\n- Test validation failures: mismatched remote, missing directory, invalid repo identifier\n- Test immutability — verify the returned context cannot be mutated\n- Test provider config loading from `.adw/providers.md`\n- Test fallback behavior when config is absent\n\n## Notes\n- The `RepoContext` is created once per workflow run in the orchestrator entry point and threaded through to all phases.\n- This does NOT yet remove `targetRepoRegistry.ts` — that happens in a later issue after all consumers are migrated.","state":"OPEN","author":"paysdoc","labels":["enhancement"],"createdAt":"2026-03-09T15:18:12Z","comments":[],"actionableComment":null}`

## Feature Description
Create a `createRepoContext` factory function that constructs an immutable, validated `RepoContext` object at workflow entry points. The factory validates the repo identifier, working directory, git remote matching, and provider instantiation before returning a frozen context. It reads optional provider configuration from `.adw/providers.md` in the target repo, falling back to GitHub for both code host and issue tracker when absent. This replaces the mutable global singleton pattern in `targetRepoRegistry.ts` and guarantees all operations target the correct repository.

## User Story
As a developer running ADW against external repositories
I want the system to guarantee that all operations target the correct repo
So that it is impossible to accidentally operate on the wrong repository

## Problem Statement
The current `targetRepoRegistry.ts` uses a mutable global singleton (`registryRepoInfo`) that can be set, overwritten, or cleared at any time. This pattern makes it possible for operations to accidentally target the wrong repository, especially when processing multiple webhook events or running concurrent workflows. There is no validation that the working directory actually corresponds to the declared repository.

## Solution Statement
Introduce a `createRepoContext` factory function that:
1. Accepts explicit platform types, repo identifier, and working directory
2. Validates all inputs at construction time (well-formed identifier, directory exists, git remote matches)
3. Resolves and instantiates the correct `IssueTracker` and `CodeHost` providers based on platform type
4. Reads optional `.adw/providers.md` configuration for mixed-platform setups
5. Returns an `Object.freeze`-d `RepoContext` — immutable after creation
6. Is created once per workflow run and threaded through all phases, eliminating global mutable state

## Relevant Files
Use these files to implement the feature:

- `adws/providers/types.ts` — Contains the `RepoContext` type, `RepoIdentifier`, `Platform` enum, `IssueTracker`/`CodeHost` interfaces, and `validateRepoIdentifier()`. The factory returns the `RepoContext` type already defined here.
- `adws/providers/github/githubIssueTracker.ts` — GitHub `IssueTracker` implementation with `createGitHubIssueTracker(repoId)` factory. The RepoContext factory delegates to this for GitHub issue tracking.
- `adws/providers/github/githubCodeHost.ts` — GitHub `CodeHost` implementation with `createGitHubCodeHost(repoId)` factory. The RepoContext factory delegates to this for GitHub code hosting.
- `adws/providers/github/index.ts` — Barrel exports for GitHub providers. May need to export additional items.
- `adws/providers/index.ts` — Barrel exports for all providers. Must export the new factory and types.
- `adws/github/githubApi.ts` — Contains `getRepoInfo()` which reads git remote URL, and URL parsing functions (`getRepoInfoFromUrl`, `getRepoInfoFromPayload`). Used as reference for git remote verification logic.
- `adws/core/targetRepoRegistry.ts` — The existing mutable global singleton being replaced (NOT modified in this issue, just reference).
- `adws/providers/__tests__/types.test.ts` — Existing test patterns for provider types. Reference for test conventions.
- `adws/providers/github/__tests__/githubIssueTracker.test.ts` — Test patterns for GitHub IssueTracker. Reference for mocking and assertion conventions.
- `adws/providers/github/__tests__/githubCodeHost.test.ts` — Test patterns for GitHub CodeHost. Reference for test structure.
- `guidelines/coding_guidelines.md` — Coding guidelines that must be followed: immutability, type safety, modularity, pure functions.
- `app_docs/feature-the-adw-is-too-speci-tf7slv-generalize-adw-project-config.md` — Documentation for `.adw/` config convention. Reference for how `.adw/providers.md` should integrate with existing config patterns.

### New Files
- `adws/providers/repoContext.ts` — The RepoContext factory implementation with `createRepoContext()`, `RepoContextOptions` type, provider config loading from `.adw/providers.md`, and validation logic.
- `adws/providers/__tests__/repoContext.test.ts` — Comprehensive test suite for the RepoContext factory covering creation, validation, immutability, provider config, and fallback behavior.

## Implementation Plan
### Phase 1: Foundation
Define the `RepoContextOptions` type and the provider config types. Establish the configuration loading logic for `.adw/providers.md` (parsing markdown sections for `## Code Host` and `## Issue Tracker`). This uses the same markdown-section parsing convention established by `adws/core/projectConfig.ts`.

### Phase 2: Core Implementation
Implement the `createRepoContext()` factory function with:
- Input validation (repo identifier well-formed via `validateRepoIdentifier`, working directory exists, `.git` directory present)
- Git remote verification (read `git remote get-url origin` from the working directory and compare owner/repo against declared identifier)
- Provider resolution (map platform enum to provider factory, currently only GitHub)
- Provider config loading from `.adw/providers.md` (optional, with GitHub fallback)
- Object.freeze on the returned `RepoContext`

### Phase 3: Integration
Export the factory and types from the provider barrel files (`adws/providers/index.ts`). Write comprehensive tests. The factory is ready to be used by orchestrator entry points in future issues.

## Step by Step Tasks

### Step 1: Define RepoContextOptions and provider config types
- In `adws/providers/repoContext.ts`, define `RepoContextOptions` interface with:
  - `repoId: RepoIdentifier` — the declared repository identifier
  - `cwd: string` — working directory path
  - `codeHostPlatform?: Platform` — optional override for code host platform (defaults to `repoId.platform`)
  - `issueTrackerPlatform?: Platform` — optional override for issue tracker platform (defaults to `repoId.platform`)
- Define `ProviderConfig` type with `codeHost: Platform` and `issueTracker: Platform` fields

### Step 2: Implement provider config loading from `.adw/providers.md`
- Create `loadProviderConfig(cwd: string): ProviderConfig` function
- Read `.adw/providers.md` from the working directory if it exists
- Parse `## Code Host` and `## Issue Tracker` sections using simple string parsing
- Map section content to `Platform` enum values (trimmed, lowercased)
- Return default `{ codeHost: Platform.GitHub, issueTracker: Platform.GitHub }` when file is absent or sections are missing
- Throw descriptive error if section content doesn't match any `Platform` enum value

### Step 3: Implement validation functions
- Create `validateWorkingDirectory(cwd: string): void` — checks directory exists and contains `.git`
- Create `validateGitRemote(cwd: string, repoId: RepoIdentifier): void` — runs `git remote get-url origin` in the cwd, parses owner/repo from the URL, compares against the declared `repoId.owner` and `repoId.repo` (case-insensitive). Throws descriptive error on mismatch.

### Step 4: Implement provider resolution
- Create `resolveIssueTracker(platform: Platform, repoId: RepoIdentifier): IssueTracker`
  - For `Platform.GitHub`: call `createGitHubIssueTracker(repoId)`
  - For other platforms: throw `Error('Unsupported issue tracker platform: ${platform}')`
- Create `resolveCodeHost(platform: Platform, repoId: RepoIdentifier): CodeHost`
  - For `Platform.GitHub`: call `createGitHubCodeHost(repoId)`
  - For other platforms: throw `Error('Unsupported code host platform: ${platform}')`

### Step 5: Implement the createRepoContext factory
- Validate `repoId` via `validateRepoIdentifier(repoId)`
- Validate working directory via `validateWorkingDirectory(cwd)`
- Validate git remote via `validateGitRemote(cwd, repoId)`
- Load provider config: if `codeHostPlatform`/`issueTrackerPlatform` options are provided, use those; otherwise call `loadProviderConfig(cwd)` to read from `.adw/providers.md` with GitHub fallback
- Resolve providers via `resolveIssueTracker()` and `resolveCodeHost()`
- Construct `RepoContext` object and return `Object.freeze({ issueTracker, codeHost, cwd, repoId })`

### Step 6: Update barrel exports
- In `adws/providers/index.ts`, add export for the new module: `export * from './repoContext'`
- This exports `createRepoContext`, `RepoContextOptions`, `ProviderConfig`, and validation functions

### Step 7: Write tests — successful creation
- Create `adws/providers/__tests__/repoContext.test.ts`
- Mock `child_process.execSync` to simulate `git remote get-url origin` returning a matching URL
- Mock `fs.existsSync` and `fs.statSync` to simulate valid directory with `.git`
- Mock `fs.readFileSync` for `.adw/providers.md` content
- Mock `createGitHubIssueTracker` and `createGitHubCodeHost` to return mock providers
- Test: valid inputs produce a `RepoContext` with correct `cwd`, `repoId`, and provider instances

### Step 8: Write tests — validation failures
- Test: empty/whitespace owner throws descriptive error
- Test: empty/whitespace repo throws descriptive error
- Test: non-existent working directory throws `Working directory does not exist` error
- Test: working directory without `.git` throws `not a git repository` error
- Test: git remote URL with mismatched owner throws `Git remote does not match` error
- Test: git remote URL with mismatched repo throws `Git remote does not match` error

### Step 9: Write tests — immutability
- Test: returned context is frozen (`Object.isFrozen(ctx)` is `true`)
- Test: attempting to assign a new property on the context throws in strict mode or is silently ignored
- Test: attempting to reassign `ctx.cwd` or `ctx.repoId` throws or is silently ignored

### Step 10: Write tests — provider config loading
- Test: `.adw/providers.md` with `## Code Host\ngithub\n\n## Issue Tracker\ngithub` correctly returns `{ codeHost: Platform.GitHub, issueTracker: Platform.GitHub }`
- Test: `.adw/providers.md` with only `## Code Host` section uses default for issue tracker
- Test: `.adw/providers.md` with unknown platform value throws descriptive error
- Test: missing `.adw/providers.md` returns default GitHub config for both

### Step 11: Write tests — mixed platform and option overrides
- Test: `codeHostPlatform` option overrides config file
- Test: `issueTrackerPlatform` option overrides config file
- Test: unsupported platform for issue tracker throws `Unsupported issue tracker platform`
- Test: unsupported platform for code host throws `Unsupported code host platform`

### Step 12: Write tests — git remote parsing edge cases
- Test: HTTPS remote URL (`https://github.com/owner/repo.git`) matches correctly
- Test: SSH remote URL (`git@github.com:owner/repo.git`) matches correctly
- Test: case-insensitive owner/repo comparison (e.g., `Owner` vs `owner`)
- Test: `git remote get-url origin` failure throws descriptive error

### Step 13: Run validation commands
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify type checking passes
- Run `bun run lint` to verify linting passes
- Run `bun run test` to verify all tests pass with zero regressions

## Testing Strategy
### Unit Tests
- **Factory creation**: Verify `createRepoContext` returns a valid `RepoContext` with correct `cwd`, `repoId`, `issueTracker`, and `codeHost` fields when all inputs are valid
- **Validation**: Each validation step (repo identifier, working directory, git remote, provider resolution) is tested independently with descriptive error messages
- **Config loading**: `loadProviderConfig` tested with valid files, missing files, partial content, and invalid values
- **Provider resolution**: Each platform branch tested, including unsupported platform errors
- **Immutability**: Verify `Object.isFrozen` on returned context and that mutation attempts fail
- **Mock isolation**: All external dependencies (file system, child_process, provider factories) mocked to keep tests fast and deterministic

### Edge Cases
- Working directory path with trailing slash
- Git remote URL without `.git` suffix
- Git remote URL with `.git` suffix
- `.adw/providers.md` with extra whitespace around platform values
- `.adw/providers.md` with empty sections (no content under heading)
- `.adw/providers.md` with extra markdown content (comments, other headings)
- Case variations in platform names (e.g., `GitHub`, `GITHUB`, `github`)
- `git remote get-url origin` returning error (no remote configured)
- Working directory exists but is not a directory (is a file)
- Mixed platform config: GitHub code host with different issue tracker platform (currently throws unsupported)

## Acceptance Criteria
- `createRepoContext(options)` factory function exists in `adws/providers/repoContext.ts`
- `RepoContextOptions` includes `repoId`, `cwd`, and optional platform overrides for each provider
- Factory validates repo identifier is well-formed (non-empty owner/repo)
- Factory validates working directory exists and contains a `.git` directory
- Factory validates git remote in the working directory matches the declared repo identifier
- Factory resolves and instantiates correct `IssueTracker` and `CodeHost` based on platform
- Factory reads `.adw/providers.md` for provider configuration when present
- Factory falls back to `Platform.GitHub` for both providers when `.adw/providers.md` is absent
- Factory returns a frozen (`Object.freeze`) `RepoContext` — immutable after creation
- Factory throws descriptive errors on any validation failure
- Unsupported platform types throw clear "unsupported platform" errors
- All types and factory are exported from `adws/providers/index.ts`
- All tests pass with zero regressions
- TypeScript type checking passes without errors
- Linting passes without errors

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bunx tsc --noEmit -p adws/tsconfig.json` — Verify TypeScript type checking passes for the adws project
- `bun run lint` — Run linter to check for code quality issues
- `bun run build` — Build the application to verify no build errors
- `bun run test` — Run all tests to validate the feature works with zero regressions

## Notes
- This feature does NOT remove `targetRepoRegistry.ts` — that migration happens in a later issue after all consumers are switched to `RepoContext`.
- The `RepoContext` is created once per workflow run in the orchestrator entry point and threaded through to all phases.
- Follow the established factory pattern from `createGitHubIssueTracker` and `createGitHubCodeHost`.
- The `.adw/providers.md` config loading follows the same markdown-section parsing convention used by `adws/core/projectConfig.ts` (see `parseMarkdownSections`). Consider reusing that parser if appropriate, or keep a lightweight inline implementation since we only need two sections.
- All provider factories (`createGitHubIssueTracker`, `createGitHubCodeHost`) already validate `RepoIdentifier` internally, but the RepoContext factory should also validate upfront for fail-fast behavior.
- Strictly adhere to `guidelines/coding_guidelines.md`: immutability, type safety, modularity, pure functions where possible, side effects at boundaries.
- No new libraries are required for this implementation.
