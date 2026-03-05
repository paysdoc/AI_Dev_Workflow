# Bug: PR not shown in GitHub Projects view for non-ADW repos

## Metadata
issueNumber: `70`
adwId: `issue-with-associate-pe6oww`
issueJson: `{"number":70,"title":"Issue with associated PR does not show the PR in the projects view","body":"Whenever a Pull Request is created for an issue, the project view should show the PR icon underneath the issue. In repositories that are not AI Dev Workflow, this is not the case until the issue is closed.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-05T12:11:47Z","comments":[],"actionableComment":null}`

## Bug Description
When a Pull Request is created for an issue in a non-ADW repository, the GitHub Projects V2 board does not show the PR icon underneath the issue card. The PR only appears linked to the issue once the issue is closed. In the ADW repository itself, the PR icon appears correctly because GitHub's native `Closes #N` keyword auto-linking works for same-repo PRs.

**Expected behavior:** After a PR is created, the project board shows the PR icon underneath the associated issue immediately.

**Actual behavior:** The PR icon does not appear on the project board for issues in non-ADW repositories until the issue is closed.

## Problem Statement
After PR creation, the code never explicitly adds the PR as a project item via the GitHub Projects V2 API (`addProjectV2ItemById`). It only moves the issue's status to "Review" via `moveIssueToStatus`. For cross-repo or user-level projects, GitHub's native `Closes #N` auto-linking does not automatically surface the PR on the project board — the PR must be explicitly added as a project item.

## Solution Statement
Add a new function `addPrToProject` in `projectBoardApi.ts` that:
1. Gets the PR's node ID from the PR URL using `gh pr view`
2. Finds the project linked to the repo using the existing `findRepoProjectId`
3. Adds the PR to the project via the `addProjectV2ItemById` GraphQL mutation

Call this function from `prPhase.ts` after PR creation (when `ctx.prUrl` is available).

## Steps to Reproduce
1. Set up ADW to process an issue in a non-ADW target repository that has a GitHub Project V2 linked
2. Run the full workflow (plan + build + PR)
3. After the PR is created, check the project board
4. The PR icon does not appear underneath the issue card
5. Only after the issue is closed does the PR appear linked

## Root Cause Analysis
The `projectBoardApi.ts` module only operates on **issues** — it finds issues in a project and updates their status. It never adds PRs as project items. GitHub Projects V2 requires either:
- Same-repo `Closes #N` keyword (works for ADW repo where issue + PR are in same repo)
- Explicit `addProjectV2ItemById` API call to add the PR to the project

For non-ADW repos, the project is often a user-level project (e.g., `https://github.com/users/paysdoc/projects/2`), and the `Closes #N` keyword in the PR body does not trigger auto-linking on such projects. The fix is to explicitly add the PR to the project via the API.

## Relevant Files
Use these files to fix the bug:

- `adws/github/projectBoardApi.ts` — Contains all GitHub Projects V2 API functions. The new `addPrToProject` function will be added here.
- `adws/github/index.ts` — Exports from the github module. Must export the new function.
- `adws/phases/prPhase.ts` — Orchestrates PR creation. Must call the new function after PR creation.
- `adws/__tests__/projectBoardApi.test.ts` — Unit tests for the project board API. Must add tests for the new function.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Add `getPrNodeId` function to `projectBoardApi.ts`
- Add a new exported function `getPrNodeId(prUrl: string): string | null`
- Use `gh pr view <prUrl> --json id --jq .id` to get the PR's GraphQL node ID
- Wrap in try-catch, return `null` on failure and log a warning
- This needs the full PR URL (e.g., `https://github.com/owner/repo/pull/123`)

### 2. Add `addItemToProject` function to `projectBoardApi.ts`
- Add a new exported function `addItemToProject(projectId: string, contentId: string): string | null`
- Execute the `addProjectV2ItemById` GraphQL mutation:
  ```graphql
  mutation($projectId: ID!, $contentId: ID!) {
    addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
      item { id }
    }
  }
  ```
- Return the created item ID on success, `null` on failure
- Wrap in try-catch, log a warning on failure

### 3. Add `addPrToProject` orchestrator function to `projectBoardApi.ts`
- Add a new exported async function `addPrToProject(prUrl: string, repoInfo?: RepoInfo): Promise<void>`
- Steps:
  1. Resolve `{ owner, repo }` from `repoInfo` or `getTargetRepo()`
  2. Call `findRepoProjectId(owner, repo)` — return early if no project
  3. Call `getPrNodeId(prUrl)` — return early if node ID not found
  4. Call `addItemToProject(projectId, prNodeId)`
  5. Log success or failure
- Wrap entire function in try-catch (same pattern as `moveIssueToStatus`)

### 4. Export `addPrToProject` from `adws/github/index.ts`
- Add `addPrToProject` to the exports from `./projectBoardApi`

### 5. Call `addPrToProject` from `prPhase.ts`
- Import `addPrToProject` from `'../github'`
- After the existing `moveIssueToStatus` call (line 69), add:
  ```typescript
  if (ctx.prUrl) {
    await addPrToProject(ctx.prUrl, repoInfo);
  }
  ```

### 6. Add unit tests for the new functions in `projectBoardApi.test.ts`
- Import the new functions: `getPrNodeId`, `addItemToProject`, `addPrToProject`
- Add tests for `getPrNodeId`:
  - Returns node ID when PR exists
  - Returns null when gh command fails
- Add tests for `addItemToProject`:
  - Returns item ID on success
  - Returns null when mutation fails
- Add tests for `addPrToProject`:
  - Successfully adds PR to project (happy path)
  - Skips when no project is linked
  - Skips when PR node ID cannot be resolved
  - Does not throw on errors (catches and logs)

### 7. Run validation commands
- Execute all validation commands listed below to confirm zero regressions.

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `npm run lint` — Run linter to check for code quality issues
- `npx tsc --noEmit` — Type check the main project
- `npx tsc --noEmit -p adws/tsconfig.json` — Type check the adws scripts
- `npm test` — Run tests to validate the bug is fixed with zero regressions
- `npm run build` — Build the application to verify no build errors

## Notes
- IMPORTANT: Strictly adhere to the coding guidelines in `guidelines/coding_guidelines.md`.
- The `addPrToProject` function follows the same defensive pattern as `moveIssueToStatus`: silently handles all errors, logs warnings, and never throws.
- The `gh pr view` command accepts a full PR URL, so we don't need to parse the owner/repo/number from the URL.
- This fix is minimal and surgical: 3 new functions in `projectBoardApi.ts`, 1 new export, and 2 lines added to `prPhase.ts`.
