# Bug: Pull requests should not be added to the project board

## Metadata
issueNumber: `82`
adwId: `pull-requests-should-cuo3au`
issueJson: `{"number":82,"title":"Pull requests should not be added to the project","body":"Issue 70 solved the problem that pull requests did not reflect on the issue once they got status `Review`.\nSince that issue was resolved, the pull request now features as a separate issue in the project. \n\nThis is incorrect. Though the pull request is supposed to be shown on the issue itself, it should not reflect in the project, as it is not technically an issue to be solved.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-06T08:37:44Z","comments":[],"actionableComment":null}`

## Bug Description
After Issue 70 was resolved, pull requests are now being added as separate items on the GitHub Project V2 board. When a PR is created during the PR phase, the `addPrToProject()` function is called, which uses the GraphQL `addProjectV2ItemById` mutation to add the PR as a standalone item in the project. This causes the PR to appear as a separate entry alongside the issue it implements, cluttering the project board with non-issue items.

**Expected behavior:** Only the issue should appear on the project board. The issue's status gets updated to "Review" (via `moveIssueToStatus`), and the PR is linked to the issue via the PR body (e.g., "Implements #82"). The PR should NOT appear as a separate project board item.

**Actual behavior:** The PR appears as a separate item on the project board in addition to the issue, making it look like there are two items to track for a single piece of work.

## Problem Statement
The `addPrToProject()` function in `projectBoardApi.ts` explicitly adds the PR as a separate content item to the GitHub Project V2 board. This function is called from `prPhase.ts` after `moveIssueToStatus()` already correctly moves the issue to "Review" status. The PR should only be visible through its link on the issue, not as a standalone project board item.

## Solution Statement
Remove the `addPrToProject()` call from `prPhase.ts` and remove the now-dead-code functions (`addPrToProject`, `getPrNodeId`, `addItemToProject`) from `projectBoardApi.ts`. Remove the corresponding export from `github/index.ts` and clean up tests.

## Steps to Reproduce
1. Run any ADW workflow that reaches the PR phase (e.g., `adwPlanBuild.tsx`)
2. Observe that after the PR is created, `addPrToProject()` is called in `prPhase.ts:73`
3. The PR appears as a separate item on the GitHub Project V2 board
4. The project board now shows both the issue and the PR as separate items

## Root Cause Analysis
Issue 70 introduced the `addPrToProject()` function to make PRs visible on the project board during the "Review" status. However, this approach was incorrect because GitHub Project V2 treats any item added via `addProjectV2ItemById` as a standalone project item. The correct behavior was already implemented by `moveIssueToStatus(issueNumber, 'Review')` which moves the **issue** to the "Review" column. The PR is naturally linked to the issue via the "Implements #N" reference in the PR body. Adding the PR separately to the project was unnecessary and harmful.

The problematic code path is:
1. `prPhase.ts:70` - `moveIssueToStatus(issueNumber, 'Review', repoInfo)` - correctly moves issue to Review
2. `prPhase.ts:72-74` - `addPrToProject(ctx.prUrl, repoInfo)` - incorrectly adds PR as separate project item

## Relevant Files
Use these files to fix the bug:

- `adws/phases/prPhase.ts` — Contains the `executePRPhase` function that calls `addPrToProject`. The call on lines 72-74 must be removed.
- `adws/github/projectBoardApi.ts` — Contains the `addPrToProject`, `getPrNodeId`, and `addItemToProject` functions that will become dead code once the call is removed. These functions should be removed.
- `adws/github/index.ts` — Exports `addPrToProject` from `projectBoardApi`. The export must be removed.
- `adws/__tests__/projectBoardApi.test.ts` — Contains tests for `addPrToProject`, `getPrNodeId`, and `addItemToProject`. These test blocks must be removed.
- `adws/__tests__/workflowPhases.test.ts` — Mocks `addPrToProject` in the `../github` mock. The mock entry must be removed, and any assertions referencing it must be updated.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow during implementation.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### 1. Remove `addPrToProject` call from `prPhase.ts`
- Open `adws/phases/prPhase.ts`
- Remove the import of `addPrToProject` from line 16
- Remove lines 72-74 which call `addPrToProject`:
  ```typescript
  if (ctx.prUrl) {
    await addPrToProject(ctx.prUrl, repoInfo);
  }
  ```
- The `moveIssueToStatus` call on line 70 remains unchanged as it correctly updates the issue status

### 2. Remove dead code from `projectBoardApi.ts`
- Open `adws/github/projectBoardApi.ts`
- Remove the `getPrNodeId` function (lines 213-224)
- Remove the `addItemToProject` function (lines 230-251)
- Remove the `addPrToProject` function (lines 260-285)
- Keep all other functions (`findRepoProjectId`, `findIssueProjectItem`, `getStatusFieldOptions`, `updateProjectItemStatus`, `matchStatusOption`, `moveIssueToStatus`) as they are still used for issue status management

### 3. Remove `addPrToProject` export from `github/index.ts`
- Open `adws/github/index.ts`
- On line 68, change `export { moveIssueToStatus, addPrToProject } from './projectBoardApi';` to `export { moveIssueToStatus } from './projectBoardApi';`

### 4. Remove tests for deleted functions from `projectBoardApi.test.ts`
- Open `adws/__tests__/projectBoardApi.test.ts`
- Remove the import of `getPrNodeId`, `addItemToProject`, and `addPrToProject` from the imports
- Remove the `describe('getPrNodeId', ...)` test block (around lines 526-555)
- Remove the `describe('addItemToProject', ...)` test block (around lines 558-591)
- Remove the `describe('addPrToProject', ...)` test block (around lines 594-673)

### 5. Update `workflowPhases.test.ts` mock
- Open `adws/__tests__/workflowPhases.test.ts`
- Remove the `addPrToProject: vi.fn().mockResolvedValue(undefined),` line from the `../github` mock (line 119)
- Search for any test assertions that reference `addPrToProject` and remove them

### 6. Run validation commands
- Run all validation commands listed below to confirm the fix introduces zero regressions

## Validation Commands
Execute every command to validate the bug is fixed with zero regressions.

- `npm run lint` - Run linter to check for code quality issues
- `npx tsc --noEmit` - Type check the main project
- `npx tsc --noEmit -p adws/tsconfig.json` - Type check the adws project
- `npm test` - Run tests to validate the bug is fixed with zero regressions

## Notes
- This is a clean removal of functionality that was introduced in Issue 70 but turned out to be the wrong approach. The `moveIssueToStatus` function already handles the project board correctly by updating the issue's status column.
- The `addItemToProject` function is generic (can add any content item to a project), but since it is only used by `addPrToProject`, it is dead code after this fix and should be removed per the coding guidelines' "Code hygiene" rule.
- No new libraries are required.
