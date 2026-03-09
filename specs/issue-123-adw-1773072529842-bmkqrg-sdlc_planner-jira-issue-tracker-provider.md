# Feature: Jira IssueTracker Provider

## Metadata
issueNumber: `123`
adwId: `1773072529842-bmkqrg`
issueJson: `{"number":123,"title":"Implement Jira IssueTracker provider","body":"## Summary\nImplement the `IssueTracker` interface for Jira, enabling ADW to fetch issues, post comments, and transition statuses on Jira-managed projects. This validates the split between IssueTracker and CodeHost — a team can use Jira for work management with GitHub or GitLab for code hosting.\n\n## Dependencies\n- #113 — Provider interfaces must be defined\n- #121 — Provider configuration must support Jira selection and project key\n\n## User Story\nAs a team using Jira for project management, I want ADW to read issues from Jira and post workflow updates as Jira comments so that my workflow stays in Jira while code lives on GitHub/GitLab.\n\n## Acceptance Criteria\n\n### Create `adws/providers/jira/jiraIssueTracker.ts`\n- Implement `IssueTracker` interface\n- Constructor takes Jira instance URL + project key\n- Use Jira REST API v3 for:\n  - `fetchIssue()` — `GET /rest/api/3/issue/{issueIdOrKey}` → transform to `WorkItem`\n  - `commentOnIssue()` — `POST /rest/api/3/issue/{issueIdOrKey}/comment`\n  - `deleteComment()` — `DELETE /rest/api/3/issue/{issueIdOrKey}/comment/{commentId}`\n  - `closeIssue()` — Transition issue to \"Done\" status via `POST /rest/api/3/issue/{issueIdOrKey}/transitions`\n  - `getIssueState()` — Extract from issue status category\n  - `fetchComments()` — `GET /rest/api/3/issue/{issueIdOrKey}/comment`\n  - `moveToStatus()` — Find matching transition and execute it\n- Factory function: `createJiraIssueTracker(instanceUrl: string, projectKey: string): IssueTracker`\n\n### Issue number mapping\n- ADW uses numeric issue numbers internally. Jira uses keys like `PROJ-123`.\n- Map: issue number `123` → Jira key `{projectKey}-123`\n- Document this convention clearly\n\n### Authentication\n- Support `JIRA_API_TOKEN` + `JIRA_EMAIL` environment variables (Jira Cloud basic auth)\n- Support `JIRA_PAT` for Jira Data Center/Server\n- Add to `.env.sample`\n\n### Status transition mapping\n- Jira uses transition IDs, not status names directly\n- `moveToStatus()` must: fetch available transitions → match by name → execute transition\n- Handle case where target status is not a valid transition from current state\n\n### Type mapping\n- Jira issue → `WorkItem` (map summary→title, description→body, status.statusCategory→state, etc.)\n- Jira comment → `WorkItemComment`\n\n### Tests\n- Unit tests with mocked Jira API responses\n- Test issue number → Jira key mapping\n- Test status transition resolution\n- Test type mapping\n\n## Notes\n- Jira's comment format is Atlassian Document Format (ADF), not markdown. The provider will need to convert ADW's markdown comments to ADF for posting, and ADF to plain text for reading. Consider using a lightweight ADF builder.\n- Jira Cloud and Jira Server/Data Center have different auth mechanisms — support both.\n- This can be a separate npm package in the future if the ADW grows, but for now keep it in-tree.","state":"OPEN","author":"paysdoc","labels":["enhancement"],"createdAt":"2026-03-09T15:20:26Z","comments":[],"actionableComment":null}`

## Feature Description
Implement the `IssueTracker` interface (defined in `adws/providers/types.ts`) for Jira, enabling ADW to fetch issues, post comments, and transition statuses on Jira-managed projects. This is the first non-GitHub provider implementation and validates the platform-agnostic architecture introduced in #113. A team can use Jira for work management while keeping code on GitHub or GitLab.

The provider communicates with Jira via its REST API v3 using `fetch()` (available natively in Bun), handles the numeric issue number to Jira key mapping (`123` → `PROJ-123`), converts markdown comments to Atlassian Document Format (ADF) for posting, and resolves Jira's transition-based status system.

## User Story
As a team using Jira for project management
I want ADW to read issues from Jira and post workflow updates as Jira comments
So that my workflow stays in Jira while code lives on GitHub/GitLab

## Problem Statement
ADW currently only supports GitHub Issues as the issue tracker. Teams using Jira for project management cannot use ADW without migrating their issues to GitHub. The `IssueTracker` interface was defined in #113 but has no Jira implementation, leaving the platform-agnostic architecture unvalidated.

## Solution Statement
Create a Jira provider that implements the `IssueTracker` interface, using Jira REST API v3 for all operations. The provider maps ADW's numeric issue numbers to Jira keys (`{projectKey}-{number}`), converts between markdown and ADF for comments, and resolves Jira's transition-based status system by querying available transitions and matching by name. Authentication supports both Jira Cloud (email + API token) and Jira Data Center/Server (PAT).

## Relevant Files
Use these files to implement the feature:

- `adws/providers/types.ts` — Defines the `IssueTracker`, `WorkItem`, `WorkItemComment` interfaces that the Jira provider must implement. The contract to code against.
- `adws/providers/index.ts` — Re-exports from `types.ts`. Will need to also export Jira provider.
- `adws/providers/__tests__/types.test.ts` — Existing type contract tests. Shows the testing pattern for provider interfaces including mock implementations of `IssueTracker`.
- `adws/github/issueApi.ts` — Existing GitHub issue operations. Reference implementation showing how `fetchIssue`, `commentOnIssue`, `closeIssue`, `getIssueState`, `fetchComments`, and `deleteComment` are implemented for GitHub. Follow the same patterns (error handling, logging).
- `adws/github/projectBoardApi.ts` — GitHub Projects V2 status transitions. Reference for `moveToStatus` — shows fuzzy status name matching pattern and graceful error handling.
- `adws/github/__tests__/issueApi.test.ts` — Test patterns for issue API functions. Follow the same mocking and assertion patterns.
- `adws/core/config.ts` — Environment variable loading via `dotenv.config()`. Add Jira env vars here.
- `adws/core/index.ts` — Core module re-exports. Will export new Jira config constants.
- `adws/core/utils.ts` — Provides `log()` utility used throughout. Use for Jira provider logging.
- `.env.sample` — Environment variable documentation. Add Jira-specific variables.
- `guidelines/coding_guidelines.md` — Coding standards that must be followed strictly.
- `adws/README.md` — ADW documentation (conditional: operating in `adws/` directory).

### New Files
- `adws/providers/jira/jiraIssueTracker.ts` — Main Jira `IssueTracker` implementation with factory function.
- `adws/providers/jira/jiraApiClient.ts` — Low-level Jira REST API client using `fetch()`. Handles authentication, request building, error handling.
- `adws/providers/jira/jiraTypes.ts` — Jira-specific API response types (internal to the module).
- `adws/providers/jira/adfConverter.ts` — Lightweight markdown-to-ADF and ADF-to-plain-text converters.
- `adws/providers/jira/index.ts` — Barrel export for the Jira provider module.
- `adws/providers/jira/__tests__/jiraApiClient.test.ts` — Unit tests for the API client.
- `adws/providers/jira/__tests__/jiraIssueTracker.test.ts` — Unit tests for the IssueTracker implementation.
- `adws/providers/jira/__tests__/adfConverter.test.ts` — Unit tests for ADF conversion.

## Implementation Plan
### Phase 1: Foundation
Set up the Jira provider module structure, define Jira-specific types, implement the API client, and add environment variable configuration. Build the ADF converter for comment format interop.

### Phase 2: Core Implementation
Implement the `JiraIssueTracker` class that satisfies the `IssueTracker` interface. Each method maps to Jira REST API v3 endpoints. Handle the numeric issue number to Jira key mapping, status transition resolution, and type transformations.

### Phase 3: Integration
Export the Jira provider from the providers module, add a factory function, update `.env.sample` with Jira configuration, and ensure all tests pass with zero regressions.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Add Jira environment variables to config
- Read `adws/core/config.ts` and add exports for Jira configuration:
  - `JIRA_BASE_URL` — Jira instance URL (e.g., `https://your-domain.atlassian.net`)
  - `JIRA_EMAIL` — Email for Jira Cloud basic auth
  - `JIRA_API_TOKEN` — API token for Jira Cloud
  - `JIRA_PAT` — Personal access token for Jira Data Center/Server
  - `JIRA_PROJECT_KEY` — Default project key (e.g., `PROJ`)
- Export these constants from `adws/core/index.ts`
- Update `.env.sample` with commented-out Jira variables and documentation

### Step 2: Create Jira-specific types
- Create `adws/providers/jira/jiraTypes.ts` with TypeScript interfaces for Jira REST API v3 responses:
  - `JiraIssueResponse` — `{ id, key, fields: { summary, description, status, creator, comment, labels, ... } }`
  - `JiraCommentResponse` — `{ id, author: { displayName, emailAddress }, body (ADF object), created }`
  - `JiraTransition` — `{ id, name, to: { name, statusCategory } }`
  - `JiraStatusCategory` — Maps to ADW states: `new` → `OPEN`, `indeterminate` → `IN_PROGRESS`, `done` → `CLOSED`
  - `JiraUser` — `{ displayName, emailAddress, accountId }`
  - `JiraApiError` — Structured error type for API failures
- Follow existing pattern: use `interface` for object shapes, `readonly` where appropriate

### Step 3: Create the ADF converter
- Create `adws/providers/jira/adfConverter.ts` with two functions:
  - `markdownToAdf(markdown: string): object` — Converts markdown text to a minimal ADF document structure. Support:
    - Paragraphs (text nodes)
    - Code blocks → ADF `codeBlock` nodes
    - Bold/italic → ADF `marks`
    - Headings → ADF `heading` nodes
    - Bullet lists → ADF `bulletList` nodes
    - Links → ADF `link` marks
  - `adfToPlainText(adf: unknown): string` — Extracts plain text from an ADF document, recursively walking `content` arrays and extracting `text` nodes. Falls back to empty string for unknown structures.
- Keep it lightweight — no external ADF library needed. Build the JSON structure directly.
- Create `adws/providers/jira/__tests__/adfConverter.test.ts` with tests for:
  - Simple paragraph conversion (markdown → ADF)
  - Code block conversion
  - Bold/italic marks
  - ADF → plain text extraction
  - Edge cases: empty string, null/undefined input, deeply nested ADF

### Step 4: Create the Jira API client
- Create `adws/providers/jira/jiraApiClient.ts` with a class `JiraApiClient`:
  - Constructor takes `instanceUrl: string` and auth credentials (either `{ email: string, apiToken: string }` for Cloud or `{ pat: string }` for Data Center)
  - Private method `buildHeaders(): Record<string, string>` — builds auth headers:
    - Cloud: `Authorization: Basic ${base64(email:apiToken)}`, `Content-Type: application/json`
    - Data Center: `Authorization: Bearer ${pat}`, `Content-Type: application/json`
  - Private method `request<T>(method: string, path: string, body?: unknown): Promise<T>` — generic HTTP request wrapper using native `fetch()`:
    - Builds full URL: `${instanceUrl}/rest/api/3/${path}`
    - Handles HTTP errors: 401, 403, 404, 400, 429 (rate limit)
    - Logs errors using `log()` from `adws/core`
    - Parses JSON response
  - Public methods:
    - `getIssue(issueKey: string): Promise<JiraIssueResponse>` — `GET /rest/api/3/issue/{issueKey}?expand=renderedFields`
    - `addComment(issueKey: string, adfBody: object): Promise<JiraCommentResponse>` — `POST /rest/api/3/issue/{issueKey}/comment`
    - `deleteComment(issueKey: string, commentId: string): Promise<void>` — `DELETE /rest/api/3/issue/{issueKey}/comment/{commentId}`
    - `getComments(issueKey: string): Promise<JiraCommentResponse[]>` — `GET /rest/api/3/issue/{issueKey}/comment`
    - `getTransitions(issueKey: string): Promise<JiraTransition[]>` — `GET /rest/api/3/issue/{issueKey}/transitions`
    - `doTransition(issueKey: string, transitionId: string): Promise<void>` — `POST /rest/api/3/issue/{issueKey}/transitions`
- Create `adws/providers/jira/__tests__/jiraApiClient.test.ts` with tests:
  - Mock `global.fetch` using `vi.fn()`
  - Test Cloud auth header construction (base64 encoding)
  - Test Data Center/Server auth header construction (Bearer token)
  - Test each API method with realistic mock responses
  - Test error handling: 401 (unauthorized), 404 (issue not found), 400 (bad request), 429 (rate limited)
  - Test URL construction from instance URL and path

### Step 5: Implement JiraIssueTracker
- Create `adws/providers/jira/jiraIssueTracker.ts` implementing `IssueTracker` from `adws/providers/types.ts`:
  - Constructor takes `client: JiraApiClient` and `projectKey: string`
  - Private method `toJiraKey(issueNumber: number): string` — returns `${projectKey}-${issueNumber}`
  - Private method `mapStatusCategory(statusCategory: string): string` — maps Jira status categories:
    - `"new"` → `"OPEN"`
    - `"indeterminate"` → `"IN_PROGRESS"`
    - `"done"` → `"CLOSED"`
    - Default → the raw status name uppercased
  - Private method `toWorkItem(jiraIssue: JiraIssueResponse): WorkItem` — transforms Jira response:
    - `id` → `jiraIssue.key` (e.g., `"PROJ-123"`)
    - `number` → parse numeric suffix from key (e.g., `123`)
    - `title` → `jiraIssue.fields.summary`
    - `body` → `adfToPlainText(jiraIssue.fields.description)` (description is ADF in API v3)
    - `state` → `mapStatusCategory(jiraIssue.fields.status.statusCategory.key)`
    - `author` → `jiraIssue.fields.creator.displayName`
    - `labels` → `jiraIssue.fields.labels` (string array in Jira)
    - `comments` → transform each via `toWorkItemComment()`
  - Private method `toWorkItemComment(jiraComment: JiraCommentResponse): WorkItemComment`:
    - `id` → `jiraComment.id`
    - `body` → `adfToPlainText(jiraComment.body)`
    - `author` → `jiraComment.author.displayName`
    - `createdAt` → `jiraComment.created` (already ISO 8601)
  - Interface methods:
    - `fetchIssue(issueNumber)` — calls `client.getIssue(toJiraKey(issueNumber))`, transforms to `WorkItem`
    - `commentOnIssue(issueNumber, body)` — converts `body` to ADF via `markdownToAdf()`, calls `client.addComment()`
    - `deleteComment(commentId)` — needs the issue key; store a comment→issue mapping or accept `issueKey:commentId` format. Simplest: require the caller to pass the full comment ID as returned by `fetchComments`. Call `client.deleteComment()` with a known issue key from context. **Decision**: Accept `commentId` as `"PROJ-123:commentId"` format or just the Jira comment ID. Since the interface takes `string`, and the existing GitHub impl passes the comment ID that the REST API returns, we'll store a mapping internally or require the issue key to be embedded. **Final approach**: Use just the Jira comment ID. For `deleteComment`, fetch the comment's issue key via a reverse lookup, or require callers to have fetched comments first. Simplest: make `deleteComment` a no-op that logs a warning since Jira API requires the issue key. **Better**: Store a `Map<string, string>` of `commentId → issueKey` populated by `fetchComments()` and `commentOnIssue()`.
    - `closeIssue(issueNumber, comment?)` — optionally post comment, then find "Done" transition and execute it. Return `true` on success, `false` if already done or no valid transition.
    - `getIssueState(issueNumber)` — fetch issue and return mapped status category
    - `fetchComments(issueNumber)` — fetch comments via `client.getComments()`, transform each
    - `moveToStatus(issueNumber, status)` — fetch transitions, fuzzy-match target status name (same pattern as `projectBoardApi.ts`), execute transition. Log warning if no match.
- Factory function: `createJiraIssueTracker(instanceUrl: string, projectKey: string): IssueTracker`
  - Reads `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PAT` from config
  - Creates `JiraApiClient` with appropriate auth
  - Returns `new JiraIssueTracker(client, projectKey)`

### Step 6: Write JiraIssueTracker unit tests
- Create `adws/providers/jira/__tests__/jiraIssueTracker.test.ts`:
  - Mock `JiraApiClient` methods using `vi.fn()`
  - Test `fetchIssue`:
    - Verify issue number → Jira key mapping (e.g., `42` → `PROJ-42`)
    - Verify `WorkItem` transformation (title, body, state, author, labels, comments)
    - Verify status category mapping (`"new"` → `"OPEN"`, `"done"` → `"CLOSED"`)
  - Test `commentOnIssue`:
    - Verify markdown → ADF conversion is called
    - Verify API client receives ADF body
  - Test `deleteComment`:
    - Verify comment ID is passed correctly
    - Verify internal comment-to-issue mapping works
  - Test `closeIssue`:
    - Verify "Done" transition is found and executed
    - Verify comment is posted before closing if provided
    - Verify returns `false` when issue is already in `done` category
    - Verify returns `false` when no "Done" transition exists
  - Test `getIssueState`:
    - Verify returns mapped status category string
  - Test `fetchComments`:
    - Verify Jira comments → `WorkItemComment[]` transformation
    - Verify ADF body → plain text conversion
  - Test `moveToStatus`:
    - Verify fuzzy matching: `"Review"` matches `"In Review"` transition
    - Verify exact matching takes priority over fuzzy
    - Verify logs warning when no matching transition found
    - Verify skips when issue already in target status
  - Test `createJiraIssueTracker` factory:
    - Verify Cloud auth when `JIRA_EMAIL` + `JIRA_API_TOKEN` are set
    - Verify Data Center auth when `JIRA_PAT` is set
    - Verify throws when no auth credentials found

### Step 7: Create barrel export and update providers index
- Create `adws/providers/jira/index.ts` — exports `JiraIssueTracker`, `createJiraIssueTracker`, and types
- Update `adws/providers/index.ts` to also export from `./jira`

### Step 8: Run validation commands
- Run `bun run lint` to check for code quality issues
- Run `bunx tsc --noEmit` to verify no type errors in the main project
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify no type errors in the ADW scripts
- Run `bun run test` to validate the feature works with zero regressions
- Run `bun run build` to verify no build errors

## Testing Strategy
### Unit Tests
- **ADF Converter** (`adfConverter.test.ts`): Test markdown → ADF conversion for paragraphs, code blocks, bold/italic, headings, lists, and links. Test ADF → plain text extraction for nested structures, empty input, and malformed ADF.
- **Jira API Client** (`jiraApiClient.test.ts`): Mock `global.fetch` to test each API method (getIssue, addComment, deleteComment, getComments, getTransitions, doTransition). Test both auth modes (Cloud basic auth, Data Center bearer token). Test HTTP error handling (401, 403, 404, 400, 429).
- **JiraIssueTracker** (`jiraIssueTracker.test.ts`): Mock `JiraApiClient` to test all 7 `IssueTracker` interface methods. Test issue number → Jira key mapping. Test status category mapping. Test transition resolution with fuzzy matching. Test factory function with different auth configurations.

### Edge Cases
- Issue number `0` — should produce key `PROJ-0` (unusual but valid)
- Empty description (null in Jira) — should map to empty string in `WorkItem.body`
- No comments on issue — should return empty array
- Jira description in ADF with no text nodes — should return empty string
- Status with no valid transitions available — `moveToStatus` should log warning and return without error
- Multiple transitions matching the target status name — should use the first exact match, then first fuzzy match
- Jira API returning paginated comments — handle pagination for large comment sets
- Both `JIRA_API_TOKEN`+`JIRA_EMAIL` and `JIRA_PAT` set — prefer Cloud auth (token+email)
- Network timeout or unreachable Jira instance — should throw with descriptive error
- Rate limiting (429 response) — should log and throw with retry-after info if available

## Acceptance Criteria
- `JiraIssueTracker` class fully implements the `IssueTracker` interface from `adws/providers/types.ts`
- All 7 interface methods (`fetchIssue`, `commentOnIssue`, `deleteComment`, `closeIssue`, `getIssueState`, `fetchComments`, `moveToStatus`) work correctly against mocked Jira API responses
- Issue number `123` maps to Jira key `{projectKey}-123` and back
- Jira status categories (`new`, `indeterminate`, `done`) map to ADW states (`OPEN`, `IN_PROGRESS`, `CLOSED`)
- Markdown comments are converted to ADF for posting to Jira
- ADF descriptions and comments are converted to plain text for `WorkItem.body` and `WorkItemComment.body`
- Both Jira Cloud (email + API token) and Jira Data Center/Server (PAT) authentication are supported
- `moveToStatus` uses fuzzy matching (same pattern as `projectBoardApi.ts`) to find and execute transitions
- Factory function `createJiraIssueTracker()` creates a properly configured instance from environment variables
- `.env.sample` documents all Jira-related environment variables
- All existing tests continue to pass (zero regressions)
- TypeScript strict mode compilation passes for both main and ADW tsconfigs
- All new code follows `guidelines/coding_guidelines.md` (immutability, type safety, pure functions, modularity)

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type check the main project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check the ADW scripts
- `bun run test` — Run all tests to validate the feature works with zero regressions
- `bun run build` — Build the application to verify no build errors

## Notes
- **ADF Handling**: Jira REST API v3 uses Atlassian Document Format (ADF) for issue descriptions and comments. The `adfConverter.ts` module provides lightweight conversion. For the initial implementation, focus on the most common markdown elements (paragraphs, code blocks, bold, italic, headings, lists, links). More complex markdown features can be added later as needed.
- **No external dependencies required**: Use Bun's native `fetch()` for HTTP requests and `btoa()` for base64 encoding. No need for `node-fetch` or Jira client libraries.
- **Coding guidelines**: Strictly follow `guidelines/coding_guidelines.md` — immutability, type safety, pure functions, modularity, files under 300 lines.
- **Delete comment limitation**: The `IssueTracker.deleteComment(commentId: string)` interface only takes a comment ID, but Jira's API requires both the issue key and comment ID. The implementation maintains an internal `Map<string, string>` of commentId → issueKey, populated by `fetchComments()` and `commentOnIssue()`. If the mapping is missing, log a warning.
- **Future considerations**: This provider can be extracted into a separate package if ADW grows. The `RepoContext` system from #113 already supports swapping providers at runtime.
