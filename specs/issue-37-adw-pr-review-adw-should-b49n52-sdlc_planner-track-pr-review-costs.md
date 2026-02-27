# Feature: Track PR Review Workflow Costs

## Metadata
issueNumber: `37`
adwId: `pr-review-adw-should-b49n52`
issueJson: `{"number":37,"title":"PR Review adw should also track costs.","body":"Whenever a PR review takes place, nothing is changed in the issue's token costs. However, tokens are being used to resolve the issue. \n\nThe relevant csv file needs to be updated to update the token costs by\n - adding the tokens used for the review\n - recalculating the costs\n\nThe total cost for the project should also be updated.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-02-27T07:57:00Z","comments":[],"actionableComment":null}`

## Feature Description
The PR review workflow (`adwPrReview.tsx`) runs Claude agents across plan, build, and test phases but does not track or persist the token costs incurred during these phases. Regular workflows (e.g., `adwSdlc.tsx`, `adwPlanBuild.tsx`) aggregate `modelUsage` from every agent result using `mergeModelUsageMaps()`, write per-issue CSV files via `writeIssueCostCsv()`, update the project total via `updateProjectCostCsv()`, and include cost breakdowns in completion comments. The PR review workflow does none of this. This feature adds cost aggregation, CSV persistence, and cost reporting to the PR review workflow so that every token consumed during a PR review is properly accounted for.

## User Story
As a project maintainer
I want PR review workflows to track and persist their token costs
So that the issue's cost CSV and the project's total cost CSV accurately reflect all tokens used to resolve an issue, including those spent during PR review cycles.

## Problem Statement
When a PR review takes place via `adwPrReview.tsx`, the plan agent, build agent, and test retry agents all consume tokens. However, the `modelUsage` data returned by these agents is currently discarded — `executePRReviewPlanPhase()`, `executePRReviewBuildPhase()`, and `executePRReviewTestPhase()` do not return cost data, and `completePRReviewWorkflow()` does not write CSV files. This means PR review costs are invisible in the project's cost tracking, understating the true cost of resolving an issue.

## Solution Statement
1. **Return cost data from each PR review phase function** — modify `executePRReviewPlanPhase()`, `executePRReviewBuildPhase()`, and `executePRReviewTestPhase()` to capture `modelUsage` and `totalCostUsd` from their agent results and return them.
2. **Aggregate costs in the orchestrator** — update `adwPrReview.tsx` to accumulate costs across all phases using `mergeModelUsageMaps()` and `persistTokenCounts()`, following the same pattern used by `adwSdlc.tsx`.
3. **Write CSV files in the completion function** — enhance `completePRReviewWorkflow()` to call `writeIssueCostCsv()` and `updateProjectCostCsv()` when `modelUsage` is provided, mirroring the logic in `completeWorkflow()`.
4. **Include cost breakdown in completion comments** — the existing `costBreakdown` support in `completePRReviewWorkflow()` already handles this when `modelUsage` is passed; the orchestrator just needs to pass the aggregated data.

## Relevant Files
Use these files to implement the feature:

- `adws/adwPrReview.tsx` — The PR review orchestrator. Needs cost aggregation logic added (accumulate costs from each phase, pass to completion).
- `adws/phases/prReviewPhase.ts` — PR review phase functions. Each phase needs to return cost data (`costUsd`, `modelUsage`) from agent results.
- `adws/phases/workflowLifecycle.ts` — Contains `completeWorkflow()` with the CSV writing pattern to replicate. Reference only.
- `adws/core/costTypes.ts` — Type definitions for `ModelUsage`, `ModelUsageMap`, `CostBreakdown`. Reference only.
- `adws/core/costReport.ts` — Contains `mergeModelUsageMaps()`, `buildCostBreakdown()`, `persistTokenCounts()`. Reference only.
- `adws/core/costCsvWriter.ts` — Contains `writeIssueCostCsv()`, `updateProjectCostCsv()`. Will be called from `completePRReviewWorkflow()`.
- `adws/agents/claudeAgent.ts` — Defines `AgentResult` with `modelUsage` and `totalCostUsd` fields. Reference only.
- `adws/agents/testRetry.ts` — `TestRetryResult` includes `modelUsage` and `costUsd`. Reference only.
- `adws/github/githubApi.ts` — `getRepoInfo()` to derive the repo name for CSV paths.
- `adws/__tests__/adwPrReview.test.ts` — Existing PR review tests. Will be extended with cost tracking tests.
- `guidelines/coding_guidelines.md` — Coding guidelines to follow.

### New Files
- `adws/__tests__/prReviewCostTracking.test.ts` — Unit tests for the new cost tracking behavior in PR review phases and completion.

## Implementation Plan
### Phase 1: Foundation
Modify the PR review phase functions in `prReviewPhase.ts` to capture and return cost data from agent results. Each phase function (`executePRReviewPlanPhase`, `executePRReviewBuildPhase`, `executePRReviewTestPhase`) currently discards the `modelUsage` and `totalCostUsd` from its `AgentResult`. Update their return types to include `costUsd` and `modelUsage`, and extract these values from the agent results.

### Phase 2: Core Implementation
Update `completePRReviewWorkflow()` to write cost CSV files when `modelUsage` is provided. This mirrors the pattern in `completeWorkflow()` from `workflowLifecycle.ts`: determine the repo name via `getRepoInfo()`, compute the EUR rate from the cost breakdown, and call `writeIssueCostCsv()` and `updateProjectCostCsv()`. The issue title can be derived from `prDetails.title` (the PR title serves as the issue description in cost CSVs).

### Phase 3: Integration
Update the orchestrator `adwPrReview.tsx` to aggregate costs across phases using the same pattern as `adwSdlc.tsx`: initialize running totals, accumulate from each phase result, call `persistTokenCounts()` after each phase, and pass the final aggregated `modelUsage` to `completePRReviewWorkflow()`.

## Step by Step Tasks
IMPORTANT: Execute every step in order, top to bottom.

### Step 1: Update `executePRReviewPlanPhase()` return type and capture cost data
- Change the return type from `Promise<{ planOutput: string }>` to `Promise<{ planOutput: string; costUsd: number; modelUsage: ModelUsageMap }>`
- Extract `totalCostUsd` and `modelUsage` from `planResult` (which is an `AgentResult`)
- Return `costUsd` and `modelUsage` alongside `planOutput`
- Import `emptyModelUsageMap` from `../core` if not already imported

### Step 2: Update `executePRReviewBuildPhase()` return type and capture cost data
- Change the return type from `Promise<void>` to `Promise<{ costUsd: number; modelUsage: ModelUsageMap }>`
- Extract `totalCostUsd` and `modelUsage` from `buildResult` (which is an `AgentResult`)
- Return `costUsd` and `modelUsage`

### Step 3: Update `executePRReviewTestPhase()` return type and capture cost data
- Change the return type from `Promise<void>` to `Promise<{ costUsd: number; modelUsage: ModelUsageMap }>`
- `runUnitTestsWithRetry()` and `runE2ETestsWithRetry()` already return `TestRetryResult` which includes `costUsd` and `modelUsage`
- Aggregate costs from both unit test and E2E test results using `mergeModelUsageMaps()`
- Return the combined `costUsd` and `modelUsage`
- Import `mergeModelUsageMaps` and `emptyModelUsageMap` from `../core` if not already imported

### Step 4: Update `completePRReviewWorkflow()` to write CSV files
- When `modelUsage` is provided and non-empty, after building the cost breakdown:
  - Determine `repoName` using `getRepoInfo()` from `../github/githubApi`
  - Determine `issueTitle` from `config.prDetails.title` (the PR title)
  - Determine `issueNumber` from `config.issueNumber`
  - Compute `eurRate` from the cost breakdown currencies
  - Call `writeIssueCostCsv()` with the ADW repo root (use `process.cwd()` since PR review runs in the ADW repo context)
  - Call `updateProjectCostCsv()` with the same parameters
  - Wrap CSV writes in try/catch to prevent failures from disrupting the workflow
- Import `writeIssueCostCsv`, `updateProjectCostCsv` from `../core`
- Import `getRepoInfo` from `../github/githubApi`
- Persist cost metadata to `orchestratorStatePath` (add `totalCostUsd` and `modelUsage` to the final state write)

### Step 5: Update `adwPrReview.tsx` orchestrator to aggregate costs
- Import `mergeModelUsageMaps`, `persistTokenCounts`, `emptyModelUsageMap` from `./core`
- Initialize cost accumulators: `let totalCostUsd = 0; let totalModelUsage: ModelUsageMap = {};`
- After `executePRReviewPlanPhase()`: accumulate `costUsd` and merge `modelUsage`, call `persistTokenCounts()`
- After `executePRReviewBuildPhase()`: accumulate `costUsd` and merge `modelUsage`, call `persistTokenCounts()`
- After `executePRReviewTestPhase()`: accumulate `costUsd` and merge `modelUsage`, call `persistTokenCounts()`
- Pass `totalModelUsage` to `completePRReviewWorkflow(config, totalModelUsage)`
- Update `handlePRReviewWorkflowError()` call in the catch block to pass `totalCostUsd` and `totalModelUsage` for crash recovery

### Step 6: Update `handlePRReviewWorkflowError()` to persist cost data on failure
- Add optional `costUsd` and `modelUsage` parameters to the function signature
- Call `persistTokenCounts()` before writing the failed state, matching the pattern in `handleWorkflowError()`
- Import `persistTokenCounts` from `../core` and `ModelUsageMap` type

### Step 7: Write unit tests for PR review cost tracking
- Create `adws/__tests__/prReviewCostTracking.test.ts`
- Test that `executePRReviewPlanPhase()` returns `costUsd` and `modelUsage` from agent result
- Test that `executePRReviewBuildPhase()` returns `costUsd` and `modelUsage` from agent result
- Test that `executePRReviewTestPhase()` aggregates costs from unit and E2E test results
- Test that `completePRReviewWorkflow()` calls `writeIssueCostCsv()` and `updateProjectCostCsv()` when `modelUsage` is provided
- Test that `completePRReviewWorkflow()` does not write CSVs when `modelUsage` is empty or undefined
- Test that CSV write failures do not throw (are caught and logged)
- Mock agent runners, CSV writers, and `getRepoInfo()`

### Step 8: Run validation commands
- Run all validation commands listed below to ensure zero regressions.

## Testing Strategy
### Unit Tests
- Test each PR review phase function returns cost data correctly
- Test cost aggregation across phases (merging model usage maps)
- Test `completePRReviewWorkflow()` CSV writing behavior (with and without `modelUsage`)
- Test error isolation (CSV write failures don't propagate)
- Test `handlePRReviewWorkflowError()` persists cost data before exiting
- Mock all external dependencies (Claude agents, file system, git operations)

### Edge Cases
- `modelUsage` is undefined (no cost data available) — should skip CSV writing
- `modelUsage` is an empty object — should skip CSV writing
- `issueNumber` is 0 (no issue linked to PR) — CSV should still be written with issue number 0
- CSV write throws an error — should be caught and logged, not propagate
- One phase fails mid-workflow — costs accumulated so far should be persisted via `persistTokenCounts()`
- EUR exchange rate fetch fails — should use 0 as rate (matches existing behavior)

## Acceptance Criteria
- PR review plan phase returns `costUsd` and `modelUsage` from the plan agent result
- PR review build phase returns `costUsd` and `modelUsage` from the build agent result
- PR review test phase returns aggregated `costUsd` and `modelUsage` from unit and E2E test results
- The PR review orchestrator accumulates costs across all phases and calls `persistTokenCounts()` after each phase
- `completePRReviewWorkflow()` writes per-issue cost CSV and updates project total cost CSV when `modelUsage` is provided
- Cost breakdown is included in the PR review completion comment
- CSV write failures are caught and logged without disrupting the workflow
- Accumulated cost data is persisted even if the workflow fails mid-execution
- All existing tests continue to pass
- TypeScript type checks pass with no errors
- Linting passes with no errors

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `npm run lint` - Run linter to check for code quality issues
- `npx tsc --noEmit` - Run type checker for the main project
- `npx tsc --noEmit -p adws/tsconfig.json` - Run type checker for the adws project
- `npm test` - Run all tests to validate zero regressions
- `npm run build` - Build the application to verify no build errors

## Notes
- The `guidelines/coding_guidelines.md` file mandates strict TypeScript, immutability, and modularity. All changes follow these guidelines.
- The existing `completePRReviewWorkflow()` already accepts `modelUsage` and builds a `costBreakdown` for comments — this feature completes the cost tracking by also writing CSV files and having the orchestrator actually pass cost data.
- The PR title is used as the issue title/description for CSV file naming since the PR review workflow doesn't fetch the full issue object — this matches the existing behavior in `webhookHandlers.ts` where `pull_request.title` serves as the issue title.
- The `repoName` is derived from `getRepoInfo()` (which reads the git remote URL) since `PRReviewWorkflowConfig` doesn't carry a `targetRepo` or `repoInfo` by default. When `repoInfo` is present on the config, prefer that.
- The `adwRepoRoot` for CSV paths should be `process.cwd()` since the PR review orchestrator runs in the ADW repo root, not in a worktree of the target repo.
