# Feature: Move Issue Through Project Boards as Implementation Progresses

## Metadata
issueNumber: `58`
adwId: `adw-unknown`
issueJson: `{}`

## Feature Description
Some target repositories are linked to a GitHub Project (Projects V2) that tracks issues through workflow statuses. When the ADW runs, it should automatically move the linked issue through the project board as the workflow progresses — setting the status to "In Progress" before the Plan Phase begins, and "Review" after the PR Phase completes. The "Done" status on merge is already implemented.

This automates project board management so that stakeholders always see the accurate lifecycle state of each issue without any manual intervention.

## User Story
As a project manager using GitHub Projects
I want the issue status to be updated automatically as the ADW workflow progresses
So that the project board always reflects the current state of implementation without manual updates

## Problem Statement
When a target repository issue is linked to a GitHub Project, the project board status is not automatically updated by the ADW during the Plan Phase (should become "In Progress") or after the PR Phase (should become "Review"). Only the "Done" status on merge is currently handled. This leaves the project board out of sync with the actual workflow state.

## Solution Statement
Create a new `adws/github/projectBoardApi.ts` module that uses the GitHub GraphQL API (via `gh api graphql`) to find an issue's linked project items and update the project status field. Integrate calls to this module into `planPhase.ts` (before the plan agent runs) and `prPhase.ts` (after the PR is created). Errors must be caught and logged without disrupting the main workflow.

## Relevant Files

- `adws/phases/planPhase.ts` — Plan phase implementation; needs a status update to "In Progress" added **before** the plan agent runs (line ~63, just before `postWorkflowComment(issueNumber, 'plan_building', ...)`).
- `adws/phases/prPhase.ts` — PR phase implementation; needs a status update to "Review" added **after** `postWorkflowComment(issueNumber, 'pr_created', ...)` (line ~62).
- `adws/github/index.ts` — GitHub module index; needs to export the new `updateIssueProjectStatus` function.
- `adws/triggers/webhookHandlers.ts` — Reference for how "Done" is handled (currently via `closeIssue`), confirms merge case is already implemented.
- `adws/github/issueApi.ts` — Reference for the existing `gh` CLI and GraphQL usage patterns.
- `adws/github/githubApi.ts` — Reference for `RepoInfo` type and module re-exports.
- `adws/core/utils.ts` — Contains the `log` utility used across all modules.
- `guidelines/coding_guidelines.md` — Must be followed during implementation.

### New Files
- `adws/github/projectBoardApi.ts` — New module with functions to query and update GitHub Projects V2 status fields for issues linked to projects.
- `adws/__tests__/projectBoardApi.test.ts` — Unit tests for the new `projectBoardApi` module.

## Implementation Plan

### Phase 1: Foundation
Build the `projectBoardApi.ts` module with GraphQL queries and mutations to interact with GitHub Projects V2. This module is self-contained and fully testable before integration into the phases.

### Phase 2: Core Implementation
Integrate calls to `updateIssueProjectStatus` into `planPhase.ts` (before plan runs → "In Progress") and `prPhase.ts` (after PR created → "Review"). Errors must be non-fatal.

### Phase 3: Integration
Export the new function from `adws/github/index.ts` and write unit tests that verify both the API module logic and the phase integrations.

## Step by Step Tasks

### Step 1: Create `adws/github/projectBoardApi.ts`
- Create the file with the following exported functions:
  - `getIssueProjectItems(issueNumber: number, repoInfo: RepoInfo): ProjectItemInfo[]` — uses `gh api graphql` to fetch all project items linked to the issue, including project ID, item ID, current status option name, the Status field ID, and all available status options (id + name).
  - `updateIssueProjectStatus(issueNumber: number, targetStatus: string, repoInfo: RepoInfo): void` — calls `getIssueProjectItems`, finds projects where the target status option exists, checks current status is not already equal to target, and calls the GraphQL mutation to update the field value. Silently skips if no project found, if the target status option doesn't exist, or if already at target status.
- Define these internal types (not exported):
  - `StatusOption { id: string; name: string }`
  - `ProjectItemInfo { projectId: string; itemId: string; statusFieldId: string | null; currentStatusName: string | null; availableOptions: StatusOption[] }`
- GraphQL query to fetch project items:
  ```graphql
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        projectItems(first: 10) {
          nodes {
            id
            project { id }
            fieldValues(first: 20) {
              nodes {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  name
                  optionId
                  field { ... on ProjectV2SingleSelectField { id name options { id name } } }
                }
              }
            }
          }
        }
      }
    }
  }
  ```
- GraphQL mutation to update status:
  ```graphql
  mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
    updateProjectV2ItemFieldValue(
      input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { singleSelectOptionId: $optionId } }
    ) { projectV2Item { id } }
  }
  ```
- Wrap all `execSync` calls in try-catch; log errors with `log(..., 'error')` and return gracefully
- Use `log` from `../core/utils` and `RepoInfo` from `./githubApi`
- Use `execSync` from `child_process` with `{ encoding: 'utf-8' }`

### Step 2: Export from `adws/github/index.ts`
- Add `updateIssueProjectStatus` to the exports from `./projectBoardApi`
- Keep export statement near other GitHub API exports

### Step 3: Integrate into `adws/phases/planPhase.ts`
- Import `updateIssueProjectStatus` from `../github`
- Add a call to `updateIssueProjectStatus(issueNumber, 'In Progress', repoInfo)` **before** the plan agent runs — specifically just before the `postWorkflowComment(issueNumber, 'plan_building', ...)` call
- Wrap in try-catch: log error but do not rethrow (non-fatal)
- Only call this once, not inside the `shouldExecuteStage` guard for plan creation (it should always attempt on workflow start for a fresh run)
- Actually: place it inside the `if (shouldExecuteStage('plan_created', recoveryState) && !planFileExists(...))` block, just before posting the `plan_building` comment, so it's skipped on recovery

### Step 4: Integrate into `adws/phases/prPhase.ts`
- Import `updateIssueProjectStatus` from `../github`
- Add a call to `updateIssueProjectStatus(issueNumber, 'Review', repoInfo)` **after** `postWorkflowComment(issueNumber, 'pr_created', ...)` — within the `if (shouldExecuteStage('pr_created', recoveryState))` block
- Wrap in try-catch: log error but do not rethrow (non-fatal)

### Step 5: Write unit tests in `adws/__tests__/projectBoardApi.test.ts`
- Mock `child_process` (`execSync`) and `../core/utils` (`log`)
- Test `getIssueProjectItems`:
  - Returns project item info with correct ids, status field id, current status, and available options
  - Returns empty array when issue has no project items
  - Returns empty array (and logs error) when GraphQL call fails
- Test `updateIssueProjectStatus`:
  - Calls mutation when target status exists and is different from current
  - Does nothing when target status option does not exist in the project
  - Does nothing when current status already equals target status
  - Does nothing when issue has no project items
  - Handles mutation failure gracefully (logs error, does not throw)
- Follow the vitest pattern from `adws/__tests__/webhookHandlers.test.ts`: `vi.mock` at top, import after mocks, `beforeEach(() => vi.clearAllMocks())`

### Step 6: Run Validation Commands
- Run the full validation suite to confirm zero regressions

## Testing Strategy

### Unit Tests
- `projectBoardApi.test.ts` covers all exported functions with mocked `execSync`
- Tests verify: success path, already-at-target-status noop, missing status option noop, no project items noop, GraphQL error recovery

### Edge Cases
- Issue has no linked project items → do nothing
- Project has no "Status" field → do nothing (no statusFieldId)
- Target status name doesn't exist in the project's status options → do nothing
- Issue is already in the target status → do nothing
- GraphQL query fails (network error, auth error) → log error, don't throw
- GraphQL mutation fails → log error, don't throw
- Issue linked to multiple projects → update status in each project that has the target option

## Acceptance Criteria
- Before the plan agent runs for a fresh issue, if the issue is linked to a GitHub Project and that project has an "In Progress" status option, the issue's project status is set to "In Progress"
- After the PR is created, if the issue is linked to a GitHub Project and that project has a "Review" status option, the issue's project status is set to "Review"
- If the target status option does not exist in the project, no changes are made and no errors are thrown
- If the issue is already at the target status, no update is made
- All errors from the project board API are caught and logged; they do not abort the workflow
- All existing tests continue to pass
- New tests cover the `projectBoardApi` module with at least 8 test cases

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

```bash
npm run lint
```

```bash
npx tsc --noEmit
```

```bash
npx tsc --noEmit -p adws/tsconfig.json
```

```bash
npm test
```

## Notes
- The GitHub Projects V2 GraphQL API requires the `project` scope in the GitHub PAT. The existing `GITHUB_PAT` or `gh auth` token must have this scope for project status updates to work in production.
- The `repoInfo` parameter (available in `WorkflowConfig` as `config.repoInfo`) is already passed through both `planPhase.ts` and `prPhase.ts` via the `config` destructure, so no interface changes are needed.
- The feature is designed to be non-fatal: any failure in project board updates must be caught and logged without aborting the workflow.
- The "Merge → Done" case is already implemented in `webhookHandlers.ts` (via `closeIssue`), and is explicitly excluded from this implementation per the issue spec.
- Status name comparison should be case-sensitive to match exactly what's configured in the GitHub Project.
- `adws/phases/planPhase.ts` has a recovery guard (`shouldExecuteStage`). The "In Progress" update is placed inside the `plan_created` stage guard so it is naturally skipped on recovery (the plan already exists).
