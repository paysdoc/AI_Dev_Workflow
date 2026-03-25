# Feature: Extend compaction recovery to test and review phases

## Metadata
issueNumber: `299`
adwId: `u7lut9-extend-compaction-re`
issueJson: `{"number":299,"title":"Extend compaction recovery to test and review phases","body":"## Problem\n\nIssue #298 adds compaction detection and restart for the build agent only. The test retry and review retry phases are also long-running and could hit context compaction, but they lack the continuation loop to recover from it.\n\n## Depends on\n\n- #298 — Detect context compaction and restart build agent with fresh context\n\n## Solution\n\nAdd compaction recovery (handling `compactionDetected` on `AgentResult`) to:\n\n1. **`testPhase.ts`** — test retry loop. When compaction is detected mid-test-resolution, restart the test agent with fresh context.\n2. **`prReviewPhase.ts`** — review retry loop. When compaction is detected mid-review-resolution, restart the review agent with fresh context.\n\nBoth should reuse the same pattern established in #298: increment the shared continuation counter, rebuild the prompt with partial output, and re-spawn the agent.\n\n### Comment types\n\nEach phase should have its own `compaction_recovery` comment variant so observers can distinguish which phase triggered the restart.","state":"OPEN","author":"paysdoc","labels":[],"createdAt":"2026-03-25T11:49:03Z","comments":[],"actionableComment":null}`

## Feature Description
Issue #298 added compaction detection and recovery for the build agent only. When Claude Code compacts the conversation context (a lossy operation), the build agent is killed and restarted with fresh context. This feature extends that same recovery mechanism to the test and review phases, which are also long-running and can hit context compaction.

The test phase uses `retryWithResolution` to run test agents and resolver agents. The review phase runs parallel review agents, patch agents, and build agents. Any of these agents can trigger compaction. Currently, when compaction is detected in these phases, the agent is killed and returns `success: true` with `compactionDetected: true`, but the phases don't check this flag — they treat the result as if the agent completed normally, leading to degraded output.

## User Story
As an ADW operator
I want compaction recovery in the test and review phases
So that long-running test resolution and review cycles can survive context compaction without producing degraded output

## Problem Statement
The test retry loop (`retryWithResolution` in `testRetry.ts`) and the review retry loop (`runReviewWithRetry` in `reviewRetry.ts`) call agents that can trigger context compaction. When compaction fires, the agent is killed and returns `compactionDetected: true`, but neither retry mechanism checks this flag. The result is treated as a normal success/failure, leading to incomplete or degraded agent output being consumed by downstream logic.

## Solution Statement
Reuse the compaction recovery pattern from the build phase (#298):

1. **Detect** `compactionDetected` on agent results in the test and review retry loops.
2. **Restart** the agent with fresh context (without counting it as a retry attempt).
3. **Post** phase-specific compaction recovery comments so observers can distinguish which phase triggered the restart.
4. **Limit** restarts using the shared `MAX_TOKEN_CONTINUATIONS` counter to prevent infinite loops.

The implementation adds compaction handling at two levels:
- **`retryWithResolution`** (generic retry orchestrator) — detects compaction on the `run()` callback result and re-invokes without incrementing the retry counter.
- **`reviewRetry.ts`** — wraps each agent call (review, patch, build) with compaction detection and re-invocation.

Each phase gets its own comment variant: `test_compaction_recovery` for the test phase and `review_compaction_recovery` for the review phase. The PR review workflow gets `pr_review_compaction_recovery` for its test/build phases.

## Relevant Files
Use these files to implement the feature:

- `adws/types/workflowTypes.ts` — Add new `WorkflowStage` union members (`test_compaction_recovery`, `review_compaction_recovery`) and new `PRReviewWorkflowStage` member (`pr_review_compaction_recovery`).
- `adws/types/agentTypes.ts` — Reference for `AgentResult.compactionDetected` field (read-only, no changes needed).
- `adws/core/workflowCommentParsing.ts` — Add `STAGE_HEADER_MAP` entries for the new compaction recovery stages.
- `adws/core/config.ts` — Reference for `MAX_TOKEN_CONTINUATIONS` constant (read-only, no changes needed).
- `adws/core/retryOrchestrator.ts` — Add compaction detection to the `retryWithResolution` loop and extend `RetryConfig`/`RetryResult` to support compaction callbacks and continuation tracking.
- `adws/agents/testRetry.ts` — Propagate compaction detection through `runUnitTestsWithRetry`, `runE2ETestsWithRetry`, and `runBddScenariosWithRetry`. Add `compactionDetected` and `continuationCount` to `TestRetryResult`.
- `adws/agents/reviewRetry.ts` — Add compaction detection around `runReviewAgent`, `runPatchAgent`, and `runBuildAgent` calls. Add `compactionDetected` and `continuationCount` to `ReviewRetryResult`.
- `adws/github/workflowCommentsIssue.ts` — Add `formatTestCompactionRecoveryComment()` and `formatReviewCompactionRecoveryComment()` functions; wire them into the `formatWorkflowComment()` switch.
- `adws/github/workflowCommentsPR.ts` — Add `pr_review_compaction_recovery` case to `formatPRReviewWorkflowComment()`.
- `adws/phases/testPhase.ts` — Post `test_compaction_recovery` comments and track continuation count in phase cost records.
- `adws/phases/workflowCompletion.ts` — Post `review_compaction_recovery` comments and track continuation count in phase cost records.
- `adws/phases/prReviewCompletion.ts` — Post `pr_review_compaction_recovery` comments from the PR review test phase.
- `adws/phases/buildPhase.ts` — Reference for the established compaction recovery pattern (read-only).
- `adws/phases/planPhase.ts` — Reference for `buildContinuationPrompt()` (read-only, no changes needed).
- `adws/phases/phaseCommentHelpers.ts` — Reference for `postIssueStageComment()` and `postPRStageComment()` (read-only, no changes needed).
- `guidelines/coding_guidelines.md` — Must follow these guidelines during implementation.
- `app_docs/feature-9zcqhw-detect-compaction-restart-build-agent.md` — Reference documentation for the #298 compaction recovery pattern.

### New Files
No new source files are needed. All changes are additions to existing files.

## Implementation Plan
### Phase 1: Foundation — Types and Comments
Add the new workflow stage types and comment formatters so that the recovery mechanism has the infrastructure to post distinct phase-specific comments.

1. Extend `WorkflowStage` in `adws/types/workflowTypes.ts` with `test_compaction_recovery` and `review_compaction_recovery`.
2. Extend `PRReviewWorkflowStage` in `adws/types/workflowTypes.ts` with `pr_review_compaction_recovery`.
3. Add `STAGE_HEADER_MAP` entries in `adws/core/workflowCommentParsing.ts` for the two new issue-workflow stages.
4. Add `formatTestCompactionRecoveryComment()` and `formatReviewCompactionRecoveryComment()` in `adws/github/workflowCommentsIssue.ts`. Wire them into the `formatWorkflowComment()` switch.
5. Add `pr_review_compaction_recovery` case to `formatPRReviewWorkflowComment()` in `adws/github/workflowCommentsPR.ts`.

### Phase 2: Core Implementation — Retry-Level Compaction Handling
Add compaction detection and restart logic to the retry orchestrator and the review retry loop.

1. Extend `RetryConfig` in `adws/core/retryOrchestrator.ts` with an optional `onCompactionDetected` callback and a `maxContinuations` limit.
2. In `retryWithResolution`, after `run()` returns, check if the result has `compactionDetected`. If so, invoke the callback, increment a continuation counter, and re-run without incrementing the retry counter.
3. Extend `RetryResult` with `compactionDetected: boolean` and `continuationCount: number`.
4. In `reviewRetry.ts`, wrap each agent call (`runReviewAgent`, `runPatchAgent`, `runBuildAgent`) with a compaction-detection while loop that re-invokes the agent up to `MAX_TOKEN_CONTINUATIONS` times.
5. Extend `ReviewRetryResult` with `compactionDetected: boolean` and `continuationCount: number`.

### Phase 3: Integration — Phase-Level Wiring
Wire the compaction recovery into the phase files that orchestrate tests and reviews.

1. In `testRetry.ts`, add `compactionDetected` and `continuationCount` to `TestRetryResult`. Pass the `onCompactionDetected` callback from the phase to `retryWithResolution`.
2. In `testPhase.ts`, pass a compaction callback to `runUnitTestsWithRetry` that posts `test_compaction_recovery` comments. Track continuation count in phase cost records.
3. In `workflowCompletion.ts` (`executeReviewPhase`), read the `continuationCount` from the review result and record it in phase cost records. Post `review_compaction_recovery` from the `onCompactionDetected` callback passed through to `reviewRetry`.
4. In `prReviewCompletion.ts` (`executePRReviewTestPhase`), pass a compaction callback that posts `pr_review_compaction_recovery` comments on the PR.

## Step by Step Tasks
Execute every step in order, top to bottom.

### Step 1: Read reference files
- Read `adws/phases/buildPhase.ts` (lines 218-244) to understand the compaction recovery pattern.
- Read `adws/phases/planPhase.ts` `buildContinuationPrompt()` to understand the continuation prompt builder.
- Read `adws/agents/agentProcessHandler.ts` compaction detection to understand what `compactionDetected` means on `AgentResult`.
- Read `guidelines/coding_guidelines.md` and follow all coding guidelines.

### Step 2: Extend WorkflowStage and PRReviewWorkflowStage types
- In `adws/types/workflowTypes.ts`, add `'test_compaction_recovery'` and `'review_compaction_recovery'` to the `WorkflowStage` union type (after the existing `'compaction_recovery'` entry).
- In the same file, add `'pr_review_compaction_recovery'` to the `PRReviewWorkflowStage` union type.

### Step 3: Add STAGE_HEADER_MAP entries
- In `adws/core/workflowCommentParsing.ts`, add two new entries to `STAGE_HEADER_MAP`:
  - `':warning: Test Compaction Recovery': 'test_compaction_recovery'`
  - `':warning: Review Compaction Recovery': 'review_compaction_recovery'`

### Step 4: Add comment format functions for issue workflow
- In `adws/github/workflowCommentsIssue.ts`, add `formatTestCompactionRecoveryComment(ctx)` that produces a comment like: `## :warning: Test Compaction Recovery\n\nThe test agent's context was compacted by Claude Code...`. Include `ctx.tokenContinuationNumber` and `ctx.adwId`.
- Add `formatReviewCompactionRecoveryComment(ctx)` with similar structure but referencing "The review agent's context...".
- Wire both into the `formatWorkflowComment()` switch statement:
  - `case 'test_compaction_recovery': return formatTestCompactionRecoveryComment(ctx);`
  - `case 'review_compaction_recovery': return formatReviewCompactionRecoveryComment(ctx);`

### Step 5: Add PR review compaction comment
- In `adws/github/workflowCommentsPR.ts`, add a `'pr_review_compaction_recovery'` case to `formatPRReviewWorkflowComment()` that produces a compaction recovery comment for the PR review workflow. Reference "The PR review agent's context...".

### Step 6: Extend retryOrchestrator with compaction support
- In `adws/core/retryOrchestrator.ts`:
  - Add `compactionDetected?: boolean` to `AgentRunResult` interface.
  - Add optional `onCompactionDetected?: (continuationNumber: number) => void` and `maxContinuations?: number` to `RetryConfig`.
  - Add `continuationCount: number` and `compactionDetected: boolean` to `RetryResult`.
  - In the `retryWithResolution` loop body, after `const result = await run()` and `trackCost(...)`, check `(result as any).compactionDetected`. If true:
    - Increment a `continuationCount` local variable.
    - Check against `maxContinuations` (default `MAX_TOKEN_CONTINUATIONS`). If exceeded, break with error.
    - Call `onCompactionDetected?.(continuationCount)`.
    - Log the compaction detection.
    - `continue` without incrementing `retryCount`.
  - Return `continuationCount` and `compactionDetected` (whether any compaction occurred) in the result.

### Step 7: Extend TestRetryResult and propagate compaction
- In `adws/agents/testRetry.ts`:
  - Add `compactionDetected?: boolean` and `continuationCount?: number` to `TestRetryResult`.
  - Add optional `onCompactionDetected?: (continuationNumber: number) => void` to `TestRetryOptions`.
  - In `runUnitTestsWithRetry`, pass `onCompactionDetected` and `maxContinuations: MAX_TOKEN_CONTINUATIONS` through to `retryWithResolution`. Import `MAX_TOKEN_CONTINUATIONS` from `../core`.
  - Propagate `result.continuationCount` and `result.compactionDetected` to the returned `TestRetryResult`.
  - Apply the same changes to `runE2ETestsWithRetry` and `runBddScenariosWithRetry`.

### Step 8: Add compaction recovery to reviewRetry.ts
- In `adws/agents/reviewRetry.ts`:
  - Import `MAX_TOKEN_CONTINUATIONS` from `../core`.
  - Add `onCompactionDetected?: (continuationNumber: number, phase: string) => void` to `ReviewRetryOptions`.
  - Add `compactionDetected: boolean` and `continuationCount: number` to `ReviewRetryResult`.
  - Track a `continuationCount` variable across the retry loop.
  - After each `runReviewAgent()` result in the `Promise.all`, check `compactionDetected`. If detected on any agent, re-run that specific agent (wrap individual agent calls with a compaction while loop, up to `MAX_TOKEN_CONTINUATIONS`). Call `onCompactionDetected?.(count, 'review')`.
  - After `runPatchAgent()`, check `compactionDetected`. If detected, re-run the patch agent.
  - After `runBuildAgent()`, check `compactionDetected`. If detected, re-run the build agent.
  - Return `compactionDetected` and `continuationCount` in the result.

### Step 9: Wire compaction comments into testPhase.ts
- In `adws/phases/testPhase.ts`:
  - Import `MAX_TOKEN_CONTINUATIONS` from `../core`.
  - Pass an `onCompactionDetected` callback to `runUnitTestsWithRetry` that:
    - Sets `ctx.tokenContinuationNumber = continuationNumber`.
    - Posts `test_compaction_recovery` comment via `postIssueStageComment(repoContext, issueNumber, 'test_compaction_recovery', ctx)`.
  - Read `continuationCount` from the unit test result and pass it to `createPhaseCostRecords`.

### Step 10: Wire compaction comments into workflowCompletion.ts (review phase)
- In `adws/phases/workflowCompletion.ts` (`executeReviewPhase`):
  - Pass an `onCompactionDetected` callback through `ReviewRetryOptions` that:
    - Sets `ctx.tokenContinuationNumber = continuationNumber`.
    - Posts `review_compaction_recovery` comment via `postIssueStageComment(repoContext, issueNumber, 'review_compaction_recovery', ctx)`.
  - Read `continuationCount` from the review result and pass it to `createPhaseCostRecords`.

### Step 11: Wire compaction comments into prReviewCompletion.ts (PR review test phase)
- In `adws/phases/prReviewCompletion.ts` (`executePRReviewTestPhase`):
  - Pass an `onCompactionDetected` callback to `runUnitTestsWithRetry` and `runE2ETestsWithRetry` that:
    - Posts `pr_review_compaction_recovery` comment via `postPRStageComment(repoContext, prNumber, 'pr_review_compaction_recovery', ctx)`.

### Step 12: Validate — Lint and type-check
- Run `bun run lint` to check for code quality issues.
- Run `bunx tsc --noEmit` to verify TypeScript compilation.
- Run `bunx tsc --noEmit -p adws/tsconfig.json` to verify adws-specific types.

### Step 13: Validate — Build
- Run `bun run build` to verify no build errors.

### Step 14: Validate — BDD scenarios
- Run `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` to verify no regressions in existing BDD scenarios.

## Testing Strategy
### Edge Cases
- **Multiple compactions in one phase**: The `MAX_TOKEN_CONTINUATIONS` counter must apply across all compaction and token-limit restarts within a single phase. Verify the counter is shared.
- **Compaction during parallel review agents**: If one of three parallel review agents hits compaction, only that agent should be restarted. The other two results should be preserved.
- **Compaction in the resolution agent**: When `runResolveTestAgent` or `runPatchAgent` hits compaction, it should be restarted independently of the retry counter.
- **Compaction + test failure**: If compaction fires and the re-run then discovers test failures, the normal failure-resolution flow should continue (compaction is a restart mechanism, not a failure).
- **MAX_TOKEN_CONTINUATIONS exceeded**: When the continuation limit is reached, the phase should throw/fail cleanly with a descriptive error.
- **No compaction**: When no agents trigger compaction, the phases should behave identically to before (zero regression).

## Acceptance Criteria
- When a test agent's context is compacted, the test phase detects `compactionDetected` on the agent result, restarts the agent, and posts a `test_compaction_recovery` comment on the GitHub issue.
- When a review/patch/build agent's context is compacted during the review phase, the agent is restarted and a `review_compaction_recovery` comment is posted on the GitHub issue.
- When a PR review agent's context is compacted, the agent is restarted and a `pr_review_compaction_recovery` comment is posted on the PR.
- The shared `MAX_TOKEN_CONTINUATIONS` counter prevents infinite restart loops across all compaction and token-limit restarts within a phase.
- Cost is accumulated correctly across compaction restarts (no cost data lost).
- The `continuationCount` is reported in phase cost records.
- All existing BDD scenarios pass with zero regressions.
- TypeScript compiles without errors.
- Linter passes with no new warnings.

## Validation Commands
Execute every command to validate the feature works correctly with zero regressions.

- `bun run lint` — Run linter to check for code quality issues.
- `bunx tsc --noEmit` — Type-check the project.
- `bunx tsc --noEmit -p adws/tsconfig.json` — Type-check the adws module specifically.
- `bun run build` — Build the application to verify no build errors.
- `NODE_OPTIONS="--import tsx" bunx cucumber-js --tags "@regression"` — Run regression BDD scenarios to validate zero regressions.

## Notes
- Follow `guidelines/coding_guidelines.md` strictly. Refactor as needed to stay under 300 lines per file, use immutable data patterns, and avoid `any` types (use type narrowing for `compactionDetected` check).
- The `compactionDetected` field already exists on `AgentResult` (added in #298). No changes to `agentProcessHandler.ts` are needed.
- The `buildContinuationPrompt()` function in `planPhase.ts` is specific to the build agent's continuation context and is not needed for test/review phases. Test and review agents are simply re-invoked — they don't need a "continuation prompt" because they re-read the working tree and test/review from scratch.
- The `retryWithResolution` abstraction needs the lightest possible change: detect compaction on the `run()` result, callback, and re-invoke without counting as a retry.
- For `reviewRetry.ts`, compaction in a single parallel agent should only restart that agent, not all three. Use individual per-agent compaction loops rather than restarting the entire parallel batch.
