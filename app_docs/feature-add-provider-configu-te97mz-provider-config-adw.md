# Provider Configuration via `.adw/providers.md`

**ADW ID:** 1773106318290-te97mz
**Date:** 2026-03-10
**Specification:** specs/issue-121-adw-1773106318290-te97mz-sdlc_planner-provider-config.md

## Overview

This feature extends the `.adw/` project configuration system with a new `.adw/providers.md` file that declares which issue tracker and code host each target repository uses. Provider selection is parsed by `projectConfig.ts` and consumed by a new `createRepoContext()` factory that instantiates the correct provider implementations. When `.adw/providers.md` is absent, both providers default to `github` for full backward compatibility.

## What Was Built

- `ProvidersConfig` type and `parseProvidersMd()` parser in `adws/core/projectConfig.ts`
- `getDefaultProvidersConfig()` helper returning github defaults
- `providers` field added to `ProjectConfig` type and loaded by `loadProjectConfig()`
- `createRepoContext()` factory in `adws/providers/repoContextFactory.ts` that maps config to provider instances
- `.adw/providers.md` reference implementation for ADW itself
- Updated `/adw_init` slash command to auto-generate `providers.md` from git remote URL
- Unit tests for parsing, loading, defaults, factory creation, and error cases

## Technical Implementation

### Files Modified

- `adws/core/projectConfig.ts`: Added `ProvidersConfig` interface, `PROVIDER_HEADING_TO_KEY` mapping, `getDefaultProvidersConfig()`, `parseProvidersMd()`, and extended `ProjectConfig` + `loadProjectConfig()` to include providers
- `adws/core/index.ts`: Exported `ProvidersConfig`, `getDefaultProvidersConfig`, and `parseProvidersMd`
- `adws/providers/index.ts`: Exported from `./repoContextFactory`
- `.claude/commands/adw_init.md`: Added step 4 to generate `.adw/providers.md` with auto-detected values; renumbered subsequent steps
- `.adw/conditional_docs.md`: Added conditional docs entry for provider config documentation

### New Files

- `adws/providers/repoContextFactory.ts`: `createRepoContext(config, repoId, cwd)` factory with switch-based provider lookup and validation
- `adws/providers/__tests__/repoContextFactory.test.ts`: Tests for factory behavior, error cases, and provider validation
- `adws/core/__tests__/projectConfig.test.ts`: Extended with `ProvidersConfig` parsing and loading tests
- `.adw/providers.md`: Reference implementation for ADW's own provider configuration

### Key Changes

- **Heading-based parsing**: `parseProvidersMd()` uses the same `parseMarkdownSections()` pattern as `parseCommandsMd()` — each `## Heading` maps to a `ProvidersConfig` key via `PROVIDER_HEADING_TO_KEY`
- **Graceful defaults**: Missing file or empty content silently returns `getDefaultProvidersConfig()` (both providers = `github`)
- **Factory validation**: `createRepoContext()` throws descriptive errors for unsupported providers and for Jira missing required URL/project key fields
- **Jira support**: Jira is supported as an issue tracker when `issueTrackerUrl` and `issueTrackerProjectKey` are provided; GitHub is the only supported code host initially
- **Auto-detection in init**: `/adw_init` inspects `git remote get-url origin` hostname to detect `github` or `gitlab` and generates `providers.md` accordingly

## How to Use

### Configuring providers for a target repo

1. Create `.adw/providers.md` in the target repository:

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

2. For Jira as the issue tracker:

```markdown
## Code Host
github

## Code Host URL
https://github.com

## Issue Tracker
jira

## Issue Tracker URL
https://your-org.atlassian.net

## Issue Tracker Project Key
MYPROJECT
```

3. ADW reads `providers.md` automatically as part of `loadProjectConfig()` — no code changes needed.

### Using `createRepoContext()` in ADW code

```typescript
import { loadProjectConfig } from './core/projectConfig';
import { createRepoContext } from './providers';

const config = loadProjectConfig(targetRepoPath);
const repoId = { owner: 'my-org', repo: 'my-repo' };
const context = createRepoContext(config.providers, repoId, targetRepoPath);
// context.issueTracker, context.codeHost, context.cwd, context.repoId are ready to use
```

### Auto-generating via `/adw_init`

Run `/adw_init` on a target repository — it will detect the code host from the git remote URL and create `.adw/providers.md` automatically as part of step 4.

## Configuration

`.adw/providers.md` supports five heading sections:

| Heading | Description | Required |
|---|---|---|
| `## Code Host` | Platform name (`github`, `gitlab`) | No (defaults to `github`) |
| `## Code Host URL` | Base URL for code host | No |
| `## Issue Tracker` | Platform name (`github`, `jira`) | No (defaults to `github`) |
| `## Issue Tracker URL` | Base URL for issue tracker | Required for Jira |
| `## Issue Tracker Project Key` | Project key (e.g., `PROJ`) | Required for Jira |

## Testing

```bash
bun run test adws/core/__tests__/projectConfig.test.ts
bun run test adws/providers/__tests__/repoContextFactory.test.ts
```

Tests cover:
- `parseProvidersMd()`: all five sections, empty content, partial configs, unknown headings
- `loadProjectConfig()`: loads providers when present, defaults when absent, empty file
- `getDefaultProvidersConfig()`: returns github defaults matching `getDefaultProjectConfig()`
- `createRepoContext()`: github defaults, jira with valid config, errors for unsupported providers, Jira missing URL/key validation

## Notes

- **Backward compatible**: Repos without `.adw/providers.md` continue to work exactly as before — `loadProjectConfig()` catches the missing file and returns github defaults.
- **Not yet wired into workflow lifecycle**: `createRepoContext()` provides the infrastructure but is not yet called inside `initializeWorkflow()`. Wiring it in (replacing direct GitHub API calls with provider-based calls) is a separate task.
- **Forward-looking format**: URL fields support self-hosted instances (GitHub Enterprise, self-hosted GitLab, on-prem Jira) even though only cloud GitHub is initially supported as a code host.
- **Adding new providers**: Register a new provider by adding a `case` to the `switch` in `buildIssueTracker()` or `buildCodeHost()` in `repoContextFactory.ts`.
