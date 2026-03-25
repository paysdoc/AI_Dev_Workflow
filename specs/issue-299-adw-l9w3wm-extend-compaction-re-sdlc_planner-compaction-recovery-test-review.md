# Feature: Extend compaction recovery to test and review phases

## Metadata
issueNumber: `299`
adwId: `l9w3wm-extend-compaction-re`
issueJson: `{"number":299,"title":"Extend compaction recovery to test and review phases","body":"## Problem\n\nIssue #298 adds compaction detection and restart for the build agent only. The test retry and review retry phases are also long-running and could hit context compaction, but they lack the continuation loop to recover from it.\n\n## Depends on\n\n- #298 — Detect context compaction and restart build agent with fresh context\n\n## Solution\n\nAdd compaction recovery (handling `compactionDetected` on `AgentResult`) to:\n\n1. **`testPhase.ts`** — test retry loop. When compaction is detected mid-test-resolution, restart the test agent with fresh context.\n2. **`prReviewPhase.ts`** — review retry loop. When compaction is detected mid-review-resolution, restart the review agent with fresh context.\n\nBoth should reuse the same pattern established in #298: increment the shared continuation counter, rebuild the prompt with partial output, and re-spawn the agent.\n\n### Comment types\n\nEach phase should have its own `compaction_recovery` comment variant so observers can distinguish which phase triggered the restart.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-25T11:49:03Z","comments":[],"actionableComment":null}`

## Feature Description
Extend the context compaction recovery mechanism (introduced in #298 for the build agent) to the test and review retry phases. When Claude Code compacts the conversation context during a long-running test resolution or review resolution agent, the compaction is detected, the agent is terminated, and a fresh agent is spawned to continue the work. Each phase posts its own distinct `compaction_recovery` comment variant so observers can identify which phase triggered the restart.

## User Story
As a workflow operator
I want compaction recovery in the test and review phases
So that long-running test resolution and review resolution agents can survive context compaction without failing the entire workflow

## Problem Statement
Issue #298 added compaction detection and restart for the build agent only. The test retry loop (unit tests, E2E tests, BDD scenarios) and review retry loop (multi-agent review with patch cycle) are also long-running and can hit context compaction, but they currently lack recovery logic. When compaction occurs in these phases, the agent's output quality degrades silently, potentially causing spurious failures or incomplete resolutions.

## Solution Statement
Add `compactionDetected` handling to the retry loops in both phases:

1. **Test phase** — In the generic `retryWithResolution` orchestrator and the specific test retry functions (`runUnitTestsWithRetry`, `runE2ETestsWithRetry`, `runBddScenariosWithRetry`), detect `compactionDetected` on agent results and re-run the agent without counting it as a test failure retry. Post a `test_compaction_recovery` comment.

2. **Review phase** — In the `runReviewWithRetry` loop in `reviewRetry.ts`, detect `compactionDetected` on review agent, patch agent, and build agent results and re-run without counting it as a review iteration. Post a `review_compaction_recovery` comment.

Both phases share the existing `MAX_TOKEN_CONTINUATIONS` limit from `buildPhase.ts` to prevent infinite restart loops. The continuation counter is incremented for each compaction restart across all agent calls within a phase invocation.

## Relevant Files
Use these files to implement the feature:

- `adws/types/workflowTypes.ts` — Add new `WorkflowStage` variants `test_compaction_recovery` and `review_compaction_recovery`
- `adws/types/agentTypes.ts` — Reference for `AgentResult.compactionDetected` field (already exists from #298)
- `adws/core/workflowCommentParsing.ts` — Add `STAGE_HEADER_MAP` entries for the new comment types
- `adws/core/retryOrchestrator.ts` — Add `compactionDetected` to `AgentRunResult` interface; add compaction-aware re-run logic to `retryWithResolution`
- `adws/agents/testRetry.ts` — Wire compaction handling in `runUnitTestsWithRetry`, `runE2ETestsWithRetry`, and `runBddScenariosWithRetry`
- `adws/agents/reviewRetry.ts` — Wire compaction handling in `runReviewWithRetry` for review, patch, and build agent calls
- `adws/phases/testPhase.ts` — Pass compaction recovery callback and post `test_compaction_recovery` comments
- `adws/phases/workflowCompletion.ts` — Pass compaction recovery callback and post `review_compaction_recovery` comments from `executeReviewPhase`
- `adws/phases/prReviewCompletion.ts` — Wire compaction handling in `executePRReviewTestPhase` for the PR review test flow
- `adws/github/workflowCommentsIssue.ts` — Add `formatTestCompactionRecoveryComment()` and `formatReviewCompactionRecoveryComment()` formatters; wire into `formatWorkflowComment()` switch
- `adws/phases/buildPhase.ts` — Reference for the existing compaction recovery pattern (read-only)
- `adws/phases/planPhase.ts` — Reference for `buildContinuationPrompt()` (read-only, may be reused if resolution agents need continuation prompts)
- `guidelines/coding_guidelines.md` — Follow coding guidelines
- `app_docs/feature-9zcqhw-detect-compaction-restart-build-agent.md` — Reference documentation for the #298 build agent compaction pattern

### New Files
No new files needed. All changes are modifications to existing files.

## Implementation Plan
### Phase 1: Foundation — Types and Comment Infrastructure
Add the new workflow stage types and comment formatting functions. This establishes the type system and comment infrastructure that both phases will use.

- Add `test_compaction_recovery` and `review_compaction_recovery` to the `WorkflowStage` union type
- Add corresponding `STAGE_HEADER_MAP` entries for workflow comment parsing
- Add `formatTestCompactionRecoveryComment()` and `formatReviewCompactionRecoveryComment()` to `workflowCommentsIssue.ts`
- Wire both formatters into the `formatWorkflowComment()` switch statement

### Phase 2: Core Implementation — Retry Orchestrator and Agent Retry Functions
Extend the generic retry infrastructure and specific retry functions to detect and handle compaction.

- Add `compactionDetected?: boolean` to `AgentRunResult` in `retryOrchestrator.ts`
- Add compaction-aware re-run logic to `retryWithResolution`: when `run()` returns `compactionDetected`, re-invoke without incrementing `retryCount`, up to a configurable max continuation limit
- Add `onCompactionDetected` callback to `RetryConfig` so callers can post phase-specific comments
- Wire compaction handling into `runUnitTestsWithRetry`, `runE2ETestsWithRetry`, and `runBddScenariosWithRetry` in `testRetry.ts`
- Wire compaction handling into `runReviewWithRetry` in `reviewRetry.ts` for all agent types (review, patch, build)

### Phase 3: Integration — Phase-Level Wiring
Connect the compaction callbacks in the phase orchestrators to post the correct comment types.

- In `testPhase.ts`: pass an `onCompactionDetected` callback that posts `test_compaction_recovery` via `postIssueStageComment`
- In `workflowCompletion.ts` (`executeReviewPhase`): pass an `onCompactionDetected` callback that posts `review_compaction_recovery` via `postIssueStageComment`
- In `prReviewCompletion.ts` (`executePRReviewTestPhase`): pass an `onCompactionDetected` callback that posts `test_compaction_recovery` via `postPRStageComment`

## Step by Step Tasks

### Step 1: Add workflow stage types
- Add `'test_compaction_recovery'` and `'review_compaction_recovery'` to the `WorkflowStage` type union in `adws/types/workflowTypes.ts`

### Step 2: Add STAGE_HEADER_MAP entries
- In `adws/core/workflowCommentParsing.ts`, add two new entries to `STAGE_HEADER_MAP`:
  - `':warning: Test Compaction Recovery': 'test_compaction_recovery'`
  - `':warning: Review Compaction Recovery': 'review_compaction_recovery'`

### Step 3: Add comment formatting functions
- In `adws/github/workflowCommentsIssue.ts`:
  - Add `formatTestCompactionRecoveryComment(ctx: WorkflowContext): string` — posts a comment indicating the test resolution agent was compacted and restarted. Include continuation number and ADW ID. Follow the same structure as `formatCompactionRecoveryComment()` but with test-phase-specific messaging.
  - Add `formatReviewCompactionRecoveryComment(ctx: WorkflowContext): string` — same pattern for review-phase compaction. Messaging should indicate the review/patch agent was compacted and restarted.
  - Wire both into the `formatWorkflowComment()` switch statement under `case 'test_compaction_recovery'` and `case 'review_compaction_recovery'`

### Step 4: Extend AgentRunResult and retryWithResolution
- In `adws/core/retryOrchestrator.ts`:
  - Add `compactionDetected?: boolean` to the `AgentRunResult` interface
  - Add `onCompactionDetected?: (continuationNumber: number) => void` callback to `RetryConfig`
  - Add `maxContinuations?: number` to `RetryConfig` (defaults to `MAX_TOKEN_CONTINUATIONS` from core)
  - In the `retryWithResolution` loop: after calling `run()`, check `result.compactionDetected`. If true, increment a local continuation counter, call `onCompactionDetected`, and re-run without incrementing `retryCount`. Throw if continuations exceed `maxContinuations`.
  - Similarly, after calling `resolveFailures()`, check if the returned `AgentRunResult` has `compactionDetected` and handle accordingly.

### Step 5: Wire compaction handling in test retry functions
- In `adws/agents/testRetry.ts`:
  - In `runUnitTestsWithRetry()`: pass `onCompactionDetected` from the caller through to `retryWithResolution`
  - Add `onCompactionDetected` to `TestRetryOptions` interface
  - In `runE2ETestsWithRetry()`: add compaction detection in the E2E retry loop. When `runResolveE2ETestAgent()` returns with `compactionDetected`, re-run the resolution agent without incrementing the retry counter. Call `onCompactionDetected` callback.
  - In `runBddScenariosWithRetry()`: add compaction detection in the BDD retry loop. When `runResolveE2ETestAgent()` returns with `compactionDetected`, re-run without incrementing `totalRetries`. Call `onCompactionDetected` callback.

### Step 6: Wire compaction handling in review retry
- In `adws/agents/reviewRetry.ts`:
  - Add `onCompactionDetected?: (continuationNumber: number) => void` to `ReviewRetryOptions`
  - In the review agent parallel run: after `runReviewAgent()` completes, check each result for `compactionDetected`. If any agent was compacted, re-run that specific agent and merge the new result.
  - In the patch+build sequential loop: after `runPatchAgent()` or `runBuildAgent()`, check `compactionDetected`. If detected, re-run that agent.
  - Track a shared continuation counter across all compaction restarts within a single `runReviewWithRetry` invocation. Throw if it exceeds `MAX_TOKEN_CONTINUATIONS`.
  - Call `onCompactionDetected` callback on each restart.

### Step 7: Wire compaction callbacks in test phase
- In `adws/phases/testPhase.ts`:
  - When calling `runUnitTestsWithRetry()`, pass an `onCompactionDetected` callback that:
    - Sets `ctx.tokenContinuationNumber` to the continuation number
    - Calls `postIssueStageComment(repoContext, issueNumber, 'test_compaction_recovery', ctx)`
    - Logs the compaction event

### Step 8: Wire compaction callbacks in review phase
- In `adws/phases/workflowCompletion.ts` (`executeReviewPhase`):
  - When calling `runReviewWithRetry()`, pass an `onCompactionDetected` callback that:
    - Sets `ctx.tokenContinuationNumber` to the continuation number
    - Calls `postIssueStageComment(repoContext, issueNumber, 'review_compaction_recovery', ctx)`
    - Logs the compaction event

### Step 9: Wire compaction callbacks in PR review test phase
- In `adws/phases/prReviewCompletion.ts` (`executePRReviewTestPhase`):
  - When calling `runUnitTestsWithRetry()` and `runE2ETestsWithRetry()`, pass an `onCompactionDetected` callback that:
    - Sets `ctx.tokenContinuationNumber` to the continuation number
    - Calls `postPRStageComment(repoContext, prNumber, 'test_compaction_recovery', ctx)`
    - Logs the compaction event

### Step 10: Add continuationCount to phase cost records
- In `testPhase.ts`: track total compaction continuations and pass to `createPhaseCostRecords({ continuationCount })` instead of hard-coded `0`
- In `workflowCompletion.ts` (`executeReviewPhase`): track total compaction continuations and pass to `createPhaseCostRecords({ continuationCount })` instead of hard-coded `0`

### Step 11: Validate with linter and type checker
- Run `bun run lint` to check for code quality issues
- Run `bunx tsc --noEmit` to validate TypeScript types
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to validate adws-specific types
- Run `bun run build` to verify no build errors

## Testing Strategy

### Edge Cases
- Compaction detected on the very first test/review agent run (continuation #1)
- Multiple compaction events in a single phase invocation (shared counter increments correctly)
- Compaction counter reaches `MAX_TOKEN_CONTINUATIONS` — should throw an error with descriptive message
- Compaction detected during `resolveFailures` in `retryWithResolution` (not just during `run`)
- Compaction detected on one of three parallel review agents but not the others — only re-run the compacted agent
- Compaction detected simultaneously with `tokenLimitExceeded` — `tokenLimitExceeded` should take precedence (existing behavior in `agentProcessHandler.ts`)
- No `repoContext` available — compaction recovery should still work but skip posting comments

## Acceptance Criteria
- When a test resolution agent's context is compacted, the agent is restarted without counting as a test failure retry, and a `test_compaction_recovery` comment is posted to the issue
- When a review/patch/build agent's context is compacted during the review phase, the agent is restarted without counting as a review iteration, and a `review_compaction_recovery` comment is posted to the issue
- The shared `MAX_TOKEN_CONTINUATIONS` limit prevents infinite restart loops across all compaction events within a phase
- The `test_compaction_recovery` and `review_compaction_recovery` comments are correctly parsed by `STAGE_HEADER_MAP` for workflow recovery
- Phase cost records include the correct `continuationCount` reflecting compaction restarts
- All existing tests pass with zero regressions
- TypeScript type checker passes with no errors

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues
- `bunx tsc --noEmit` — Type check the project
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type check adws-specific code
- `bun run build` — Build the application to verify no build errors
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run regression scenarios to validate zero regressions

## Notes
- Follow `guidelines/coding_guidelines.md` strictly: pure functions, explicit types, meaningful names.
- The `retryWithResolution` changes should be backward-compatible — callers that don't pass `onCompactionDetected` should see no behavioral change.
- The E2E retry loop in `runE2ETestsWithRetry` has its own custom loop (not using `retryWithResolution`), so compaction handling must be added inline there separately.
- Similarly, `runBddScenariosWithRetry` has its own custom loop — handle compaction inline.
- The `runReviewWithRetry` loop in `reviewRetry.ts` handles three different agent types (review, patch, build). Compaction recovery should be per-agent: only re-run the specific agent that was compacted, not all of them.
- For parallel review agents, if one is compacted but others complete normally, re-run only the compacted agent and merge its result with the already-completed results.
