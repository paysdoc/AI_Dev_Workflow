# Chore: Remove project board status management from ADW

## Metadata
issueNumber: `227`
adwId: `2tlgjj-remove-project-board`
issueJson: `{"number":227,"title":"Remove project board status management from ADW","body":"## Summary\n\nRemove all project board status transition logic from ADW. The issue tracker's built-in project automations should be the sole authority for board status management.\n\n**Why:** When ADW runs under its own GitHub App, the installation token lacks Projects V2 permissions (`organization_projects: write`), causing all `moveToStatus` calls to fail silently. Rather than fixing app permissions and maintaining parallel automation, it's cleaner to let the issue tracker handle board transitions natively.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-18T09:55:19Z","comments":[],"actionableComment":null}`

## Chore Description
Remove all project board status transition logic from ADW. The `moveToStatus` method on the `IssueTracker` interface and all its implementations/callers must be deleted. The `projectBoardApi.ts` file (GitHub Projects V2 GraphQL queries/mutations) must be deleted entirely. The issue tracker's built-in project automations should be the sole authority for board status management. This also includes removing the `moveIssueToStatus` re-export from `adws/github/index.ts`, updating the BDD scenario that references `projectBoardApi.ts`, and removing the file from the README project structure listing.

## Relevant Files
Use these files to resolve the chore:

- `adws/github/projectBoardApi.ts` — entire file to be deleted (GraphQL queries/mutations for Projects V2)
- `adws/github/index.ts` — re-exports `moveIssueToStatus` from `projectBoardApi.ts` (line 28)
- `adws/providers/types.ts` — `IssueTracker` interface defines `moveToStatus` method (line 75)
- `adws/providers/github/githubIssueTracker.ts` — implements `moveToStatus` and imports `moveIssueToStatus` from `projectBoardApi` (lines 18, 65-67)
- `adws/providers/jira/jiraIssueTracker.ts` — implements `moveToStatus` and the `matchTransition` helper (lines 23-34, 179-205)
- `adws/phases/planPhase.ts` — calls `repoContext.issueTracker.moveToStatus(issueNumber, 'In Progress')` (line 32)
- `adws/phases/workflowCompletion.ts` — calls `repoContext.issueTracker.moveToStatus(issueNumber, 'Review')` (line 61)
- `adws/phases/prReviewCompletion.ts` — calls `repoContext.issueTracker.moveToStatus(config.issueNumber, 'Review')` (line 135)
- `features/remove_unnecessary_exports.feature` — BDD scenario "projectBoardApi.ts internal helpers are not exported" references the deleted file (lines 43-48)
- `README.md` — project structure lists `projectBoardApi.ts` (line 181)
- `guidelines/coding_guidelines.md` — coding guidelines to follow during implementation

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Remove `moveToStatus` from the `IssueTracker` interface
- Edit `adws/providers/types.ts`
- Remove line 75: `moveToStatus(issueNumber: number, status: string): Promise<void>;`

### Step 2: Remove `moveToStatus` implementation from GitHub IssueTracker
- Edit `adws/providers/github/githubIssueTracker.ts`
- Remove the `import { moveIssueToStatus } from '../../github/projectBoardApi';` import (line 18)
- Remove the `moveToStatus` method (lines 65-67)
- Remove `projectBoardApi` from the JSDoc module description on line 4

### Step 3: Remove `moveToStatus` implementation from Jira IssueTracker
- Edit `adws/providers/jira/jiraIssueTracker.ts`
- Remove the `matchTransition` helper function (lines 23-34)
- Remove the `moveToStatus` method (lines 179-205)

### Step 4: Remove `moveToStatus` call from planPhase
- Edit `adws/phases/planPhase.ts`
- Remove the entire `if` block at lines 31-33:
  ```ts
  if (repoContext) {
    await repoContext.issueTracker.moveToStatus(issueNumber, 'In Progress');
  }
  ```

### Step 5: Remove `moveToStatus` call from workflowCompletion
- Edit `adws/phases/workflowCompletion.ts`
- Remove line 61: `await repoContext.issueTracker.moveToStatus(issueNumber, 'Review');`

### Step 6: Remove `moveToStatus` call from prReviewCompletion
- Edit `adws/phases/prReviewCompletion.ts`
- Remove line 135: `await repoContext.issueTracker.moveToStatus(config.issueNumber, 'Review');`

### Step 7: Remove `moveIssueToStatus` re-export from GitHub index
- Edit `adws/github/index.ts`
- Remove lines 27-28 (the `// Project Board API` comment and `export { moveIssueToStatus } from './projectBoardApi';`)

### Step 8: Delete `projectBoardApi.ts`
- Delete the file `adws/github/projectBoardApi.ts` entirely

### Step 9: Update BDD scenario referencing projectBoardApi
- Edit `features/remove_unnecessary_exports.feature`
- Remove the entire scenario "projectBoardApi.ts internal helpers are not exported" (lines 43-48), since the file no longer exists

### Step 10: Update README project structure
- Edit `README.md`
- Remove `│   ├── projectBoardApi.ts` from the project structure listing under `github/`

### Step 11: Run validation commands
- Run all validation commands to confirm zero regressions

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type check the root project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check the adws project
- `bunx cucumber-js --dry-run` — Verify BDD scenarios parse without errors (no undefined steps)

## Notes
- IMPORTANT: Follow coding guidelines in `guidelines/coding_guidelines.md` — especially "Code hygiene: Remove unused variables, functions, and imports."
- The `matchTransition` helper in `jiraIssueTracker.ts` is only used by `moveToStatus` — removing both is safe.
- After deleting `projectBoardApi.ts`, ensure no other file imports from it (the grep confirmed only `githubIssueTracker.ts` and `index.ts` import from it).
- The BDD scenario step definitions in `features/step_definitions/removeUnnecessaryExportsSteps.ts` should still work after removing the scenario — the step definitions are generic and shared across scenarios.
