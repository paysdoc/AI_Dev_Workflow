# Feature: GitLab CodeHost Provider

## Metadata
issueNumber: `122`
adwId: `1773341233172-9jw507`
issueJson: `{"number":122,"title":"Implement GitLab CodeHost provider","body":"## Summary\nImplement the `CodeHost` interface for GitLab, enabling ADW to create merge requests, fetch reviews, and manage code on GitLab-hosted repositories. This validates that the provider abstraction works for a real second platform.\n\n## Dependencies\n- #113 — Provider interfaces must be defined\n- #120 — VCS module must be extracted (so git operations are cleanly separated)\n- #121 — Provider configuration must support GitLab selection\n\n## User Story\nAs a team hosting code on GitLab, I want ADW to create merge requests and handle code reviews through the GitLab API so that I can use ADW without migrating to GitHub.\n\n## Acceptance Criteria\n\n### Create `adws/providers/gitlab/gitlabCodeHost.ts`\n- Implement `CodeHost` interface\n- Constructor takes `RepoIdentifier` + GitLab instance URL (for self-hosted support)\n- Use GitLab REST API (via `glab` CLI or direct HTTP calls) for:\n  - `getDefaultBranch()` — `GET /projects/:id` → `default_branch`\n  - `createMergeRequest()` — `POST /projects/:id/merge_requests`\n  - `fetchMergeRequest()` — `GET /projects/:id/merge_requests/:mr_iid`\n  - `commentOnMergeRequest()` — `POST /projects/:id/merge_requests/:mr_iid/notes`\n  - `fetchReviewComments()` — `GET /projects/:id/merge_requests/:mr_iid/discussions`\n  - `listOpenMergeRequests()` — `GET /projects/:id/merge_requests?state=opened`\n- Factory function: `createGitLabCodeHost(repoId: RepoIdentifier, instanceUrl?: string): CodeHost`\n\n### Authentication\n- Support `GITLAB_TOKEN` environment variable\n- Support `glab auth` if glab CLI is available\n- Add to `.env.sample`\n\n### Type mapping\n- GitLab MR response → `MergeRequest`\n- GitLab discussion/note → `ReviewComment`\n- Map GitLab-specific fields (iid vs id, discussions vs reviews)\n\n### Tests\n- Unit tests with mocked API responses\n- Test self-hosted URL construction\n- Test type mapping\n\n## Notes\n- This is the first non-GitHub provider. Its implementation will likely reveal gaps in the interface definitions — iterate on #113 as needed.\n- GitLab uses \"merge requests\" (MRs) instead of \"pull requests\" (PRs), and \"discussions\" instead of \"reviews\". The `CodeHost` interface already uses platform-neutral terminology.\n- Consider whether to require `glab` CLI (like we require `gh` for GitHub) or use direct HTTP calls. Direct HTTP is more portable.","state":"OPEN","author":"paysdoc","labels":["enhancement"],"createdAt":"2026-03-09T15:20:05Z","comments":[],"actionableComment":null}`

## Feature Description
Implement a GitLab-specific `CodeHost` provider that enables ADW to manage merge requests, fetch reviews, and interact with code hosted on GitLab instances (both gitlab.com and self-hosted). This is the first non-GitHub CodeHost implementation, validating that the provider abstraction defined in #113 works for a real second platform. The implementation uses direct HTTP calls via the GitLab REST API v4 (not the `glab` CLI) for maximum portability — following the same pattern established by the Jira provider's `JiraApiClient`.

## User Story
As a team hosting code on GitLab
I want ADW to create merge requests and handle code reviews through the GitLab API
So that I can use ADW without migrating to GitHub

## Problem Statement
ADW currently only supports GitHub as a code hosting platform. Teams using GitLab cannot use ADW's merge request creation, review fetching, or code management capabilities. While the provider interfaces (`CodeHost`, `MergeRequest`, `ReviewComment`) are already platform-agnostic, only a GitHub implementation exists.

## Solution Statement
Create a `GitLabCodeHost` class implementing the `CodeHost` interface, backed by a `GitLabApiClient` that makes direct HTTP calls to the GitLab REST API v4. This follows the established pattern: low-level API client → GitLab-specific types → pure mapper functions → CodeHost interface. Authentication uses `GITLAB_TOKEN` (personal access token). The provider is wired into `resolveCodeHost()` in `repoContext.ts` so that configuring `gitlab` in `.adw/providers.md` automatically selects it.

## Relevant Files
Use these files to implement the feature:

- `adws/providers/types.ts` — Contains the `CodeHost`, `MergeRequest`, `ReviewComment`, `CreateMROptions`, `RepoIdentifier`, `Platform` types that the GitLab provider must implement. `Platform.GitLab` already exists.
- `adws/providers/repoContext.ts` — Contains `resolveCodeHost()` which needs a `Platform.GitLab` case to return a `GitLabCodeHost`. Also contains `loadProviderConfig()` and `parseOwnerRepoFromUrl()` which may need GitLab URL support.
- `adws/providers/github/githubCodeHost.ts` — Reference implementation of `CodeHost` for GitHub. Follow the same class structure, constructor pattern, and factory function pattern.
- `adws/providers/github/mappers.ts` — Reference for pure mapper function patterns. GitLab mappers follow the same style.
- `adws/providers/github/__tests__/githubCodeHost.test.ts` — Reference for CodeHost test patterns (mock dependencies, test delegation and mapping).
- `adws/providers/github/__tests__/mappers.test.ts` — Reference for mapper test patterns (helper factories, field-by-field assertions).
- `adws/providers/jira/jiraApiClient.ts` — Reference for direct HTTP API client pattern using native `fetch()`. GitLab API client follows this exact structure.
- `adws/providers/jira/jiraTypes.ts` — Reference for platform-specific type definitions.
- `adws/providers/jira/__tests__/jiraApiClient.test.ts` — Reference for API client tests (mock `fetch`, test auth headers, URL construction, error handling).
- `adws/providers/index.ts` — Barrel export file that needs a GitLab export added.
- `adws/core/config.ts` — Where env var constants are defined. Add `GITLAB_TOKEN` and `GITLAB_INSTANCE_URL`.
- `adws/core/index.ts` — Barrel export for core module. Export new GitLab config constants.
- `.env.sample` — Add `GITLAB_TOKEN` and `GITLAB_INSTANCE_URL` env var documentation.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow strictly.

### New Files
- `adws/providers/gitlab/gitlabApiClient.ts` — Low-level GitLab REST API v4 client using native `fetch()`.
- `adws/providers/gitlab/gitlabTypes.ts` — GitLab-specific API response types.
- `adws/providers/gitlab/mappers.ts` — Pure mapper functions: GitLab types → platform-agnostic types.
- `adws/providers/gitlab/gitlabCodeHost.ts` — `GitLabCodeHost` class implementing `CodeHost` interface.
- `adws/providers/gitlab/index.ts` — Barrel exports for the GitLab provider module.
- `adws/providers/gitlab/__tests__/gitlabApiClient.test.ts` — Unit tests for the API client.
- `adws/providers/gitlab/__tests__/mappers.test.ts` — Unit tests for mapper functions.
- `adws/providers/gitlab/__tests__/gitlabCodeHost.test.ts` — Unit tests for the CodeHost implementation.

## Implementation Plan
### Phase 1: Foundation
Set up the GitLab provider module structure, define GitLab-specific types, configure environment variables, and create the low-level API client. This mirrors how the Jira provider was built: types first, then API client, then tests.

### Phase 2: Core Implementation
Implement the mapper functions that convert GitLab API responses to platform-agnostic types, then build the `GitLabCodeHost` class that implements the `CodeHost` interface by composing the API client and mappers. Test each layer.

### Phase 3: Integration
Wire the GitLab provider into `resolveCodeHost()` in `repoContext.ts`, add GitLab URL parsing support to `parseOwnerRepoFromUrl()`, update barrel exports, and add environment variable documentation. Run full test suite to verify zero regressions.

## Step by Step Tasks

### Step 1: Add GitLab environment variable constants
- In `adws/core/config.ts`, add `GITLAB_TOKEN` and `GITLAB_INSTANCE_URL` constants following the Jira pattern:
  ```typescript
  export const GITLAB_TOKEN = process.env.GITLAB_TOKEN || '';
  export const GITLAB_INSTANCE_URL = process.env.GITLAB_INSTANCE_URL || 'https://gitlab.com';
  ```
- In `adws/core/index.ts`, export these new constants from the core barrel file.
- In `.env.sample`, add documented GitLab configuration section:
  ```
  # GitLab Configuration (required only when using GitLab as the code host)
  # GitLab personal access token (needs api scope)
  # GITLAB_TOKEN="glpat-xxxxxxxxxxxxxxxxxxxx"
  # GitLab instance URL (default: https://gitlab.com, set for self-hosted)
  # GITLAB_INSTANCE_URL="https://gitlab.example.com"
  ```

### Step 2: Create GitLab-specific API response types
- Create `adws/providers/gitlab/gitlabTypes.ts` with readonly interfaces for GitLab REST API v4 responses:
  - `GitLabUser` — `readonly id: number; readonly username: string; readonly name: string;`
  - `GitLabProject` — `readonly id: number; readonly default_branch: string; readonly path_with_namespace: string;`
  - `GitLabMergeRequest` — `readonly iid: number; readonly title: string; readonly description: string; readonly source_branch: string; readonly target_branch: string; readonly web_url: string; readonly state: string;`
  - `GitLabNote` — `readonly id: number; readonly body: string; readonly author: GitLabUser; readonly created_at: string; readonly type: string | null; readonly position?: GitLabNotePosition;`
  - `GitLabNotePosition` — `readonly new_path?: string; readonly new_line?: number | null;`
  - `GitLabDiscussion` — `readonly id: string; readonly notes: readonly GitLabNote[];`
  - `GitLabCreateMRPayload` — `readonly source_branch: string; readonly target_branch: string; readonly title: string; readonly description: string;`
- All interfaces must be `readonly` per coding guidelines (immutability).

### Step 3: Create the GitLab API client
- Create `adws/providers/gitlab/gitlabApiClient.ts` following the `JiraApiClient` pattern:
  - Class `GitLabApiClient` with constructor taking `instanceUrl: string` and `token: string`.
  - Private `buildHeaders()` method returning `{ 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json', 'Accept': 'application/json' }`.
  - Private generic `request<T>(method, path, body?)` method that builds URL as `${instanceUrl}/api/v4/${path}`, handles errors, and parses JSON.
  - The project ID for API calls is the URL-encoded `owner/repo` path (e.g., `encodeURIComponent('acme/widgets')`).
  - Public methods:
    - `getProject(projectPath: string): Promise<GitLabProject>` — `GET /projects/:id`
    - `createMergeRequest(projectPath: string, payload: GitLabCreateMRPayload): Promise<GitLabMergeRequest>` — `POST /projects/:id/merge_requests`
    - `getMergeRequest(projectPath: string, mrIid: number): Promise<GitLabMergeRequest>` — `GET /projects/:id/merge_requests/:mr_iid`
    - `createNote(projectPath: string, mrIid: number, body: string): Promise<GitLabNote>` — `POST /projects/:id/merge_requests/:mr_iid/notes`
    - `listDiscussions(projectPath: string, mrIid: number): Promise<readonly GitLabDiscussion[]>` — `GET /projects/:id/merge_requests/:mr_iid/discussions`
    - `listMergeRequests(projectPath: string, state?: string): Promise<readonly GitLabMergeRequest[]>` — `GET /projects/:id/merge_requests?state=opened`
  - Log errors using `log` from `../../core`.

### Step 4: Create unit tests for the GitLab API client
- Create `adws/providers/gitlab/__tests__/gitlabApiClient.test.ts` following `jiraApiClient.test.ts` pattern:
  - Mock `globalThis.fetch` in `beforeEach`.
  - Test authentication header (`PRIVATE-TOKEN`).
  - Test URL construction: `https://gitlab.com/api/v4/projects/acme%2Fwidgets`.
  - Test trailing slash stripping from instance URL.
  - Test each public method returns parsed response.
  - Test error handling: 401, 404, 400, 429 (rate limit).
  - Test self-hosted URL construction (`https://gitlab.example.com/api/v4/...`).

### Step 5: Create pure mapper functions
- Create `adws/providers/gitlab/mappers.ts` with pure functions:
  - `mapGitLabMRToMergeRequest(mr: GitLabMergeRequest): MergeRequest` — Maps `iid` → `number`, `description` → `body`, `source_branch` → `sourceBranch`, `target_branch` → `targetBranch`, `web_url` → `url`. Extract `linkedIssueNumber` from description if it contains `#123` or `Closes #123` pattern (return undefined if not found).
  - `mapGitLabNoteToReviewComment(note: GitLabNote): ReviewComment` — Maps `id` → string id, `body`, `author.username` → `author`, `created_at` → `createdAt`, `position?.new_path` → `path`, `position?.new_line` → `line`.
  - `mapGitLabDiscussionsToReviewComments(discussions: readonly GitLabDiscussion[]): ReviewComment[]` — Flattens discussions into notes, filters to diff notes only (notes with `position`), and maps each using `mapGitLabNoteToReviewComment`. Include non-position notes as general review comments too (they represent MR-level review feedback).
  - `toProjectPath(repoId: RepoIdentifier): string` — Returns `${repoId.owner}/${repoId.repo}`.

### Step 6: Create unit tests for mapper functions
- Create `adws/providers/gitlab/__tests__/mappers.test.ts` following `github/mappers.test.ts` pattern:
  - Create `makeGitLabMR()` and `makeGitLabNote()` and `makeGitLabDiscussion()` helper factories with sensible defaults and `Partial` overrides.
  - Test `mapGitLabMRToMergeRequest`:
    - Maps all fields correctly with full data.
    - Maps `iid` to `number` (not `id`).
    - Extracts `linkedIssueNumber` from description containing `Closes #42`.
    - Returns undefined `linkedIssueNumber` when description has no issue reference.
    - Maps empty description as empty string.
  - Test `mapGitLabNoteToReviewComment`:
    - Maps all fields correctly.
    - Converts numeric id to string.
    - Maps note without position (path and line are undefined).
    - Maps note with position (path and line set).
  - Test `mapGitLabDiscussionsToReviewComments`:
    - Flattens multiple discussions into flat array.
    - Includes both positioned and non-positioned notes.
    - Returns empty array for no discussions.
  - Test `toProjectPath`:
    - Returns `owner/repo` format.

### Step 7: Implement GitLabCodeHost class
- Create `adws/providers/gitlab/gitlabCodeHost.ts` following `githubCodeHost.ts` pattern:
  - Class `GitLabCodeHost implements CodeHost` with:
    - Private `readonly repoId: RepoIdentifier`
    - Private `readonly client: GitLabApiClient`
    - Private `readonly projectPath: string` (computed from `toProjectPath(repoId)`)
    - Constructor takes `repoId: RepoIdentifier` and `client: GitLabApiClient`.
  - Method implementations:
    - `getRepoIdentifier()` → returns `this.repoId`
    - `getDefaultBranch()` → calls `this.client.getProject(this.projectPath)`, returns `project.default_branch`. Note: the interface is synchronous but GitLab API is async. Use `execSync` with `curl` or a synchronous approach matching how `GitHubCodeHost.getDefaultBranch()` delegates to `ghGetDefaultBranch()` which uses `execSync`. Use `Bun.spawnSync` or `execSync` to make a synchronous HTTP call, or use the VCS git approach: `execSync('git remote show origin')` to parse default branch — this is what the GitHub implementation does internally via `getDefaultBranch()` in `gitBranchOperations.ts`.
    - `fetchMergeRequest(mrNumber)` → calls `this.client.getMergeRequest(this.projectPath, mrNumber)`, maps with `mapGitLabMRToMergeRequest`.
    - `commentOnMergeRequest(mrNumber, body)` → calls `this.client.createNote(this.projectPath, mrNumber, body)`.
    - `fetchReviewComments(mrNumber)` → calls `this.client.listDiscussions(this.projectPath, mrNumber)`, maps with `mapGitLabDiscussionsToReviewComments`.
    - `listOpenMergeRequests()` → calls `this.client.listMergeRequests(this.projectPath, 'opened')`, maps each with `mapGitLabMRToMergeRequest`.
    - `createMergeRequest(options)` → calls `this.client.createMergeRequest(this.projectPath, { source_branch, target_branch, title, description })`, returns `mr.web_url`.
  - **Important**: The `CodeHost` interface methods are synchronous (no `Promise` return types). The GitHub implementation achieves this because it delegates to functions that use `execSync` internally. For the GitLab provider, the API client methods are async. To resolve this mismatch, the `GitLabCodeHost` methods that wrap async API calls should use `execSync`-based curl calls for the synchronous methods, or alternatively, the API client methods used by `GitLabCodeHost` can provide synchronous wrappers using `Bun.spawnSync` to call `curl`. **However**, looking at the GitHub implementation more carefully: `fetchPRDetails`, `commentOnPR`, `fetchPRReviewComments`, and `fetchPRList` all use `execSync` internally (they shell out to `gh` CLI). So the GitLab implementation should similarly use synchronous HTTP calls. Implement the `GitLabApiClient` methods as **synchronous** using `execSync` with `curl` (or refactor to use `Bun.spawnSync`), matching the GitHub provider's synchronous `execSync`-based approach. This keeps the interface contract honest.
  - **Revised approach for `GitLabApiClient`**: Make the client synchronous (like GitHub's `gh` CLI calls). Use `execSync` to run `curl` commands. This is the simplest approach that matches the existing pattern. The `request<T>` method becomes:
    ```typescript
    private request<T>(method: string, path: string, body?: unknown): T {
      const url = `${this.instanceUrl}/api/v4/${path}`;
      const args = ['curl', '-s', '-X', method, '-H', `PRIVATE-TOKEN: ${this.token}`, '-H', 'Content-Type: application/json'];
      if (body) args.push('-d', JSON.stringify(body));
      args.push(url);
      const result = execSync(args.join(' '), { encoding: 'utf-8' });
      return JSON.parse(result) as T;
    }
    ```
    But be careful with shell escaping — use `spawnSync` for safety instead of `execSync` with string concatenation.
  - Factory function: `createGitLabCodeHost(repoId: RepoIdentifier, instanceUrl?: string): CodeHost`
    - Validates `repoId` using `validateRepoIdentifier`.
    - Reads `GITLAB_TOKEN` from env (import from `../../core`). Throws if empty.
    - Uses `instanceUrl ?? GITLAB_INSTANCE_URL` (defaulting to `https://gitlab.com`).
    - Creates `GitLabApiClient` and `GitLabCodeHost`.

### Step 8: Create unit tests for GitLabCodeHost
- Create `adws/providers/gitlab/__tests__/gitlabCodeHost.test.ts` following `githubCodeHost.test.ts` pattern:
  - Mock `../gitlabApiClient` module.
  - Test `createGitLabCodeHost`:
    - Creates valid CodeHost instance.
    - Throws on empty owner / empty repo.
    - Throws when `GITLAB_TOKEN` is not set.
  - Test `GitLabCodeHost` methods:
    - `getRepoIdentifier()` returns bound repoId.
    - `getDefaultBranch()` delegates to client and returns `default_branch`.
    - `fetchMergeRequest()` calls client with project path and maps result.
    - `commentOnMergeRequest()` calls client createNote.
    - `fetchReviewComments()` calls client listDiscussions and maps result.
    - `listOpenMergeRequests()` calls client listMergeRequests and maps result.
    - `createMergeRequest()` calls client createMergeRequest with mapped payload and returns URL.
    - Error propagation from underlying client.

### Step 9: Create barrel exports
- Create `adws/providers/gitlab/index.ts`:
  ```typescript
  export { createGitLabCodeHost, GitLabCodeHost } from './gitlabCodeHost';
  export * from './mappers';
  ```
- Update `adws/providers/index.ts` to add: `export * from './gitlab';`

### Step 10: Wire GitLab into provider resolution
- In `adws/providers/repoContext.ts`:
  - Add import: `import { createGitLabCodeHost } from './gitlab/gitlabCodeHost';`
  - Update `resolveCodeHost()` to handle `Platform.GitLab`:
    ```typescript
    if (platform === Platform.GitLab) {
      return createGitLabCodeHost(repoId);
    }
    ```
  - Update `parseOwnerRepoFromUrl()` to support GitLab URLs:
    - HTTPS: `https://gitlab.com/owner/repo.git` or `https://gitlab.example.com/owner/repo.git`
    - SSH: `git@gitlab.com:owner/repo.git` or `git@gitlab.example.com:owner/repo.git`
    - The current function is hardcoded to `github.com`. Generalize it to match any host with `/owner/repo` pattern or `git@host:owner/repo` pattern.
  - Update `validateGitRemote()` if needed — currently it calls `parseOwnerRepoFromUrl` which only matches `github.com`. After generalizing the parser, this should work for GitLab URLs too.

### Step 11: Update repoContext tests
- In `adws/providers/__tests__/repoContext.test.ts`:
  - Add mock for `../gitlab/gitlabCodeHost`.
  - Add test: `resolveCodeHost returns GitLabCodeHost for Platform.GitLab`.
  - Add test: `parseOwnerRepoFromUrl handles GitLab HTTPS URLs`.
  - Add test: `parseOwnerRepoFromUrl handles GitLab SSH URLs`.
  - Add test: `createRepoContext uses GitLab code host when config says gitlab`.

### Step 12: Run validation commands
- Run `bun run lint` to check for code quality issues.
- Run `bunx tsc --noEmit` to type-check the entire project.
- Run `bunx tsc --noEmit -p adws/tsconfig.json` for additional type checks.
- Run `bun run test` to validate all tests pass with zero regressions.

## Testing Strategy
### Unit Tests
- **GitLab API Client** (`gitlabApiClient.test.ts`): Test authentication header construction, URL building (including self-hosted and encoded project paths), each API method's request/response, error handling (401, 404, 429), and trailing-slash normalization.
- **Mapper Functions** (`mappers.test.ts`): Test each mapper with full data, partial data, edge cases (empty strings, null values, missing optional fields). Test `iid` vs `id` mapping, discussion-to-flat-comments flattening, and linked issue number extraction from description.
- **GitLabCodeHost** (`gitlabCodeHost.test.ts`): Test factory validation, method delegation to API client, result mapping to platform-agnostic types, and error propagation.
- **RepoContext Integration** (`repoContext.test.ts`): Test that `resolveCodeHost(Platform.GitLab, repoId)` returns a `GitLabCodeHost`, and that `createRepoContext` with GitLab provider config works end-to-end.

### Edge Cases
- Self-hosted GitLab instance URL with trailing slash.
- Project paths with special characters that need URL encoding (e.g., subgroups: `group/subgroup/repo`).
- GitLab MR with no description (empty string).
- Discussions with no notes (empty array).
- Notes without position (general MR comments, not line-specific).
- MR description with no issue reference → `linkedIssueNumber` is undefined.
- MR description with multiple issue references → pick the first `Closes #N` or `#N` pattern.
- Empty `GITLAB_TOKEN` — factory should throw clear error.
- GitLab API returning error responses (401, 403, 404, 429, 500).

## Acceptance Criteria
- `GitLabCodeHost` class fully implements the `CodeHost` interface.
- All six `CodeHost` methods work correctly: `getDefaultBranch()`, `createMergeRequest()`, `fetchMergeRequest()`, `commentOnMergeRequest()`, `fetchReviewComments()`, `listOpenMergeRequests()`, `getRepoIdentifier()`.
- `createGitLabCodeHost(repoId, instanceUrl?)` factory function validates inputs and creates a working instance.
- `GITLAB_TOKEN` environment variable is used for authentication.
- Self-hosted GitLab instances are supported via `GITLAB_INSTANCE_URL` / `instanceUrl` parameter.
- GitLab API responses are correctly mapped to platform-agnostic types (`MergeRequest`, `ReviewComment`).
- `resolveCodeHost(Platform.GitLab, repoId)` returns a `GitLabCodeHost`.
- `parseOwnerRepoFromUrl` supports GitLab HTTPS and SSH URLs.
- All new code has unit tests with mocked dependencies.
- All existing tests continue to pass (zero regressions).
- `bun run lint`, `bunx tsc --noEmit`, and `bun run test` all pass cleanly.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type-check the entire project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Additional type checks for adws module
- `bun run test` — Run full test suite to validate zero regressions

## Notes
- **Synchronous interface constraint**: The `CodeHost` interface methods are synchronous (no `Promise` return types). The GitHub implementation achieves this by shelling out to `gh` CLI via `execSync`. The GitLab implementation should similarly use synchronous HTTP calls via `spawnSync`/`execSync` with `curl`, NOT async `fetch()`. This is a critical design constraint — the Jira API client uses async `fetch()` but Jira only implements `IssueTracker` (which has some async methods), not `CodeHost`.
- **Project path encoding**: GitLab REST API v4 uses URL-encoded `namespace/project` as the project identifier (e.g., `acme%2Fwidgets`). This must be encoded properly in all API URLs.
- **`iid` vs `id`**: GitLab uses `iid` (internal ID, scoped to project) for merge requests, which maps to the `number` field in `MergeRequest`. The global `id` is not user-facing.
- **No new libraries required** — uses native `fetch` / `execSync` + `curl` and Bun built-ins only.
- **Coding guidelines** (`guidelines/coding_guidelines.md`) must be followed strictly: readonly types, pure mapper functions, single responsibility, files under 300 lines, no `any`, strict TypeScript.
- This feature deliberately implements only `CodeHost`, not `IssueTracker` for GitLab. A future issue can add `GitLabIssueTracker` for teams using GitLab Issues. Teams can mix providers (e.g., GitLab CodeHost + GitHub Issues, or GitLab CodeHost + Jira IssueTracker).
