# Feature: Add Provider Configuration to .adw/ Project Config

## Metadata
issueNumber: `121`
adwId: `1773131354028-eosfan`
issueJson: `{"number":121,"title":"Add provider configuration to .adw/ project config","body":"## Summary\nExtend the `.adw/` project configuration system to support provider selection, so each target repository can declare which issue tracker and code host it uses.\n\n## Dependencies\n- #116 — RepoContext factory must support provider configuration loading\n\n## User Story\nAs a team using ADW with a GitLab-hosted repo and Jira for issue tracking, I want to configure my providers in `.adw/providers.md` so that ADW uses the correct platforms for my project.\n\n## Acceptance Criteria\n\n### Create `.adw/providers.md` specification\nDefine the configuration format:\n```markdown\n## Code Host\ngithub\n\n## Code Host URL\nhttps://github.com\n\n## Issue Tracker\ngithub\n\n## Issue Tracker URL\nhttps://github.com\n\n## Issue Tracker Project Key\n(optional — for Jira, Linear, etc.)\n```\n\n### Update `projectConfig.ts`\n- Add `ProvidersConfig` type: `{ codeHost: string, codeHostUrl?: string, issueTracker: string, issueTrackerUrl?: string, issueTrackerProjectKey?: string }`\n- Parse `.adw/providers.md` using existing heading-based extraction\n- Add to `ProjectConfig` return type\n- Default to `github` for both when file is absent (backward compatible)\n\n### Update RepoContext factory\n- Read `ProvidersConfig` when creating context\n- Use config to determine which provider implementations to instantiate\n- Throw clear \"unsupported provider\" errors for platforms not yet implemented\n\n### Update `adwInit.tsx`\n- When bootstrapping `.adw/` config for a target repo, detect the code host from the git remote URL (github.com → github, gitlab.com → gitlab)\n- Generate a default `.adw/providers.md`\n\n### Tests\n- Test config parsing with various provider combinations\n- Test defaults when `.adw/providers.md` is absent\n- Test auto-detection from git remote URL\n\n## Notes\n- Initially only `github` is a valid provider value. The config format is forward-looking — adding `gitlab` or `jira` later just means implementing the provider and registering it.\n- The URL fields are optional for GitHub (inferred from repo URL) but will be required for self-hosted instances (GitHub Enterprise, self-hosted GitLab, on-prem Jira).","state":"OPEN","author":"paysdoc","labels":["enhancement"],"createdAt":"2026-03-09T15:19:45Z","comments":[],"actionableComment":null}`

## Feature Description
Extend the `.adw/` project configuration system to support provider selection via a new `.adw/providers.md` file. Each target repository can declare which issue tracker and code host it uses (e.g., GitHub, GitLab, Jira), along with optional URLs for self-hosted instances and project keys for external trackers. This bridges the existing `ProjectConfig` system (which handles commands, project structure, and conditional docs) with the `RepoContext` factory (which resolves provider implementations), creating a unified configuration flow from markdown config to provider instantiation.

## User Story
As a team using ADW with a GitLab-hosted repo and Jira for issue tracking,
I want to configure my providers in `.adw/providers.md`
So that ADW uses the correct platforms for my project.

## Problem Statement
The RepoContext factory (`adws/providers/repoContext.ts`) already has a `loadProviderConfig()` function that reads `.adw/providers.md`, but it only parses `## Code Host` and `## Issue Tracker` as Platform enum values. It lacks URL fields needed for self-hosted instances (GitHub Enterprise, self-hosted GitLab, on-prem Jira), project key support for external trackers (Jira, Linear), and integration with the broader `ProjectConfig` system in `projectConfig.ts`. Additionally, the ADW init process (`adwInit.tsx` / `adw_init.md`) does not generate a `providers.md` file when bootstrapping `.adw/` config for a target repository.

## Solution Statement
1. Add a `ProvidersConfig` type to `projectConfig.ts` with string-based fields (`codeHost`, `codeHostUrl`, `issueTracker`, `issueTrackerUrl`, `issueTrackerProjectKey`) and a `parseProvidersMd()` function using the existing `parseMarkdownSections()` parser.
2. Add `providers: ProvidersConfig` to the `ProjectConfig` interface and load it in `loadProjectConfig()`.
3. Update the `ProviderConfig` in `repoContext.ts` to include optional URL and project key fields, and update `loadProviderConfig()` to parse them.
4. Update `createRepoContext()` to accept an optional `ProvidersConfig` from `ProjectConfig` to avoid double-parsing.
5. Update `adw_init.md` to generate a default `.adw/providers.md` by detecting the code host from the git remote URL.
6. Add comprehensive tests for all new parsing, defaulting, and auto-detection logic.

## Relevant Files
Use these files to implement the feature:

- `guidelines/coding_guidelines.md` — Coding guidelines that must be strictly followed (type safety, immutability, modularity, testing).
- `adws/core/projectConfig.ts` — **Primary target.** Add `ProvidersConfig` type, `parseProvidersMd()` function, `getDefaultProvidersConfig()`, and integrate into `ProjectConfig` interface and `loadProjectConfig()`.
- `adws/providers/repoContext.ts` — **Primary target.** Update `ProviderConfig` to include URL/project key fields, update `loadProviderConfig()` to parse new sections, update `createRepoContext()` to accept `ProvidersConfig` from project config.
- `adws/providers/types.ts` — Contains `Platform` enum, `RepoContext` type, and provider interfaces. Reference for platform values.
- `adws/providers/index.ts` — Barrel export for providers module. May need to export new types.
- `adws/phases/workflowInit.ts` — Contains `WorkflowConfig` and `initializeWorkflow()`. Already loads `ProjectConfig` — the new `providers` field will be available automatically.
- `.claude/commands/adw_init.md` — Slash command template for `/adw_init`. Must be updated to generate `.adw/providers.md`.
- `adws/adwInit.tsx` — ADW init orchestrator. No code changes needed (delegates to slash command), but included for context.
- `adws/core/__tests__/projectConfig.test.ts` — Existing tests for `projectConfig.ts`. Must be extended with `ProvidersConfig` tests.
- `adws/providers/__tests__/repoContext.test.ts` — Existing tests for `repoContext.ts`. Must be extended with URL/project key parsing tests and `ProvidersConfig` acceptance tests.
- `app_docs/feature-the-adw-is-too-speci-tf7slv-generalize-adw-project-config.md` — Conditional doc about the `.adw/` project config system. Reference for understanding the existing pattern.

### New Files
- `adws/core/__tests__/providersConfig.test.ts` — Dedicated test file for `ProvidersConfig` parsing logic (to keep `projectConfig.test.ts` focused).

## Implementation Plan
### Phase 1: Foundation
Add the `ProvidersConfig` type and parsing logic to `projectConfig.ts`. This is the foundation that all other changes depend on. The type uses raw strings (not Platform enums) because the config file is user-facing markdown — validation and conversion to enums happens downstream in the RepoContext factory.

Key decisions:
- `ProvidersConfig` uses `string` for `codeHost` and `issueTracker` (not `Platform` enum) because the config layer should be format-agnostic. The RepoContext factory already handles string-to-Platform conversion.
- Default values are `'github'` for both `codeHost` and `issueTracker`, with all URL/key fields as `undefined` — fully backward compatible.
- Parsing reuses the existing `parseMarkdownSections()` function with a new heading-to-key mapping.

### Phase 2: Core Implementation
Update the RepoContext factory to support the new URL and project key fields, and to accept `ProvidersConfig` from the project config system. This avoids double file reads (once in `loadProjectConfig()` and once in `loadProviderConfig()`) when both are called during workflow initialization.

Update the existing `ProviderConfig` interface to include `codeHostUrl`, `issueTrackerUrl`, and `issueTrackerProjectKey` as optional string fields. Update `loadProviderConfig()` to parse these new sections from `providers.md`. Add an optional `providersConfig` parameter to `createRepoContext()` so callers can pass pre-loaded config from `ProjectConfig`.

### Phase 3: Integration
Update the `adw_init.md` slash command to generate a default `.adw/providers.md` file during ADW init. The command should detect the code host from the git remote URL (`github.com` → `github`, `gitlab.com` → `gitlab`, etc.) and generate the appropriate config. This is the only user-facing change — the rest of the pipeline picks up the config automatically through `loadProjectConfig()` in `initializeWorkflow()`.

## Step by Step Tasks

### Step 1: Add `ProvidersConfig` type and parsing to `projectConfig.ts`
- Add a `PROVIDERS_HEADING_TO_KEY` mapping for the provider-specific headings:
  - `'code host'` → `'codeHost'`
  - `'code host url'` → `'codeHostUrl'`
  - `'issue tracker'` → `'issueTracker'`
  - `'issue tracker url'` → `'issueTrackerUrl'`
  - `'issue tracker project key'` → `'issueTrackerProjectKey'`
- Add `ProvidersConfig` interface:
  ```typescript
  export interface ProvidersConfig {
    codeHost: string;
    codeHostUrl?: string;
    issueTracker: string;
    issueTrackerUrl?: string;
    issueTrackerProjectKey?: string;
  }
  ```
- Add `getDefaultProvidersConfig()` function returning `{ codeHost: 'github', issueTracker: 'github' }`
- Add `parseProvidersMd(content: string): ProvidersConfig` function using `parseMarkdownSections()` and `PROVIDERS_HEADING_TO_KEY`
- Add `providers: ProvidersConfig` to the `ProjectConfig` interface
- Update `getDefaultProjectConfig()` to include `providers: getDefaultProvidersConfig()`
- Update `loadProjectConfig()` to read `.adw/providers.md` and parse it with `parseProvidersMd()`, falling back to defaults when absent

### Step 2: Write tests for `ProvidersConfig` parsing in `projectConfig.ts`
- Create `adws/core/__tests__/providersConfig.test.ts` with tests for:
  - `getDefaultProvidersConfig()` returns github defaults
  - `parseProvidersMd()` with all sections present
  - `parseProvidersMd()` with only required sections (code host + issue tracker)
  - `parseProvidersMd()` with empty content returns defaults
  - `parseProvidersMd()` with whitespace-only content returns defaults
  - `parseProvidersMd()` with missing code host section (defaults to github)
  - `parseProvidersMd()` with missing issue tracker section (defaults to github)
  - `parseProvidersMd()` with URL fields populated
  - `parseProvidersMd()` with issue tracker project key
  - `parseProvidersMd()` preserves case for URLs but lowercases platform names
  - `parseProvidersMd()` trims whitespace from values
- Add integration tests to existing `projectConfig.test.ts`:
  - `loadProjectConfig()` includes `providers` field with defaults when `providers.md` absent
  - `loadProjectConfig()` parses `providers.md` when present
  - `loadProjectConfig()` returns default providers when `.adw/` directory is missing
- Run tests: `bun run test -- --run adws/core/__tests__/providersConfig.test.ts`

### Step 3: Update `ProviderConfig` and `loadProviderConfig()` in `repoContext.ts`
- Add optional URL and project key fields to the `ProviderConfig` interface:
  ```typescript
  export interface ProviderConfig {
    codeHost: Platform;
    codeHostUrl?: string;
    issueTracker: Platform;
    issueTrackerUrl?: string;
    issueTrackerProjectKey?: string;
  }
  ```
- Update `loadProviderConfig()` to also parse `## Code Host URL`, `## Issue Tracker URL`, and `## Issue Tracker Project Key` sections from the markdown content
- Add an optional `providersConfig` parameter to `RepoContextOptions`:
  ```typescript
  export interface RepoContextOptions {
    repoId: RepoIdentifier;
    cwd: string;
    codeHostPlatform?: Platform;
    issueTrackerPlatform?: Platform;
    providersConfig?: ProvidersConfig;
  }
  ```
- Update `createRepoContext()`: when `providersConfig` is provided, use it to resolve platforms (converting string to Platform enum via `parsePlatform()`) instead of calling `loadProviderConfig()`. This avoids reading `.adw/providers.md` twice when `ProjectConfig` has already loaded it.

### Step 4: Update `repoContext.test.ts` with new field tests
- Add tests for `loadProviderConfig()` parsing URL fields:
  - Parses `## Code Host URL` when present
  - Parses `## Issue Tracker URL` when present
  - Parses `## Issue Tracker Project Key` when present
  - Returns `undefined` for URL fields when sections are absent
- Add tests for `createRepoContext()` with `providersConfig` option:
  - Accepts `ProvidersConfig` and uses it for platform resolution
  - Skips file read when `providersConfig` is provided
  - Throws on unknown platform string in `providersConfig`
- Run tests: `bun run test -- --run adws/providers/__tests__/repoContext.test.ts`

### Step 5: Export new types from barrel files
- Export `ProvidersConfig`, `getDefaultProvidersConfig`, and `parseProvidersMd` from `adws/core/index.ts`
- Verify `ProviderConfig` is already exported from `adws/providers/index.ts` (via `repoContext.ts` re-export)

### Step 6: Update `adw_init.md` to generate `.adw/providers.md`
- Add a new step between steps 4 and 5 (renumber existing steps 5→6 and 6→7):
  ```
  5. **Create `.adw/providers.md`**
     - Detect the code host from the git remote URL:
       - `github.com` → `github`
       - `gitlab.com` → `gitlab`
       - `bitbucket.org` → `bitbucket`
       - Unknown → `github` (default)
     - Generate `.adw/providers.md` with the following sections:
       - `## Code Host` — The detected code host platform
       - `## Code Host URL` — The base URL extracted from the remote (e.g., `https://github.com`)
       - `## Issue Tracker` — Same as code host (default assumption; user can change)
       - `## Issue Tracker URL` — Same as code host URL
       - `## Issue Tracker Project Key` — Empty (user fills in for Jira/Linear)
  ```
- Update the report step to include `providers.md` in the list of created files

### Step 7: Update existing `projectConfig.test.ts` for `providers` field
- Update the existing `getDefaultProjectConfig` test to verify `providers` field is present and has github defaults
- Update the `loadProjectConfig — valid .adw/ directory` test to include a `providers.md` file and verify it's parsed
- Update the `loadProjectConfig — partial .adw/ directory` test to verify providers defaults when `providers.md` is absent
- Update the `loadProjectConfig — edge cases` test for empty `providers.md`

### Step 8: Run full validation suite
- Run all validation commands listed in the Validation Commands section below to confirm zero regressions.

## Testing Strategy
### Unit Tests
- **`parseProvidersMd()`**: Test parsing with all sections, partial sections, empty content, whitespace-only content, case variations, and extra markdown noise.
- **`getDefaultProvidersConfig()`**: Verify it returns `{ codeHost: 'github', issueTracker: 'github' }` with no URL/key fields.
- **`loadProjectConfig()` with providers**: Verify the `providers` field is correctly populated from `.adw/providers.md` and defaults when absent.
- **`loadProviderConfig()` with URL fields**: Verify the updated function parses URL and project key sections.
- **`createRepoContext()` with `providersConfig`**: Verify it accepts pre-loaded config and skips file reads.

### Edge Cases
- Empty `.adw/providers.md` file → returns github defaults for both providers
- Only `## Code Host` present → issue tracker defaults to github
- Only `## Issue Tracker` present → code host defaults to github
- URL fields with trailing slashes and whitespace
- Case-insensitive platform name matching (e.g., `GitHub`, `GITHUB`, `github`)
- Unknown platform strings (e.g., `jira` as code host) → preserved as-is in `ProvidersConfig` (validation happens in RepoContext factory)
- `## Issue Tracker Project Key` with empty value vs absent section
- `.adw/providers.md` with extra headings that should be ignored
- Providers field in `ProjectConfig` when `.adw/` directory is completely absent

## Acceptance Criteria
- `ProvidersConfig` type is defined in `projectConfig.ts` with all five fields
- `parseProvidersMd()` correctly parses all provider configuration sections
- `getDefaultProvidersConfig()` returns github defaults
- `ProjectConfig` includes a `providers: ProvidersConfig` field
- `loadProjectConfig()` reads and parses `.adw/providers.md`, falling back to defaults
- `ProviderConfig` in `repoContext.ts` includes optional URL and project key fields
- `loadProviderConfig()` parses URL and project key sections
- `createRepoContext()` accepts optional `ProvidersConfig` to avoid double file reads
- `adw_init.md` generates `.adw/providers.md` with auto-detected code host from git remote
- All existing tests pass with zero regressions
- New tests cover parsing, defaults, edge cases, and integration
- Backward compatible: repositories without `.adw/providers.md` continue to work with github defaults

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Run TypeScript type checker
- `bunx tsc --noEmit -p adws/tsconfig.json` — Run additional type checks for adws
- `bun run test -- --run adws/core/__tests__/providersConfig.test.ts` — Run new provider config tests
- `bun run test -- --run adws/core/__tests__/projectConfig.test.ts` — Run updated project config tests
- `bun run test -- --run adws/providers/__tests__/repoContext.test.ts` — Run updated RepoContext tests
- `bun run test` — Run full test suite to verify zero regressions
- `bun run build` — Build the application to verify no build errors

## Notes
- **Backward compatibility**: The highest priority constraint. Repositories without `.adw/providers.md` continue to work with github defaults for both code host and issue tracker. The `ProvidersConfig` default values match the existing behavior.
- **String vs enum in ProvidersConfig**: `ProvidersConfig` deliberately uses `string` (not `Platform` enum) for `codeHost` and `issueTracker` because it represents raw user input from markdown. The RepoContext factory handles validation and conversion to `Platform` enum values downstream.
- **Double-read prevention**: The `providersConfig` parameter on `RepoContextOptions` prevents `createRepoContext()` from re-reading `.adw/providers.md` when it has already been loaded by `loadProjectConfig()` in `initializeWorkflow()`.
- **URL fields are forward-looking**: For GitHub, URLs are inferred from the git remote. The URL fields become required for self-hosted instances (GitHub Enterprise, self-hosted GitLab, on-prem Jira) which will be supported when those provider implementations are added.
- **`guidelines/coding_guidelines.md` compliance**: All code must follow strict TypeScript mode, use explicit types (no `any`), prefer immutability, and include comprehensive unit tests.
