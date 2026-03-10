# Feature: Add Provider Configuration to .adw/ Project Config

## Metadata
issueNumber: `121`
adwId: `1773106318290-te97mz`
issueJson: `{"number":121,"title":"Add provider configuration to .adw/ project config","body":"## Summary\nExtend the `.adw/` project configuration system to support provider selection, so each target repository can declare which issue tracker and code host it uses.\n\n## Dependencies\n- #116 — RepoContext factory must support provider configuration loading\n\n## User Story\nAs a team using ADW with a GitLab-hosted repo and Jira for issue tracking, I want to configure my providers in `.adw/providers.md` so that ADW uses the correct platforms for my project.\n\n## Acceptance Criteria\n\n### Create `.adw/providers.md` specification\nDefine the configuration format:\n```markdown\n## Code Host\ngithub\n\n## Code Host URL\nhttps://github.com\n\n## Issue Tracker\ngithub\n\n## Issue Tracker URL\nhttps://github.com\n\n## Issue Tracker Project Key\n(optional — for Jira, Linear, etc.)\n```\n\n### Update `projectConfig.ts`\n- Add `ProvidersConfig` type: `{ codeHost: string, codeHostUrl?: string, issueTracker: string, issueTrackerUrl?: string, issueTrackerProjectKey?: string }`\n- Parse `.adw/providers.md` using existing heading-based extraction\n- Add to `ProjectConfig` return type\n- Default to `github` for both when file is absent (backward compatible)\n\n### Update RepoContext factory\n- Read `ProvidersConfig` when creating context\n- Use config to determine which provider implementations to instantiate\n- Throw clear \"unsupported provider\" errors for platforms not yet implemented\n\n### Update `adwInit.tsx`\n- When bootstrapping `.adw/` config for a target repo, detect the code host from the git remote URL (github.com → github, gitlab.com → gitlab)\n- Generate a default `.adw/providers.md`\n\n### Tests\n- Test config parsing with various provider combinations\n- Test defaults when `.adw/providers.md` is absent\n- Test auto-detection from git remote URL\n\n## Notes\n- Initially only `github` is a valid provider value. The config format is forward-looking — adding `gitlab` or `jira` later just means implementing the provider and registering it.\n- The URL fields are optional for GitHub (inferred from repo URL) but will be required for self-hosted instances (GitHub Enterprise, self-hosted GitLab, on-prem Jira).","state":"OPEN","author":"paysdoc","labels":["enhancement"],"createdAt":"2026-03-09T15:19:45Z","comments":[],"actionableComment":null}`

## Feature Description
Extend the `.adw/` project configuration system to support provider selection via a new `.adw/providers.md` file. This allows each target repository to declare which issue tracker (GitHub Issues, Jira, etc.) and code host (GitHub, GitLab, etc.) it uses. The configuration is parsed using the existing heading-based markdown extraction pattern established by `projectConfig.ts`, integrated into `ProjectConfig`, and consumed by a new `createRepoContext()` factory function that instantiates the correct provider implementations. When `.adw/providers.md` is absent, both providers default to `github` for backward compatibility.

## User Story
As a team using ADW with a GitLab-hosted repo and Jira for issue tracking
I want to configure my providers in `.adw/providers.md`
So that ADW uses the correct platforms for my project without code changes

## Problem Statement
ADW currently has no way for target repositories to declare which issue tracker and code host they use. Provider instantiation is hardcoded to GitHub. Teams using Jira for issue tracking or GitLab for code hosting cannot configure ADW to use their platforms through project config — they would need to modify ADW source code.

## Solution Statement
Add a `.adw/providers.md` configuration file that follows the existing heading-based markdown format. Parse it alongside other `.adw/` config files in `projectConfig.ts`, expose it via the `ProjectConfig` type, and create a `createRepoContext()` factory function that reads the config to instantiate the correct provider implementations. Update `adwInit.tsx` (via the `/adw_init` slash command) to auto-detect the code host from the git remote URL and generate a default `providers.md`.

## Relevant Files
Use these files to implement the feature:

- `guidelines/coding_guidelines.md` — Coding standards that must be followed (strict mode, avoid `any`, immutability, modularity, etc.)
- `app_docs/feature-the-adw-is-too-speci-tf7slv-generalize-adw-project-config.md` — Documentation of the `.adw/` project config system; explains the heading-based parsing pattern, `ProjectConfig` type, and how config is loaded and used
- `adws/core/projectConfig.ts` — Core module to extend: add `ProvidersConfig` type, `parseProvidersMd()` function, load `.adw/providers.md`, add to `ProjectConfig` return type
- `adws/core/__tests__/projectConfig.test.ts` — Existing test file to extend with `ProvidersConfig` parsing and loading tests
- `adws/core/index.ts` — Barrel export; add `ProvidersConfig` export
- `adws/providers/types.ts` — Provider interfaces (`IssueTracker`, `CodeHost`, `RepoContext`, `Platform` enum, `RepoIdentifier`); the `RepoContext` type is the target output of the factory
- `adws/providers/github/githubIssueTracker.ts` — GitHub `IssueTracker` factory (`createGitHubIssueTracker`)
- `adws/providers/github/githubCodeHost.ts` — GitHub `CodeHost` factory (`createGitHubCodeHost`)
- `adws/providers/jira/jiraIssueTracker.ts` — Jira `IssueTracker` factory (`createJiraIssueTracker`)
- `adws/providers/index.ts` — Provider barrel export; add new factory export
- `adws/phases/workflowInit.ts` — `initializeWorkflow()` and `WorkflowConfig`; where `projectConfig` is loaded and could be used to create `RepoContext`
- `.claude/commands/adw_init.md` — Slash command template for `/adw_init`; update to generate `.adw/providers.md`
- `.adw/providers.md` — New file: ADW's own provider config (self-referential reference implementation)

### New Files
- `adws/providers/repoContextFactory.ts` — New factory function `createRepoContext()` that reads `ProvidersConfig` and instantiates the correct `IssueTracker` and `CodeHost` implementations
- `adws/providers/__tests__/repoContextFactory.test.ts` — Tests for the `createRepoContext()` factory
- `.adw/providers.md` — ADW's own provider configuration (reference implementation)

## Implementation Plan
### Phase 1: Foundation
Add the `ProvidersConfig` type and parsing logic to `projectConfig.ts`. This follows the exact same heading-based extraction pattern used by `parseCommandsMd()`. Define the type, create a `parseProvidersMd()` function, and extend `loadProjectConfig()` to read `.adw/providers.md`. Extend `ProjectConfig` with a `providers` field. Update defaults to use `github` for both `codeHost` and `issueTracker` when the file is absent.

### Phase 2: Core Implementation
Create the `createRepoContext()` factory in `adws/providers/repoContextFactory.ts`. This function takes a `ProvidersConfig` and a `RepoIdentifier`, looks up the provider name to determine which factory to call, and returns a fully constructed `RepoContext`. It validates that requested providers are implemented and throws clear "unsupported provider" errors for platforms not yet built. Update the `/adw_init` slash command to generate `.adw/providers.md` with auto-detected values from the git remote URL.

### Phase 3: Integration
Create ADW's own `.adw/providers.md` as a reference implementation. Export new types and factory from barrel files. Write comprehensive tests covering config parsing, factory behavior, defaults, and edge cases. Validate the full test suite passes with zero regressions.

## Step by Step Tasks

### Step 1: Read conditional documentation
- Read `app_docs/feature-the-adw-is-too-speci-tf7slv-generalize-adw-project-config.md` to understand the full project config system architecture
- Read `guidelines/coding_guidelines.md` to ensure compliance with coding standards

### Step 2: Add `ProvidersConfig` type and parsing to `projectConfig.ts`
- Add `ProvidersConfig` interface to `adws/core/projectConfig.ts`:
  ```typescript
  export interface ProvidersConfig {
    codeHost: string;
    codeHostUrl: string;
    issueTracker: string;
    issueTrackerUrl: string;
    issueTrackerProjectKey: string;
  }
  ```
- Add `PROVIDER_HEADING_TO_KEY` mapping constant:
  ```typescript
  const PROVIDER_HEADING_TO_KEY: Record<string, keyof ProvidersConfig> = {
    'code host': 'codeHost',
    'code host url': 'codeHostUrl',
    'issue tracker': 'issueTracker',
    'issue tracker url': 'issueTrackerUrl',
    'issue tracker project key': 'issueTrackerProjectKey',
  };
  ```
- Add `getDefaultProvidersConfig()` function returning `{ codeHost: 'github', codeHostUrl: '', issueTracker: 'github', issueTrackerUrl: '', issueTrackerProjectKey: '' }`
- Add `parseProvidersMd(content: string): ProvidersConfig` function following the same pattern as `parseCommandsMd()`
- Add `providers: ProvidersConfig` field to the `ProjectConfig` interface
- Update `getDefaultProjectConfig()` to include `providers: getDefaultProvidersConfig()`
- Update `loadProjectConfig()` to read `.adw/providers.md` and parse it using `parseProvidersMd()`

### Step 3: Export new types from barrel
- Update `adws/core/index.ts` to export `ProvidersConfig`, `getDefaultProvidersConfig`, and `parseProvidersMd`

### Step 4: Add unit tests for provider config parsing
- Extend `adws/core/__tests__/projectConfig.test.ts` with new test sections:
  - `getDefaultProvidersConfig` — returns github defaults with empty URLs
  - `parseProvidersMd` — parses all known provider sections, returns defaults for empty/missing content, handles partial configs, ignores unknown headings
  - `loadProjectConfig` with providers — loads providers.md when present, returns default providers when absent, handles empty providers.md
- Follow the exact test patterns established in the existing test file (tmpDir setup, `writeAdwFile` helper, describe blocks)

### Step 5: Create `createRepoContext()` factory
- Create `adws/providers/repoContextFactory.ts` with:
  - Import `ProvidersConfig` from core, provider types, and factory functions from github/jira modules
  - `createRepoContext(config: ProvidersConfig, repoId: RepoIdentifier, cwd: string): RepoContext` function
  - Internal lookup for `issueTracker` provider name → factory function:
    - `'github'` → `createGitHubIssueTracker(repoId)`
    - `'jira'` → `createJiraIssueTracker(config.issueTrackerUrl, config.issueTrackerProjectKey)` (requires URL and project key)
  - Internal lookup for `codeHost` provider name → factory function:
    - `'github'` → `createGitHubCodeHost(repoId)`
  - Throw `Error(`Unsupported issue tracker provider: "${config.issueTracker}"`)` for unrecognized providers
  - Throw `Error(`Unsupported code host provider: "${config.codeHost}"`)` for unrecognized providers
  - Validate required fields: if `issueTracker` is `'jira'`, `issueTrackerUrl` and `issueTrackerProjectKey` must be non-empty
  - Return `{ issueTracker, codeHost, cwd, repoId }` as `RepoContext`

### Step 6: Add unit tests for `createRepoContext()`
- Create `adws/providers/__tests__/repoContextFactory.test.ts`:
  - Test creating context with github/github defaults
  - Test creating context with jira issue tracker + github code host
  - Test error for unsupported issue tracker (e.g., `'linear'`)
  - Test error for unsupported code host (e.g., `'gitlab'`)
  - Test error when jira is selected but `issueTrackerUrl` or `issueTrackerProjectKey` is missing
  - Use vitest mocking for the provider factory functions to avoid real API calls

### Step 7: Export factory from provider barrel
- Update `adws/providers/index.ts` to export from `./repoContextFactory`

### Step 8: Update `/adw_init` slash command to generate `providers.md`
- Edit `.claude/commands/adw_init.md`:
  - Add a new step between step 4 and step 5 (renumber accordingly): **Create `.adw/providers.md`**
  - Instructions for the step:
    - Detect the code host from the git remote URL: run `git remote get-url origin` and inspect the hostname
      - `github.com` → `github`
      - `gitlab.com` → `gitlab`
      - Default to `github` if detection fails
    - Set issue tracker to match the code host (default assumption: same platform for both)
    - Generate `.adw/providers.md` with `## Code Host`, `## Code Host URL`, `## Issue Tracker`, `## Issue Tracker URL`, `## Issue Tracker Project Key` sections
    - Leave `## Issue Tracker Project Key` empty (to be filled manually for Jira/Linear)
  - Update the Report step to include `providers.md` in the list of generated files

### Step 9: Create ADW's own `.adw/providers.md`
- Create `.adw/providers.md` as the reference implementation for ADW itself:
  ```markdown
  ## Code Host
  github

  ## Code Host URL
  https://github.com

  ## Issue Tracker
  github

  ## Issue Tracker URL
  https://github.com

  ## Issue Tracker Project Key

  ```

### Step 10: Update `.adw/conditional_docs.md`
- Add a conditional documentation entry for `providers.md`-related work:
  ```
  - app_docs/feature-{this-feature-doc}.md
    - Conditions:
      - When working with `.adw/providers.md` or provider configuration
      - When modifying `adws/providers/repoContextFactory.ts`
      - When adding a new provider implementation
  ```
  (The actual doc file will be created after implementation via the `/document` command)

### Step 11: Run validation commands
- `bun run lint` — Verify no lint errors
- `bunx tsc --noEmit` — Verify no TypeScript errors
- `bunx tsc --noEmit -p adws/tsconfig.json` — Verify no ADW TypeScript errors
- `bun run test` — Run full test suite to ensure zero regressions
- `bun run build` — Build the application to verify no build errors

## Testing Strategy
### Unit Tests
- **`parseProvidersMd()`**: Parse all five heading sections, handle empty/whitespace-only content, handle partial configs, ignore unknown headings, handle multi-line values (take first non-empty line)
- **`loadProjectConfig()` with providers**: Load providers.md alongside existing files, return default providers when file is absent, handle empty providers.md
- **`getDefaultProvidersConfig()`**: Returns github defaults, matches the providers from `getDefaultProjectConfig()`
- **`createRepoContext()`**: Create context with github defaults, create context with jira issue tracker, throw for unsupported providers, validate required fields for jira

### Edge Cases
- `.adw/providers.md` exists but is empty → default to github
- `.adw/providers.md` has only `## Code Host` but no `## Issue Tracker` → code host is parsed, issue tracker defaults to github
- Provider value has leading/trailing whitespace → trimmed by `parseMarkdownSections()`
- Provider value is an unknown string (e.g., `'linear'`) → `createRepoContext()` throws clear error
- Jira selected but missing URL → `createRepoContext()` throws validation error
- `.adw/` directory exists but `providers.md` is missing → default providers config (backward compatible)
- Multiple `## Code Host` headings → last one wins (existing `parseMarkdownSections` behavior)

## Acceptance Criteria
- `.adw/providers.md` specification is defined with five heading sections: Code Host, Code Host URL, Issue Tracker, Issue Tracker URL, Issue Tracker Project Key
- `ProvidersConfig` type is added to `projectConfig.ts` and exported from `adws/core/index.ts`
- `parseProvidersMd()` parses `.adw/providers.md` using the existing heading-based extraction pattern
- `ProjectConfig` includes a `providers: ProvidersConfig` field
- Default providers are `github` for both `codeHost` and `issueTracker` when `.adw/providers.md` is absent (backward compatible)
- `createRepoContext()` factory instantiates correct providers based on `ProvidersConfig`
- `createRepoContext()` throws clear errors for unsupported or misconfigured providers
- `/adw_init` slash command generates `.adw/providers.md` with auto-detected values from git remote URL
- ADW's own `.adw/providers.md` exists as a reference implementation
- All existing tests pass (zero regressions)
- New unit tests cover parsing, loading, factory creation, defaults, and edge cases
- Code follows `guidelines/coding_guidelines.md` (strict types, no `any`, immutability, modularity)

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type check the main application
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check ADW scripts
- `bun run test` — Run full test suite to validate zero regressions
- `bun run build` — Build the application to verify no build errors

## Notes
- **Backward compatibility**: This is the highest priority constraint. Repositories without `.adw/providers.md` must continue to work exactly as before, defaulting to GitHub for both providers.
- **Forward-looking config format**: The `.adw/providers.md` format supports URL fields for self-hosted instances (GitHub Enterprise, self-hosted GitLab, on-prem Jira) even though only cloud GitHub is initially supported.
- **Initially only `github` and `jira` (issue tracker only) are valid provider values**: The config format is forward-looking — adding `gitlab` code host or `linear` issue tracker later just means implementing the provider factory and registering it in the lookup table in `repoContextFactory.ts`.
- **No new libraries required**: This feature uses only existing dependencies and patterns.
- **Coding guidelines**: Implementation must strictly adhere to `guidelines/coding_guidelines.md` — strict TypeScript, no `any`, immutable data, single-responsibility functions, comprehensive tests.
- **The `createRepoContext()` factory is not yet wired into `initializeWorkflow()`**: This feature creates the factory and config infrastructure. Wiring it into the workflow lifecycle (replacing direct GitHub API calls with provider-based calls) is a separate task that depends on #116 (RepoContext factory must support provider configuration loading).
