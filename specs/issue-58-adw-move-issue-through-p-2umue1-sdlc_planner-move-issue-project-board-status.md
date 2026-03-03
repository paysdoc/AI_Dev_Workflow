# Feature: Move Issue Through Project Board Statuses

## Metadata
issueNumber: `58`
adwId: `move-issue-through-p-2umue1`
issueJson: `{"number":58,"title":"Move issue through project boards as implementation progresses","body":"## Summary\nIssues that are linked to a project should get their status changed as the ADW progresses through the workflow.\n\n## Details\nSome target repositories are linked to a github project that has a number of statuses. As the ADW progresses through the workflow, the status needs to be updated.\n\n| workflow phase | moment | status | status type | implementation status | \n|:-------|:--------|:-------|:-------|:------|\n| Plan Phase | before | In Progress | default | not implemented | \n| PR Phase | after | Review | custom | not implemented | \n| Merge | after | Done | default | implemented | \n\nMore info about the table:\n*workflow phases*: The `Plan Phase`  and `PR Phase` are phases as defined in the adws phases (planPhase.tx and prPhase.tx respectively. `Merge`, however is a github event that gets picked up by the  `trigger_webhook`. This has to therefoe be handled by the webhook. \n*moment*: denotes whether to move the issue before or after the phase has been executed\n*status*: possible github statuses are `Todo`, `In Progress`, `Review` or `In Review`, `Done`\n*status type*: Github has some `default` statuses such as `Todo` or `Done`. \n\nOnly implement the status changes that have *implementation status*=`not implemented`\nOnly change an issue to an existing status. If it does not exist, then do nothing. If the issue is already in the target status, do nothing. ","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-03T07:31:17Z","comments":[],"actionableComment":null}`

## Feature Description
This feature automatically moves GitHub issues through project board statuses as the ADW workflow progresses. When a repository is linked to a GitHub Project (V2), the issue's status field should be updated at key workflow transitions:

- **Plan Phase (before)**: Set status to "In Progress" — signals that work has started on the issue.
- **PR Phase (after)**: Set status to "Review" (or "In Review") — signals that the implementation is complete and ready for review.

The "Done" status transition on merge is already implemented via the existing `closeIssue()` flow in the webhook handler.

All status changes are resilient: if the project doesn't have the target status, or the issue isn't linked to a project, the operation silently succeeds without disrupting the workflow.

## User Story
As a project manager using GitHub Projects
I want issues to automatically move through board statuses as the ADW workflow progresses
So that I can track implementation progress without manual status updates

## Problem Statement
When ADW processes a GitHub issue, the issue stays in its initial project board status (e.g., "Todo") throughout the entire workflow. Project managers and team members have no visibility into whether an issue is being actively worked on or is in review, requiring manual board updates.

## Solution Statement
Create a new `projectBoardApi.ts` module in `adws/github/` that uses the GitHub Projects V2 GraphQL API (via `gh api graphql`) to query and update project board statuses. Integrate calls to this module at two points: before `executePlanPhase` runs (set "In Progress") and after `executePRPhase` completes (set "Review"). The implementation is defensive — all project board operations are wrapped in try/catch and log failures without throwing, ensuring the main workflow is never disrupted.

## Relevant Files
Use these files to implement the feature:

- `guidelines/coding_guidelines.md` — Coding guidelines to follow during implementation.
- `adws/github/githubApi.ts` — Core GitHub API wrapper; provides `RepoInfo` type and re-exports. The new project board module should follow the same pattern of accepting optional `RepoInfo` and falling back to `getTargetRepo()`.
- `adws/github/issueApi.ts` — Existing issue API using `gh` CLI with `execSync`. Pattern reference for new API functions.
- `adws/github/index.ts` — GitHub module barrel export; new project board functions must be re-exported here.
- `adws/core/index.ts` — Core module barrel export; no changes needed but useful reference.
- `adws/core/targetRepoRegistry.ts` — Provides `getTargetRepo()` for resolving the current repo context. The new module will use this for default repo resolution.
- `adws/phases/planPhase.ts` — Plan phase implementation; needs a project board status call **before** the main plan logic.
- `adws/phases/prPhase.ts` — PR phase implementation; needs a project board status call **after** PR creation.
- `adws/phases/workflowLifecycle.ts` — Defines `WorkflowConfig` interface passed to all phases; provides `repoInfo` and `issueNumber`.
- `adws/__tests__/webhookHandlers.test.ts` — Existing test file for webhook handlers; pattern reference for mocking and test structure.

### New Files
- `adws/github/projectBoardApi.ts` — New module implementing GitHub Projects V2 GraphQL operations for moving issues across board statuses.
- `adws/__tests__/projectBoardApi.test.ts` — Unit tests for the project board API module.

## Implementation Plan
### Phase 1: Foundation
Create the `projectBoardApi.ts` module with all the GitHub Projects V2 GraphQL operations needed to query project metadata and update issue status fields. This module must be self-contained, following the existing pattern in `issueApi.ts` of using `execSync` with `gh api graphql`.

Key GraphQL operations:
1. **Find projects linked to a repository** — Query `repository.projectsV2` to get project IDs.
2. **Find the issue's project item** — Query `repository.issue.projectItems` to get the item ID and current status.
3. **Get status field options** — Query `node(id: projectId).field(name: "Status")` to discover available status options (e.g., "In Progress", "Review", "Done").
4. **Update the status** — Mutation `updateProjectV2ItemFieldValue` to change the status.

### Phase 2: Core Implementation
Implement a high-level `moveIssueToStatus(issueNumber, targetStatus, repoInfo?)` function that:
1. Finds the first project linked to the repository.
2. Finds the issue's item within that project.
3. Looks up the status field and its available options.
4. Matches the target status (fuzzy matching: "Review" also matches "In Review").
5. Skips if already in the target status.
6. Updates the status if found, logs and skips if not.

All operations wrapped in try/catch — failures log warnings but never throw.

### Phase 3: Integration
Hook `moveIssueToStatus` into the two workflow phases:
1. **Plan Phase** (`planPhase.ts`): Call `moveIssueToStatus(issueNumber, 'In Progress', repoInfo)` at the start of `executePlanPhase`, before any plan logic runs.
2. **PR Phase** (`prPhase.ts`): Call `moveIssueToStatus(issueNumber, 'Review', repoInfo)` at the end of `executePRPhase`, after the PR has been created.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Create the project board API module
- Create `adws/github/projectBoardApi.ts` with the following functions:
  - `findRepoProjectId(owner, repo)` — Executes a GraphQL query against `repository.projectsV2(first: 1)` to get the first linked project's ID. Returns `null` if no project exists.
  - `findIssueProjectItem(owner, repo, issueNumber, projectId)` — Executes a GraphQL query against `repository.issue(number: N).projectItems` to find the item ID in the given project and its current status value. Returns `null` if the issue isn't in the project.
  - `getStatusFieldOptions(projectId)` — Executes a GraphQL query against `node(id: projectId).field(name: "Status")` to get the field ID and all option values (id + name). Returns `null` if no Status field exists.
  - `updateProjectItemStatus(projectId, itemId, fieldId, optionId)` — Executes the `updateProjectV2ItemFieldValue` mutation to set the status.
  - `moveIssueToStatus(issueNumber, targetStatus, repoInfo?)` — High-level orchestrator function:
    1. Resolve `owner`/`repo` from `repoInfo` or `getTargetRepo()`.
    2. Call `findRepoProjectId`. If null, log and return.
    3. Call `findIssueProjectItem`. If null, log and return.
    4. Check if current status already matches target. If so, log and return.
    5. Call `getStatusFieldOptions`. If null or target status not found, log and return.
    6. Match target status with fuzzy logic: "Review" should match "In Review" as well.
    7. Call `updateProjectItemStatus`.
    8. Log success.
  - Wrap the entire `moveIssueToStatus` function body in try/catch that logs errors but never throws.
- Follow the pattern from `issueApi.ts`: use `execSync` with `gh api graphql`, accept optional `RepoInfo` parameter.
- Use `log` from `../core` for all logging.

### Step 2: Export the new module from the GitHub barrel
- Update `adws/github/index.ts` to add exports for `moveIssueToStatus` from `./projectBoardApi`.

### Step 3: Write unit tests for the project board API
- Create `adws/__tests__/projectBoardApi.test.ts` with the following test cases:
  - `findRepoProjectId` returns project ID when project exists.
  - `findRepoProjectId` returns null when no projects exist.
  - `findRepoProjectId` returns null and logs when `gh` command fails.
  - `findIssueProjectItem` returns item ID and current status.
  - `findIssueProjectItem` returns null when issue is not in the project.
  - `getStatusFieldOptions` returns field ID and options.
  - `getStatusFieldOptions` returns null when no Status field exists.
  - `moveIssueToStatus` successfully updates status.
  - `moveIssueToStatus` skips when issue already in target status.
  - `moveIssueToStatus` skips when target status doesn't exist in project options.
  - `moveIssueToStatus` skips when no project is linked to the repo.
  - `moveIssueToStatus` skips when issue is not in the project.
  - `moveIssueToStatus` matches "Review" to "In Review" (fuzzy match).
  - `moveIssueToStatus` does not throw on any error (catches and logs).
- Mock `child_process.execSync` and `../core/utils` log, following the pattern in `webhookHandlers.test.ts`.

### Step 4: Integrate into the Plan Phase
- Edit `adws/phases/planPhase.ts`:
  - Import `moveIssueToStatus` from `../github`.
  - At the very beginning of `executePlanPhase`, before the "Classify step" block, add:
    ```typescript
    await moveIssueToStatus(issueNumber, 'In Progress', repoInfo);
    ```
  - This ensures the issue moves to "In Progress" before any plan work begins.

### Step 5: Integrate into the PR Phase
- Edit `adws/phases/prPhase.ts`:
  - Import `moveIssueToStatus` from `../github`.
  - At the end of `executePRPhase`, just before the `return` statement, add:
    ```typescript
    await moveIssueToStatus(issueNumber, 'Review', repoInfo);
    ```
  - This ensures the issue moves to "Review" after the PR has been created.

### Step 6: Run validation commands
- Run all validation commands listed below to ensure zero regressions.

## Testing Strategy
### Unit Tests
- Test each low-level GraphQL function (`findRepoProjectId`, `findIssueProjectItem`, `getStatusFieldOptions`, `updateProjectItemStatus`) with mocked `execSync` responses.
- Test the high-level `moveIssueToStatus` function for all code paths: success, no project, no item, status already set, status not found, fuzzy matching, and error handling.
- Verify that `moveIssueToStatus` never throws — all errors are caught and logged.

### Edge Cases
- Repository has no linked GitHub Project — should silently skip.
- Issue is not added to the project — should silently skip.
- Target status doesn't exist in the project's status options — should silently skip.
- Issue is already in the target status — should silently skip (no API mutation).
- Project has "In Review" instead of "Review" — should match via fuzzy logic.
- `gh api graphql` command fails (network error, auth error) — should catch and log without disrupting the workflow.
- Multiple projects linked to the repo — use the first one.

## Acceptance Criteria
- When the Plan Phase begins, the linked issue is moved to "In Progress" on the project board (if it exists and has that status).
- When the PR Phase completes, the linked issue is moved to "Review" (or "In Review") on the project board (if it exists and has that status).
- If no project is linked, or the issue isn't in the project, or the status doesn't exist, the workflow continues without error.
- All existing tests pass with zero regressions.
- New unit tests cover all code paths in `projectBoardApi.ts`.
- The `moveIssueToStatus` function never throws — it always catches and logs.
- Lint, type check, and build all pass.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `npm run lint` — Run linter to check for code quality issues.
- `npx tsc --noEmit` — TypeScript type check for the main project.
- `npx tsc --noEmit -p adws/tsconfig.json` — TypeScript type check for the adws directory.
- `npm test` — Run all tests to validate zero regressions.
- `npm run build` — Build the application to verify no build errors.

## Notes
- Strictly follow the coding guidelines in `guidelines/coding_guidelines.md`: clarity over cleverness, modularity, immutability, type safety, purity, and security by default.
- The `moveIssueToStatus` function is designed to be `async` even though current `execSync` calls are synchronous. This future-proofs the API for potential migration to async `gh` calls.
- The GitHub Projects V2 API requires the `project` scope on the GitHub token. If the token doesn't have this scope, the GraphQL calls will fail gracefully (caught and logged).
- The fuzzy matching for status names (e.g., "Review" matching "In Review") is intentional since different projects may use different naming conventions for the review column.
- No new libraries are needed for this implementation.
