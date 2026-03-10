# RepoContext Factory with Entry-Point Validation

**ADW ID:** 1773073910340-o5ncqk
**Date:** 2026-03-10
**Specification:** specs/issue-116-adw-1773073902212-9l2nv9-sdlc_planner-repo-context-factory.md

## Overview

Introduces a `createRepoContext` factory that constructs an immutable, validated `RepoContext` object at workflow entry points. The factory validates the repo identifier, working directory, and git remote match before resolving provider instances, replacing the mutable global singleton in `targetRepoRegistry.ts` and making it impossible to accidentally operate on the wrong repository.

## What Was Built

- `createRepoContext(options)` factory — validates inputs and returns a frozen `RepoContext`
- `RepoContextOptions` interface — accepts `repoId`, `cwd`, and optional platform overrides per provider
- `ProviderConfig` type — models platform config loaded from `.adw/providers.md`
- `loadProviderConfig(cwd)` — reads provider platform config from `.adw/providers.md` with GitHub fallback
- `validateWorkingDirectory(cwd)` — checks directory exists and contains `.git`
- `validateGitRemote(cwd, repoId)` — verifies `git remote get-url origin` matches declared repo (case-insensitive)
- `resolveIssueTracker(platform, repoId)` / `resolveCodeHost(platform, repoId)` — platform-to-provider dispatch
- 604-line comprehensive test suite covering creation, validation failures, immutability, config loading, and edge cases
- Removed Jira provider files (no longer part of the supported provider set for this project)

## Technical Implementation

### Files Modified

- `adws/providers/repoContext.ts`: New file — full factory implementation (218 lines)
- `adws/providers/__tests__/repoContext.test.ts`: New file — comprehensive test suite (604 lines)
- `adws/providers/index.ts`: Added `export * from './repoContext'` barrel export
- `adws/core/index.ts`: Minor update to barrel exports
- `adws/providers/jira/` (all files): Removed — Jira provider removed from codebase
- `.env.sample`: Updated to remove Jira-specific environment variables

### Key Changes

- **Immutability**: Factory returns `Object.freeze({ issueTracker, codeHost, cwd, repoId })` — the context cannot be mutated after creation
- **Fail-fast validation**: Three sequential validations run before any provider is instantiated — `validateRepoIdentifier`, `validateWorkingDirectory`, `validateGitRemote`
- **Git remote verification**: Parses both HTTPS (`https://github.com/owner/repo.git`) and SSH (`git@github.com:owner/repo.git`) remote URLs, compares owner/repo case-insensitively against the declared `RepoIdentifier`
- **Provider config from `.adw/providers.md`**: Optional file in the target repo; parses `## Code Host` and `## Issue Tracker` markdown sections; falls back to `Platform.GitHub` for any missing section
- **Platform overrides**: `codeHostPlatform` and `issueTrackerPlatform` options take precedence over the config file, enabling mixed-platform setups

## How to Use

1. Import the factory from the providers barrel:
   ```ts
   import { createRepoContext, Platform } from './adws/providers';
   ```

2. Call at workflow entry point with a valid `RepoIdentifier` and working directory:
   ```ts
   const ctx = createRepoContext({
     repoId: { platform: Platform.GitHub, owner: 'acme', repo: 'my-app' },
     cwd: '/path/to/cloned/repo',
   });
   ```

3. Thread `ctx` through all workflow phases — do not call the factory again mid-workflow.

4. Optionally override provider platforms per-call:
   ```ts
   const ctx = createRepoContext({
     repoId: { platform: Platform.GitHub, owner: 'acme', repo: 'my-app' },
     cwd: '/path/to/cloned/repo',
     codeHostPlatform: Platform.GitHub,
     issueTrackerPlatform: Platform.GitHub,
   });
   ```

## Configuration

**`.adw/providers.md`** (optional, in the target repo root):

```md
## Code Host
github

## Issue Tracker
github
```

- If absent, both providers default to `github`
- Supported platform values: `github` (case-insensitive)
- Unsupported platform values throw a descriptive error at context creation time

## Testing

```bash
bun run test adws/providers/__tests__/repoContext.test.ts
```

The test suite mocks `fs.existsSync`, `fs.statSync`, `fs.readFileSync`, `child_process.execSync`, `createGitHubIssueTracker`, and `createGitHubCodeHost` to keep tests fast and deterministic. Covers:

- Successful context creation (HTTPS + SSH remote URLs)
- Validation failures (missing directory, non-git directory, mismatched remote owner/repo)
- Immutability (`Object.isFrozen`, mutation attempt behavior)
- Provider config loading (valid file, partial file, unknown platform, missing file)
- Platform option overrides and unsupported platform errors

## Notes

- `targetRepoRegistry.ts` is **not removed** by this feature — migration of existing consumers happens in a follow-up issue
- The `RepoContext` is created once per workflow run; never re-create it mid-workflow
- Only `Platform.GitHub` is supported; other platform values throw `Unsupported issue tracker/code host platform` errors
- The `.adw/providers.md` config loading uses inline regex parsing (not `parseMarkdownSections` from `projectConfig.ts`) to avoid coupling
