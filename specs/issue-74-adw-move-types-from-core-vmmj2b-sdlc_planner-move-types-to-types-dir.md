# Chore: Move types from /core to /types

## Metadata
issueNumber: `74`
adwId: `move-types-from-core-vmmj2b`
issueJson: `{"number":74,"title":"Move types from /core to /types","body":"","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-05T12:46:28Z","comments":[],"actionableComment":null}`

## Chore Description
Move all type-only files from `adws/core/` to a new `adws/types/` directory to improve project organization. The type files to move are: `agentTypes.ts`, `costTypes.ts`, `dataTypes.ts`, `issueTypes.ts`, and `workflowTypes.ts`. All imports across the codebase must be updated to reference the new paths. The `adws/core/index.ts` barrel must be updated to re-export from the new location. A new `adws/types/index.ts` barrel file should be created.

## Relevant Files
Use these files to resolve the chore:

- `guidelines/coding_guidelines.md` — Coding guidelines to follow (modularity, type safety, code hygiene).

### Type files to move (from `adws/core/` to `adws/types/`)
- `adws/core/issueTypes.ts` — Base types for issues, GitHub entities, slash commands, prefix maps. No type deps.
- `adws/core/agentTypes.ts` — Agent-related types. Imports from `issueTypes`.
- `adws/core/workflowTypes.ts` — Workflow stage types, PR types. Imports from `issueTypes`.
- `adws/core/costTypes.ts` — Cost/model usage types. No deps.
- `adws/core/dataTypes.ts` — Barrel re-export of `issueTypes`, `agentTypes`, `workflowTypes`.

### Core files that need import path updates
- `adws/core/index.ts` — Main barrel file; must update re-exports to point to `../types/`.
- `adws/core/config.ts` — Imports `SlashCommand` from `./issueTypes`.
- `adws/core/targetRepoManager.ts` — Imports `TargetRepoInfo` from `./issueTypes`.
- `adws/core/orchestratorLib.ts` — Imports from `./dataTypes`.
- `adws/core/utils.ts` — Imports from `./dataTypes`.
- `adws/core/agentState.ts` — Imports from `./dataTypes`.
- `adws/core/stateHelpers.ts` — Imports from `./dataTypes`.
- `adws/core/costReport.ts` — Imports from `./costTypes`.
- `adws/core/costPricing.ts` — Imports from `./costTypes`.
- `adws/core/costCsvWriter.ts` — Imports from `./costTypes`.
- `adws/core/retryOrchestrator.ts` — Imports from `./costTypes`.

### Agent files that need import path updates
- `adws/agents/jsonlParser.ts` — Imports from `../core/dataTypes`.
- `adws/agents/claudeAgent.ts` — Imports from `../core/dataTypes`.
- `adws/agents/gitAgent.ts` — Imports from `../core/dataTypes`.
- `adws/agents/planAgent.ts` — Imports from `../core/dataTypes`.
- `adws/agents/buildAgent.ts` — Imports from `../core/dataTypes`.
- `adws/agents/reviewRetry.ts` — Imports from `../core/dataTypes`.
- `adws/agents/tokenManager.ts` — Imports from `../core/dataTypes`.

### GitHub module files that need import path updates
- `adws/github/pullRequestCreator.ts`
- `adws/github/prApi.ts`
- `adws/github/workflowCommentsBase.ts`
- `adws/github/gitOperations.ts`
- `adws/github/issueApi.ts`
- `adws/github/workflowCommentsPR.ts`
- `adws/github/workflowCommentsIssue.ts`
- `adws/github/worktreeOperations.ts`
- `adws/github/prCommentDetector.ts`

### Phase files that need import path updates
- `adws/phases/workflowLifecycle.ts`
- `adws/phases/prReviewPhase.ts`
- `adws/phases/planPhase.ts`
- `adws/phases/buildPhase.ts`
- `adws/phases/testPhase.ts`
- `adws/phases/documentPhase.ts`
- `adws/phases/prPhase.ts`

### Test files that need import path updates
- `adws/__tests__/costTypes.test.ts` — Imports from `../core/costTypes`.
- `adws/__tests__/costReport.test.ts` — Imports from `../core/costTypes`.
- `adws/__tests__/costCsvWriter.test.ts` — Imports from `../core/costTypes`.
- `adws/__tests__/claudeAgent.test.ts` — Imports from `../core/costTypes`.
- `adws/__tests__/persistTokenCounts.test.ts` — Imports from `../core/costTypes`.
- `adws/__tests__/tokenManagerFiltered.test.ts` — Imports from `../core/costTypes`.
- `adws/__tests__/agentState.test.ts` — Imports from `../core/dataTypes`.
- `adws/__tests__/orchestratorLib.test.ts` — Imports from `../core/dataTypes`.
- `adws/__tests__/workflowPhases.test.ts` — Imports from `../core/dataTypes`.
- `adws/__tests__/branchNameGeneration.test.ts` — Imports from `../core/dataTypes`.
- `adws/__tests__/adwPrReview.test.ts` — Imports from `../core/dataTypes`.
- `adws/__tests__/gitAgent.test.ts` — Imports from `../core/dataTypes`.
- `adws/__tests__/tokenLimitRecovery.test.ts` — Imports from `../core/dataTypes`.
- `adws/__tests__/issueClassifier.test.ts` — Imports from `../core/dataTypes`.
- `adws/__tests__/prReviewCostTracking.test.ts` — Imports from `../core/dataTypes`.

### New Files
- `adws/types/index.ts` — New barrel file re-exporting all types from the moved files.

### Documentation updates
- `README.md` — Update the Project Structure tree to show the new `types/` directory and reflect removed type files from `core/`.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Create `adws/types/` directory and move type files
- Create the `adws/types/` directory.
- Move `adws/core/issueTypes.ts` → `adws/types/issueTypes.ts`.
- Move `adws/core/agentTypes.ts` → `adws/types/agentTypes.ts`.
- Move `adws/core/workflowTypes.ts` → `adws/types/workflowTypes.ts`.
- Move `adws/core/costTypes.ts` → `adws/types/costTypes.ts`.
- Move `adws/core/dataTypes.ts` → `adws/types/dataTypes.ts`.
- The internal imports within these files (`./issueTypes`, etc.) remain unchanged since they are relative to each other and will maintain the same relative paths in the new directory.

### Step 2: Create `adws/types/index.ts` barrel file
- Create `adws/types/index.ts` that re-exports everything from all type files:
  ```typescript
  export * from './issueTypes';
  export * from './agentTypes';
  export * from './workflowTypes';
  export * from './costTypes';
  export * from './dataTypes';
  ```

### Step 3: Update `adws/core/index.ts` barrel re-exports
- Update all type re-exports in `adws/core/index.ts` to import from `../types/` instead of local `./` paths:
  - Change `'./dataTypes'` → `'../types/dataTypes'`
  - Change `'./costTypes'` → `'../types/costTypes'`
- This ensures that any file importing from `adws/core` (via the barrel) continues to work without changes.

### Step 4: Update direct imports within `adws/core/` files
- Update `adws/core/config.ts`: change `'./issueTypes'` → `'../types/issueTypes'`.
- Update `adws/core/targetRepoManager.ts`: change `'./issueTypes'` → `'../types/issueTypes'`.
- Update `adws/core/orchestratorLib.ts`: change `'./dataTypes'` → `'../types/dataTypes'`.
- Update `adws/core/utils.ts`: change `'./dataTypes'` → `'../types/dataTypes'`.
- Update `adws/core/agentState.ts`: change `'./dataTypes'` → `'../types/dataTypes'`.
- Update `adws/core/stateHelpers.ts`: change `'./dataTypes'` → `'../types/dataTypes'`.
- Update `adws/core/costReport.ts`: change `'./costTypes'` → `'../types/costTypes'`.
- Update `adws/core/costPricing.ts`: change `'./costTypes'` → `'../types/costTypes'`.
- Update `adws/core/costCsvWriter.ts`: change `'./costTypes'` → `'../types/costTypes'`.
- Update `adws/core/retryOrchestrator.ts`: change `'./costTypes'` → `'../types/costTypes'`.

### Step 5: Update imports in `adws/agents/` files
- For each file that imports from `'../core/dataTypes'`, change to `'../types/dataTypes'`:
  - `adws/agents/jsonlParser.ts`
  - `adws/agents/claudeAgent.ts`
  - `adws/agents/gitAgent.ts`
  - `adws/agents/planAgent.ts`
  - `adws/agents/buildAgent.ts`
  - `adws/agents/reviewRetry.ts`
  - `adws/agents/tokenManager.ts`

### Step 6: Update imports in `adws/github/` files
- For each file that imports from `'../core/dataTypes'`, change to `'../types/dataTypes'`:
  - `adws/github/pullRequestCreator.ts`
  - `adws/github/prApi.ts`
  - `adws/github/workflowCommentsBase.ts`
  - `adws/github/gitOperations.ts`
  - `adws/github/issueApi.ts`
  - `adws/github/workflowCommentsPR.ts`
  - `adws/github/workflowCommentsIssue.ts`
  - `adws/github/worktreeOperations.ts`
  - `adws/github/prCommentDetector.ts`

### Step 7: Update imports in `adws/phases/` files
- For each file that imports from `'../core/dataTypes'`, change to `'../types/dataTypes'`:
  - `adws/phases/workflowLifecycle.ts`
  - `adws/phases/prReviewPhase.ts`
  - `adws/phases/planPhase.ts`
  - `adws/phases/buildPhase.ts`
  - `adws/phases/testPhase.ts`
  - `adws/phases/documentPhase.ts`
  - `adws/phases/prPhase.ts`

### Step 8: Update imports in `adws/__tests__/` files
- For test files importing from `'../core/costTypes'`, change to `'../types/costTypes'`:
  - `adws/__tests__/costTypes.test.ts`
  - `adws/__tests__/costReport.test.ts`
  - `adws/__tests__/costCsvWriter.test.ts`
  - `adws/__tests__/claudeAgent.test.ts`
  - `adws/__tests__/persistTokenCounts.test.ts`
  - `adws/__tests__/tokenManagerFiltered.test.ts`
- For test files importing from `'../core/dataTypes'`, change to `'../types/dataTypes'`:
  - `adws/__tests__/agentState.test.ts`
  - `adws/__tests__/orchestratorLib.test.ts`
  - `adws/__tests__/workflowPhases.test.ts`
  - `adws/__tests__/branchNameGeneration.test.ts`
  - `adws/__tests__/adwPrReview.test.ts`
  - `adws/__tests__/gitAgent.test.ts`
  - `adws/__tests__/tokenLimitRecovery.test.ts`
  - `adws/__tests__/issueClassifier.test.ts`
  - `adws/__tests__/prReviewCostTracking.test.ts`

### Step 9: Update `README.md` project structure
- Update the project structure tree in `README.md` to:
  - Add the new `types/` directory under `adws/` with its files listed.
  - Remove the type files (`agentTypes.ts`, `costTypes.ts`, `dataTypes.ts`, `issueTypes.ts`, `workflowTypes.ts`) from the `core/` listing.

### Step 10: Run Validation Commands
- Run all validation commands to confirm the chore is complete with zero regressions.

## Validation Commands
Execute every command to validate the chore is complete with zero regressions.

- `npm run lint` — Run linter to check for code quality issues
- `npx tsc --noEmit` — Type check the main project
- `npx tsc --noEmit -p adws/tsconfig.json` — Type check the adws project
- `npm run build` — Build the application to verify no build errors
- `npm test` — Run tests to validate the chore is complete with zero regressions

## Notes
- IMPORTANT: Strictly adhere to the coding guidelines in `guidelines/coding_guidelines.md`.
- The `adws/core/index.ts` barrel must continue to re-export all types so that existing consumers importing from `adws/core` are not broken. This is the key backward-compatibility requirement.
- The internal cross-references between type files (e.g., `agentTypes.ts` imports from `./issueTypes`) do NOT need updating since they are relative to each other and remain in the same directory together.
- `dataTypes.ts` is a barrel re-export file (re-exports from `issueTypes`, `agentTypes`, `workflowTypes`). It should be moved as-is to maintain the same aggregation pattern.
- After all moves and import updates, do a final grep for any remaining references to the old paths (`'./agentTypes'`, `'./issueTypes'`, `'./workflowTypes'`, `'./costTypes'`, `'./dataTypes'` within `adws/core/`, and `'../core/dataTypes'`, `'../core/costTypes'`, `'../core/issueTypes'` from other directories) to catch any missed imports.
