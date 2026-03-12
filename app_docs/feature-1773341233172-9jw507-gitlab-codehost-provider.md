# GitLab CodeHost Provider

**ADW ID:** 1773341233172-9jw507
**Date:** 2026-03-12
**Specification:** specs/issue-122-adw-1773341233172-9jw507-sdlc_planner-gitlab-codehost-provider.md

## Overview

Implements a `GitLabCodeHost` class that satisfies the `CodeHost` interface, enabling ADW to create merge requests, fetch review comments, and interact with repositories hosted on GitLab (both gitlab.com and self-hosted instances). This is the first non-GitHub `CodeHost` provider, validating that the provider abstraction defined in issue #113 works for a real second platform.

## What Was Built

- `GitLabApiClient` — synchronous HTTP client using `spawnSync`+`curl` to call the GitLab REST API v4
- `GitLabCodeHost` — `CodeHost` implementation delegating all operations to `GitLabApiClient`
- Pure mapper functions converting GitLab API types to platform-agnostic `MergeRequest` and `ReviewComment` types
- GitLab-specific readonly type definitions (`gitlabTypes.ts`)
- Factory function `createGitLabCodeHost()` with input validation and env-var authentication
- `GITLAB_TOKEN` and `GITLAB_INSTANCE_URL` environment variable constants in `adws/core/config.ts`
- `resolveCodeHost()` updated to return a `GitLabCodeHost` for `Platform.GitLab`
- `parseOwnerRepoFromUrl()` generalized to support any git host (GitLab HTTPS and SSH URLs)
- Full unit test coverage: API client, mappers, CodeHost, and repoContext integration

## Technical Implementation

### Files Modified

- `adws/core/config.ts`: Added `GITLAB_TOKEN` and `GITLAB_INSTANCE_URL` constants
- `adws/core/index.ts`: Exported the two new GitLab constants from the core barrel
- `adws/providers/repoContext.ts`: Added `Platform.GitLab` case in `resolveCodeHost()`; generalized `parseOwnerRepoFromUrl()` to match any host
- `adws/providers/index.ts`: Added `export * from './gitlab'` barrel export
- `adws/providers/__tests__/repoContext.test.ts`: Added tests for GitLab URL parsing and `resolveCodeHost` GitLab branch
- `.env.sample`: Added `GITLAB_TOKEN` and `GITLAB_INSTANCE_URL` documentation section

### New Files

- `adws/providers/gitlab/gitlabTypes.ts`: Readonly interfaces for GitLab REST API v4 response shapes (`GitLabProject`, `GitLabMergeRequest`, `GitLabNote`, `GitLabDiscussion`, etc.)
- `adws/providers/gitlab/gitlabApiClient.ts`: `GitLabApiClient` class — synchronous `spawnSync`+`curl` calls, URL-encodes project paths, handles error responses
- `adws/providers/gitlab/mappers.ts`: Pure functions — `mapGitLabMRToMergeRequest`, `mapGitLabNoteToReviewComment`, `mapGitLabDiscussionsToReviewComments`, `toProjectPath`
- `adws/providers/gitlab/gitlabCodeHost.ts`: `GitLabCodeHost implements CodeHost` + `createGitLabCodeHost()` factory
- `adws/providers/gitlab/index.ts`: Barrel exports for the GitLab provider module
- `adws/providers/gitlab/__tests__/gitlabApiClient.test.ts`: API client unit tests (auth headers, URL construction, error handling, self-hosted)
- `adws/providers/gitlab/__tests__/mappers.test.ts`: Mapper unit tests (field mapping, `iid` vs `id`, linked issue extraction, discussion flattening)
- `adws/providers/gitlab/__tests__/gitlabCodeHost.test.ts`: CodeHost unit tests (factory validation, method delegation, error propagation)

### Key Changes

- **Synchronous API calls**: `GitLabApiClient` uses `spawnSync('curl', ...)` rather than `async fetch()` to satisfy the synchronous `CodeHost` interface contract — matching the GitHub provider's `execSync`+`gh` pattern.
- **Project path encoding**: All API URLs URL-encode the `owner/repo` path (e.g., `acme%2Fwidgets`) via `encodeURIComponent()` as required by GitLab REST API v4.
- **`iid` vs `id`**: GitLab merge requests expose both a global `id` and a project-scoped `iid`. The mapper correctly maps `iid` → `MergeRequest.number` since `iid` is the user-facing identifier.
- **Generalized URL parser**: `parseOwnerRepoFromUrl()` now matches HTTPS and SSH remote URLs for any hostname, enabling GitLab (and future) providers to share the same validation logic.
- **Provider wiring**: Setting `gitlab` under `## Code Host` in `.adw/providers.md` now automatically selects `GitLabCodeHost` at workflow startup via `resolveCodeHost()`.

## How to Use

1. **Configure authentication** — add to your `.env` file:
   ```
   GITLAB_TOKEN="glpat-xxxxxxxxxxxxxxxxxxxx"
   # Optional: only needed for self-hosted GitLab
   GITLAB_INSTANCE_URL="https://gitlab.example.com"
   ```

2. **Set provider in the target repository** — create/update `.adw/providers.md`:
   ```markdown
   ## Code Host
   gitlab

   ## Issue Tracker
   github
   ```

3. **Run ADW as normal** — the workflow will use `GitLabCodeHost` to create merge requests and fetch reviews through the GitLab API.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `GITLAB_TOKEN` | _(required)_ | GitLab personal access token with `api` scope |
| `GITLAB_INSTANCE_URL` | `https://gitlab.com` | GitLab instance URL (for self-hosted) |

Set these in the project root `.env` file (see `.env.sample` for documented examples).

## Testing

```bash
# Run all GitLab provider tests
bun run test adws/providers/gitlab

# Run full test suite to confirm zero regressions
bun run test
```

The tests mock `spawnSync` to avoid real network calls. Each layer (API client, mappers, CodeHost) is tested in isolation.

## Notes

- **No new dependencies** — uses only `child_process.spawnSync` (Node.js built-in) and `curl` (assumed available in the runtime environment, same as `gh` for the GitHub provider).
- **Self-hosted GitLab**: Pass a custom `instanceUrl` to `createGitLabCodeHost(repoId, instanceUrl)` or set `GITLAB_INSTANCE_URL` in the environment. Trailing slashes are stripped automatically.
- **Subgroup projects**: Project paths with subgroups (e.g., `group/subgroup/repo`) are URL-encoded correctly, but the `parseOwnerRepoFromUrl()` regex captures only two path segments. Subgroup support in URL parsing would require a separate enhancement.
- **GitLabIssueTracker is not included**: This feature only implements `CodeHost`. Teams using GitLab Issues can continue to use GitHub Issues or Jira as the issue tracker. A future issue can add `GitLabIssueTracker`.
