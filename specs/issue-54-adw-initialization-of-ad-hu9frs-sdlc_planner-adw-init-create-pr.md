# Feature: Add PR Creation Phase to adwInit Orchestrator

## Metadata
issueNumber: `54`
adwId: `initialization-of-ad-hu9frs`
issueJson: `{"number":54,"title":"Initialization of adw should end with pr creation","body":"``` adw_init ``` creates a branch in a worktree, but does not add a pull request. \n\nAdd the PR phase before completing the issue. ","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-01T18:21:56Z","comments":[],"actionableComment":null}`

## Feature Description
The `adwInit.tsx` orchestrator currently initializes `.adw/` project configuration files, commits them, and completes the workflow — but it never creates a pull request. Every other orchestrator that modifies code (e.g., `adwPlanBuild.tsx`, `adwSdlc.tsx`) includes a PR phase so that changes are reviewable. This feature adds the existing `executePRPhase()` call to `adwInit.tsx` so the generated `.adw/` configuration is submitted as a pull request, consistent with all other ADW orchestrators.

## User Story
As a developer using ADW to initialize a target repository
I want the `adwInit` workflow to automatically create a pull request with the generated `.adw/` configuration
So that the configuration changes go through the standard code review process instead of only existing on an unmerged branch

## Problem Statement
When `adwInit.tsx` runs, it creates a worktree with a feature branch, generates `.adw/` configuration files, and commits them. However, it never pushes the branch or creates a pull request. This means the generated configuration sits on a local branch with no visibility to the team and no review process. Other orchestrators like `adwPlanBuild.tsx` include a PR phase — `adwInit.tsx` should follow the same pattern.

## Solution Statement
Add the `executePRPhase(config)` call to `adwInit.tsx` after the commit step and before `completeWorkflow()`. This reuses the existing PR phase infrastructure (`adws/phases/prPhase.ts`) which handles pushing the branch, creating the PR via the `/pull_request` skill, and posting workflow status comments. The change also requires importing `executePRPhase` from `./workflowPhases` and accumulating the PR phase's cost and model usage into the workflow totals.

## Relevant Files
Use these files to implement the feature:

- `adws/adwInit.tsx` — The main orchestrator file that needs modification. Currently missing the PR phase call between commit and `completeWorkflow()`.
- `adws/workflowPhases.ts` — Re-exports all phase functions including `executePRPhase`. The import source for the PR phase.
- `adws/phases/prPhase.ts` — The existing PR phase implementation. Already handles uncommitted changes, PR creation, and workflow comments. No changes needed here — read for reference only.
- `adws/adwPlanBuild.tsx` — Reference orchestrator that already includes the PR phase. Use as a pattern for how to integrate `executePRPhase()`.
- `adws/phases/workflowLifecycle.ts` — Contains `WorkflowConfig`, `initializeWorkflow`, `completeWorkflow`, and `handleWorkflowError`. Read for reference only.
- `guidelines/coding_guidelines.md` — Coding guidelines that must be followed.

### New Files
- `adws/__tests__/adwInitPrPhase.test.ts` — Unit test verifying that `adwInit.tsx` calls the PR phase after committing `.adw/` files.

## Implementation Plan
### Phase 1: Foundation
No foundational work is needed. The `executePRPhase()` function already exists in `adws/phases/prPhase.ts` and is exported through `adws/workflowPhases.ts`. The `WorkflowConfig` interface already contains all the fields the PR phase needs (`branchName`, `worktreePath`, `issue`, etc.).

### Phase 2: Core Implementation
Modify `adwInit.tsx` to:
1. Import `executePRPhase` from `./workflowPhases`
2. After the `commitChanges()` call, invoke `executePRPhase(config)` to create the pull request
3. Accumulate the PR phase's `costUsd` and `modelUsage` into the existing `totalCostUsd` and `totalModelUsage` variables
4. Call `persistTokenCounts()` after the PR phase (following the pattern in `adwPlanBuild.tsx`)

### Phase 3: Integration
The change integrates naturally because:
- `initializeWorkflow()` already sets up the worktree, branch, and all config needed by `executePRPhase()`
- `executePRPhase()` handles pushing the branch and creating the PR via the `/pull_request` slash command
- `completeWorkflow()` already logs the PR URL if `ctx.prUrl` is set (which `executePRPhase` sets)
- No changes to the workflow lifecycle, slash commands, or agent infrastructure are needed

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Update adwInit.tsx imports
- In `adws/adwInit.tsx`, add `executePRPhase` to the import from `./workflowPhases`
- The current import is: `import { initializeWorkflow, completeWorkflow, handleWorkflowError } from './workflowPhases';`
- Add `executePRPhase` to this import statement

### Step 2: Add PR phase call after commit
- In the `main()` function of `adws/adwInit.tsx`, after the `commitChanges()` call (line ~138) and before `persistTokenCounts()` / `completeWorkflow()`, add:
  - A log line: `log('Phase: PR Creation', 'info');`
  - The PR phase call: `const prResult = await executePRPhase(config);`
  - Accumulate cost: `totalCostUsd += prResult.costUsd;`
  - Merge model usage: `totalModelUsage = mergeModelUsageMaps(totalModelUsage, prResult.modelUsage);`
- Keep the existing `persistTokenCounts()` call after the PR phase (it already exists before `completeWorkflow`)

### Step 3: Update the orchestrator JSDoc header
- Update the JSDoc comment at the top of `adws/adwInit.tsx` to reflect the new workflow step:
  - Change step 3 from "Commit the generated files" to "Commit the generated files"
  - Add step 4: "PR Phase: create pull request"
  - Renumber step 4 (Finalize) to step 5

### Step 4: Write unit test
- Create `adws/__tests__/adwInitPrPhase.test.ts`
- Test that the `adwInit.tsx` module imports `executePRPhase` from `./workflowPhases` by reading the source file and verifying the import statement contains `executePRPhase`
- Test that the source code calls `executePRPhase(config)` after `commitChanges()`
- Follow existing test patterns in the `adws/__tests__/` directory (use `describe`/`it` blocks, `fs.readFileSync` to read source)

### Step 5: Run validation commands
- Run all validation commands listed below to ensure zero regressions

## Testing Strategy
### Unit Tests
- Verify `adwInit.tsx` imports `executePRPhase` from `./workflowPhases`
- Verify the source code of `adwInit.tsx` calls `executePRPhase(config)` after `commitChanges` and before `completeWorkflow`
- Verify cost accumulation from PR phase is present in the source

### Edge Cases
- If `executePRPhase` fails, the error should be caught by the existing `try/catch` block and handled by `handleWorkflowError()`
- If there are no uncommitted changes at PR time (already committed), `executePRPhase` handles this gracefully (it checks `hasUncommittedChanges` internally)
- Recovery mode: `shouldExecuteStage('pr_created', recoveryState)` inside `executePRPhase` handles skipping if already done

## Acceptance Criteria
- `adws/adwInit.tsx` imports and calls `executePRPhase(config)` after committing `.adw/` files
- PR phase cost and model usage are accumulated into workflow totals
- The orchestrator JSDoc header documents the PR phase step
- A unit test verifies the PR phase integration in the source code
- All existing tests pass with zero regressions
- Lint, type check, and build all pass cleanly

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `npm run lint` — Run linter to check for code quality issues
- `npx tsc --noEmit` — Type check the Next.js project
- `npx tsc --noEmit -p adws/tsconfig.json` — Type check the ADW scripts
- `npm test` — Run all tests to validate zero regressions
- `npm run build` — Build the application to verify no build errors

## Notes
- IMPORTANT: Strictly adhere to the coding guidelines in `guidelines/coding_guidelines.md`.
- The change follows the exact same pattern used in `adwPlanBuild.tsx` (lines 113-116) for integrating the PR phase.
- No new dependencies or libraries are needed.
- The `executePRPhase` function already handles all PR creation complexity (pushing, creating PR, posting comments). We only need to call it and accumulate costs.
