# Jira IssueTracker Provider

**ADW ID:** 1773072529842-bmkqrg
**Date:** 2026-03-09
**Specification:** specs/issue-123-adw-1773072529842-bmkqrg-sdlc_planner-jira-issue-tracker-provider.md

## Overview

This feature implements the `IssueTracker` interface for Jira, enabling ADW to fetch issues, post comments, and transition statuses on Jira-managed projects. It validates the platform-agnostic provider architecture by allowing teams to use Jira for work management while hosting code on GitHub or GitLab. The provider communicates with Jira REST API v3, handles issue number to Jira key mapping, converts markdown to Atlassian Document Format (ADF), and resolves Jira's transition-based status system.

## What Was Built

- `JiraIssueTracker` class — full implementation of the `IssueTracker` interface
- `JiraApiClient` class — low-level Jira REST API v3 HTTP client
- `adfConverter` module — lightweight markdown ↔ ADF conversion without external dependencies
- Jira-specific TypeScript types (`jiraTypes.ts`)
- `createJiraIssueTracker` factory function for environment-variable-driven instantiation
- Environment variable support for both Jira Cloud and Jira Data Center/Server auth
- 778 lines of unit tests covering all provider methods, API client, and ADF converter

## Technical Implementation

### Files Modified

- `adws/providers/jira/jiraIssueTracker.ts`: Main `IssueTracker` implementation (225 lines) — maps ADW interface to Jira REST API v3, handles issue number → Jira key mapping, status category mapping, and internal comment-to-issue tracking
- `adws/providers/jira/jiraApiClient.ts`: HTTP client (106 lines) — wraps native `fetch()` for all Jira API operations with dual auth support (Cloud basic auth, Data Center bearer token)
- `adws/providers/jira/adfConverter.ts`: Format converter (184 lines) — converts markdown paragraphs, headings, code blocks, bold/italic, links, and bullet lists to ADF; recursively extracts plain text from ADF
- `adws/providers/jira/jiraTypes.ts`: Jira API response types (71 lines) — `JiraIssueResponse`, `JiraCommentResponse`, `JiraTransition`, `JiraUser`, `JiraStatusCategory`
- `adws/providers/jira/index.ts`: Barrel export for the Jira provider module
- `adws/providers/index.ts`: Updated to re-export from `./jira`
- `adws/core/config.ts`: Added `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PAT`, `JIRA_PROJECT_KEY` exports
- `adws/core/index.ts`: Updated to re-export new Jira config constants
- `.env.sample`: Documented all Jira environment variables with comments
- `adws/providers/jira/__tests__/jiraIssueTracker.test.ts`: 373 lines of unit tests
- `adws/providers/jira/__tests__/jiraApiClient.test.ts`: 205 lines of unit tests
- `adws/providers/jira/__tests__/adfConverter.test.ts`: 200 lines of unit tests

### Key Changes

- **Issue number mapping**: ADW numeric issue numbers are mapped to Jira keys via `toJiraKey(n) → "${projectKey}-${n}"`. The reverse mapping parses the numeric suffix from the Jira key string.
- **Status category mapping**: Jira's `statusCategory.key` values (`new`, `indeterminate`, `done`) map to ADW states (`OPEN`, `IN_PROGRESS`, `CLOSED`). Unknown categories fall back to the uppercased raw value.
- **Comment format interop**: Comments posted to Jira are converted from markdown to ADF using `markdownToAdf()`. Issue descriptions and comments fetched from Jira are converted to plain text via `adfToPlainText()` for ADW consumers.
- **Delete comment workaround**: Jira's delete-comment API requires both the issue key and comment ID. The `JiraIssueTracker` maintains an internal `Map<commentId, issueKey>` populated during `fetchComments()` and `commentOnIssue()` to satisfy the `IssueTracker.deleteComment(commentId)` interface.
- **Transition-based status changes**: `moveToStatus()` fetches available transitions from Jira, fuzzy-matches the target status name (exact first, then substring), and executes the matched transition. Logs a warning if no match is found.

## How to Use

1. Copy `.env.sample` to `.env` and set the Jira configuration variables:

```env
# Jira Cloud
JIRA_BASE_URL=https://your-domain.atlassian.net
JIRA_EMAIL=you@example.com
JIRA_API_TOKEN=your-api-token
JIRA_PROJECT_KEY=PROJ

# OR Jira Data Center/Server
JIRA_BASE_URL=https://jira.your-company.com
JIRA_PAT=your-personal-access-token
JIRA_PROJECT_KEY=PROJ
```

2. Instantiate the provider using the factory function:

```typescript
import { createJiraIssueTracker } from 'adws/providers/jira';

const tracker = createJiraIssueTracker(
  process.env.JIRA_BASE_URL!,
  process.env.JIRA_PROJECT_KEY!
);
```

3. Use the `IssueTracker` interface methods:

```typescript
// Fetch an issue (Jira key: PROJ-42)
const issue = await tracker.fetchIssue(42);

// Post a markdown comment
tracker.commentOnIssue(42, '**Done!** See PR #99.');

// Move to a different status
await tracker.moveToStatus(42, 'In Review');

// Close the issue
await tracker.closeIssue(42, 'Closing as complete.');
```

## Configuration

| Environment Variable | Description | Auth Mode |
|---|---|---|
| `JIRA_BASE_URL` | Jira instance URL (e.g., `https://your-domain.atlassian.net`) | Both |
| `JIRA_EMAIL` | User email for basic auth | Jira Cloud |
| `JIRA_API_TOKEN` | API token from Atlassian account | Jira Cloud |
| `JIRA_PAT` | Personal Access Token | Jira Data Center/Server |
| `JIRA_PROJECT_KEY` | Default project key (e.g., `PROJ`) | Both |

When both Cloud and Data Center credentials are present, Cloud auth (email + API token) takes priority.

## Testing

Run unit tests for all Jira provider components:

```bash
bun run test adws/providers/jira
```

Individual test suites:
- `adws/providers/jira/__tests__/adfConverter.test.ts` — ADF conversion
- `adws/providers/jira/__tests__/jiraApiClient.test.ts` — HTTP client with mocked `fetch`
- `adws/providers/jira/__tests__/jiraIssueTracker.test.ts` — Full `IssueTracker` interface

## Notes

- **No external dependencies**: Uses Bun's native `fetch()` for HTTP and `btoa()` for base64 encoding. No Jira client libraries required.
- **ADF support scope**: The `adfConverter` handles the most common markdown elements. Complex markdown (tables, nested lists, HTML) may not convert perfectly; extend `adfConverter.ts` as needed.
- **Delete comment limitation**: `deleteComment` requires that `fetchComments` or `commentOnIssue` has been called first for the same issue to populate the internal `commentId → issueKey` map. Calling `deleteComment` with an unknown comment ID will log a warning and skip the operation.
- **Pagination**: The current implementation fetches comments without explicit pagination handling. Jira defaults to returning up to 1048576 comments per request; this may need adjustment for very large issues.
- **Future**: This provider can be extracted into a separate npm package if ADW grows. The `RepoContext` system already supports swapping providers at runtime.
